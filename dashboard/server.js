// Project Setu - Production Cloud Simulation Server & Operations API Bridge
// Decoupled Job Architecture, Bounded Buffers, Concurrency Pool, & Multi-Tier Health Probes
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
    // Standard Linux / Docker / Cloud VM build paths
    path.join(ROOT_DIR, 'build', 'setu_sim'),
    path.join(ROOT_DIR, 'build', 'Release', 'setu_sim'),
    path.join(ROOT_DIR, 'setu_sim')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Ensure traces directory exists
if (!fs.existsSync(TRACES_DIR)) {
  fs.mkdirSync(TRACES_DIR, { recursive: true });
}

// -----------------------------------------------------------------------------
// Simulation Job & Concurrency Manager (Phases C, D, E, F)
// -----------------------------------------------------------------------------

class SimulationJob {
  constructor(id, params, triggers, faults, sessionId, manager) {
    this.id = id;
    this.sessionId = sessionId || `sess_${Date.now()}`;
    this.params = params || {};
    this.triggers = triggers || [];
    this.faults = faults || [];
    this.manager = manager;

    // States: 'queued' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
    this.status = 'queued';
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.durationMs = 0;
    this.error = null;
    this.process = null;

    this.traceFilename = `job_${this.id}.jsonl`;
    this.traceFilePath = path.join(TRACES_DIR, this.traceFilename);
    this.writeStream = null;

    this.summary = null;
    this.eventBuffer = []; // Bounded ring buffer for live streaming & reconnection
    this.eventSeq = 0;
    this.sseClients = new Set();
    this.timeoutTimer = null;
    this.completionPromise = null;
    this.completionResolve = null;
    this.completionReject = null;

    this.completionPromise = new Promise((resolve, reject) => {
      this.completionResolve = resolve;
      this.completionReject = reject;
    });
    // Prevent unhandled promise rejection if job is async or cancelled without an active awaiter
    this.completionPromise.catch(() => {});
  }

  addEvent(ev) {
    this.eventSeq++;
    const enriched = { ...ev, _seq: this.eventSeq, _jobId: this.id };
    this.eventBuffer.push(enriched);
    if (this.eventBuffer.length > this.manager.maxEventBufferSize) {
      this.eventBuffer.shift();
    }
    this.broadcastSSE('event', enriched);
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

  getSnapshot(sinceSeq = 0) {
    const seq = parseInt(sinceSeq, 10) || 0;
    const events = seq > 0
      ? this.eventBuffer.filter(e => e._seq > seq)
      : this.eventBuffer;

    return {
      jobId: this.id,
      status: this.status,
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.durationMs,
      summary: this.summary,
      error: this.error,
      traceFilename: this.traceFilename,
      lastSeq: this.eventSeq,
      events
    };
  }
}

class SimulationJobManager {
  constructor(options = {}) {
    this.maxConcurrent = Math.max(1, parseInt(process.env.MAX_CONCURRENT_SIMS || options.maxConcurrent || 2, 10));
    this.defaultTimeoutMs = Math.max(5000, parseInt(process.env.SIM_TIMEOUT_MS || options.defaultTimeoutMs || 60000, 10));
    this.maxEventBufferSize = Math.max(100, parseInt(process.env.MAX_JOB_EVENTS || options.maxEventBufferSize || 2000, 10));
    this.maxQueueSize = Math.max(1, parseInt(process.env.MAX_QUEUE_SIZE || options.maxQueueSize || 5, 10));
    this.jobsIndexFile = path.join(TRACES_DIR, 'jobs_index.json');

    this.jobs = new Map(); // jobId -> SimulationJob
    this.queue = []; // Array of jobIds
    this.activeJobs = new Map(); // jobId -> SimulationJob
    this.metrics = {
      submittedTotal: 0,
      completedTotal: 0,
      failedTotal: 0,
      cancelledTotal: 0
    };

    // Recover previous completed and interrupted jobs across cloud restarts/sleeps
    this.loadIndex();
  }

