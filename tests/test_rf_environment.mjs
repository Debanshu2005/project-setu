// Project Setu: Phase 2 RF Environment, Obstacle Attenuation, and Fluid Drift Integration Tests
// Tests REST control endpoints and native simulator integration for Phase 2 realism features.

import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { findSimulator } from '../dashboard/sim_finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 3206;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [ PASS ] ${message}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${message}`);
    failedCount++;
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
          headers: res.headers,
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

  // Wait for server to become responsive
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await request('GET', '/health');
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  if (!ready) {
    throw new Error(`Server failed to respond on /health within timeout on port ${TEST_PORT}`);
  }
}

function stopServer() {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
    serverProcess = null;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu: Phase 2 RF Environment and Fluid Drift Tests');
  console.log('================================================================\n');

  try {
    await startServer();
    assert(true, `Test server started on port ${TEST_PORT}`);

    // 1. Initialize interactive simulator in Field realism profile
    console.log('\n[1/5] Initializing simulator in Field realism profile...');
    const initRes = await request('POST', '/api/control/init', {
      survivors: 5,
      relays: 2,
      zone: 1000,
      seed: 42,
      profile: 'field'
    });
    assert(initRes.status === 200, `POST /api/control/init returned HTTP 200 (Got: ${initRes.status})`);
    assert(initRes.json && initRes.json.success === true, 'Engine initialized with Field profile');

    // 2. Query initial loss budget between node 1 and hub 0
    console.log('\n[2/5] Testing loss budget API...');
    const lbRes = await request('GET', '/api/control/loss-budget?from=1&to=0');
    assert(lbRes.status === 200, `GET /api/control/loss-budget returned HTTP 200 (Got: ${lbRes.status})`);
    assert(lbRes.json && lbRes.json.cmd === 'get_loss_budget', 'Loss budget command confirmed');
    assert(lbRes.json.obstacle_loss === '0.0 dB (line of sight)', `Initial obstacle loss is line of sight (Got: ${lbRes.json.obstacle_loss})`);
    assert(lbRes.json.body_loss === '0.0 dB (unshadowed)', `Initial body loss is unshadowed (Got: ${lbRes.json.body_loss})`);
    assert(typeof lbRes.json.rx_power_dbm === 'number', 'rx_power_dbm is numeric');
    assert(typeof lbRes.json.link_margin_db === 'number', 'link_margin_db is numeric');

    // 3. Add polygonal/segment obstacle and verify obstacle query
    console.log('\n[3/5] Testing obstacle management...');
    const addObsRes = await request('POST', '/api/control/add-obstacle', {
      id: 101,
      label: 'collapsed_concrete_wall',
      material: 'concrete',
      x1: 50.0,
      y1: -200.0,
      x2: 50.0,
      y2: 200.0,
      thickness_m: 0.2,
      attenuation_db: 22.0
    });
    if (addObsRes.status !== 200) {
      console.error('addObsRes error response:', addObsRes.data);
    }
    assert(addObsRes.status === 200, `POST /api/control/add-obstacle returned HTTP 200 (Got: ${addObsRes.status})`);
    assert(addObsRes.json.success === true, 'Obstacle added successfully');

    const listObsRes = await request('GET', '/api/control/obstacles');
    assert(listObsRes.status === 200, `GET /api/control/obstacles returned HTTP 200`);
    assert(Array.isArray(listObsRes.json.obstacles), 'Obstacles returned as array');
    assert(listObsRes.json.obstacles.length === 1, `1 obstacle present in world (Got: ${listObsRes.json.obstacles.length})`);
    assert(listObsRes.json.obstacles[0].id === 101, 'Obstacle ID preserved');
    assert(listObsRes.json.obstacles[0].material === 'concrete', 'Obstacle material preserved');
    assert(listObsRes.json.obstacles[0].attenuation_db === 22.0, 'Obstacle attenuation 22.0 dB preserved');

    // 4. Test fluid drift kinematics
    console.log('\n[4/5] Testing fluid drift kinematics...');
    const driftRes = await request('POST', '/api/control/fluid-drift', {
      vx: 3.0,
      vy: -1.5
    });
    assert(driftRes.status === 200, `POST /api/control/fluid-drift returned HTTP 200`);
    assert(driftRes.json.vx === 3.0 && driftRes.json.vy === -1.5, 'Drift velocity vectors registered');

    // Query state before step
    const statePre = await request('GET', '/api/control/state');
    const survivorPre = statePre.json.nodes.find(n => n.id === 1);
    const hubPre = statePre.json.nodes.find(n => n.id === 0);
    assert(survivorPre !== undefined, 'Survivor node 1 found in pre-step state');

    // Step simulator across two 1000ms boundaries: [0, 3000ms) executes t=1000ms and t=2000ms (2 full seconds of drift)
    const stepRes = await request('POST', '/api/control/step', { ms: 3000 });
    assert(stepRes.status === 200, 'POST /api/control/step 3000ms returned HTTP 200');

    // Query state after step
    const statePost = await request('GET', '/api/control/state');
    const survivorPost = statePost.json.nodes.find(n => n.id === 1);
    const hubPost = statePost.json.nodes.find(n => n.id === 0);

    // Hub is static infrastructure and must not drift
    assert(hubPost.x === hubPre.x && hubPost.y === hubPre.y, 'Hub node remained fixed');

    // Survivor drifted by 2s * 3.0m/s = +6.0m in X and 2s * -1.5m/s = -3.0m in Y
    const dx = survivorPost.x - survivorPre.x;
    const dy = survivorPost.y - survivorPre.y;
    assert(Math.abs(dx - 6.0) < 0.1, `Survivor drifted +6.0m in X (Got: ${dx.toFixed(2)}m)`);
    assert(Math.abs(dy - (-3.0)) < 0.1, `Survivor drifted -3.0m in Y (Got: ${dy.toFixed(2)}m)`);

    // Clear obstacles
    const clearRes = await request('POST', '/api/control/clear-obstacles');
    assert(clearRes.status === 200, 'POST /api/control/clear-obstacles returned HTTP 200');
    const listCleared = await request('GET', '/api/control/obstacles');
    assert(listCleared.json.obstacles.length === 0, 'Obstacles cleared successfully');

    // 5. Direct CLI test of setu_sim with --obstacle and --fluid-drift flags
    console.log('\n[5/5] Testing setu_sim CLI flags (--obstacle and --fluid-drift)...');
    const simBin = findSimulator(ROOT_DIR) || (process.platform === 'win32'
      ? path.join(ROOT_DIR, 'build', 'Release', 'setu_sim.exe')
      : path.join(ROOT_DIR, 'build', 'setu_sim'));

    const simRes = spawnSync(simBin, [
      '--survivors', '3',
      '--relays', '1',
      '--profile', 'field',
      '--obstacle', '10:brick:0,-100,0,100@10.0',
      '--fluid-drift', '1.0,0.5',
      '--duration', '2000',
      '--trace', '-'
    ], { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

    assert(simRes.status === 0, `setu_sim exited with code 0 (Got: ${simRes.status})`);
    const out = simRes.stdout || '';
    assert(out.includes('"ev":"obstacle_init"'), 'Trace output contains obstacle_init event');
    assert(out.includes('"material":"brick"'), 'Trace output contains brick material');
    assert(out.includes('"loss_db":10.0'), 'Trace output contains 10.0 dB loss');

    console.log(`\n================================================================`);
    console.log(`  ALL ${passedCount} PHASE 2 RF ENVIRONMENT TESTS PASSED!`);
    console.log(`================================================================\n`);
  } finally {
    stopServer();
  }
}

runTests().catch(err => {
  console.error('\n[FATAL ERROR]', err.message);
  stopServer();
  process.exit(1);
});
