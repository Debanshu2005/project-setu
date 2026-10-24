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

  // 10. Graceful Shutdown & Child Process Cleanup
  console.log('\n[10/10] Testing graceful shutdown (SIGTERM)...');
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