  saveIndex() {
    try {
      const records = [];
      for (const [id, job] of this.jobs) {
        records.push({
          id: job.id,
          sessionId: job.sessionId,
          status: (job.status === 'running' || job.status === 'starting' || job.status === 'queued') ? 'interrupted' : job.status,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt || Date.now(),
          durationMs: job.durationMs,
          traceFilename: job.traceFilename,
          summary: job.summary,
          error: job.error || ((job.status === 'running' || job.status === 'starting' || job.status === 'queued') ? 'Job interrupted by container restart / cold sleep' : null)
        });
      }
      fs.writeFileSync(this.jobsIndexFile, JSON.stringify(records.slice(-100), null, 2), 'utf8');
    } catch (err) {
      console.warn('[JobManager] Failed to persist job index:', err.message);
    }
  }

  loadIndex() {
    if (!fs.existsSync(this.jobsIndexFile)) return;
    try {
      const content = fs.readFileSync(this.jobsIndexFile, 'utf8');
      const records = JSON.parse(content);
      if (Array.isArray(records)) {
        let restoredCount = 0;
        for (const r of records) {
          if (r && r.id) {
            const job = new SimulationJob(r.id, {}, [], [], r.sessionId, this);
            job.status = (r.status === 'running' || r.status === 'starting' || r.status === 'queued') ? 'interrupted' : r.status;
            job.createdAt = r.createdAt || Date.now();
            job.startedAt = r.startedAt;
            job.completedAt = r.completedAt;
            job.durationMs = r.durationMs || 0;
            job.summary = r.summary;
            job.error = r.error;
            job.traceFilename = r.traceFilename;
            this.jobs.set(r.id, job);
            restoredCount++;
          }
        }
        console.log(`[JobManager] Restored ${restoredCount} historical job(s) from persistent index across restart.`);
      }
    } catch (err) {
      console.warn('[JobManager] Failed to load persistent job index:', err.message);
    }
  }

  createJob(params = {}, triggers = [], faults = [], sessionId = null) {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(`Simulation queue is full (max ${this.maxQueueSize} queued jobs). Please wait for active runs to complete.`);
    }

    const randSuffix = Math.random().toString(36).substring(2, 8);
    const jobId = `sim_${Date.now()}_${randSuffix}`;
    const job = new SimulationJob(jobId, params, triggers, faults, sessionId, this);

    this.jobs.set(jobId, job);
    this.queue.push(jobId);
    this.metrics.submittedTotal++;
    this.saveIndex();

    // Prune historical jobs if map grows too large
    if (this.jobs.size > 200) {
      const oldestKeys = Array.from(this.jobs.keys()).slice(0, 50);
      for (const k of oldestKeys) {
        const old = this.jobs.get(k);
        if (old && (old.status === 'completed' || old.status === 'failed' || old.status === 'cancelled' || old.status === 'interrupted')) {
          this.jobs.delete(k);
        }
      }
    }

    process.nextTick(() => this.processQueue());
    return job;
  }

