// Project Setu - Regression Tests for Path Loss Exponent & Topology Diagnostics
// Verifies:
// 1. Exponent 3.0 works under known feasible configuration
// 2. Exponent 3.5 is handled correctly under standard demo mesh
// 3. Exponent 4.0 succeeds when topology and radio parameters permit connectivity (feasible zone)
// 4. Exponent 4.0 produces actionable diagnostic when requested connected topology is infeasible
// 5. Exponent 4.0 succeeds with --allow-disconnected in partitioned networks
// 6. Changing exponent actually affects calculated path loss and link viability
// 7. Determinism contract: identical seed & config produce deterministic results
// 8. REST API propagates rich diagnostic reason to frontend without loss

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const simPath = process.platform === 'win32'
  ? path.join(ROOT_DIR, 'build', 'Release', 'setu_sim.exe')
  : path.join(ROOT_DIR, 'build', 'setu_sim');

const TEST_PORT = 3209;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let passedCount = 0;
let failedCount = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  [ PASS ] ${msg}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${msg}`);
    failedCount++;
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function runSimulator(args) {
  return new Promise((resolve) => {
    const child = spawn(simPath, args, { cwd: ROOT_DIR });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
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

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu — Path Loss Exponent & Diagnostics Regression Suite');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // [1] Exponent 3.0 Works Under Known Feasible Configuration
  // ---------------------------------------------------------------------------
  console.log('[Test 1] Path Loss Exponent 3.0 Feasible Execution...');
  const res30 = await runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1200',
    '--seed', '42',
    '--duration', '2000',
    '--sf', '7',
    '--loss', '0.04',
    '--path-exp', '3.0',
    '--trigger', '1:short@1000'
  ]);
  assert(res30.code === 0, `Exponent 3.0 exited cleanly with code 0 (Got: ${res30.code})`);
  assert(res30.stdout.includes('"deliveries":'), 'Exponent 3.0 completed simulation and produced totals summary');

  // ---------------------------------------------------------------------------
  // [2] Exponent 3.5 Handled Correctly Under Standard Demo Mesh
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2] Path Loss Exponent 3.5 Handled Correctly...');
  const res35 = await runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1200',
    '--seed', '42',
    '--duration', '2000',
    '--sf', '7',
    '--loss', '0.04',
    '--path-exp', '3.5',
    '--trigger', '1:short@1000'
  ]);
  assert(res35.code === 0, `Exponent 3.5 exited cleanly with code 0 (Got: ${res35.code})`);
  assert(res35.stdout.includes('"deliveries":'), 'Exponent 3.5 completed multi-hop mesh simulation');

  // ---------------------------------------------------------------------------
  // [3] Exponent 4.0 Succeeds When Topology & Parameters Permit Connectivity
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3] Path Loss Exponent 4.0 Succeeds in Feasible Zone (400m)...');
  const res40Feasible = await runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '400',
    '--seed', '42',
    '--duration', '2000',
    '--sf', '7',
    '--loss', '0.04',
    '--path-exp', '4.0',
    '--trigger', '1:short@1000'
  ]);
  assert(res40Feasible.code === 0, `Exponent 4.0 in 400m zone exited cleanly with code 0 (Got: ${res40Feasible.code})`);
  assert(res40Feasible.stdout.includes('"totals":'), 'Exponent 4.0 generated connected topology and completed simulation');

  // ---------------------------------------------------------------------------
  // [4] Exponent 4.0 Produces Actionable Diagnostic on Infeasible Configuration
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4] Path Loss Exponent 4.0 Infeasible Diagnostic Reporting...');
  const res40Infeasible = await runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1200',
    '--seed', '42',
    '--duration', '2000',
    '--sf', '7',
    '--loss', '0.04',
    '--path-exp', '4.0'
  ]);
  assert(res40Infeasible.code === 2, `Infeasible configuration exited with code 2 (Got: ${res40Infeasible.code})`);
  const err = res40Infeasible.stderr;
  assert(err.includes('could not generate a connected demo topology'), 'Error starts with standard prefix');
  assert(err.includes('after 500 attempts'), 'Diagnostic cites attempt limit');
  assert(err.includes('path_exp=4.00'), 'Diagnostic cites effective path loss exponent');
  assert(err.includes('seed=42'), 'Diagnostic cites random seed');
  assert(err.includes('zone=1200m'), 'Diagnostic cites zone size');
  assert(err.includes('survivors=20, relays=5'), 'Diagnostic cites node counts');
  assert(err.includes('156.7m'), 'Diagnostic cites calculated physical radio range limit (~156.7m)');
  assert(err.includes('disconnected from Hub'), 'Diagnostic identifies disconnected nodes/components');
  assert(err.includes('--allow-disconnected'), 'Diagnostic provides actionable options (reduce zone, allow disconnected)');

  // ---------------------------------------------------------------------------
  // [5] Exponent 4.0 Succeeds When --allow-disconnected is Enabled
  // ---------------------------------------------------------------------------
  console.log('\n[Test 5] Path Loss Exponent 4.0 with --allow-disconnected in 1200m Zone...');
  const res40Disc = await runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1200',
    '--seed', '42',
    '--duration', '2000',
    '--sf', '7',
    '--loss', '0.04',
    '--path-exp', '4.0',
    '--allow-disconnected',
    '--trigger', '1:short@1000'
  ]);
  assert(res40Disc.code === 0, `Exponent 4.0 with --allow-disconnected exited cleanly with code 0 (Got: ${res40Disc.code})`);
  assert(res40Disc.stderr.includes('[WARN] running with disconnected topology'), 'Warning logged to stderr');
  assert(res40Disc.stdout.includes('"totals":'), 'Simulation completed and reported honest reachability metrics');

  // ---------------------------------------------------------------------------
  // [6] Exponent Affects Calculated Path Loss and Airtime/Weak Drops Honestly
  // ---------------------------------------------------------------------------
  console.log('\n[Test 6] Verifying Exponent Affects Physical Propagation & Weak Drops...');
  // Run with seed 42, zone 600 at n=3.0 vs n=4.0
  const simA = await runSimulator([
    '--survivors', '20', '--relays', '5', '--zone', '600', '--seed', '42',
    '--duration', '3000', '--sf', '7', '--loss', '0.0', '--path-exp', '3.0',
    '--trigger', '1:short@1000'
  ]);
  const simB = await runSimulator([
    '--survivors', '20', '--relays', '5', '--zone', '600', '--seed', '42',
    '--duration', '3000', '--sf', '7', '--loss', '0.0', '--path-exp', '4.0',
    '--trigger', '1:short@1000'
  ]);
  assert(simA.code === 0 && simB.code === 0, 'Both simulations at zone 600 executed successfully');
  const summaryA = JSON.parse(simA.stdout.slice(simA.stdout.indexOf('{')));
  const summaryB = JSON.parse(simB.stdout.slice(simB.stdout.indexOf('{')));
  assert(summaryB.totals.weak > summaryA.totals.weak, `Higher exponent honestly increases weak signal drops (${summaryB.totals.weak} > ${summaryA.totals.weak})`);

  // ---------------------------------------------------------------------------
  // [7] Cross-Run Determinism Contract
  // ---------------------------------------------------------------------------
  console.log('\n[Test 7] Verifying Deterministic Simulator Contract...');
  const runD1 = await runSimulator([
    '--survivors', '10', '--relays', '3', '--zone', '500', '--seed', '77',
    '--duration', '2000', '--sf', '7', '--loss', '0.02', '--path-exp', '3.8',
    '--trigger', '1:short@1000'
  ]);
  const runD2 = await runSimulator([
    '--survivors', '10', '--relays', '3', '--zone', '500', '--seed', '77',
    '--duration', '2000', '--sf', '7', '--loss', '0.02', '--path-exp', '3.8',
    '--trigger', '1:short@1000'
  ]);
  assert(runD1.code === 0 && runD2.code === 0, 'Both deterministic runs exited 0');
  assert(runD1.stdout === runD2.stdout, 'Simulator output is bit-for-bit deterministic across identical runs');

  // ---------------------------------------------------------------------------
  // [8] Backend REST API Integration & Diagnostic Forwarding
  // ---------------------------------------------------------------------------
  console.log('\n[Test 8] Testing Backend REST Integration & Diagnostic Forwarding...');
  const server = spawn(process.execPath, [path.join(ROOT_DIR, 'dashboard', 'server.js')], {
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
    cwd: ROOT_DIR
  });

  try {
    // Wait for server health
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const h = await request('GET', '/health');
        if (h.statusCode === 200) { ready = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert(ready, `Backend server started on port ${TEST_PORT}`);

    // Subtest 8A: Infeasible custom simulation returns HTTP 500 with actionable diagnostic
    const postInfeasible = await request('POST', '/api/simulate', {
      params: {
        survivors: 20,
        relays: 5,
        zone: 1200,
        seed: 42,
        duration: 2000,
        path_exp: 4.0
      }
    });
    assert(postInfeasible.statusCode === 500, `Infeasible simulation returned HTTP 500 (Got: ${postInfeasible.statusCode})`);
    assert(postInfeasible.json && typeof postInfeasible.json.error === 'string', 'Response contains error string');
    const apiErr = postInfeasible.json.error;
    assert(apiErr.includes('could not generate a connected demo topology'), 'API error contains canonical prefix');
    assert(apiErr.includes('156.7m'), 'API error preserves physical range limit (~156.7m)');
    assert(apiErr.includes('disconnected from Hub'), 'API error preserves disconnected nodes metric');
    assert(apiErr.includes('--allow-disconnected'), 'API error preserves actionable remedy instructions');

    // Subtest 8B: Feasible custom simulation (zone 400) returns HTTP 200
    const postFeasible = await request('POST', '/api/simulate', {
      params: {
        survivors: 20,
        relays: 5,
        zone: 400,
        seed: 42,
        duration: 2000,
        path_exp: 4.0
      }
    });
    assert(postFeasible.statusCode === 200, `Feasible simulation (zone 400) returned HTTP 200 (Got: ${postFeasible.statusCode})`);
    assert(postFeasible.json && postFeasible.json.success === true, 'Feasible simulation completed successfully');

    // Subtest 8C: Custom simulation with allow_disconnected returns HTTP 200
    const postAllowDisc = await request('POST', '/api/simulate', {
      params: {
        survivors: 20,
        relays: 5,
        zone: 1200,
        seed: 42,
        duration: 2000,
        path_exp: 4.0,
        allow_disconnected: true
      }
    });
    assert(postAllowDisc.statusCode === 200, `Simulation with allow_disconnected=true returned HTTP 200 (Got: ${postAllowDisc.statusCode})`);
    assert(postAllowDisc.json && postAllowDisc.json.success === true, 'Disconnected network simulation completed successfully');

  } finally {
    server.kill('SIGTERM');
  }

  console.log('\n================================================================');
  console.log(`  REGRESSION TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) process.exit(1);
  else process.exit(0);
}

runTests().catch(err => {
  console.error('\n[FATAL] Test runner uncaught exception:', err);
  process.exit(1);
});

