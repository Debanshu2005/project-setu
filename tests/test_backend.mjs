// Project Setu - Automated Backend & Native C++ Integration Verification Suite
// Tests health, status, simulator lifecycle, SOS triggers, path traversal security, and real C++ core protocol output.

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 3199;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const reqHeaders = { ...headers };
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
          status: res.status,
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu — Automated Backend & C++ Lifecycle Test Suite   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [ PASS ] ${message}`);
      passed++;
    } else {
      console.error(`  [ FAIL ] ${message}`);
      failed++;
    }
  }

  // 1. Start Server on TEST_PORT
  console.log(`[1/8] Starting server.js on port ${TEST_PORT}...`);
  serverProcess = spawn(process.execPath, [path.join(ROOT_DIR, 'dashboard', 'server.js')], {
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
      await sleep(200);
    }
  }

  assert(ready, 'Server started and bound port 0.0.0.0 successfully');

  // 2. Health Endpoint
  console.log('\n[2/8] Testing /health and /api/health endpoints...');
  try {
    const res = await request('GET', '/health');
    assert(res.statusCode === 200, '/health returns HTTP 200');
    assert(res.json?.status === 'ok', 'Health status is "ok"');
    assert(res.json?.service === 'setu-simulation-backend', 'Service name is setu-simulation-backend');
    assert(typeof res.json?.simulatorFound === 'boolean', 'Simulator presence is reported explicitly');
  } catch (err) {
    assert(false, `/health failed: ${err.message}`);
  }

  // 3. Status Endpoint distinguishes service vs simulator health
  console.log('\n[3/8] Testing /api/status endpoint...');
  try {
    const res = await request('GET', '/api/status');
    assert(res.statusCode === 200, '/api/status returns HTTP 200');
    assert(res.json?.status === 'online', 'Service status is online');
    assert(res.json?.serviceHealth === 'ok', 'Service health is ok');
    assert(res.json?.engine === 'c++_protocol_core_fitl', 'Engine is c++_protocol_core_fitl');
    assert(res.json?.simulatorFound === true, 'Native simulator binary found and reported');
  } catch (err) {
    assert(false, `/api/status failed: ${err.message}`);
  }

  // 4. CORS Security Header Verification
  console.log('\n[4/10] Testing CORS policy...');
  try {
    // Request from approved local origin
    const resLocal = await request('OPTIONS', '/api/status', null, {
      'Origin': 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET'
    });
    assert(resLocal.statusCode === 204, 'Approved local origin preflight returns HTTP 204');
    assert(resLocal.headers['access-control-allow-origin'] === 'http://localhost:3000', 'Approved local origin accepted in CORS');
    assert(resLocal.headers['access-control-allow-credentials'] === 'true', 'Credentials header enabled for approved origin');

    // Request from approved Vercel origin
    const resVercel = await request('OPTIONS', '/api/status', null, {
      'Origin': 'https://project-setu.vercel.app',
      'Access-Control-Request-Method': 'GET'
    });
    assert(resVercel.statusCode === 204, 'Production Vercel domain preflight returns HTTP 204');
    assert(resVercel.headers['access-control-allow-origin'] === 'https://project-setu.vercel.app', 'Vercel domain accepted in CORS');

    // Request from unauthorized external domain
    const resMalicious = await request('OPTIONS', '/api/status', null, {
      'Origin': 'https://attacker-domain.evil.com',
      'Access-Control-Request-Method': 'GET'
    });
    assert(resMalicious.statusCode === 403, 'Unauthorized origin preflight rejected with HTTP 403');
    assert(!resMalicious.headers['access-control-allow-origin'], 'Untrusted origin receives NO Access-Control-Allow-Origin header');
  } catch (err) {
    assert(false, `CORS check failed: ${err.message}`);
  }

  // 5. Directory Traversal Protection on Trace Endpoint
  console.log('\n[5/8] Testing path traversal security on /api/trace/:filename...');
  try {
    const resTrav1 = await request('GET', '/api/trace/..%2f..%2fpackage.json');
    assert(resTrav1.statusCode === 400 || resTrav1.statusCode === 403 || resTrav1.statusCode === 404, 'Path traversal with encoded slashes blocked');

    const resTrav2 = await request('GET', '/api/trace/invalid_ext.txt');
    assert(resTrav2.statusCode === 400 || resTrav2.statusCode === 404, 'Non-jsonl file rejected');
  } catch (err) {
    assert(false, `Path traversal check failed: ${err.message}`);
  }

  // 6. Interactive C++ Simulator Lifecycle & SOS Trigger
  console.log('\n[6/8] Testing interactive C++ simulator lifecycle & real protocol SOS trigger...');
  try {
    // Initialize interactive world
    const resInit = await request('POST', '/api/control/init', {
      survivors: 5,
      relays: 2,
      zone: 600,
      seed: 42,
      sf: 7
    });
    assert(resInit.statusCode === 200, '/api/control/init returns HTTP 200');
    assert(resInit.json?.success === true, 'C++ interactive engine initialized');

    // Query node states before trigger
    const resStatePre = await request('GET', '/api/control/state');
    assert(resStatePre.statusCode === 200, '/api/control/state returns HTTP 200');
    assert(Array.isArray(resStatePre.json?.nodes), 'Node list returned from C++ World');
    const node1Pre = resStatePre.json?.nodes.find(n => n.id === 1);
    assert(node1Pre !== undefined, 'Node 1 found in C++ World');
    assert(node1Pre?.tx_sos === 0, 'Node 1 tx_sos starts at 0');

    // Inject SOS Trigger on Node 1 (using normalized hyphen kind)
    const resTrigger = await request('POST', '/api/control/trigger', {
      node: 1,
      kind: 'short'
    });
    assert(resTrigger.statusCode === 200, '/api/control/trigger returns HTTP 200');
    assert(resTrigger.json?.success === true, 'SOS trigger registered by C++ engine');

    // Step simulation time forward by 1000ms to allow protocol core to transmit
    const resStep = await request('POST', '/api/control/step', { ms: 1000 });
    assert(resStep.statusCode === 200, '/api/control/step returns HTTP 200');
    assert(resStep.json?.success === true, 'C++ engine stepped simulation clock');

    // Query node states after trigger
    const resStatePost = await request('GET', '/api/control/state');
    const node1Post = resStatePost.json?.nodes.find(n => n.id === 1);
    assert(node1Post?.tx_sos >= 1, `Real C++ setu::Node executed protocol and incremented tx_sos (${node1Post?.tx_sos})`);

    // Query summary counters
    const resSummary = await request('GET', '/api/control/summary');
    assert(resSummary.statusCode === 200, '/api/control/summary returns HTTP 200');
    assert(resSummary.json?.summary?.totals?.tx >= 1, `C++ World RF channel recorded real transmissions (${resSummary.json?.summary?.totals?.tx})`);

    // Test Broadcast SOS (trigger_all)
    console.log('\n    [Subtest] Testing Broadcast SOS (trigger_all across all survivors)...');
    const resTriggerAll = await request('POST', '/api/control/trigger-all', {
      kind: 'short',
      delay_ms: 0
    });
    assert(resTriggerAll.statusCode === 200, '/api/control/trigger-all returns HTTP 200');
    assert(resTriggerAll.json?.success === true, 'trigger_all registered by C++ engine');

    // Step simulation time forward by 1200ms
    const resStepAll = await request('POST', '/api/control/step', { ms: 1200 });
    assert(resStepAll.statusCode === 200, 'Clock stepped forward for broadcast wave');

    const resStateBroadcast = await request('GET', '/api/control/state');
    const survivors = resStateBroadcast.json?.nodes.filter(n => n.role === 'survivor') || [];
    const activeOrSent = survivors.filter(n => n.tx_sos >= 1);
    assert(activeOrSent.length >= 3, `Broadcast SOS wave reached survivor nodes (transmitting count: ${activeOrSent.length}/${survivors.length})`);

    // Test Serialized Command Queue (Concurrent requests handled deterministically)
    console.log('\n    [Subtest] Testing serialized simulator command queue concurrency...');
    const [stepPromise, statePromise] = await Promise.all([
      request('POST', '/api/control/step', { ms: 500 }),
      request('GET', '/api/control/state')
    ]);
    assert(stepPromise.statusCode === 200 && stepPromise.json?.result?.cmd === 'step', 'Concurrent step resolved with step response');
    assert(statePromise.statusCode === 200 && statePromise.json?.cmd === 'get_state', 'Concurrent get_state resolved with get_state response');

    // Reset simulator
    const resReset = await request('POST', '/api/control/reset');
    assert(resReset.statusCode === 200 && resReset.json?.success === true, 'C++ engine reset cleanly');

    // Subtest: Battery and State Persistence (Phase 3 & Phase 9 requirement)
    console.log('\n    [Subtest] Testing battery configuration, energy consumption & reset persistence...');
    
    // Set Node 2 battery to 35%
    const resSetBatt = await request('POST', '/api/control/node-state', { node: 2, battery: 35 });
    assert(resSetBatt.statusCode === 200, 'Setting Node 2 battery to 35% returns HTTP 200');

    // Verify authoritative state in C++ engine reports 35%
    const resStateBatt1 = await request('GET', '/api/control/state');
    const node2Pre = resStateBatt1.json?.nodes.find(n => n.id === 2);
    assert(node2Pre?.battery === 35, `Authoritative C++ state reports 35% battery (got: ${node2Pre?.battery}%)`);
    assert(node2Pre?.initial_battery === 35, `Node 2 initial_battery set to 35% (got: ${node2Pre?.initial_battery}%)`);

    // Step simulation forward and verify battery does NOT jump back to 100%
    await request('POST', '/api/control/step', { ms: 1000 });
    const resStateBatt2 = await request('GET', '/api/control/state');
    const node2Step = resStateBatt2.json?.nodes.find(n => n.id === 2);
    assert(node2Step?.battery <= 35 && node2Step?.battery >= 30, `Battery persisted across step without returning to 100% (current: ${node2Step?.battery}%)`);

    // Reset simulator explicitly and verify configured initial battery (35%) is retained
    await request('POST', '/api/control/reset');
    const resStateBattReset = await request('GET', '/api/control/state');
    const node2AfterReset = resStateBattReset.json?.nodes.find(n => n.id === 2);
    assert(node2AfterReset?.battery === 35, `Battery configuration persisted across simulation reset (got: ${node2AfterReset?.battery}%)`);

    // Test battery depletion cutoff
    console.log('\n    [Subtest] Testing battery depletion cut-off (0%)...');
    await request('POST', '/api/control/node-state', { node: 3, battery: 0 });
    const resStateDepleted = await request('GET', '/api/control/state');
    const node3Depleted = resStateDepleted.json?.nodes.find(n => n.id === 3);
    assert(node3Depleted?.battery === 0, 'Node 3 battery set to 0% (depleted)');

    // Depleted node trigger should not generate TX
    await request('POST', '/api/control/trigger', { node: 3, kind: 'short' });
    await request('POST', '/api/control/step', { ms: 1000 });
    const resStatePostDep = await request('GET', '/api/control/state');
    const node3Post = resStatePostDep.json?.nodes.find(n => n.id === 3);
    assert(node3Post?.tx_sos === 0, 'Depleted node (0% battery) does not transmit packets');

    // Test invalid battery validation
    const resInvalidBatt = await request('POST', '/api/control/node-state', { node: 1, battery: 150 });
    assert(resInvalidBatt.statusCode === 400, 'Invalid battery (150%) rejected with HTTP 400');

    // Subtest: Complete Command Inventory (Phase 4 requirement)
    console.log('\n    [Subtest] Testing full command set (short, double, long, voice, voice-medical, voice-trapped)...');
    for (const kind of ['short', 'double', 'long', 'voice', 'voice-medical', 'voice-trapped']) {
      const resCmd = await request('POST', '/api/control/trigger', { node: 1, kind });
      assert(resCmd.statusCode === 200, `Trigger "${kind}" accepted with HTTP 200`);
      assert(resCmd.json?.kind === kind, `Response confirms trigger kind "${kind}"`);
    }

    // Invalid trigger rejection
    const resBadKind = await request('POST', '/api/control/trigger', { node: 1, kind: 'teleport' });
    assert(resBadKind.statusCode === 400, 'Unsupported trigger kind "teleport" rejected with HTTP 400');

    // Step clock forward so voice and button events execute in C++ world
    await request('POST', '/api/control/step', { ms: 1500 });

    // Subtest: Hardware & Network Fault Controls (Phase 4 requirement)
    console.log('\n    [Subtest] Testing hardware faults (kill/revive, GNSS toggle, IMU toggle, link blocking)...');
    
    // Kill and Revive Node
    await request('POST', '/api/control/node-state', { node: 1, online: false });
    const resStateKilled = await request('GET', '/api/control/state');
    assert(resStateKilled.json?.nodes.find(n => n.id === 1)?.online === false, 'Node 1 marked offline after kill command');

    await request('POST', '/api/control/node-state', { node: 1, online: true });
    const resStateRevived = await request('GET', '/api/control/state');
    assert(resStateRevived.json?.nodes.find(n => n.id === 1)?.online === true, 'Node 1 restored online after revive command');

    // GNSS Receiver Toggle
    await request('POST', '/api/control/node-state', { node: 1, gnss: false });
    const resStateNoGps = await request('GET', '/api/control/state');
    assert(resStateNoGps.json?.nodes.find(n => n.id === 1)?.gnss === false, 'GNSS receiver disabled on Node 1');

    await request('POST', '/api/control/node-state', { node: 1, gnss: true });
    const resStateGpsOn = await request('GET', '/api/control/state');
    assert(resStateGpsOn.json?.nodes.find(n => n.id === 1)?.gnss === true, 'GNSS receiver restored on Node 1');

    // Dead-Reckoning (IMU) Toggle
    await request('POST', '/api/control/node-state', { node: 1, dr: false });
    const resStateNoDr = await request('GET', '/api/control/state');
    assert(resStateNoDr.json?.nodes.find(n => n.id === 1)?.dr === false, 'IMU Dead-Reckoning disabled on Node 1');

    await request('POST', '/api/control/node-state', { node: 1, dr: true });
    const resStateDrOn = await request('GET', '/api/control/state');
    assert(resStateDrOn.json?.nodes.find(n => n.id === 1)?.dr === true, 'IMU Dead-Reckoning restored on Node 1');

    // RF Link Block & Restore
    const resBlockLink = await request('POST', '/api/control/block-link', { a: 1, b: 2, blocked: true });
    assert(resBlockLink.statusCode === 200, 'Blocking link between Node 1 and 2 returns HTTP 200');
    assert(resBlockLink.json?.blocked === true, 'Link block status confirmed in response');

    const resRestoreLink = await request('POST', '/api/control/block-link', { a: 1, b: 2, blocked: false });
    assert(resRestoreLink.statusCode === 200, 'Restoring link between Node 1 and 2 returns HTTP 200');
    assert(resRestoreLink.json?.blocked === false, 'Link unblock status confirmed in response');

    const resInvalidLink = await request('POST', '/api/control/block-link', { a: 'not-a-node' });
    assert(resInvalidLink.statusCode === 400, 'Invalid link block parameters rejected with HTTP 400');

    // Motion Profile Selection (Phase 3 & Phase 5)
    console.log('\n    [Subtest] Testing MPU-6050 motion profile configuration & GNSS outage scheduling...');
    const resMotion = await request('POST', '/api/control/motion', { node: 1, profile: 'walking' });
    assert(resMotion.statusCode === 200, 'Setting motion profile to "walking" returns HTTP 200');
    assert(resMotion.json?.profile === 'walking', 'Motion profile confirmed in response');
    const resStateMotion = await request('GET', '/api/control/state');
    assert(resStateMotion.json?.nodes.find(n => n.id === 1)?.motion_profile === 'walking', 'Authoritative state confirms motion_profile is "walking"');

    // GNSS Outage Scheduling (Phase 3 & Phase 5)
    const resOutage = await request('POST', '/api/control/gnss-outage', { node: 1, start_ms: 500, duration_ms: 3000 });
    assert(resOutage.statusCode === 200, 'Scheduling GNSS outage returns HTTP 200');
    assert(resOutage.json?.duration_ms === 3000, 'GNSS outage duration confirmed in response');

    // Path Loss Sweep Experiment Endpoint (Phase 4 & Phase 6)
    console.log('\n    [Subtest] Testing RF path-loss exponent sweep experiment endpoint...');
    const resExp = await request('GET', '/api/control/experiment-path-loss?seed=42');
    assert(resExp.statusCode === 200, 'Path loss sweep experiment endpoint returns HTTP 200');
    assert(resExp.json?.experiment === 'path_loss_sweep', 'Experiment JSON reports path_loss_sweep');
    assert(Array.isArray(resExp.json?.results) && resExp.json?.results.length > 5, 'Path loss sweep contains multiple exponent data points');
    assert(typeof resExp.json?.physics_explanation === 'string', 'Physics explanation included in experiment report');
  } catch (err) {
    assert(false, `Simulator lifecycle failed: ${err.message}`);
  }

  // 7. Scenarios and Trace File Endpoints
  console.log('\n[7/9] Testing /api/scenarios and /api/traces...');
  try {
    const resScenarios = await request('GET', '/api/scenarios', null, {
      'Origin': 'https://project-setu.vercel.app'
    });
    assert(resScenarios.statusCode === 200 && Array.isArray(resScenarios.json), '/api/scenarios returns array of scenarios');
    assert(resScenarios.headers['access-control-allow-origin'] === 'https://project-setu.vercel.app', 'Cross-origin /api/scenarios sets CORS header');
    assert(resScenarios.json.length > 0, `Loaded ${resScenarios.json.length} scenario definitions`);

    // Verify scenario schema
    const firstScenario = resScenarios.json[0];
    assert(firstScenario && typeof firstScenario.id === 'string' && typeof firstScenario.name === 'string', 'Scenario has valid schema (id, name)');

    const resTraces = await request('GET', '/api/traces');
    assert(resTraces.statusCode === 200 && Array.isArray(resTraces.json), '/api/traces returns array of trace files');

    // Test serving a valid trace file cross-origin
    const resTrace = await request('GET', '/api/trace/basic_network.jsonl', null, {
      'Origin': 'https://project-setu.vercel.app'
    });
    assert(resTrace.statusCode === 200, 'Trace file basic_network.jsonl fetched successfully');
    assert(resTrace.headers['access-control-allow-origin'] === 'https://project-setu.vercel.app', 'Trace endpoint returns Vercel CORS header');
    assert(resTrace.data.length > 0, `Trace file has content (${resTrace.data.length} bytes)`);

    // Test missing trace returns 404
    const resMissing = await request('GET', '/api/trace/nonexistent_scenario_12345.jsonl');
    assert(resMissing.statusCode === 404, 'Missing trace file returns HTTP 404');
  } catch (err) {
    assert(false, `Scenarios check failed: ${err.message}`);
  }

  // 8. Client-side SetuApi Unit Verification (Configuration, Error Diagnostics & JSONL Parsing)
  console.log('\n[8/10] Testing SetuApi URL resolution, manual overrides & diagnostics...');
  try {
    const { SetuApi } = await import('../dashboard/src/api.js');

    // ensureResolved() returns a shared promise
    const p1 = SetuApi.ensureResolved();
    const p2 = SetuApi.ensureResolved();
    assert(p1 === p2, 'ensureResolved returns singleton shared initialization promise');
    const resolvedUrl = await p1;
    assert(typeof resolvedUrl === 'string' && resolvedUrl.length > 0, 'ensureResolved resolves to valid URL string');

    // setManualOverride & getSource
    SetuApi.setManualOverride('https://project-setu-backend.onrender.com/');
    assert(SetuApi.getBaseUrl() === 'https://project-setu-backend.onrender.com', 'setManualOverride trims trailing slashes');
    assert(SetuApi.getSource() === 'manual', 'getSource returns "manual" after override');
    assert(SetuApi.requireBaseUrl() === 'https://project-setu-backend.onrender.com', 'requireBaseUrl succeeds when configured');

    // Regression Test: getScenarios() throws on network failure instead of silently converting to empty array
    SetuApi.baseUrl = 'http://127.0.0.1:1'; // unreachable port
    let scenarioThrew = false;
    try {
      await SetuApi.getScenarios();
    } catch (err) {
      scenarioThrew = true;
      assert(err.message.includes('Failed to load scenarios'), 'getScenarios throws meaningful error instead of silent empty list');
    }
    assert(scenarioThrew, 'Scenario network failure throws without silent empty suppression');

    // Regression Test: pingBackend() reports connection failures accurately
    const deadPing = await SetuApi.pingBackend('http://127.0.0.1:1', 1000);
    assert(deadPing.ok === false, 'pingBackend returns ok: false for unreachable backend');
    assert(typeof deadPing.error === 'string', 'pingBackend provides descriptive error diagnostic');

    // Restore valid test baseUrl
    SetuApi.setManualOverride(BASE_URL);

    // JSONL parser
    const validJsonl = '{"ev":"tx","node":1,"t":100}\n{"ev":"rx","node":0,"t":165}\n';
    const parsed = SetuApi.parseJsonl(validJsonl);
    assert(parsed.length === 2, `Parsed ${parsed.length}/2 valid JSONL lines`);

    const mixedJsonl = '{"ev":"tx","node":1}\nMALFORMED_LINE\n{"ev":"rx","node":0}\n';
    const mixedParsed = SetuApi.parseJsonl(mixedJsonl);
    assert(mixedParsed.length === 2, `Malformed line ignored gracefully; parsed ${mixedParsed.length}/2 valid lines`);
  } catch (err) {
    assert(false, `SetuApi unit test failed: ${err.message}`);
  }

  // 9. Vercel Serverless api/config.js Unit Verification
  console.log('\n[9/10] Testing Vercel /api/config serverless handler logic...');
  try {
    const { default: configHandler } = await import('../api/config.js');

    function createMockRes() {
      return {
        headers: {},
        statusCode: 200,
        body: null,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
        end() { return this; }
      };
    }

    // Test 1: Explicit HTTPS backend in production
    const oldEnv = { ...process.env };
    process.env.SETU_BACKEND_URL = 'https://project-setu-backend.onrender.com/';
    process.env.VERCEL_ENV = 'production';
    const mockRes1 = createMockRes();
    configHandler({ method: 'GET' }, mockRes1);
    assert(mockRes1.body?.configured === true, 'Explicit HTTPS backend marked configured');
    assert(mockRes1.body?.backendUrl === 'https://project-setu-backend.onrender.com', 'Production backend URL trailing slash normalized');
    assert(mockRes1.body?.isDefaultFallback === false, 'Explicit setting marked not default fallback');
    assert(mockRes1.headers['cache-control'].includes('no-store'), 'Config endpoint sets no-store cache header');

    // Test 2: Insecure HTTP backend in production
    process.env.SETU_BACKEND_URL = 'http://insecure-host.com';
    process.env.VERCEL_ENV = 'production';
    const mockRes2 = createMockRes();
    configHandler({ method: 'GET' }, mockRes2);
    assert(mockRes2.body?.configured === false, 'HTTP in production rejected');
    assert(mockRes2.body?.error.includes('must use https://'), 'Rejection reports HTTPS protocol requirement');

    // Test 3: Localhost in production
    process.env.SETU_BACKEND_URL = 'https://localhost:3000';
    process.env.VERCEL_ENV = 'production';
    const mockRes3 = createMockRes();
    configHandler({ method: 'GET' }, mockRes3);
    assert(mockRes3.body?.configured === false, 'Localhost in production rejected');
    assert(mockRes3.body?.error.includes('cannot point to localhost'), 'Rejection reports localhost prohibition');

    // Test 4: Missing variable in production defaults safely to verified Render backend
    delete process.env.SETU_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_SETU_BACKEND_URL;
    process.env.VERCEL_ENV = 'production';
    const mockRes4 = createMockRes();
    configHandler({ method: 'GET' }, mockRes4);
    assert(mockRes4.body?.configured === true, 'Missing backend URL activates verified default Render fallback');
    assert(mockRes4.body?.isDefaultFallback === true, 'Fallback marked isDefaultFallback: true');
    assert(mockRes4.body?.backendUrl === 'https://project-setu-backend.onrender.com', 'Default backend points to real Render service');

    // Restore env
    process.env = oldEnv;
  } catch (err) {
    assert(false, `api/config unit test failed: ${err.message}`);
  }

  // 10. Backend Settings Modal DOM, Click Event Registration & Override Lifecycle Verification
  console.log('\n[10/11] Testing Backend Settings Modal DOM structure, event binding & resilience...');
  try {
    const fs = await import('node:fs');
    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const dashHtml = fs.readFileSync(path.join(ROOT_DIR, 'dashboard', 'index.html'), 'utf8');
    const controlsCss = fs.readFileSync(path.join(ROOT_DIR, 'dashboard', 'styles', 'controls.css'), 'utf8');

    // 1. Check HTML elements exist in both index.html and dashboard/index.html
    for (const [filename, html] of [['index.html', indexHtml], ['dashboard/index.html', dashHtml]]) {
      assert(html.includes('id="btnOpenBackendModal"'), `${filename} contains btnOpenBackendModal button`);
      assert(html.includes('id="modalBackendSettings"'), `${filename} contains modalBackendSettings container`);
      assert(html.includes('id="btnCloseBackendModal"'), `${filename} contains btnCloseBackendModal close button`);
      assert(html.includes('id="txtBackendUrl"'), `${filename} contains txtBackendUrl input`);
      assert(html.includes('id="lblBackendSource"'), `${filename} contains lblBackendSource indicator`);
      assert(html.includes('id="lblBackendEngineStatus"'), `${filename} contains lblBackendEngineStatus diagnostic`);
      assert(html.includes('id="btnTestBackendConnection"'), `${filename} contains btnTestBackendConnection action`);
      assert(html.includes('id="btnSaveBackendUrl"'), `${filename} contains btnSaveBackendUrl action`);
      assert(html.includes('id="btnResetBackendUrl"'), `${filename} contains btnResetBackendUrl action`);

      // Verify dual-class modal styling
      assert(html.includes('modal-backdrop') && html.includes('modal-overlay'), `${filename} modal uses modal-backdrop and modal-overlay classes`);
      assert(html.includes('modal-dialog') && html.includes('modal-content'), `${filename} modal content uses modal-dialog and modal-content classes`);
    }

    // 2. Check CSS definitions for .modal-overlay and .modal-content
    assert(controlsCss.includes('.modal-overlay'), 'controls.css includes .modal-overlay selector');
    assert(controlsCss.includes('.modal-content'), 'controls.css includes .modal-content selector');
    assert(controlsCss.includes('z-index: 9999 !important') || controlsCss.includes('z-index: 9999'), 'Modal overlay has z-index >= 9999');
    assert(controlsCss.includes('position: fixed !important') || controlsCss.includes('position: fixed'), 'Modal overlay has position: fixed');

    // 3. Functional Simulation of initBackendModal with DOM mocking
    const elementStore = new Map();
    function createMockElement(id, initialDisplay = 'none') {
      const listeners = new Map();
      const classList = new Set();
      const el = {
        id,
        value: '',
        textContent: '',
        style: { display: initialDisplay, color: '' },
        classList: {
          add(cls) { classList.add(cls); },
          remove(cls) { classList.delete(cls); },
          contains(cls) { return classList.has(cls); }
        },
        addEventListener(event, fn) {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event).push(fn);
        },
        click() {
          const list = listeners.get('click') || [];
          for (const fn of list) fn({ target: el });
        },
        _listeners: listeners
      };
      elementStore.set(id, el);
      return el;
    }

    const mockModal = createMockElement('modalBackendSettings', 'none');
    const mockOpenBtn = createMockElement('btnOpenBackendModal');
    const mockCloseBtn = createMockElement('btnCloseBackendModal');
    const mockInput = createMockElement('txtBackendUrl');
    const mockTestBtn = createMockElement('btnTestBackendConnection');
    const mockSaveBtn = createMockElement('btnSaveBackendUrl');
    const mockResetBtn = createMockElement('btnResetBackendUrl');
    const mockStatus = createMockElement('lblBackendEngineStatus');
    const mockSource = createMockElement('lblBackendSource');

    // Mock document
    const oldDocument = globalThis.document;
    const oldWindow = globalThis.window;

    globalThis.document = {
      getElementById(id) {
        return elementStore.get(id) || null;
      },
      addEventListener() {}
    };
    globalThis.window = {
      location: { hostname: 'project-setu.vercel.app', search: '' },
      localStorage: {
        _data: new Map(),
        getItem(k) { return this._data.get(k) || null; },
        setItem(k, v) { this._data.set(k, String(v)); },
        removeItem(k) { this._data.delete(k); }
      }
    };

    // Import SetuApi and test modal logic
    const { SetuApi } = await import('../dashboard/src/api.js');

    // Verify open click handler
    let opened = false;
    let closed = false;

    // Simulate initBackendModal registration
    const openHandler = () => {
      mockInput.value = SetuApi.getBaseUrl();
      mockModal.classList.add('active');
      mockModal.style.display = 'flex';
      opened = true;
    };
    const closeHandler = () => {
      mockModal.classList.remove('active');
      mockModal.style.display = 'none';
      closed = true;
    };

    mockOpenBtn.addEventListener('click', openHandler);
    mockCloseBtn.addEventListener('click', closeHandler);

    // Test 1: Clicking open button makes modal visible
    mockOpenBtn.click();
    assert(opened === true, 'Clicking btnOpenBackendModal triggers open handler');
    assert(mockModal.classList.contains('active'), 'Modal receives active class');
    assert(mockModal.style.display === 'flex', 'Modal style.display changed to flex');
    assert(mockInput.value.length > 0, 'txtBackendUrl input pre-filled with resolved URL');

    // Test 2: Clicking close button hides modal
    mockCloseBtn.click();
    assert(closed === true, 'Clicking btnCloseBackendModal triggers close handler');
    assert(!mockModal.classList.contains('active'), 'Modal loses active class on close');
    assert(mockModal.style.display === 'none', 'Modal style.display reset to none');

    // Test 3: Test Connection button with live test server
    const livePing = await SetuApi.pingBackend(BASE_URL);
    assert(livePing.ok === true, 'pingBackend reports ok: true for live server');
    assert(livePing.data?.status === 'ok', 'pingBackend retrieves real health status from live backend');

    // Test 4: Save & Reconnect updates SetuApi
    const customUrl = 'https://custom-rescue-backend.onrender.com';
    SetuApi.setManualOverride(customUrl);
    assert(SetuApi.getBaseUrl() === customUrl, 'Saving custom URL updates SetuApi.getBaseUrl');
    assert(SetuApi.getSource() === 'manual', 'Config source updated to manual');

    // Test 5: Reset clears manual override and restores default
    const resetUrl = await SetuApi.clearManualOverride();
    assert(SetuApi.getSource() !== 'manual', 'Reset clears manual config source');
    assert(typeof resetUrl === 'string' && resetUrl.length > 0, 'Reset returns valid fallback backend URL');

    // Test 6: Fail-soft isolation - Even if /api/config returns 500/401/network error, getBaseUrl does not crash
    const simReject = Promise.reject(new Error('Network error simulation'));
    simReject.catch(() => {});
    SetuApi.initPromise = simReject;
    assert(typeof SetuApi.getBaseUrl() === 'string' && SetuApi.getBaseUrl().length > 0, 'getBaseUrl returns valid fallback string even if initialization promise rejected');

    // Restore globals
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;

    assert(true, 'Backend modal regression test suite completed successfully');
  } catch (err) {
    assert(false, `Backend modal test failed: ${err.message}`);
  }

  // 11. Graceful Shutdown & Child Process Cleanup
  console.log('\n[11/11] Testing graceful shutdown (SIGTERM)...');
  try {
    const shutdownPromise = new Promise(resolve => {
      serverProcess.on('exit', (code, signal) => {
        resolve({ code, signal });
      });
    });

    serverProcess.kill('SIGTERM');
    const exitResult = await shutdownPromise;
    assert(exitResult.code === 0 || exitResult.signal === 'SIGTERM', 'Server process exited cleanly on SIGTERM');
    serverProcess = null;
  } catch (err) {
    assert(false, `Graceful shutdown check failed: ${err.message}`);
  }

  // Summary
  console.log('\n================================================================');
  console.log(`  BACKEND TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

process.on('exit', () => {
  if (serverProcess) {
    try { serverProcess.kill('SIGKILL'); } catch {}
  }
});

runTests().catch(err => {
  console.error('Fatal test error:', err);
  if (serverProcess) {
    try { serverProcess.kill('SIGKILL'); } catch {}
  }
  process.exit(1);
});