  processQueue() {
    if (this.activeJobs.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Free-tier memory protection: check RSS before spawning child process
    const memRssMb = process.memoryUsage().rss / (1024 * 1024);
    if (memRssMb > 380) { // 380 MB is ~75% of 512 MB free container limit
      console.warn(`[JobManager] Memory RSS high (${memRssMb.toFixed(1)} MB). Delaying job execution.`);
      setTimeout(() => this.processQueue(), 2000).unref();
      return;
    }

    const nextJobId = this.queue.shift();
    const job = this.jobs.get(nextJobId);
    if (!job || job.status !== 'queued') {
      return this.processQueue();
    }

    this.startJob(job);
  }

  startJob(job) {
    const simPath = findSimulator();
    if (!simPath) {
      job.status = 'failed';
      job.error = 'Simulator binary (setu_sim) not found on host system.';
      job.completedAt = Date.now();
      job.durationMs = job.completedAt - job.createdAt;
      this.metrics.failedTotal++;
      job.broadcastSSE('done', { status: 'failed', error: job.error });
      if (job.completionReject) job.completionReject(new Error(job.error));
      this.processQueue();
      return;
    }

    job.status = 'starting';
    job.startedAt = Date.now();
    this.activeJobs.set(job.id, job);

    const p = job.params;
    const survivors = Math.min(100, Math.max(1, parseInt(p.survivors, 10) || 20));
    const relays = Math.min(30, Math.max(1, parseInt(p.relays, 10) || 5));
    const zone = Math.min(5000, Math.max(200, parseFloat(p.zone) || 1200));
    const seed = Math.max(0, parseInt(p.seed, 10) || 7);
    const duration = Math.min(120000, Math.max(1000, parseInt(p.duration, 10) || 30000));
    const sf = Math.min(12, Math.max(7, parseInt(p.sf, 10) || 7));
    const loss = Math.min(0.9, Math.max(0.0, parseFloat(p.loss) || 0.0));
    const pathExp = Math.min(6.0, Math.max(2.0, parseFloat(p.path_exp) || 3.5));

    const args = [
      '--survivors', String(survivors),
      '--relays', String(relays),
      '--zone', String(zone),
      '--seed', String(seed),
      '--duration', String(duration),
      '--sf', String(sf),
      '--loss', String(loss),
      '--path-exp', String(pathExp),
      '--trace', '-'
    ];

    if (Array.isArray(job.triggers)) {
      for (const tr of job.triggers) {
        const id = parseInt(tr.node || tr.id, 10);
        const t = parseInt(tr.t, 10);
        const kind = String(tr.kind || 'short').replace('_', '-');
        if (!isNaN(id) && !isNaN(t) && ['short', 'double', 'long', 'voice', 'voice-medical', 'voice-trapped'].includes(kind)) {
          args.push('--trigger', `${id}:${kind}@${t}`);
        }
      }
    }

    if (Array.isArray(job.faults)) {
      for (const ft of job.faults) {
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

    // Open file stream for writing output trace safely without buffering everything in V8 memory
    job.writeStream = fs.createWriteStream(job.traceFilePath, { flags: 'w', encoding: 'utf8' });

    console.log(`[JobManager] Starting job ${job.id}: ${simPath} ${args.join(' ')}`);
    const child = spawn(simPath, args, { cwd: ROOT_DIR });
    job.process = child;
    job.status = 'running';
    job.startedAt = Date.now();
    this.saveIndex();
    job.broadcastSSE('start', { jobId: job.id, traceFilename: job.traceFilename });

    // Set execution timeout watchdog
    job.timeoutTimer = setTimeout(() => {
      console.warn(`[JobManager] Job ${job.id} exceeded wall-clock limit of ${this.defaultTimeoutMs}ms. Cancelling.`);
      this.cancelJob(job.id, `Execution timed out after ${this.defaultTimeoutMs}ms`);
    }, this.defaultTimeoutMs);

    let stdoutBuffer = '';
    let summaryStdout = '';
    let stderrData = '';
    let summaryJson = null;

    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      let newlineIdx;
      while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIdx).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        if (!line) continue;

        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch {
          // Non-JSON or multi-line summary fragment
        }

        if (parsed && parsed.ev) {
          if (parsed.ev === 'node_init') {
            const nid = parseInt(parsed.id !== undefined ? parsed.id : parsed.node, 10);
            if (!parsed.role) {
              parsed.role = (nid === 0 ? 'hub' : 'unknown');
            } else {
              parsed.role = String(parsed.role).trim().toLowerCase();
            }
          }
          // Valid JSONL trace event: write to disk trace and broadcast live
          if (job.writeStream && !job.writeStream.destroyed) {
            job.writeStream.write(JSON.stringify(parsed) + '\n');
          }
          job.addEvent(parsed);
        } else {
          // Summary JSON line or non-event log
          summaryStdout += line + '\n';
          if (parsed && (parsed.cmd === 'summary' || parsed.totals || parsed.summary || parsed.duration_ms !== undefined)) {
            summaryJson = parsed;
          }
        }
      }
    });

