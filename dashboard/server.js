// Project Setu - Local Simulation Bridge & Operations API Server
// Pure Node.js (no npm dependencies needed)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');
const DASHBOARD_DIR = __dirname;
const SCENARIOS_DIR = path.join(ROOT_DIR, 'scenarios');
const TRACES_DIR = path.join(SCENARIOS_DIR, 'traces');

// Locate setu_sim executable
function findSimulator() {
  if (process.env.SETU_SIM_PATH && fs.existsSync(process.env.SETU_SIM_PATH)) {
    return process.env.SETU_SIM_PATH;
  }
  const candidates = [
    // Standard Windows build paths
    path.join(ROOT_DIR, 'build', 'Release', 'setu_sim.exe'),
    path.join(ROOT_DIR, 'build', 'setu_sim.exe'),
    path.join(ROOT_DIR, 'setu_sim.exe'),
    // Standard Linux / Docker / Render build paths
    path.join(ROOT_DIR, 'build', 'setu_sim'),
    path.join(ROOT_DIR, 'build', 'Release', 'setu_sim'),
    path.join(ROOT_DIR, 'setu_sim')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

let activeChildProcess = null;

class InteractiveSimulatorManager {
  constructor() {
    this.process = null;
    this.buffer = '';
    this.eventHistory = [];
    this.sseClients = new Set();
    this.commandQueue = [];
    this.activeCommand = null;
    this.commandTimeoutMs = 8000;
    this.isRunning = false;
    this.simTime = 0;
    this.continuousTimer = null;
    this.config = {
      survivors: 20,
      relays: 5,
      zone: 1200,
      seed: 7,
      sf: 7,
      loss: 0.0,
      path_exp: 3.5
    };
  }

  ensureStarted() {
    if (this.process) return Promise.resolve();
    return this.spawn();
  }

  spawn() {
    const simPath = findSimulator();
    if (!simPath) {
      return Promise.reject(new Error('Simulator binary (setu_sim) not found. Please build the project first.'));
    }
    const args = [
      '--interactive',
      '--survivors', String(this.config.survivors),
      '--relays', String(this.config.relays),
      '--zone', String(this.config.zone),
      '--seed', String(this.config.seed),
      '--sf', String(this.config.sf),
      '--loss', String(this.config.loss),
      '--path-exp', String(this.config.path_exp)
    ];

    console.log(`[Setu API] Spawning interactive simulator: ${simPath} ${args.join(' ')}`);
    this.process = spawn(simPath, args, { cwd: ROOT_DIR });
    this.buffer = '';
    this.eventHistory = [];
    this.simTime = 0;

    return new Promise((resolve, reject) => {
      let resolved = false;

      // 10-second startup watchdog timer
      const startupTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (this.process) {
            try { this.process.kill(); } catch {}
            this.process = null;
          }
          reject(new Error('Simulator process failed to initialize (startup timed out after 10s)'));
        }
      }, 10000);

      this.process.stdout.on('data', chunk => {
        this.buffer += chunk.toString();
        let idx;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          this.handleLine(line);
          if (!resolved && line.includes('"cmd":"ready"')) {
            resolved = true;
            clearTimeout(startupTimer);
            resolve();
          }
        }
      });

      this.process.stderr.on('data', chunk => {
        console.error('[Simulator STDERR]', chunk.toString().trim());
      });

      this.process.on('close', code => {
        console.log(`[Setu API] Simulator process closed with code ${code}`);
        clearTimeout(startupTimer);
        this.process = null;
        this.pauseContinuous();
        this.cleanupPendingCommands(new Error(`Simulator closed prematurely with code ${code}`));
        this.broadcastSSE('sim_closed', { code });
        if (!resolved) {
          resolved = true;
          reject(new Error(`Simulator closed prematurely with code ${code}`));
        }
      });

      this.process.on('error', err => {
        clearTimeout(startupTimer);
        this.process = null;
        this.pauseContinuous();
        this.cleanupPendingCommands(err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
  }

  cleanupPendingCommands(err) {
    if (this.activeCommand) {
      if (this.activeCommand.timeoutId) clearTimeout(this.activeCommand.timeoutId);
      this.activeCommand.reject(err);
      this.activeCommand = null;
    }
    while (this.commandQueue.length > 0) {
      const item = this.commandQueue.shift();
      if (item.timeoutId) clearTimeout(item.timeoutId);
      item.reject(err);
    }
  }

  handleLine(line) {
    try {
      const obj = JSON.parse(line);
      if (obj.ev) {
        if (typeof obj.t === 'number') this.simTime = obj.t;
        this.eventHistory.push(obj);
        if (this.eventHistory.length > 50000) {
          this.eventHistory.shift();
        }
        this.broadcastSSE('event', obj);
        return;
      }
      if (obj.cmd) {
        if (typeof obj.t === 'number') this.simTime = obj.t;
        if (this.activeCommand) {
          const activeCmd = this.activeCommand.cmdObj.cmd;
          if (activeCmd === obj.cmd || obj.cmd === 'ready' || obj.cmd === 'reset') {
            if (this.activeCommand.timeoutId) clearTimeout(this.activeCommand.timeoutId);
            this.activeCommand.resolve(obj);
            this.activeCommand = null;
            this.processNextCommand();
          }
        }
        this.broadcastSSE('status', {
          cmd: obj.cmd,
          t: this.simTime,
          running: this.isRunning,
          ok: obj.ok
        });
      }
    } catch {
      // ignore non-JSON line
    }
  }

  processNextCommand() {
    if (this.activeCommand || this.commandQueue.length === 0) return;
    if (!this.process || !this.process.stdin.writable) {
      this.cleanupPendingCommands(new Error('Simulator process not running or stdin not writable'));
      return;
    }

    const item = this.commandQueue.shift();
    this.activeCommand = item;
    const line = JSON.stringify(item.cmdObj) + '\n';

    item.timeoutId = setTimeout(() => {
      console.error(`[Setu API] Command timed out after ${this.commandTimeoutMs}ms:`, item.cmdObj);
      item.reject(new Error(`Command timed out after ${this.commandTimeoutMs}ms (${item.cmdObj.cmd})`));
      if (this.activeCommand === item) {
        this.activeCommand = null;
      }
      this.processNextCommand();
    }, this.commandTimeoutMs);

    this.process.stdin.write(line, err => {
      if (err) {
        if (item.timeoutId) clearTimeout(item.timeoutId);
        item.reject(err);
        if (this.activeCommand === item) {
          this.activeCommand = null;
        }
        this.processNextCommand();
      }
    });
  }

  sendCommand(cmdObj) {
    if (!this.process || !this.process.stdin.writable) {
      return Promise.reject(new Error('Simulator process not running'));
    }
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ cmdObj, resolve, reject, timeoutId: null });
      this.processNextCommand();
    });
  }

  broadcastSSE(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  startContinuous(stepMs = 50, wallIntervalMs = 50) {
    if (this.continuousTimer) return;
    this.isRunning = true;
    this.continuousTimer = setInterval(async () => {
      if (!this.process || !this.isRunning) {
        this.pauseContinuous();
        return;
      }
      // Yield continuous step if user/API commands are executing or waiting
      if (this.activeCommand || this.commandQueue.length > 0) {
        return;
      }
      try {
        await this.sendCommand({ cmd: 'step', ms: stepMs });
      } catch {
        this.pauseContinuous();
      }
    }, wallIntervalMs);
    this.broadcastSSE('playback', { isRunning: true });
  }

  pauseContinuous() {
    this.isRunning = false;
    if (this.continuousTimer) {
      clearInterval(this.continuousTimer);
      this.continuousTimer = null;
    }
    this.broadcastSSE('playback', { isRunning: false });
  }

  async stopAndReset() {
    this.pauseContinuous();
    if (this.process) {
      try {
        await this.sendCommand({ cmd: 'reset' });
      } catch {
        this.process.kill();
        this.process = null;
        await this.spawn();
      }
    }
  }
}

