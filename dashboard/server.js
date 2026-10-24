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
  const candidates = [
    path.join(ROOT_DIR, 'build', 'Release', 'setu_sim.exe'),
    path.join(ROOT_DIR, 'build', 'setu_sim.exe'),
    path.join(ROOT_DIR, 'build', 'setu_sim'),
    path.join(ROOT_DIR, 'build', 'Release', 'setu_sim')
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
    this.pendingResolvers = new Map();
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
            resolve();
          }
        }
      });

      this.process.stderr.on('data', chunk => {
        console.error('[Simulator STDERR]', chunk.toString().trim());
      });

      this.process.on('close', code => {
        console.log(`[Setu API] Simulator process closed with code ${code}`);
        this.process = null;
        this.pauseContinuous();
        this.broadcastSSE('sim_closed', { code });
        if (!resolved) {
          resolved = true;
          reject(new Error(`Simulator closed prematurely with code ${code}`));
        }
      });

      this.process.on('error', err => {
        this.process = null;
        this.pauseContinuous();
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
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
        const resolvers = this.pendingResolvers.get(obj.cmd);
        if (resolvers && resolvers.length > 0) {
          const fn = resolvers.shift();
          fn(obj);
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

  sendCommand(cmdObj) {
    if (!this.process || !this.process.stdin.writable) {
      return Promise.reject(new Error('Simulator process not running'));
    }
    const line = JSON.stringify(cmdObj) + '\n';
    return new Promise((resolve, reject) => {
      const cmd = cmdObj.cmd;
      if (!this.pendingResolvers.has(cmd)) {
        this.pendingResolvers.set(cmd, []);
      }
      this.pendingResolvers.get(cmd).push(resolve);
      this.process.stdin.write(line, err => {
        if (err) reject(err);
      });
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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
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
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // --- Live Interactive Simulator Endpoints ---

  // GET /api/events (Server-Sent Events)
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
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
      return sendJson(res, 200, { success: true, config: simManager.config, t: simManager.simTime });
    } catch (err) {
      return sendError(res, 500, err.message);
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
      return sendJson(res, 200, { success: true, isRunning: true });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // POST /api/control/pause
  if (req.method === 'POST' && pathname === '/api/control/pause') {
    simManager.pauseContinuous();
    return sendJson(res, 200, { success: true, isRunning: false });
  }

  // POST /api/control/step
  if (req.method === 'POST' && pathname === '/api/control/step') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const ms = Math.min(10000, Math.max(1, parseInt(body.ms, 10) || 100));
      const result = await simManager.sendCommand({ cmd: 'step', ms });
      return sendJson(res, 200, { success: true, result, t: simManager.simTime });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // POST /api/control/reset
  if (req.method === 'POST' && pathname === '/api/control/reset') {
    try {
      await simManager.stopAndReset();
      return sendJson(res, 200, { success: true, t: 0 });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // POST /api/control/trigger
  if (req.method === 'POST' && pathname === '/api/control/trigger') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const node = parseInt(body.node, 10);
      const kind = String(body.kind || 'short');
      const result = await simManager.sendCommand({ cmd: 'trigger', node, kind });
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // POST /api/control/trigger-all
  if (req.method === 'POST' && pathname === '/api/control/trigger-all') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const kind = String(body.kind || 'short');
      const mode = String(body.mode || 'immediate');
      const delayMs = parseInt(body.delay_ms, 10) || 2000;
      const result = await simManager.sendCommand({ cmd: 'trigger_all', kind, mode, delay_ms: delayMs });
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 500, err.message);
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
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 500, err.message);
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
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 500, err.message);
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
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // GET /api/control/state
  if (req.method === 'GET' && pathname === '/api/control/state') {
    try {
      await simManager.ensureStarted();
      const result = await simManager.sendCommand({ cmd: 'get_state' });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // GET /api/control/summary
  if (req.method === 'GET' && pathname === '/api/control/summary') {
    try {
      await simManager.ensureStarted();
      const result = await simManager.sendCommand({ cmd: 'summary' });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 500, err.message);
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
    });
  }

  // --- Standard API Endpoints ---

  // GET /api/status
  if (req.method === 'GET' && pathname === '/api/status') {
    const simPath = findSimulator();
    return sendJson(res, 200, {
      status: 'online',
      nodeVersion: process.version,
      simulatorFound: Boolean(simPath),
      simulatorPath: simPath ? path.relative(ROOT_DIR, simPath) : null,
      activeRun: Boolean(activeChildProcess || simManager.process),
      interactiveActive: Boolean(simManager.process),
      simTime: simManager.simTime
    });
  }

  // GET /api/scenarios
  if (req.method === 'GET' && pathname === '/api/scenarios') {
    try {
      const files = fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.json'));
      const list = files.map(file => {
        try {
          const content = fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8');
          return JSON.parse(content);
        } catch {
          return null;
        }
      }).filter(Boolean);
      return sendJson(res, 200, list);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // GET /api/traces
  if (req.method === 'GET' && pathname === '/api/traces') {
    try {
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
      return sendJson(res, 200, traces);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // GET /api/trace/:filename
  if (req.method === 'GET' && pathname.startsWith('/api/trace/')) {
    const filename = path.basename(pathname.replace('/api/trace/', ''));
    const fullPath = path.join(TRACES_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      return sendError(res, 404, 'Trace file not found');
    }
    fs.readFile(fullPath, (err, data) => {
      if (err) return sendError(res, 500, err.message);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
    return;
  }

  // POST /api/simulate
  if (req.method === 'POST' && pathname === '/api/simulate') {
    const simPath = findSimulator();
    if (!simPath) {
      return sendError(res, 500, 'Simulator binary (setu_sim) not found. Please build the project first.');
    }
    if (activeChildProcess) {
      return sendError(res, 409, 'Another simulation is already currently running.');
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
          return sendError(res, 500, `Simulator exited with code ${code}: ${stderrData || stdoutData}`);
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
        });
      });

      child.on('error', err => {
        activeChildProcess = null;
        sendError(res, 500, `Simulator spawn failed: ${err.message}`);
      });
      return;
    } catch (err) {
      activeChildProcess = null;
      return sendError(res, 500, err.message);
    }
  }

  // GET /api/simulate/stream (Server-Sent Events)
  if (req.method === 'GET' && pathname === '/api/simulate/stream') {
    const simPath = findSimulator();
    if (!simPath) {
      return sendError(res, 500, 'Simulator binary not found.');
    }
    if (activeChildProcess) {
      return sendError(res, 409, 'Another simulation is already currently running.');
    }

    const query = parsedUrl.query;
    const survivors = Math.min(100, Math.max(1, parseInt(query.survivors, 10) || 20));
    const relays = Math.min(30, Math.max(1, parseInt(query.relays, 10) || 5));
    const zone = Math.min(5000, Math.max(200, parseFloat(query.zone) || 1200));
    const seed = Math.max(0, parseInt(query.seed, 10) || 7);
    const duration = Math.min(120000, Math.max(1000, parseInt(query.duration, 10) || 30000));
    const sf = Math.min(12, Math.max(7, parseInt(query.sf, 10) || 7));
    const loss = Math.min(0.9, Math.max(0.0, parseFloat(query.loss) || 0.0));
    const pathExp = Math.min(6.0, Math.max(2.0, parseFloat(query.path_exp) || 3.5));

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

    if (query.trigger) {
      const trs = Array.isArray(query.trigger) ? query.trigger : [query.trigger];
      for (const t of trs) args.push('--trigger', t);
    }
    if (query.fault) {
      const fts = Array.isArray(query.fault) ? query.fault : [query.fault];
      for (const f of fts) {
        const [kind, rest] = f.split(':');
        if (kind && rest) args.push(`--${kind}`, rest);
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write(`data: ${JSON.stringify({ type: 'start', traceFilename })}\n\n`);

    const child = spawn(simPath, args, { cwd: ROOT_DIR });
    activeChildProcess = child;

    let buffer = '';
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
        return sendJson(res, 200, { success: true, message: 'Simulation stopped' });
      } catch (err) {
        return sendError(res, 500, err.message);
      }
    }
    return sendJson(res, 200, { success: true, message: 'No simulation was active' });
  }

  // POST /api/upload-trace
  if (req.method === 'POST' && pathname === '/api/upload-trace') {
    try {
      const body = await parseBody(req);
      const filename = `uploaded_${Date.now()}.jsonl`;
      const fullPath = path.join(TRACES_DIR, filename);
      const content = typeof body === 'string' ? body : (body.content || body.raw || '');
      fs.writeFileSync(fullPath, content, 'utf8');
      return sendJson(res, 200, { success: true, filename });
    } catch (err) {
      return sendError(res, 500, err.message);
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

server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`  Project Setu - Operations Dashboard & Simulation Server        `);
  console.log(`  Control Center: http://localhost:${PORT}                      `);
  console.log(`  Simulator Binary: ${findSimulator() || 'NOT BUILT YET'}       `);
  console.log(`================================================================`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} in use, trying ${PORT + 1}...`);
    server.listen(PORT + 1);
  } else {
    console.error('Server error:', err);
  }
});