    child.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    child.on('close', code => {
      if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
      if (job.writeStream && !job.writeStream.destroyed) {
        job.writeStream.end();
      }

      this.activeJobs.delete(job.id);
      job.completedAt = Date.now();
      job.durationMs = job.completedAt - job.startedAt;

      // Extract summary JSON from accumulated summaryStdout or buffer
      if (!summaryJson) {
        const toSearch = summaryStdout + '\n' + stdoutBuffer;
        const match = toSearch.match(/\{[\s\S]*"totals"[\s\S]*\}/);
        if (match) {
          try {
            summaryJson = JSON.parse(match[0]);
          } catch {}
        }
      }

      if (job.status === 'cancelled') {
        this.metrics.cancelledTotal++;
        job.broadcastSSE('done', { status: 'cancelled', error: job.error, jobId: job.id });
        if (job.completionReject) job.completionReject(new Error(job.error || 'Job cancelled'));
      } else if (code !== 0) {
        job.status = 'failed';
        job.error = `Simulator exited with code ${code}: ${stderrData || stdoutBuffer || 'Unknown error'}`;
        this.metrics.failedTotal++;
        job.broadcastSSE('done', { status: 'failed', error: job.error, code, jobId: job.id });
        if (job.completionReject) job.completionReject(new Error(job.error));
      } else {
        job.status = 'completed';
        job.summary = summaryJson || { totals: {} };
        this.metrics.completedTotal++;
        job.broadcastSSE('done', {
          status: 'completed',
          jobId: job.id,
          traceFilename: job.traceFilename,
          summary: job.summary
        });
        if (job.completionResolve) {
          job.completionResolve({
            success: true,
            status: 'completed',
            jobId: job.id,
            traceFilename: job.traceFilename,
            summary: job.summary
          });
        }
      }

      this.saveIndex();

      // Close all SSE listeners for this job
      for (const client of job.sseClients) {
        try { client.end(); } catch {}
      }
      job.sseClients.clear();

      // Process next in queue
      this.processQueue();
    });

    child.on('error', err => {
      if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
      if (job.writeStream && !job.writeStream.destroyed) job.writeStream.end();
      this.activeJobs.delete(job.id);
      job.completedAt = Date.now();
      job.status = 'failed';
      job.error = `Process spawn error: ${err.message}`;
      this.metrics.failedTotal++;
      this.saveIndex();
      job.broadcastSSE('done', { status: 'failed', error: job.error, jobId: job.id });
      if (job.completionReject) job.completionReject(err);
      this.processQueue();
    });
  }

  cancelJob(jobId, reason = 'Cancelled by user') {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'queued') {
      const idx = this.queue.indexOf(jobId);
      if (idx !== -1) this.queue.splice(idx, 1);
      job.status = 'cancelled';
      job.error = reason;
      job.completedAt = Date.now();
      this.metrics.cancelledTotal++;
      this.saveIndex();
      job.broadcastSSE('done', { status: 'cancelled', error: reason, jobId: job.id });
      if (job.completionReject) job.completionReject(new Error(reason));
      return true;
    }

    if (job.status === 'running' && job.process) {
      job.status = 'cancelled';
      job.error = reason;
      this.saveIndex();
      try {
        job.process.kill('SIGTERM');
        // Force kill if process does not exit in 3s
        setTimeout(() => {
          if (job.process) {
            try { job.process.kill('SIGKILL'); } catch {}
          }
        }, 3000).unref();
      } catch {}
      return true;
    }

    return false;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  listJobs(limit = 20) {
    const list = Array.from(this.jobs.values()).map(j => ({
      id: j.id,
      sessionId: j.sessionId,
      status: j.status,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      durationMs: j.durationMs,
      traceFilename: j.traceFilename,
      hasSummary: Boolean(j.summary),
      error: j.error
    }));
    return list.reverse().slice(0, Math.min(100, limit));
  }
}

const jobManager = new SimulationJobManager();

// -----------------------------------------------------------------------------
// Interactive Simulator Manager (Refined with Bounded Ring Buffer & Backpressure)
// -----------------------------------------------------------------------------