const simManager = new InteractiveSimulatorManager();

// Ensure traces directory exists
if (!fs.existsSync(TRACES_DIR)) {
  fs.mkdirSync(TRACES_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const DEFAULT_ALLOWED_ORIGINS = [
  'https://project-setu.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173'
];

function getAllowedOrigins() {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins];
}

function getCorsOrigin(req) {
  if (!req || !req.headers) return null;
  const origin = req.headers.origin;
  if (!origin) return null;
  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return origin;
  }
  const allowVercel = process.env.ALLOW_VERCEL_PREVIEWS !== 'false';
  if (allowVercel && /^https:\/\/([a-z0-9_-]+\.)*vercel\.app$/i.test(origin)) {
    return origin;
  }
  if (/^https:\/\/[a-z0-9_-]+\.onrender\.com$/i.test(origin)) {
    return origin;
  }
  return null;
}

function applyCorsHeaders(headers, req) {
  const corsOrigin = getCorsOrigin(req);
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, Accept';
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Max-Age'] = '86400';
    headers['Vary'] = 'Origin';
  }
}

function sendJson(res, statusCode, data, req = null) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8'
  };
  applyCorsHeaders(headers, req);
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message, req = null) {
  sendJson(res, statusCode, { error: message }, req);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({ raw: body });
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin && !getCorsOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'CORS origin not allowed' }));
      return;
    }
    const headers = {};
    applyCorsHeaders(headers, req);
    res.writeHead(204, headers);
    res.end();
    return;
  }

  // --- Live Interactive Simulator Endpoints ---

  // GET /api/events (Server-Sent Events)
  if (req.method === 'GET' && pathname === '/api/events') {
    const sseHeaders = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    };
    applyCorsHeaders(sseHeaders, req);
    res.writeHead(200, sseHeaders);
    res.write(': connected\n\n');

    // Send history if any
    for (const ev of simManager.eventHistory) {
      res.write(`event: event\ndata: ${JSON.stringify(ev)}\n\n`);
    }

    simManager.sseClients.add(res);
    req.on('close', () => {
      simManager.sseClients.delete(res);
    });
    return;
  }

  // POST /api/control/init
  if (req.method === 'POST' && pathname === '/api/control/init') {
    try {
      const body = await parseBody(req);
      const params = body.params || body;
      simManager.config.survivors = Math.min(100, Math.max(1, parseInt(params.survivors, 10) || 20));
      simManager.config.relays = Math.min(30, Math.max(1, parseInt(params.relays, 10) || 5));
      simManager.config.zone = Math.min(5000, Math.max(200, parseFloat(params.zone) || 1200));
      simManager.config.seed = Math.max(0, parseInt(params.seed, 10) || 7);
      if (params.sf) simManager.config.sf = parseInt(params.sf, 10);
      if (params.loss !== undefined) simManager.config.loss = parseFloat(params.loss);
      if (params.path_exp) simManager.config.path_exp = parseFloat(params.path_exp);

      if (!simManager.process) {
        await simManager.spawn();
      } else {
        await simManager.sendCommand({
          cmd: 'init',
          survivors: simManager.config.survivors,
          relays: simManager.config.relays,
          zone: simManager.config.zone,
          seed: simManager.config.seed,
          sf: simManager.config.sf,
          loss: simManager.config.loss,
          path_exp: simManager.config.path_exp
        });
      }
      return sendJson(res, 200, { success: true, config: simManager.config, t: simManager.simTime }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/start
  if (req.method === 'POST' && pathname === '/api/control/start') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const speed = parseFloat(body.speed || 1.0);
      const stepMs = Math.round(50 * speed);
      simManager.startContinuous(stepMs, 50);
      return sendJson(res, 200, { success: true, isRunning: true }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/pause
  if (req.method === 'POST' && pathname === '/api/control/pause') {
    simManager.pauseContinuous();
    return sendJson(res, 200, { success: true, isRunning: false }, req);
  }

  // POST /api/control/step
  if (req.method === 'POST' && pathname === '/api/control/step') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const ms = Math.min(10000, Math.max(1, parseInt(body.ms, 10) || 100));
      const result = await simManager.sendCommand({ cmd: 'step', ms });
      return sendJson(res, 200, { success: true, result, t: simManager.simTime }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/reset
  if (req.method === 'POST' && pathname === '/api/control/reset') {
    try {
      await simManager.stopAndReset();
      return sendJson(res, 200, { success: true, t: 0 }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/trigger
  if (req.method === 'POST' && pathname === '/api/control/trigger') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const node = parseInt(body.node, 10);
      const kind = String(body.kind || 'short').replace('_', '-');
      const result = await simManager.sendCommand({ cmd: 'trigger', node, kind });
      return sendJson(res, 200, { success: true, result }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/trigger-all
  if (req.method === 'POST' && pathname === '/api/control/trigger-all') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const kind = String(body.kind || 'short').replace('_', '-');
      const delayMs = typeof body.delay_ms !== 'undefined' && !isNaN(parseInt(body.delay_ms, 10))
        ? parseInt(body.delay_ms, 10)
        : 0;
      const mode = String(body.mode || (delayMs > 0 ? 'staggered' : 'immediate'));
      const result = await simManager.sendCommand({ cmd: 'trigger_all', kind, mode, delay_ms: delayMs });
      return sendJson(res, 200, { success: true, result, t: simManager.simTime }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/node-state
  if (req.method === 'POST' && pathname === '/api/control/node-state') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const cmdObj = { cmd: 'set_node', node: parseInt(body.node, 10) };
      if (body.online !== undefined) cmdObj.online = Boolean(body.online);
      if (body.gnss !== undefined) cmdObj.gnss = Boolean(body.gnss);
      if (body.dr !== undefined) cmdObj.dr = Boolean(body.dr);
      if (body.battery !== undefined) cmdObj.battery = parseInt(body.battery, 10);
      const result = await simManager.sendCommand(cmdObj);
      return sendJson(res, 200, { success: true, result }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/reposition
  if (req.method === 'POST' && pathname === '/api/control/reposition') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const node = parseInt(body.node, 10);
      const x = parseFloat(body.x);
      const y = parseFloat(body.y);
      const result = await simManager.sendCommand({ cmd: 'reposition', node, x, y });
      return sendJson(res, 200, { success: true, result }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/block-link
  if (req.method === 'POST' && pathname === '/api/control/block-link') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const a = parseInt(body.a, 10);
      const b = parseInt(body.b, 10);
      const blocked = body.blocked !== undefined ? Boolean(body.blocked) : true;
      const result = await simManager.sendCommand({ cmd: 'block_link', a, b, blocked });
      return sendJson(res, 200, { success: true, result }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/control/state
  if (req.method === 'GET' && pathname === '/api/control/state') {
    try {
      await simManager.ensureStarted();
      const result = await simManager.sendCommand({ cmd: 'get_state' });
      return sendJson(res, 200, result, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/control/summary
  if (req.method === 'GET' && pathname === '/api/control/summary') {
    try {
      await simManager.ensureStarted();
      const result = await simManager.sendCommand({ cmd: 'summary' });
      return sendJson(res, 200, result, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/control/status
  if (req.method === 'GET' && pathname === '/api/control/status') {
    return sendJson(res, 200, {
      running: simManager.isRunning,
      t: simManager.simTime,
      eventsCount: simManager.eventHistory.length,
      processActive: Boolean(simManager.process),
      config: simManager.config
    }, req);
  }

  // --- Standard API Endpoints ---

  // GET /health and /api/health (Render Blueprint Healthcheck)
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
    const simPath = findSimulator();
    return sendJson(res, 200, {
      status: 'ok',
      service: 'setu-simulation-backend',
      timestamp: Date.now(),
      uptimeSeconds: Math.floor(process.uptime()),
      simulatorFound: Boolean(simPath),
      simulatorActive: Boolean(simManager.process),
      engine: 'c++_protocol_core_fitl',
      memoryRssBytes: process.memoryUsage().rss
    }, req);
  }

  // GET /api/status
  if (req.method === 'GET' && pathname === '/api/status') {
    const simPath = findSimulator();
    return sendJson(res, 200, {
      status: 'online',
      serviceHealth: 'ok',
      simulatorFound: Boolean(simPath),
      simulatorHealthy: Boolean(simPath),
      simulatorPath: simPath ? path.relative(ROOT_DIR, simPath) : null,
      activeRun: Boolean(activeChildProcess || simManager.process),
      interactiveActive: Boolean(simManager.process),
      engine: 'c++_protocol_core_fitl',
      simTime: simManager.simTime,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime())
    }, req);
  }

  // GET /api/scenarios
  if (req.method === 'GET' && pathname === '/api/scenarios') {
    try {
      if (!fs.existsSync(SCENARIOS_DIR)) {
        return sendError(res, 500, 'Scenarios directory not found', req);
      }
      const files = fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.json'));
      const list = files.map(file => {
        try {
          const content = fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8');
          const parsed = JSON.parse(content);
          if (parsed && (parsed.id || parsed.name)) {
            return parsed;
          }
          return null;
        } catch (readErr) {
          console.warn(`[Setu API] Failed to read scenario file ${file}:`, readErr.message);
          return null;
        }
      }).filter(Boolean);
      return sendJson(res, 200, list, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/traces
  if (req.method === 'GET' && pathname === '/api/traces') {
    try {
      if (!fs.existsSync(TRACES_DIR)) {
        return sendJson(res, 200, [], req);
      }
      const files = fs.readdirSync(TRACES_DIR).filter(f => f.endsWith('.jsonl'));
      const traces = files.map(f => {
        const full = path.join(TRACES_DIR, f);
        const st = fs.statSync(full);
        return {
          filename: f,
          sizeBytes: st.size,
          modified: st.mtime
        };
      });
      return sendJson(res, 200, traces, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/trace/:filename
  if (req.method === 'GET' && pathname.startsWith('/api/trace/')) {
    const rawParam = pathname.replace('/api/trace/', '');
    const filename = path.basename(decodeURIComponent(rawParam));
    if (!filename || filename.includes('\0') || !filename.endsWith('.jsonl')) {
      return sendError(res, 400, 'Invalid trace filename format', req);
    }
    const fullPath = path.resolve(TRACES_DIR, filename);
    if (!fullPath.startsWith(path.resolve(TRACES_DIR))) {
      return sendError(res, 403, 'Access denied', req);
    }
    if (!fs.existsSync(fullPath)) {
      return sendError(res, 404, 'Trace file not found', req);
    }
    fs.readFile(fullPath, (err, data) => {
      if (err) return sendError(res, 500, err.message, req);
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': data.length
      };
      applyCorsHeaders(headers, req);
      res.writeHead(200, headers);
      res.end(data);
    });
    return;
  }

  // POST /api/simulate
  if (req.method === 'POST' && pathname === '/api/simulate') {
    const simPath = findSimulator();
    if (!simPath) {
      return sendError(res, 500, 'Simulator binary (setu_sim) not found. Please build the project first.', req);
    }
    if (activeChildProcess) {
      return sendError(res, 409, 'Another simulation is already currently running.', req);
    }

    try {
      const body = await parseBody(req);
      const params = body.params || body;

      // Validate & bound parameters
      const survivors = Math.min(100, Math.max(1, parseInt(params.survivors, 10) || 20));
      const relays = Math.min(30, Math.max(1, parseInt(params.relays, 10) || 5));
      const zone = Math.min(5000, Math.max(200, parseFloat(params.zone) || 1200));
      const seed = Math.max(0, parseInt(params.seed, 10) || 7);
      const duration = Math.min(120000, Math.max(1000, parseInt(params.duration, 10) || 30000));
      const sf = Math.min(12, Math.max(7, parseInt(params.sf, 10) || 7));
      const loss = Math.min(0.9, Math.max(0.0, parseFloat(params.loss) || 0.0));
      const pathExp = Math.min(6.0, Math.max(2.0, parseFloat(params.path_exp) || 3.5));

      const traceFilename = `sim_${Date.now()}_seed${seed}.jsonl`;
      const traceFilePath = path.join(TRACES_DIR, traceFilename);

      const args = [
        '--survivors', String(survivors),
        '--relays', String(relays),
        '--zone', String(zone),
        '--seed', String(seed),
        '--duration', String(duration),
        '--sf', String(sf),
        '--loss', String(loss),
        '--path-exp', String(pathExp),
        '--trace', traceFilePath
      ];

      // Add triggers
      if (Array.isArray(body.triggers)) {
        for (const tr of body.triggers) {
          const id = parseInt(tr.node || tr.id, 10);
          const t = parseInt(tr.t, 10);
          const kind = String(tr.kind || 'short');
          if (!isNaN(id) && !isNaN(t) && ['short', 'double', 'long', 'voice', 'voice-medical', 'voice-trapped'].includes(kind)) {
            args.push('--trigger', `${id}:${kind}@${t}`);
          }
        }
      }

      // Add faults
      if (Array.isArray(body.faults)) {
        for (const ft of body.faults) {
          const t = parseInt(ft.t, 10);
          const target = String(ft.target || '');
          const kind = String(ft.kind || '');
          if (!isNaN(t) && target) {
            if (kind === 'kill') args.push('--kill', `${target}@${t}`);
            else if (kind === 'revive') args.push('--revive', `${target}@${t}`);
            else if (kind === 'gps-off') args.push('--gps-off', `${target}@${t}`);
            else if (kind === 'no-dr') args.push('--no-dr', `${target}@${t}`);
            else if (kind === 'block') args.push('--block', `${target}@${t}`);
          }
        }
      }

      console.log(`[Setu API] Spawning simulator: ${simPath} ${args.join(' ')}`);
      const child = spawn(simPath, args, { cwd: ROOT_DIR });
      activeChildProcess = child;

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', chunk => { stdoutData += chunk; });
      child.stderr.on('data', chunk => { stderrData += chunk; });

      child.on('close', code => {
        activeChildProcess = null;
        if (code !== 0) {
          return sendError(res, 500, `Simulator exited with code ${code}: ${stderrData || stdoutData}`, req);
        }
        let summary = null;
        try {
          summary = JSON.parse(stdoutData);
        } catch {
          summary = { raw: stdoutData };
        }
        return sendJson(res, 200, {
          success: true,
          traceFilename,
          summary
        }, req);
      });

      child.on('error', err => {
        activeChildProcess = null;
        sendError(res, 500, `Simulator spawn failed: ${err.message}`, req);
      });
      return;
    } catch (err) {
      activeChildProcess = null;
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/simulate/stream (Server-Sent Events)
  if (req.method === 'GET' && pathname === '/api/simulate/stream') {
    const simPath = findSimulator();
    if (!simPath) {
      return sendError(res, 500, 'Simulator binary not found.', req);
    }
    if (activeChildProcess) {
      return sendError(res, 409, 'Another simulation is already currently running.', req);
    }

    const searchParams = reqUrl.searchParams;
    const survivors = Math.min(100, Math.max(1, parseInt(searchParams.get('survivors'), 10) || 20));
    const relays = Math.min(30, Math.max(1, parseInt(searchParams.get('relays'), 10) || 5));
    const zone = Math.min(5000, Math.max(200, parseFloat(searchParams.get('zone')) || 1200));
    const seed = Math.max(0, parseInt(searchParams.get('seed'), 10) || 7);
    const duration = Math.min(120000, Math.max(1000, parseInt(searchParams.get('duration'), 10) || 30000));
    const sf = Math.min(12, Math.max(7, parseInt(searchParams.get('sf'), 10) || 7));
    const loss = Math.min(0.9, Math.max(0.0, parseFloat(searchParams.get('loss')) || 0.0));
    const pathExp = Math.min(6.0, Math.max(2.0, parseFloat(searchParams.get('path_exp')) || 3.5));

    const traceFilename = `stream_${Date.now()}_seed${seed}.jsonl`;
    const traceFilePath = path.join(TRACES_DIR, traceFilename);

    const args = [
      '--survivors', String(survivors),
      '--relays', String(relays),
      '--zone', String(zone),
      '--seed', String(seed),
      '--duration', String(duration),
      '--sf', String(sf),
      '--loss', String(loss),
      '--path-exp', String(pathExp),
      '--trace', traceFilePath
    ];

    const streamHeaders = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    };
    applyCorsHeaders(streamHeaders, req);
    res.writeHead(200, streamHeaders);
    res.write(`data: ${JSON.stringify({ type: 'start', traceFilename })}\n\n`);

    const child = spawn(simPath, args, { cwd: ROOT_DIR });
    activeChildProcess = child;

    let summaryData = '';

    child.stdout.on('data', chunk => {
      summaryData += chunk;
    });

    child.on('close', code => {
      activeChildProcess = null;
      let summary = null;
      try { summary = JSON.parse(summaryData); } catch { summary = { raw: summaryData }; }
      res.write(`data: ${JSON.stringify({ type: 'done', code, summary, traceFilename })}\n\n`);
      res.end();
    });

    child.on('error', err => {
      activeChildProcess = null;
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      if (activeChildProcess === child) {
        try { child.kill(); } catch {}
        activeChildProcess = null;
      }
    });
    return;
  }

  // POST /api/simulate/stop
  if (req.method === 'POST' && pathname === '/api/simulate/stop') {
    if (activeChildProcess) {
      try {
        activeChildProcess.kill();
        activeChildProcess = null;
        return sendJson(res, 200, { success: true, message: 'Simulation stopped' }, req);
      } catch (err) {
        return sendError(res, 500, err.message, req);
      }
    }
    return sendJson(res, 200, { success: true, message: 'No simulation was active' }, req);
  }

  // POST /api/upload-trace
  if (req.method === 'POST' && pathname === '/api/upload-trace') {
    try {
      const body = await parseBody(req);
      const content = typeof body === 'string' ? body : (body.content || body.raw || '');
      if (typeof content !== 'string' || content.length === 0) {
        return sendError(res, 400, 'Empty or invalid trace content', req);
      }
      if (Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024) {
        return sendError(res, 413, 'Trace content exceeds 10MB limit', req);
      }
      const filename = `uploaded_${Date.now()}.jsonl`;
      const fullPath = path.resolve(TRACES_DIR, filename);
      if (!fullPath.startsWith(path.resolve(TRACES_DIR))) {
        return sendError(res, 403, 'Access denied', req);
      }
      fs.writeFileSync(fullPath, content, 'utf8');
      return sendJson(res, 200, { success: true, filename }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // --- Static Files Serving ---
  let filePath = pathname === '/' ? '/index.html' : pathname;
  let absPath = path.join(DASHBOARD_DIR, filePath);

  // Security check: ensure path is within DASHBOARD_DIR
  if (!absPath.startsWith(DASHBOARD_DIR)) {
    return sendError(res, 403, 'Forbidden');
  }

  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(absPath, (err, data) => {
      if (err) return sendError(res, 500, err.message);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
    return;
  }

  sendError(res, 404, 'File not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================================`);
  console.log(`  Project Setu - Operations Dashboard & Simulation Server        `);
  console.log(`  Host: http://0.0.0.0:${PORT}                                   `);
  console.log(`  Simulator Binary: ${findSimulator() || 'NOT BUILT YET'}        `);
  console.log(`================================================================`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} in use, trying ${Number(PORT) + 1}...`);
    server.listen(Number(PORT) + 1, '0.0.0.0');
  } else {
    console.error('Server error:', err);
  }
});

function gracefulShutdown(signal) {
  console.log(`[Setu API] Received ${signal}. Shutting down gracefully...`);
  if (simManager.process) {
    try {
      simManager.process.kill('SIGTERM');
    } catch {}
  }
  if (activeChildProcess) {
    try {
      activeChildProcess.kill('SIGTERM');
    } catch {}
  }
  for (const client of simManager.sseClients) {
    try { client.end(); } catch {}
  }
  simManager.sseClients.clear();
  server.close(() => {
    console.log('[Setu API] Server closed cleanly.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
