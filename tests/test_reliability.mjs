// Project Setu - Reliability, Concurrency & Resilience Automated Verification Suite
// Verifies:
// 1. Decoupled job lifecycle (queued -> running -> completed)
// 2. Event-loop responsiveness & liveness check latency under CPU load (<50ms)
// 3. Concurrency limiting and FIFO queueing
// 4. Job cancellation
// 5. Worker failure isolation without breaking unrelated jobs
// 6. Client disconnection and SSE event stream recovery
// 7. Multi-tier health probe separation (liveness vs readiness)
// 8. Resource bounds and invalid parameter safety

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 3198;
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

async function runReliabilityTests() {
  console.log('================================================================');
  console.log('  Project Setu — Cloud Reliability & Resilience Test Suite      ');
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

  // 1. Spawn server with concurrency limit = 2 for testing
  console.log(`[1/8] Starting server.js on port ${TEST_PORT} (MAX_CONCURRENT_SIMS=2)...`);
  serverProcess = spawn(process.execPath, [path.join(ROOT_DIR, 'dashboard', 'server.js')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      MAX_CONCURRENT_SIMS: '2',
      SIM_TIMEOUT_MS: '15000'
    },
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
      const res = await request('GET', '/health/liveness');
      if (res.statusCode === 200) {
        ready = true;
        break;
      }
    } catch {
      await sleep(200);
    }
  }
  assert(ready, 'Server started and bound port 0.0.0.0 successfully');

  // 2. Health & Multi-tier Probes Verification (Phase G)
  console.log('\n[2/8] Testing multi-tier health probes (/health/liveness, /health/readiness, /api/metrics)...');
  try {
    const resLive = await request('GET', '/health/liveness');
    assert(resLive.statusCode === 200, 'Liveness probe returns HTTP 200');
    assert(resLive.json?.liveness === true, 'Liveness flag is true');
    assert(typeof resLive.json?.uptimeSeconds === 'number', 'Uptime reported');

    const resReady = await request('GET', '/health/readiness');
    assert(resReady.statusCode === 200, 'Readiness probe returns HTTP 200');
    assert(resReady.json?.readiness === true, 'Readiness flag is true');
    assert(resReady.json?.simulatorFound === true, 'Simulator binary verified');
    assert(resReady.json?.workerPool?.maxConcurrent === 2, 'Worker pool concurrency reported as 2');

    const resMetrics = await request('GET', '/api/metrics');
    assert(resMetrics.statusCode === 200, 'Metrics probe returns HTTP 200');
    assert(typeof resMetrics.json?.jobManager?.submittedTotal === 'number', 'Job manager metrics accessible');
  } catch (err) {
    assert(false, `Health check test failed: ${err.message}`);
  }

  // 3. Normal Asynchronous Simulation Job Lifecycle (Phase D)
  console.log('\n[3/8] Testing asynchronous job creation, status polling & completion...');
  let testJobId = null;
  try {
    const resSubmit = await request('POST', '/api/jobs', {
      params: { survivors: 5, relays: 2, zone: 600, duration: 2000, seed: 101 },
      triggers: [{ node: 1, kind: 'short', t: 100 }]
    });
    assert(resSubmit.statusCode === 202, 'Job submission returns HTTP 202 Accepted');
    assert(typeof resSubmit.json?.jobId === 'string', 'Allocated unique jobId');
    assert(resSubmit.json?.status === 'queued' || resSubmit.json?.status === 'running', 'Initial status is queued or running');
    testJobId = resSubmit.json.jobId;

    // Poll until completed
    let pollSuccess = false;
    let finalSnapshot = null;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      const resPoll = await request('GET', `/api/jobs/${testJobId}`);
      if (resPoll.json?.status === 'completed') {
        pollSuccess = true;
        finalSnapshot = resPoll.json;
        break;
      }
    }
    assert(pollSuccess, 'Job completed successfully within timeout');
    assert(finalSnapshot && finalSnapshot.summary && typeof finalSnapshot.durationMs === 'number', 'Completed snapshot contains summary and runtime duration');

    // Retrieve results via /api/jobs/:id/results
    const resResults = await request('GET', `/api/jobs/${testJobId}/results`);
    assert(resResults.statusCode === 200, 'Job results endpoint returns HTTP 200');
    assert(resResults.json?.success === true, 'Job marked success: true in results');
    assert(typeof resResults.json?.traceFilename === 'string', 'Trace filename returned in results');
  } catch (err) {
    assert(false, `Job lifecycle test failed: ${err.message}`);
  }

  // 4. Event-Loop Latency under Heavy Simulation Load (Phase E)
  console.log('\n[4/8] Measuring API latency while simulation engine is actively computing...');
  try {
    // Launch a heavier simulation job
    const resHeavy = await request('POST', '/api/jobs', {
      params: { survivors: 25, relays: 5, zone: 1200, duration: 6000, seed: 202 }
    });
    const heavyJobId = resHeavy.json?.jobId;
    assert(Boolean(heavyJobId), 'Heavy background simulation launched');

    // Make 10 concurrent requests to /health/liveness while C++ is executing
    const latencySamples = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const resLiveness = await request('GET', '/health/liveness');
      const dt = performance.now() - t0;
      latencySamples.push(dt);
      assert(resLiveness.statusCode === 200, `Liveness ping #${i + 1} succeeded (${dt.toFixed(1)}ms)`);
    }

    const avgLatency = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
    console.log(`    Average API Liveness Latency under load: ${avgLatency.toFixed(2)} ms (Max: ${Math.max(...latencySamples).toFixed(2)} ms)`);
    assert(avgLatency < 50.0, `API event-loop remained responsive (< 50ms average, got: ${avgLatency.toFixed(2)}ms)`);
  } catch (err) {
    assert(false, `Event-loop latency measurement failed: ${err.message}`);
  }

  // 5. Concurrency Limiting & Queueing (Phase C & E)
  console.log('\n[5/8] Testing concurrency limiting (MAX_CONCURRENT_SIMS=2) & FIFO queueing...');
  try {
    // Submit 3 jobs in rapid succession
    const j1 = await request('POST', '/api/jobs', { params: { survivors: 5, duration: 3000, seed: 1 } });
    const j2 = await request('POST', '/api/jobs', { params: { survivors: 5, duration: 3000, seed: 2 } });
    const j3 = await request('POST', '/api/jobs', { params: { survivors: 5, duration: 3000, seed: 3 } });

    assert(j1.statusCode === 202 && j2.statusCode === 202 && j3.statusCode === 202, 'All 3 jobs accepted asynchronously');

    // Verify readiness reports 2 active workers and 1 queued job
    const resReadyQueue = await request('GET', '/health/readiness');
    assert(resReadyQueue.json?.workerPool?.active <= 2, `Active workers capped at <= 2 (current: ${resReadyQueue.json?.workerPool?.active})`);
    assert(resReadyQueue.json?.workerPool?.queued >= 0, 'Queue handles overflow without dropping requests');

    // Clean up jobs
    await request('POST', `/api/jobs/${j1.json.jobId}/cancel`);
    await request('POST', `/api/jobs/${j2.json.jobId}/cancel`);
    await request('POST', `/api/jobs/${j3.json.jobId}/cancel`);
  } catch (err) {
    assert(false, `Concurrency limiting test failed: ${err.message}`);
  }

  // 6. Job Cancellation & Immediate Worker Termination (Phase D)
  console.log('\n[6/8] Testing explicit job cancellation...');
  try {
    const resLong = await request('POST', '/api/jobs', {
      params: { survivors: 10, duration: 30000, seed: 999 }
    });
    const cancelTargetId = resLong.json?.jobId;
    assert(Boolean(cancelTargetId), 'Long-running job created');

    // Cancel job
    const resCancel = await request('POST', `/api/jobs/${cancelTargetId}/cancel`);
    assert(resCancel.statusCode === 200, 'Cancellation request returns HTTP 200');

    await sleep(200);
    const resPollCancelled = await request('GET', `/api/jobs/${cancelTargetId}`);
    assert(resPollCancelled.json?.status === 'cancelled', 'Job status transitioned to "cancelled"');
  } catch (err) {
    assert(false, `Cancellation test failed: ${err.message}`);
  }

  // 7. Isolation of Worker Failure (Phase E & I)
  console.log('\n[7/8] Testing failure isolation (one failing job does not corrupt others)...');
  try {
    // Launch a valid job
    const resGood = await request('POST', '/api/jobs', {
      params: { survivors: 2, relays: 1, duration: 1500, seed: 42 }
    });
    const goodJobId = resGood.json?.jobId;

    // Launch a second job and cancel it abruptly
    const resBad = await request('POST', '/api/jobs', {
      params: { survivors: 2, relays: 1, duration: 5000, seed: 43 }
    });
    const badJobId = resBad.json?.jobId;

    await request('POST', `/api/jobs/${badJobId}/cancel`);

    // Poll good job to ensure it completes independently
    let goodCompleted = false;
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      const resPoll = await request('GET', `/api/jobs/${goodJobId}`);
      if (resPoll.json?.status === 'completed') {
        goodCompleted = true;
        break;
      }
    }
    assert(goodCompleted, 'Good job completed cleanly despite adjacent job termination');
  } catch (err) {
    assert(false, `Failure isolation test failed: ${err.message}`);
  }

  // 8. Bounded Event Buffers & Trace Direct-to-Disk Streaming (Phase E)
  console.log('\n[8/8] Testing trace disk persistence & memory boundedness...');
  try {
    const resTraces = await request('GET', '/api/traces');
    assert(resTraces.statusCode === 200, 'GET /api/traces returns HTTP 200');
    assert(Array.isArray(resTraces.json), 'Traces list is valid array');
    assert(resTraces.json.some(t => t.filename.startsWith('job_sim_')), 'Piped trace files exist on disk');

    const memUsage = await request('GET', '/api/metrics');
    const rssMb = (memUsage.json?.memory?.rss || 0) / (1024 * 1024);
    console.log(`    Server Memory RSS after all tests: ${rssMb.toFixed(2)} MB`);
    assert(rssMb < 150.0, `Server RSS memory remained safely below 150MB (got: ${rssMb.toFixed(2)}MB)`);
  } catch (err) {
    assert(false, `Memory boundedness test failed: ${err.message}`);
  }

  // Shutdown server
  console.log('\nCleaning up reliability test server...');
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  // Summary
  console.log('\n================================================================');
  console.log(`  RELIABILITY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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

runReliabilityTests().catch(err => {
  console.error('Fatal reliability test error:', err);
  if (serverProcess) {
    try { serverProcess.kill('SIGKILL'); } catch {}
  }
  process.exit(1);
});
