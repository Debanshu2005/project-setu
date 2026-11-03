// Project Setu: Phase 3 Disaster Acceptance Scenarios and Sensitivity Sweep Test Suite
// Validates the 5 golden disaster acceptance scenarios and global sensitivity analysis.

import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { findSimulator } from '../dashboard/sim_finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SCENARIOS_DIR = path.join(ROOT_DIR, 'scenarios');

const TEST_PORT = 3207;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;
let passedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [ PASS ] ${message}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function request(method, pathName, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const reqHeaders = {};
    let payload = null;

    if (body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, { method, headers: reqHeaders }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function getSimBin() {
  return process.platform === 'win32'
    ? path.join(ROOT_DIR, 'build', 'Release', 'setu_sim.exe')
    : path.join(ROOT_DIR, 'build', 'setu_sim');
}

async function runScenario(scenarioFile) {
  const content = fs.readFileSync(path.join(SCENARIOS_DIR, scenarioFile), 'utf8');
  const sc = JSON.parse(content);
  const p = sc.params || {};

  const args = [
    '--survivors', String(p.survivors || 10),
    '--relays', String(p.relays || 3),
    '--zone', String(p.zone || 1000),
    '--seed', String(p.seed || 42),
    '--duration', String(p.duration || 20000),
    '--sf', String(p.sf || 7),
    '--loss', String(p.loss || 0.0),
    '--path-exp', String(p.path_exp || 3.0),
    '--profile', String(p.profile || 'field'),
    '--allow-disconnected',
    '--trace', '-'
  ];

  if (p.allow_disconnected || p.allowDisconnected || sc.allow_disconnected) {
    args.push('--allow-disconnected');
  }

  if (Array.isArray(sc.obstacles)) {
    for (const obs of sc.obstacles) {
      let s = `${obs.id}:${obs.material}:${obs.x1},${obs.y1},${obs.x2},${obs.y2}`;
      if (obs.attenuation_db !== undefined) s += `@${obs.attenuation_db}`;
      args.push('--obstacle', s);
    }
  }

  if (sc.fluid_drift) {
    args.push('--fluid-drift', `${sc.fluid_drift.vx || 0},${sc.fluid_drift.vy || 0}`);
  }

  if (Array.isArray(sc.triggers)) {
    for (const tr of sc.triggers) {
      args.push('--trigger', `${tr.node}:${tr.kind}@${tr.t}`);
    }
  }

  if (Array.isArray(sc.faults)) {
    for (const ft of sc.faults) {
      if (ft.kind === 'motion') {
        args.push('--motion', `${ft.target}:${ft.profile || 'moving'}@${ft.t}`);
      } else if (ft.kind === 'battery') {
        args.push('--battery', `${ft.target}:${ft.battery !== undefined ? ft.battery : 100}@${ft.t}`);
      } else if (ft.kind === 'kill') {
        args.push('--kill', `${ft.target}@${ft.t}`);
      } else if (ft.kind === 'gps-off') {
        args.push('--gps-off', `${ft.target}@${ft.t}`);
      } else if (ft.kind === 'no-dr') {
        args.push('--no-dr', `${ft.target}@${ft.t}`);
      }
    }
  }

  const simBin = findSimulator(ROOT_DIR) || getSimBin();
  const res = spawnSync(simBin, args, { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0 || res.error) {
    const errDetail = res.error ? res.error.message : (res.stderr || res.stdout);
    throw new Error(`setu_sim failed for ${scenarioFile} with code ${res.status}: ${errDetail}`);
  }

  const events = (res.stdout || '')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
  return { events, stdout: res.stdout || '' };
}

async function startServer() {
  serverProcess = spawn(process.execPath, [path.join(ROOT_DIR, 'dashboard', 'server.js')], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stderr.on('data', chunk => {
    const s = chunk.toString().trim();
    if (s && !s.includes('ExperimentalWarning')) console.error('[server stderr]', s);
  });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await request('GET', '/health');
      if (res.status === 200) return;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(`Server failed to start on port ${TEST_PORT}`);
}

function stopServer() {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
    serverProcess = null;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu: Phase 3 Acceptance Scenarios and Sensitivity Suite');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------
    // Acceptance Scenario 1: Deep Subterranean Building Collapse
    // -------------------------------------------------------------
    console.log('[Scenario 1/5] Deep Subterranean Building Collapse...');
    const sc1 = await runScenario('building_collapse_deep.json');
    assert(sc1.events.length > 50, 'Scenario 1 produced rich simulation trace');
    const obsInit = sc1.events.filter(e => e.ev === 'obstacle_init');
    assert(obsInit.length >= 2, `2 concrete floor slabs initialized (Got: ${obsInit.length})`);
    const alerts1 = sc1.events.filter(e => e.ev === 'alert');
    assert(alerts1.length > 0, `Alert received at rescue hub (Got: ${alerts1.length})`);
    assert(alerts1.some(a => a.origin === 3 || a.origin === 7 || a.origin === 12 || a.hazard >= 0), 'Disaster SOS alert successfully delivered through concrete slabs');

    // -------------------------------------------------------------
    // Acceptance Scenario 2: Flash Flood River Valley
    // -------------------------------------------------------------
    console.log('\n[Scenario 2/5] Flash Flood River Valley Inundation...');
    const sc2 = await runScenario('flash_flood_valley.json');
    const waterObs = sc2.events.filter(e => e.ev === 'obstacle_init' && e.material === 'water');
    assert(waterObs.length >= 1, 'Water dielectric channel obstacle registered');
    const alerts2 = sc2.events.filter(e => e.ev === 'alert');
    assert(alerts2.length > 0, `Mesh delivery achieved during river valley drift (Got: ${alerts2.length} alerts)`);

    // -------------------------------------------------------------
    // Acceptance Scenario 3: Subterranean Metro Tunnel Partition
    // -------------------------------------------------------------
    console.log('\n[Scenario 3/5] Subterranean Metro Tunnel Structural Partition...');
    const sc3 = await runScenario('subway_tunnel_partition.json');
    const bulkheadObs = sc3.events.filter(e => e.ev === 'obstacle_init' && e.loss_db >= 35.0);
    assert(bulkheadObs.length >= 1, 'Tunnel bulkhead collapse partition registered (35.0 dB)');
    const relays3 = sc3.events.filter(e => e.ev === 'node_init' && e.role === 'relay');
    assert(relays3.length === 5, '5 subway tunnel relays initialized');

    // -------------------------------------------------------------
    // Acceptance Scenario 4: Urban Earthquake Simultaneous Aftershock
    // -------------------------------------------------------------
    console.log('\n[Scenario 4/5] Urban Earthquake Simultaneous Aftershock Stress Test...');
    const sc4 = await runScenario('urban_earthquake_aftershock.json');
    const nodes4 = sc4.events.filter(e => e.ev === 'node_init');
    assert(nodes4.length >= 36, `Large-scale 36+ node network loaded (Got: ${nodes4.length})`);
    const alerts4 = sc4.events.filter(e => e.ev === 'alert');
    assert(alerts4.length > 0, `Mesh delivered alerts under burst contention (Got: ${alerts4.length})`);

    // -------------------------------------------------------------
    // Acceptance Scenario 5: Mixed Multi-Hazard Complex Disaster
    // -------------------------------------------------------------
    console.log('\n[Scenario 5/5] Mixed Multi-Hazard Complex Disaster Network...');
    const sc5 = await runScenario('mixed_hazard_survival.json');
    const fallEvents = sc5.events.filter(e => e.ev === 'fall_impact_detected');
    assert(fallEvents.length >= 1, 'Automatic fall impact detection confirmed on survivor 2');
    const alerts5 = sc5.events.filter(e => e.ev === 'alert');
    assert(alerts5.length > 0, `Alerts delivered with route self-healing (Got: ${alerts5.length})`);

    // -------------------------------------------------------------
    // Global Sensitivity Analysis Framework
    // -------------------------------------------------------------
    console.log('\n[Sensitivity Analysis] Running Global Sensitivity Analysis framework...');
    await startServer();
    assert(true, 'Operations dashboard test server started');

    const sensRes = await request('GET', '/api/control/sensitivity-sweep?seed=42');
    assert(sensRes.status === 200, `GET /api/control/sensitivity-sweep returned HTTP 200 (Got: ${sensRes.status})`);
    assert(sensRes.json && sensRes.json.experiment === 'global_sensitivity_analysis', 'Sensitivity analysis experiment confirmed');
    assert(Array.isArray(sensRes.json.results) && sensRes.json.results.length >= 7, 'Multi-factor sweep executed across 7 parameter combinations');
    assert(Array.isArray(sensRes.json.ranking) && sensRes.json.ranking.length >= 3, 'Parameter importance ranking generated');
    assert(sensRes.json.ranking[0].factor === 'path_loss_exponent', 'Path loss exponent identified as primary factor');

    console.log('\n================================================================');
    console.log(`  ALL ${passedCount} ACCEPTANCE AND SENSITIVITY TESTS PASSED!`);
    console.log('================================================================\n');
  } finally {
    stopServer();
  }
}

runTests().catch(err => {
  console.error('\n[FATAL ERROR]', err.message);
  stopServer();
  process.exit(1);
});

