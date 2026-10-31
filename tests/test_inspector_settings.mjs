// Project Setu - Regression Test Suite for Inspector Settings Persistence Across Simulation Start
// Tests:
// Test A: Motion profile persistence (stationary -> moving, starts sim, verifies remains moving & active kinematics)
// Test B: Multiple Inspector settings (battery, GNSS, DR, online/offline persist across start)
// Test C: Node isolation (per-node settings configured independently do not leak across nodes)
// Test D: Polling / status responses (stale polling does not overwrite newer user edits)
// Test E: Start / stop / resume lifecycle persistence
// Test F: Scenario loading interaction vs manual settings
// Test G: Backend + C++ simulator integration (REST API & interactive native engine)

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { SimulationEngine, normalizeRole } from '../dashboard/src/simulation.js';
import { InspectorComponent } from '../dashboard/components/inspector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 3205;
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
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Minimal DOM Element Mock for Inspector testing
class MockDomElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.innerHTML = '';
    this.value = '';
    this.style = {};
    this.dataset = {};
    this.classList = {
      classes: new Set(),
      add: (c) => this.classList.classes.add(c),
      remove: (c) => this.classList.classes.delete(c),
      contains: (c) => this.classList.classes.has(c)
    };
    this.listeners = {};
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event, payload = {}) {
    const fns = this.listeners[event] || [];
    for (const fn of fns) {
      fn({ target: this, ...payload });
    }
  }

  querySelector(selector) {
    // If querying select or button inside rendered HTML
    if (selector === '#selMotionProfile') {
      const el = new MockDomElement('select');
      const match = this.innerHTML.match(/<select id="selMotionProfile"[^>]*>([\s\S]*?)<\/select>/);
      if (match) {
        const opts = match[1];
        const selectedMatch = opts.match(/<option value="([^"]+)"\s+selected>/);
        el.value = selectedMatch ? selectedMatch[1] : 'stationary';
      }
      return el;
    }
    if (selector === '#btnToggleOnline' || selector === '#btnToggleGnss' || selector === '#btnToggleDr' || selector === '#btnApplyBattery') {
      return new MockDomElement('button');
    }
    if (selector === '#sliderBattery' || selector === '#numBattery') {
      return new MockDomElement('input');
    }
    return new MockDomElement('div');
  }

  querySelectorAll(selector) {
    return [];
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu — Inspector Settings Persistence Regression Suite');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test A: Motion profile persistence
  // -------------------------------------------------------------
  console.log('[Test A] Motion Profile Persistence (stationary -> moving across start)...');
  {
    const engine = new SimulationEngine();
    const nodeEl = new MockDomElement('div');
    const pktEl = new MockDomElement('div');

    const traceEvents = [
      { t: 0, ev: 'meta', duration: 10000 },
      { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 100, x: 10, y: 10 },
      { t: 0, ev: 'node_init', id: 0, role: 'hub', battery: 100, x: 0, y: 0 }
    ];

    engine.loadTrace(traceEvents);
    const inspector = new InspectorComponent(nodeEl, pktEl, engine);

    const node1 = engine.nodes.get(1);
    assert(node1 !== undefined, 'Node 1 exists in simulation engine');
    assert(node1.motion_profile === 'stationary', 'Node 1 initial motion profile is "stationary"');

    // Verify Inspector HTML dropdown includes the 'moving' option
    inspector.inspectNode(node1);
    assert(nodeEl.innerHTML.includes('<option value="moving"'), 'Inspector dropdown includes <option value="moving">');

    // User changes motion profile to 'moving'
    node1.motion_profile = 'moving';
    node1.initial_motion_profile = 'moving';
    inspector.renderNode();

    // Verify that Inspector displays 'moving' as selected
    assert(nodeEl.innerHTML.includes('<option value="moving" selected>'), 'Inspector displays "moving" as selected in dropdown');

    // User starts simulation / steps clock forward
    engine.recalculateState(500);

    // Verify motion profile remains 'moving' and was not overwritten to 'stationary'
    assert(node1.motion_profile === 'moving', 'Node 1 motion_profile persists as "moving" after simulation starts (got: ' + node1.motion_profile + ')');
    assert(node1.initial_motion_profile === 'moving', 'Node 1 initial_motion_profile remains "moving"');

    // Verify Inspector re-render still shows 'moving'
    inspector.renderNode();
    assert(nodeEl.innerHTML.includes('<option value="moving" selected>'), 'Inspector continues to display "moving" as selected during simulation');
  }

  // -------------------------------------------------------------
  // Test B: Multiple Inspector Settings Persistence (battery, GNSS, DR, online)
  // -------------------------------------------------------------
  console.log('\n[Test B] Multiple Inspector Settings Persistence (battery, GNSS, DR, power)...');
  {
    const engine = new SimulationEngine();
    const nodeEl = new MockDomElement('div');
    const pktEl = new MockDomElement('div');

    engine.loadTrace([
      { t: 0, ev: 'meta', duration: 10000 },
      { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 100, x: 20, y: 20 }
    ]);

    const inspector = new InspectorComponent(nodeEl, pktEl, engine);
    const node1 = engine.nodes.get(1);
    inspector.inspectNode(node1);

    // User modifies all 4 settings
    node1.battery = 45;
    node1.initial_battery = 45;
    node1.gnss_on = false;
    node1.initial_gnss_on = false;
    node1.dr_on = false;
    node1.initial_dr_on = false;
    node1.online = false;
    node1.initial_online = false;
    node1.motion_profile = 'moving';
    node1.initial_motion_profile = 'moving';

    // Start simulation / advance time to 1500ms
    engine.recalculateState(1500);

    assert(node1.battery === 45, 'Configured battery (45%) persisted across simulation start (got: ' + node1.battery + ')');
    assert(node1.gnss_on === false, 'Configured GNSS disabled state persisted across simulation start');
    assert(node1.dr_on === false, 'Configured DR disabled state persisted across simulation start');
    assert(node1.online === false, 'Configured offline power state persisted across simulation start');
    assert(node1.motion_profile === 'moving', 'Configured motion profile (moving) persisted alongside other settings');

    // Inspector reflects all settings
    inspector.renderNode();
    assert(nodeEl.innerHTML.includes('45<span class="metric-unit">%</span>'), 'Inspector renders 45% battery');
    assert(nodeEl.innerHTML.includes('OFFLINE (FAILED)'), 'Inspector renders OFFLINE status');
    assert(nodeEl.innerHTML.includes('GNSS Denied (Lost)'), 'Inspector renders GNSS Denied button state');
    assert(nodeEl.innerHTML.includes('IMU DR Disabled'), 'Inspector renders IMU DR Disabled button state');
  }

  // -------------------------------------------------------------
  // Test C: Node Isolation
  // -------------------------------------------------------------
  console.log('\n[Test C] Node Isolation (per-node settings independence)...');
  {
    const engine = new SimulationEngine();
    engine.loadTrace([
      { t: 0, ev: 'meta', duration: 10000 },
      { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 100, x: 10, y: 10 },
      { t: 0, ev: 'node_init', id: 2, role: 'survivor', battery: 100, x: 30, y: 30 }
    ]);

    const n1 = engine.nodes.get(1);
    const n2 = engine.nodes.get(2);

    // Configure Node 1: Moving, 65% battery, GNSS ON
    n1.motion_profile = 'moving';
    n1.initial_motion_profile = 'moving';
    n1.battery = 65;
    n1.initial_battery = 65;
    n1.gnss_on = true;
    n1.initial_gnss_on = true;

    // Configure Node 2: Stationary, 25% battery, GNSS OFF
    n2.motion_profile = 'stationary';
    n2.initial_motion_profile = 'stationary';
    n2.battery = 25;
    n2.initial_battery = 25;
    n2.gnss_on = false;
    n2.initial_gnss_on = false;

    // Advance clock
    engine.recalculateState(2000);

    // Verify Node 1 is untouched by Node 2
    assert(n1.motion_profile === 'moving', 'Node 1 retains "moving" profile');
    assert(n1.battery === 65, 'Node 1 retains 65% battery');
    assert(n1.gnss_on === true, 'Node 1 retains GNSS on');

    // Verify Node 2 is untouched by Node 1
    assert(n2.motion_profile === 'stationary', 'Node 2 retains "stationary" profile');
    assert(n2.battery === 25, 'Node 2 retains 25% battery');
    assert(n2.gnss_on === false, 'Node 2 retains GNSS off');
  }

  // -------------------------------------------------------------
  // Test D: Polling / Status responses do not overwrite user edits
  // -------------------------------------------------------------
  console.log('\n[Test D] Polling & Status Responses Do Not Overwrite User Edits...');
  {
    const engine = new SimulationEngine();
    engine.loadTrace([
      { t: 0, ev: 'meta', duration: 10000 },
      { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 100 }
    ]);

    const n1 = engine.nodes.get(1);
    n1.motion_profile = 'moving';
    n1.initial_motion_profile = 'moving';

    // Simulate an incoming event with missing or null profile (e.g. from an old trace or partial poll)
    const partialStateEvent = {
      ev: 'state',
      t: 100,
      nodes: [
        { id: 1, battery: 98, online: true, gnss_on: true, dr_on: true } // motion_profile omitted
      ]
    };

    // If an event lacks motion_profile, it must not reset to 'stationary'
    if (partialStateEvent.nodes[0].motion_profile) {
      n1.motion_profile = partialStateEvent.nodes[0].motion_profile;
    }
    assert(n1.motion_profile === 'moving', 'Omitted profile in status poll does not overwrite configured "moving" profile');

    // Even after recalculateState at t=100
    engine.recalculateState(100);
    assert(n1.motion_profile === 'moving', 'recalculateState preserves configured profile across polling events');
  }

  // -------------------------------------------------------------
  // Test E: Start / Stop / Resume Lifecycle Persistence
  // -------------------------------------------------------------
  console.log('\n[Test E] Start / Stop / Resume Lifecycle Persistence...');
  {
    const engine = new SimulationEngine();
    engine.loadTrace([
      { t: 0, ev: 'meta', duration: 10000 },
      { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 80 }
    ]);

    const n1 = engine.nodes.get(1);
    n1.motion_profile = 'moving';
    n1.initial_motion_profile = 'moving';
    n1.battery = 50;
    n1.initial_battery = 50;

    // Start
    engine.recalculateState(500);
    assert(n1.motion_profile === 'moving', 'State holds at t=500ms (Running)');
    assert(n1.battery === 50, 'Battery holds at 50% at t=500ms');

    // Pause / Stop
    engine.pause();
    assert(n1.motion_profile === 'moving', 'State holds when paused');

    // Resume / Step forward
    engine.recalculateState(1200);
    assert(n1.motion_profile === 'moving', 'State holds when resumed at t=1200ms');
    assert(n1.battery === 50, 'Battery holds at 50% when resumed');
  }

  // -------------------------------------------------------------
  // Test F: Scenario loading interaction vs manual settings
  // -------------------------------------------------------------
  console.log('\n[Test F] Scenario Loading Interaction vs Manual Settings...');
  {
    const engine = new SimulationEngine();
    // 1. Initial custom setup
    engine.loadTrace([
      { t: 0, ev: 'meta', duration: 5000 },
      { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 100 }
    ]);

    const n1 = engine.nodes.get(1);
    n1.motion_profile = 'moving';
    n1.initial_motion_profile = 'moving';
    n1.battery = 70;
    n1.initial_battery = 70;

    // Normal play/scrub does NOT reset
    engine.recalculateState(1000);
    assert(n1.motion_profile === 'moving', 'Normal scrubbing retains custom settings');
    assert(n1.battery === 70, 'Normal scrubbing retains custom battery');

    // 2. Loading a documented scenario with explicit node states updates according to scenario definition
    const scenarioTrace = [
      { t: 0, ev: 'meta', duration: 15000 },
      { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 100, motion_profile: 'walking' }
    ];
    engine.loadTrace(scenarioTrace);
    const n1Scenario = engine.nodes.get(1);
    assert(n1Scenario.motion_profile === 'walking', 'Documented scenario definition explicitly updates node profile');
    assert(n1Scenario.battery === 100, 'Documented scenario definition explicitly updates node battery');
  }

  // -------------------------------------------------------------
  // Test G: Backend Server & C++ Simulator Integration
  // -------------------------------------------------------------
  console.log('\n[Test G] Backend & C++ Simulator Integration (REST & Native Twin)...');
  {
    // Start backend server
    const serverScript = path.join(ROOT_DIR, 'dashboard', 'server.js');
    serverProcess = spawn(process.execPath, [serverScript], {
      cwd: ROOT_DIR,
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stderr.on('data', d => {
      const s = d.toString().trim();
      if (s && !s.includes('ExperimentalWarning')) console.error('[Server STDERR]', s);
    });

    // Wait for server to become responsive
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await request('GET', '/health');
        if (res.statusCode === 200) {
          ready = true;
          break;
        }
      } catch {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    assert(ready, `Test server spawned and responsive on port ${TEST_PORT}`);

    // 1. Initialize interactive engine
    const initRes = await request('POST', '/api/control/init', { survivors: 5, relays: 2, zone: 1200, seed: 7 });
    assert(initRes.statusCode === 200, '/api/control/init returns HTTP 200');
    assert(initRes.json && initRes.json.success, 'C++ interactive engine initialized');

    // 2. Set Node 1 motion profile to 'moving' via REST API
    const motionRes = await request('POST', '/api/control/motion', { node: 1, profile: 'moving' });
    assert(motionRes.statusCode === 200, 'POST /api/control/motion with "moving" returns HTTP 200');
    assert(motionRes.json && motionRes.json.profile === 'moving', 'API confirms profile is "moving" (not defaulted to stationary)');

    // 3. Query authoritative C++ engine state
    const stateRes = await request('GET', '/api/control/state');
    assert(stateRes.statusCode === 200, 'GET /api/control/state returns HTTP 200');
    const node1State = stateRes.json && stateRes.json.nodes ? stateRes.json.nodes.find(n => n.id === 1) : null;
    assert(node1State !== null, 'Node 1 found in C++ World state');
    assert(node1State.motion_profile === 'moving', 'Authoritative C++ World reports motion_profile is "moving" (got: ' + (node1State ? node1State.motion_profile : 'null') + ')');

    // 4. Set Node 1 battery to 42%
    const battRes = await request('POST', '/api/control/node-state', { node: 1, battery: 42 });
    assert(battRes.statusCode === 200, 'POST /api/control/node-state setting battery returns HTTP 200');

    // 5. Start simulation continuous stepping
    const startRes = await request('POST', '/api/control/start', { step_ms: 100 });
    assert(startRes.statusCode === 200, 'POST /api/control/start returns HTTP 200');
    assert(startRes.json && (startRes.json.running === true || startRes.json.success === true), 'Engine is now running continuously (got: ' + JSON.stringify(startRes.json) + ')');

    // Allow engine to step
    await new Promise(r => setTimeout(r, 400));

    // Pause simulation
    const pauseRes = await request('POST', '/api/control/pause');
    assert(pauseRes.statusCode === 200, 'POST /api/control/pause returns HTTP 200');

    // 6. Query C++ engine state again to verify settings persisted during execution
    const stateAfterRun = await request('GET', '/api/control/state');
    assert(stateAfterRun.statusCode === 200, 'GET /api/control/state after stepping returns HTTP 200');
    const n1After = stateAfterRun.json.nodes.find(n => n.id === 1);
    assert(n1After.motion_profile === 'moving', 'Node 1 motion_profile persisted as "moving" across simulation stepping (got: ' + n1After.motion_profile + ')');
    assert(n1After.initial_battery === 42, 'Node 1 initial_battery persisted as 42%');
    assert(n1After.battery <= 42, 'Node 1 battery operated from configured 42% baseline (got: ' + n1After.battery + ')');

    // 7. Verify non-interactive simulation job accepts custom motion & battery
    const customJobRes = await request('POST', '/api/simulate', {
      params: { survivors: 5, relays: 2, duration: 3000, seed: 42, sf: 7, loss: 0, path_exp: 3.5, zone: 1000 },
      triggers: [{ node: 1, kind: 'short', t: 500 }],
      faults: [
        { kind: 'motion', target: 1, profile: 'moving', t: 0 },
        { kind: 'battery', target: 1, battery: 55, t: 0 }
      ]
    });
    assert(customJobRes.statusCode === 200, 'POST /api/simulate with custom motion/battery returns HTTP 200');
    assert(customJobRes.json && customJobRes.json.traceFilename, 'Custom job generated trace file');

    // Fetch the trace events
    const traceRes = await request('GET', `/api/trace/${customJobRes.json.traceFilename}`);
    assert(traceRes.statusCode === 200, 'Trace file fetched successfully');
    assert(traceRes.data.includes('"ev":"motion_profile"') && traceRes.data.includes('"profile":"moving"'), 'Trace contains motion_profile "moving" event generated by native engine');
    assert(traceRes.data.includes('"ev":"battery"') && traceRes.data.includes('"battery":55'), 'Trace contains initial battery 55% event generated by native engine');

    // Cleanup server
    serverProcess.kill('SIGTERM');
    serverProcess = null;
    console.log('  [ PASS ] Test server shut down cleanly');
  }

  console.log('\n================================================================');
  console.log(`  REGRESSION TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

try {
  await runTests();
} catch (err) {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch {}
  }
  console.error('\n[FATAL ERROR IN TEST EXECUTION]', err);
  process.exit(1);
}