class InteractiveSimulatorManager {
  constructor() {
    this.process = null;
    this.buffer = '';
    this.maxEventHistory = 2000; // Bounded ring buffer: prevents memory bloat
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
        // Strict bounded ring buffer
        if (this.eventHistory.length > this.maxEventHistory) {
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

  startContinuous(stepMs = 50, wallIntervalMs = 100) {
    if (this.continuousTimer) return;
    this.isRunning = true;
    // 100ms interval ensures the single-threaded Node.js event loop has ample time to serve HTTP
    this.continuousTimer = setInterval(async () => {
      if (!this.process || !this.isRunning) {
        this.pauseContinuous();
        return;
      }
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

// -----------------------------------------------------------------------------
// HTTP Server & Route Handler
// -----------------------------------------------------------------------------

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
  if (/^https:\/\/[a-z0-9_-]+\.onrender\.com$/i.test(origin) || /^https:\/\/[a-z0-9_-]+\.fly\.dev$/i.test(origin) || /^https:\/\/[a-z0-9_-]+\.up\.railway\.app$/i.test(origin)) {
    return origin;
  }
  return null;
}

function applyCorsHeaders(headers, req) {
  const corsOrigin = getCorsOrigin(req);
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, Accept, Last-Event-ID';
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

  // ---------------------------------------------------------------------------
  // Health & Monitoring Probes (Phase G)
  // ---------------------------------------------------------------------------

  // Fast Liveness Probe (Does not touch disk or child processes)
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/health/liveness' || pathname === '/api/health')) {
    const simPath = findSimulator();
    return sendJson(res, 200, {
      status: 'ok',
      liveness: true,
      service: 'setu-simulation-backend',
      timestamp: Date.now(),
      uptimeSeconds: Math.floor(process.uptime()),
      simulatorFound: Boolean(simPath),
      simulatorActive: Boolean(simManager.process),
      engine: 'c++_protocol_core_fitl',
      memoryRssBytes: process.memoryUsage().rss
    }, req);
  }

  // Deep Readiness Probe (Verifies worker capacity and memory health)
  if (req.method === 'GET' && (pathname === '/health/readiness' || pathname === '/api/health/readiness')) {
    const simPath = findSimulator();
    const memRss = process.memoryUsage().rss;
    const isReady = Boolean(simPath);

    return sendJson(res, isReady ? 200 : 503, {
      status: isReady ? 'ok' : 'degraded',
      readiness: isReady,
      service: 'setu-simulation-backend',
      simulatorFound: Boolean(simPath),
      simulatorPath: simPath ? path.relative(ROOT_DIR, simPath) : null,
      workerPool: {
        active: jobManager.activeJobs.size,
        queued: jobManager.queue.length,
        maxConcurrent: jobManager.maxConcurrent
      },
      memoryRssBytes: memRss,
      memoryHeapUsed: process.memoryUsage().heapUsed,
      uptimeSeconds: Math.floor(process.uptime())
    }, req);
  }

  // Comprehensive Metrics Endpoint (Phase G)
  if (req.method === 'GET' && (pathname === '/api/metrics' || pathname === '/metrics')) {
    const simPath = findSimulator();
    return sendJson(res, 200, {
      timestamp: Date.now(),
      service: 'setu-simulation-backend',
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      simulatorFound: Boolean(simPath),
      jobManager: {
        activeJobsCount: jobManager.activeJobs.size,
        queuedJobsCount: jobManager.queue.length,
        maxConcurrent: jobManager.maxConcurrent,
        submittedTotal: jobManager.metrics.submittedTotal,
        completedTotal: jobManager.metrics.completedTotal,
        failedTotal: jobManager.metrics.failedTotal,
        cancelledTotal: jobManager.metrics.cancelledTotal,
        metrics: jobManager.metrics
      },
      interactiveManager: {
        active: Boolean(simManager.process),
        running: simManager.isRunning,
        simTime: simManager.simTime,
        historySize: simManager.eventHistory.length,
        sseClientsCount: simManager.sseClients.size
      }
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
      activeRun: Boolean(jobManager.activeJobs.size > 0 || simManager.process),
      interactiveActive: Boolean(simManager.process),
      engine: 'c++_protocol_core_fitl',
      simTime: simManager.simTime,
      activeJobs: jobManager.activeJobs.size,
      queuedJobs: jobManager.queue.length,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime())
    }, req);
  }

  // ---------------------------------------------------------------------------
  // Decoupled Simulation Job Lifecycle API (Phases C, D, E, F)
  // ---------------------------------------------------------------------------

  // POST /api/jobs — Submit an asynchronous simulation job
  if (req.method === 'POST' && pathname === '/api/jobs') {
    try {
      const body = await parseBody(req);
      const params = body.params || body;
      const triggers = Array.isArray(body.triggers) ? body.triggers : [];
      const faults = Array.isArray(body.faults) ? body.faults : [];
      const sessionId = body.sessionId || null;

      const job = jobManager.createJob(params, triggers, faults, sessionId);
      const queuePosition = jobManager.queue.indexOf(job.id);

      return sendJson(res, 202, {
        success: true,
        jobId: job.id,
        status: job.status,
        queuePosition: queuePosition !== -1 ? queuePosition + 1 : 0,
        traceFilename: job.traceFilename,
        pollUrl: `/api/jobs/${job.id}`,
        eventsUrl: `/api/jobs/${job.id}/events`
      }, req);
    } catch (err) {
      if (err.message && err.message.includes('queue is full')) {
        return sendError(res, 429, err.message, req);
      }
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/jobs — List recent simulation jobs
  if (req.method === 'GET' && pathname === '/api/jobs') {
    const limit = parseInt(reqUrl.searchParams.get('limit') || 20, 10);
    return sendJson(res, 200, jobManager.listJobs(limit), req);
  }

  // GET /api/jobs/:id/events — Dedicated SSE Event Stream for a Job (with Reconnect Support)
  if (req.method === 'GET' && pathname.startsWith('/api/jobs/') && pathname.endsWith('/events')) {
    const rawId = pathname.replace('/api/jobs/', '').replace('/events', '');
    const jobId = decodeURIComponent(rawId);
    const job = jobManager.getJob(jobId);
    if (!job) {
      return sendError(res, 404, 'Job not found', req);
    }

    const sseHeaders = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    };
    applyCorsHeaders(sseHeaders, req);
    res.writeHead(200, sseHeaders);
    res.write(': connected\n\n');

    // Handle client reconnection using ?since=<seq> or Last-Event-ID header
    const sinceSeq = parseInt(reqUrl.searchParams.get('since') || req.headers['last-event-id'] || 0, 10);
    const snapshot = job.getSnapshot(sinceSeq);

    for (const ev of snapshot.events) {
      res.write(`id: ${ev._seq}\nevent: event\ndata: ${JSON.stringify(ev)}\n\n`);
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      res.write(`event: done\ndata: ${JSON.stringify({ status: job.status, summary: job.summary, error: job.error })}\n\n`);
      res.end();
      return;
    }

    job.sseClients.add(res);
    req.on('close', () => {
      job.sseClients.delete(res);
    });
    return;
  }

  // GET /api/jobs/:id/results — Retrieve Completed Job Results
  if (req.method === 'GET' && pathname.startsWith('/api/jobs/') && pathname.endsWith('/results')) {
    const rawId = pathname.replace('/api/jobs/', '').replace('/results', '');
    const jobId = decodeURIComponent(rawId);
    const job = jobManager.getJob(jobId);
    if (!job) {
      return sendError(res, 404, 'Job not found', req);
    }
    return sendJson(res, 200, {
      success: job.status === 'completed',
      jobId: job.id,
      status: job.status,
      durationMs: job.durationMs,
      summary: job.summary,
      traceFilename: job.traceFilename,
      error: job.error
    }, req);
  }

  // POST /api/jobs/:id/cancel — Cancel a Running or Queued Job
  if (req.method === 'POST' && pathname.startsWith('/api/jobs/') && pathname.endsWith('/cancel')) {
    const rawId = pathname.replace('/api/jobs/', '').replace('/cancel', '');
    const jobId = decodeURIComponent(rawId);
    const success = jobManager.cancelJob(jobId, 'Cancelled via API request');
    if (!success) {
      return sendError(res, 404, 'Job not found or already finished', req);
    }
    return sendJson(res, 200, { success: true, jobId, message: 'Job cancellation requested' }, req);
  }

  // GET /api/jobs/:id — Inspect Job Status & Snapshot
  if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
    const rawId = pathname.replace('/api/jobs/', '');
    const jobId = decodeURIComponent(rawId);
    const job = jobManager.getJob(jobId);
    if (!job) {
      return sendError(res, 404, 'Job not found', req);
    }
    return sendJson(res, 200, job.getSnapshot(), req);
  }

  // ---------------------------------------------------------------------------
  // Backward-Compatible Simulation Routes (Wrapped in Job Management)
  // ---------------------------------------------------------------------------

  // POST /api/simulate — Backward-Compatible Simulation Endpoint
  if (req.method === 'POST' && pathname === '/api/simulate') {
    const simPath = findSimulator();
    if (!simPath) {
      return sendError(res, 500, 'Simulator binary (setu_sim) not found. Please build the project first.', req);
    }

    try {
      const body = await parseBody(req);
      const params = body.params || body;
      const triggers = Array.isArray(body.triggers) ? body.triggers : [];
      const faults = Array.isArray(body.faults) ? body.faults : [];

      // If client requests asynchronous execution
      if (body.async === true || reqUrl.searchParams.get('async') === 'true') {
        const job = jobManager.createJob(params, triggers, faults);
        return sendJson(res, 202, {
          success: true,
          jobId: job.id,
          status: job.status,
          traceFilename: job.traceFilename,
          pollUrl: `/api/jobs/${job.id}`
        }, req);
      }

      // Synchronous execution (awaited via JobManager to guarantee resource caps)
      const job = jobManager.createJob(params, triggers, faults);
      const result = await job.completionPromise;
      return sendJson(res, 200, result, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // GET /api/simulate/stream — Backward-Compatible Simulation Event Stream
  if (req.method === 'GET' && pathname === '/api/simulate/stream') {
    const simPath = findSimulator();
    if (!simPath) {
      return sendError(res, 500, 'Simulator binary not found.', req);
    }

    const searchParams = reqUrl.searchParams;
    const params = {
      survivors: searchParams.get('survivors'),
      relays: searchParams.get('relays'),
      zone: searchParams.get('zone'),
      seed: searchParams.get('seed'),
      duration: searchParams.get('duration'),
      sf: searchParams.get('sf'),
      loss: searchParams.get('loss'),
      path_exp: searchParams.get('path_exp')
    };

    const streamHeaders = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    };
    applyCorsHeaders(streamHeaders, req);
    res.writeHead(200, streamHeaders);

    const job = jobManager.createJob(params);
    res.write(`data: ${JSON.stringify({ type: 'start', traceFilename: job.traceFilename, jobId: job.id })}\n\n`);

    job.sseClients.add(res);

    job.completionPromise.then(result => {
      res.write(`data: ${JSON.stringify({ type: 'done', code: 0, summary: result.summary, traceFilename: job.traceFilename })}\n\n`);
      res.end();
    }).catch(err => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      job.sseClients.delete(res);
      if (job.status === 'running') {
        jobManager.cancelJob(job.id, 'Client disconnected');
      }
    });
    return;
  }

  // POST /api/simulate/stop
  if (req.method === 'POST' && pathname === '/api/simulate/stop') {
    let stoppedCount = 0;
    for (const [id, job] of jobManager.activeJobs) {
      if (jobManager.cancelJob(id, 'Stopped via /api/simulate/stop')) {
        stoppedCount++;
      }
    }
    return sendJson(res, 200, {
      success: true,
      message: stoppedCount > 0 ? `Stopped ${stoppedCount} running simulation(s)` : 'No simulation was active'
    }, req);
  }

  // ---------------------------------------------------------------------------
  // Live Interactive Twin Endpoints
  // ---------------------------------------------------------------------------

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
      simManager.startContinuous(stepMs, 100);
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
      const node = parseInt(body.node !== undefined ? body.node : (body.id !== undefined ? body.id : body.nodeId), 10);
      if (isNaN(node)) {
        return sendError(res, 400, 'node parameter is required and must be an integer', req);
      }
      const rawKind = String(body.kind || 'short').replace('_', '-');
      const validKinds = ['short', 'double', 'long', 'voice', 'voice-medical', 'voice-trapped'];
      if (!validKinds.includes(rawKind)) {
        return sendError(res, 400, `Invalid trigger kind: "${rawKind}". Expected one of: ${validKinds.join(', ')}`, req);
      }
      const result = await simManager.sendCommand({ cmd: 'trigger', node, kind: rawKind });
      return sendJson(res, 200, { success: true, result, node, kind: rawKind }, req);
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
      const node = parseInt(body.node !== undefined ? body.node : (body.id !== undefined ? body.id : body.nodeId), 10);
      if (isNaN(node)) {
        return sendError(res, 400, 'node parameter is required and must be an integer', req);
      }
      const cmdObj = { cmd: 'set_node', node };
      if (body.online !== undefined) cmdObj.online = Boolean(body.online);
      if (body.gnss !== undefined) cmdObj.gnss = Boolean(body.gnss);
      else if (body.gnss_on !== undefined) cmdObj.gnss = Boolean(body.gnss_on);
      if (body.dr !== undefined) cmdObj.dr = Boolean(body.dr);
      else if (body.dr_on !== undefined) cmdObj.dr = Boolean(body.dr_on);
      if (body.battery !== undefined) {
        const batt = parseInt(body.battery, 10);
        if (isNaN(batt) || batt < 0 || batt > 100) {
          return sendError(res, 400, 'battery must be an integer between 0 and 100', req);
        }
        cmdObj.battery = batt;
      }
      const result = await simManager.sendCommand(cmdObj);
      return sendJson(res, 200, { success: true, result, node }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/motion
  if (req.method === 'POST' && pathname === '/api/control/motion') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const node = parseInt(body.node !== undefined ? body.node : (body.id !== undefined ? body.id : body.nodeId), 10);
      if (isNaN(node)) {
        return sendError(res, 400, 'node parameter is required and must be an integer', req);
      }
      const rawProfile = String(body.profile || 'stationary').toLowerCase().replace('-', '_');
      const validProfiles = ['stationary', 'walking', 'running', 'sudden_movement', 'fall_impact', 'irregular'];
      const profile = validProfiles.includes(rawProfile) ? rawProfile : 'stationary';
      const result = await simManager.sendCommand({ cmd: 'set_motion', node, profile });
      return sendJson(res, 200, { success: true, result, node, profile }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/gnss-outage
  if (req.method === 'POST' && pathname === '/api/control/gnss-outage') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const node = parseInt(body.node !== undefined ? body.node : (body.id !== undefined ? body.id : body.nodeId), 10);
      if (isNaN(node)) {
        return sendError(res, 400, 'node parameter is required and must be an integer', req);
      }
      const startMs = Math.max(0, parseInt(body.start_ms || 0, 10));
      const durationMs = Math.max(100, parseInt(body.duration_ms || 5000, 10));
      const result = await simManager.sendCommand({ cmd: 'schedule_gnss_outage', node, start_ms: startMs, duration_ms: durationMs });
      return sendJson(res, 200, { success: true, result, node, start_ms: startMs, duration_ms: durationMs }, req);
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // GET / POST /api/control/experiment-path-loss
  if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/control/experiment-path-loss') {
    try {
      const simPath = findSimulator();
      if (!simPath) {
        return sendError(res, 500, 'Simulator binary (setu_sim) not found.', req);
      }
      const searchParams = reqUrl.searchParams;
      const seed = Math.max(0, parseInt(searchParams.get('seed') || 42, 10));
      const args = ['--experiment-path-loss', '--seed', String(seed)];
      const child = spawn(simPath, args, { cwd: ROOT_DIR });
      let stdoutData = '';
      let stderrData = '';
      child.stdout.on('data', chunk => { stdoutData += chunk; });
      child.stderr.on('data', chunk => { stderrData += chunk; });
      child.on('close', code => {
        if (code !== 0) {
          return sendError(res, 500, `Experiment execution failed with code ${code}: ${stderrData || stdoutData}`, req);
        }
        try {
          const parsed = JSON.parse(stdoutData);
          return sendJson(res, 200, parsed, req);
        } catch {
          return sendJson(res, 200, { raw: stdoutData }, req);
        }
      });
      return;
    } catch (err) {
      return sendError(res, 500, err.message, req);
    }
  }

  // POST /api/control/reposition
  if (req.method === 'POST' && pathname === '/api/control/reposition') {
    try {
      await simManager.ensureStarted();
      const body = await parseBody(req);
      const node = parseInt(body.node !== undefined ? body.node : body.id, 10);
      if (isNaN(node)) {
        return sendError(res, 400, 'node parameter is required and must be an integer', req);
      }
      const x = parseFloat(body.x);
      const y = parseFloat(body.y);
      if (isNaN(x) || isNaN(y)) {
        return sendError(res, 400, 'x and y coordinates are required numbers', req);
      }
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
      if (isNaN(a) || isNaN(b)) {
        return sendError(res, 400, 'a and b node IDs are required integers', req);
      }
      const blocked = body.blocked !== undefined ? Boolean(body.blocked) : true;
      const result = await simManager.sendCommand({ cmd: 'block_link', a, b, blocked });
      return sendJson(res, 200, { success: true, result, a, b, blocked }, req);
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

  // ---------------------------------------------------------------------------
  // Scenarios and Trace File Endpoints
  // ---------------------------------------------------------------------------

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
  console.log(`  Job Manager: Concurrency Cap = ${jobManager.maxConcurrent}     `);
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
    try { simManager.process.kill('SIGTERM'); } catch {}
  }
  for (const [id] of jobManager.activeJobs) {
    jobManager.cancelJob(id, `Server shutdown (${signal})`);
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
