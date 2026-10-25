// Project Setu - Automated Analytics and Simulation Integrity Test Suite
// Rigorous verification of metric definitions, session isolation, latency accuracy, and native simulation parity.

import { calculateMetrics, calculateLatencyStats, METRIC_CONTRACT } from '../dashboard/src/metrics.js';
import { SimulationEngine } from '../dashboard/src/simulation.js';
import { Exporter } from '../dashboard/src/exporter.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [ PASS ] ${message}`);
  } else {
    failedTests++;
    console.error(`  [ FAIL ] ${message}`);
  }
}

function assertStrictEqual(actual, expected, message) {
  assert(actual === expected, `${message} (Expected: ${expected}, Got: ${actual})`);
}

console.log('==========================================================');
console.log('  Project Setu -- Analytics & Simulation Integrity Tests');
console.log('==========================================================\n');

// -------------------------------------------------------------
// Test Group 1: Metric Contract & Centralized Definitions
// -------------------------------------------------------------
console.log('[1/6] Auditing Centralized Metric Contract...');

assert(METRIC_CONTRACT.pdr !== undefined, 'PDR definition exists in metric contract');
assertStrictEqual(METRIC_CONTRACT.pdr.units, '%', 'PDR units documented as %');
assert(METRIC_CONTRACT.pdr.formula.includes('Unique SOS Delivered'), 'PDR formula documents unique delivered / unique originated');
assert(METRIC_CONTRACT.deliveryLatency !== undefined, 'Delivery latency documented in contract');
assertStrictEqual(METRIC_CONTRACT.deliveryLatency.units, 'ms', 'Latency units documented as ms');
assert(METRIC_CONTRACT.uniqueSosOriginated !== undefined, 'Unique SOS originated defined');
assert(METRIC_CONTRACT.physicalRadioReceptions !== undefined, 'Physical radio receptions distinguished from deliveries');

// -------------------------------------------------------------
// Test Group 2: Pure Metric Engine Edge Cases
// -------------------------------------------------------------
console.log('\n[2/6] Testing Pure Metrics Engine Edge Cases...');

// Case 2.1: Zero messages generated
{
  const res = calculateMetrics([], new Map(), 0, { id: 'test_empty' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 0, 'Zero messages: uniqueOriginated is 0');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 0, 'Zero messages: uniqueDelivered is 0');
  assertStrictEqual(res.lifecycle.pdr, null, 'Zero messages: PDR is null (not 100% or 0%)');
  assertStrictEqual(res.lifecycle.pdrDisplay, 'N/A', 'Zero messages: PDR displays as N/A');
  assertStrictEqual(res.latency.avgMs, null, 'Zero messages: Avg latency is null (not 0 or 1500)');
  assertStrictEqual(res.latency.display, 'N/A', 'Zero messages: Latency displays as N/A');
}

// Case 2.2: Single Direct SOS Delivery (1 Hop)
{
  const events = [
    { t: 0, ev: 'node_init', id: 0, role: 'hub' },
    { t: 0, ev: 'node_init', id: 1, role: 'survivor' },
    { t: 1000, ev: 'originate', node: 1, seq: 1, hazard: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1, origin: 1, air: 62 },
    { t: 1062, ev: 'rx', node: 0, from: 1, seq: 1 },
    { t: 1062, ev: 'alert', origin: 1, hops: 1, seq: 1, latency_ms: 62 },
    { t: 1100, ev: 'tx', node: 0, seq: 1, ack: true, target: 1 },
    { t: 1162, ev: 'ack_rx', node: 1, seq: 1 }
  ];

  const nodes = new Map([[0, { id: 0, role: 'hub', online: true, battery: 100 }], [1, { id: 1, role: 'survivor', online: true, battery: 100 }]]);
  const res = calculateMetrics(events, nodes, 2000, { id: 'test_1hop' });

  assertStrictEqual(res.lifecycle.uniqueOriginated, 1, '1-Hop: Unique originated is 1');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 1, '1-Hop: Unique delivered is 1');
  assertStrictEqual(res.lifecycle.uniqueAcked, 1, '1-Hop: Unique acked is 1');
  assertStrictEqual(res.lifecycle.inFlight, 0, '1-Hop: In flight is 0');
  assertStrictEqual(res.lifecycle.pdr, 100.0, '1-Hop: PDR is 100.0%');
  assertStrictEqual(res.lifecycle.pdrDisplay, '100.0%', '1-Hop: PDR display is 100.0%');
  assertStrictEqual(res.latency.avgMs, 62, '1-Hop: Latency exactly matches measured simulation clock (62ms)');
  assertStrictEqual(res.hopDistribution[0].count, 1, '1-Hop: 1 Hop count is 1');
  assertStrictEqual(res.hopDistribution[1].count, 0, '1-Hop: 2 Hops count is 0');
}

// Case 2.3: Relay Forwarding (2 Hops)
{
  const events = [
    { t: 1000, ev: 'originate', node: 1, seq: 1, hazard: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1, origin: 1 },
    { t: 1062, ev: 'rx', node: 100, from: 1, seq: 1 },
    { t: 1200, ev: 'tx', node: 100, seq: 1, origin: 1 }, // Relay forwards
    { t: 1262, ev: 'rx', node: 0, from: 100, seq: 1 },
    { t: 1262, ev: 'alert', origin: 1, hops: 2, seq: 1, latency_ms: 262 }
  ];

  const res = calculateMetrics(events, new Map(), 2000, { id: 'test_relay' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 1, '2-Hop: Unique originated is 1');
  assertStrictEqual(res.lifecycle.relayForwards, 1, '2-Hop: Relay forwards count is 1');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 1, '2-Hop: Delivered count is 1');
  assertStrictEqual(res.hopDistribution[1].count, 1, '2-Hop: 2 Hops distribution is 1');
  assertStrictEqual(res.hopDistribution[0].count, 0, '2-Hop: 1 Hop distribution is 0');
  assertStrictEqual(res.latency.avgMs, 262, '2-Hop: Measured latency is 262ms (no hardcoded 1500)');
}

// Case 2.4: Collision Drop followed by Successful Retry
{
  const events = [
    { t: 1000, ev: 'originate', node: 1, seq: 1, hazard: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1, origin: 1 },
    { t: 1062, ev: 'drop', to: 0, why: 'collision' }, // Physical attempt collision
    { t: 2000, ev: 'retry', node: 1, seq: 1 },
    { t: 2000, ev: 'tx', node: 1, seq: 1, origin: 1 }, // Retry tx
    { t: 2062, ev: 'rx', node: 0, from: 1, seq: 1 },
    { t: 2062, ev: 'alert', origin: 1, hops: 1, seq: 1, latency_ms: 1062 }
  ];

  const res = calculateMetrics(events, new Map(), 3000, { id: 'test_retry' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 1, 'Retry: Retry does NOT create duplicate logical message (originated is 1)');
  assertStrictEqual(res.lifecycle.retries, 1, 'Retry: Retries count is 1');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 1, 'Retry: Message delivered on retry 1');
  assertStrictEqual(res.lifecycle.pdr, 100.0, 'Retry: True PDR is 100% despite physical attempt collision');
  assertStrictEqual(res.radio.dropCauses.collision, 1, 'Retry: Collision recorded under radio dropCauses');
  assertStrictEqual(res.lifecycle.failed, 0, 'Retry: Recovered message is NOT counted as failed message');
}

// Case 2.5: Drop Causes Categorization
{
  const events = [
    { t: 100, ev: 'drop', to: 0, why: 'weak' },
    { t: 200, ev: 'drop', to: 0, why: 'weak' },
    { t: 300, ev: 'drop', to: 0, why: 'collision' },
    { t: 400, ev: 'drop', to: 0, why: 'halfduplex' },
    { t: 500, ev: 'drop', to: 0, why: 'loss' },
    { t: 600, ev: 'drop', to: 0, why: 'blocked' },
    { t: 700, ev: 'drop', to: 0, why: 'duty' },
    { t: 800, ev: 'drop', to: 0, why: 'depleted' }
  ];

  const res = calculateMetrics(events, new Map(), 1000);
  assertStrictEqual(res.radio.dropTotal, 8, 'Drops: Total physical drops is 8');
  assertStrictEqual(res.radio.dropCauses.weak, 2, 'Drops: Weak RSSI is 2');
  assertStrictEqual(res.radio.dropCauses.collision, 1, 'Drops: Collisions is 1');
  assertStrictEqual(res.radio.dropCauses.halfduplex, 1, 'Drops: Half-duplex is 1');
  assertStrictEqual(res.radio.dropCauses.loss, 1, 'Drops: Shadow loss is 1');
  assertStrictEqual(res.radio.dropCauses.blocked, 1, 'Drops: Blocked link is 1');
  assertStrictEqual(res.radio.dropCauses.duty_blocked, 1, 'Drops: Duty blocked is 1');
  assertStrictEqual(res.radio.dropCauses.depleted, 1, 'Drops: Depleted battery is 1');
}

// Case 2.6: Messages in Flight & Provisional PDR
{
  const events = [
    { t: 1000, ev: 'originate', node: 1, seq: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1, origin: 1 }
    // No alert yet (still in flight at t=1200)
  ];

  const res = calculateMetrics(events, new Map(), 1200);
  assertStrictEqual(res.lifecycle.uniqueOriginated, 1, 'In-Flight: 1 SOS originated');
  assertStrictEqual(res.lifecycle.inFlight, 1, 'In-Flight: 1 message currently in flight');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 0, 'In-Flight: 0 delivered yet');
  assertStrictEqual(res.lifecycle.isProvisional, true, 'In-Flight: Marked as provisional');
  assertStrictEqual(res.lifecycle.pdr, 0.0, 'In-Flight: PDR is 0.0% provisionally');
}

// Case 2.7: Gave Up (Permanently Failed Message)
{
  const events = [
    { t: 1000, ev: 'originate', node: 1, seq: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1, origin: 1 },
    { t: 5000, ev: 'gave_up', node: 1, seq: 1 }
  ];

  const res = calculateMetrics(events, new Map(), 6000);
  assertStrictEqual(res.lifecycle.uniqueOriginated, 1, 'Failed: 1 SOS originated');
  assertStrictEqual(res.lifecycle.failed, 1, 'Failed: 1 permanently failed message');
  assertStrictEqual(res.lifecycle.inFlight, 0, 'Failed: 0 messages in flight');
  assertStrictEqual(res.lifecycle.isProvisional, false, 'Failed: Non-provisional final result');
  assertStrictEqual(res.lifecycle.pdr, 0.0, 'Failed: Final PDR is 0.0%');
}

// -------------------------------------------------------------
// Test Group 3: Latency Distribution Calculation
// -------------------------------------------------------------
console.log('\n[3/6] Testing Latency Statistics & Eliminating 1500ms Fallback...');

{
  const empty = calculateLatencyStats([]);
  assertStrictEqual(empty.count, 0, 'Empty latencies: count is 0');
  assertStrictEqual(empty.avgMs, null, 'Empty latencies: avg is null');
  assertStrictEqual(empty.display, 'N/A', 'Empty latencies: display is N/A');
}

{
  const samples = [100, 200, 300, 400, 1000];
  const stats = calculateLatencyStats(samples);
  assertStrictEqual(stats.count, 5, 'Latency count is 5');
  assertStrictEqual(stats.avgMs, 400, 'Average latency is 400ms');
  assertStrictEqual(stats.medianMs, 300, 'Median latency is 300ms');
  assertStrictEqual(stats.minMs, 100, 'Min latency is 100ms');
  assertStrictEqual(stats.maxMs, 1000, 'Max latency is 1000ms');
  assertStrictEqual(stats.p95Ms, 1000, 'P95 latency is 1000ms');
  assertStrictEqual(stats.display, '400ms', 'Display string formatted correctly');
}

// -------------------------------------------------------------
// Test Group 4: SimulationEngine Session Isolation
// -------------------------------------------------------------
console.log('\n[4/6] Testing SimulationEngine Session Isolation & State Lifecycle...');

{
  const sim = new SimulationEngine();

  // Session 1: Trace A
  const traceA = [
    { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 80 },
    { t: 1000, ev: 'originate', node: 1, seq: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1 },
    { t: 1065, ev: 'alert', origin: 1, seq: 1, hops: 1, latency_ms: 65 }
  ];

  sim.loadTrace(traceA, null, { id: 'session_A', name: 'Session A', mode: 'replay' });
  sim.seek(2000); // Seek forward so event at t=1065 has completed
  let m1 = sim.getMetrics();
  assertStrictEqual(m1.session.id, 'session_A', 'Session A identity preserved');
  assertStrictEqual(m1.alertsTotal, 1, 'Session A has 1 delivered alert');
  assertStrictEqual(m1.pdr, '100.0%', 'Session A PDR is 100.0%');

  // Session 2: New session B must NOT leak data from session A
  const traceB = [
    { t: 0, ev: 'node_init', id: 2, role: 'survivor', battery: 95 }
    // No SOS originated
  ];

  sim.loadTrace(traceB, null, { id: 'session_B', name: 'Session B', mode: 'replay' });
  sim.seek(2000);
  let m2 = sim.getMetrics();
  assertStrictEqual(m2.session.id, 'session_B', 'Session B identity replaced cleanly');
  assertStrictEqual(m2.alertsTotal, 0, 'Session B has 0 delivered alerts (no leak from Session A)');
  assertStrictEqual(m2.pdr, 'N/A', 'Session B PDR is N/A (no leak from Session A)');
  assertStrictEqual(m2.avgLatencyMs, 0, 'Session B avgLatencyMs reset cleanly');
  assertStrictEqual(sim.nodes.size, 1, 'Session B only contains Node 2');
  assert(!sim.nodes.has(1), 'Node 1 purged cleanly from previous session');
}

// -------------------------------------------------------------
// Test Group 5: Event Timeline Linkage
// -------------------------------------------------------------
console.log('\n[5/6] Testing Interactive Event Linkage for Timeline Navigation...');

{
  const events = [
    { t: 100, ev: 'drop', to: 0, why: 'weak' },
    { t: 200, ev: 'drop', to: 0, why: 'collision' },
    { t: 300, ev: 'alert', origin: 1, hops: 2, latency_ms: 120 }
  ];

  const res = calculateMetrics(events, new Map(), 500);
  assert(res.eventIndices.has('drop_weak'), 'Event index contains drop_weak category');
  assertStrictEqual(res.eventIndices.get('drop_weak').length, 1, 'drop_weak has 1 event reference');
  assertStrictEqual(res.eventIndices.get('drop_weak')[0].t, 100, 'drop_weak points to exact event at t=100');

  assert(res.eventIndices.has('drop_collision'), 'Event index contains drop_collision category');
  assertStrictEqual(res.eventIndices.get('drop_collision')[0].t, 200, 'drop_collision points to exact event at t=200');

  assert(res.eventIndices.has('alert'), 'Event index contains alert category');
  assertStrictEqual(res.eventIndices.get('alert')[0].t, 300, 'alert points to exact event at t=300');
}

// -------------------------------------------------------------
// Test Group 6: Native C++ Engine End-to-End Analytics Parity
// -------------------------------------------------------------
console.log('\n[6/6] Testing Native C++ Engine Output & Latency Parity...');

async function runNativeSimTest() {
  const simExe = path.join(rootDir, 'build', 'Release', 'setu_sim.exe');

  return new Promise((resolve, reject) => {
    // Launch native simulator: 5 survivors, 2 relays, seed 42, 5s duration, trigger node 1 short SOS
    const proc = spawn(simExe, [
      '--survivors', '5',
      '--relays', '2',
      '--duration', '5000',
      '--seed', '42',
      '--trigger', '1:short@1000'
    ], { cwd: rootDir });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`setu_sim.exe exited with code ${code}: ${stderr}`));
      }

      // Parse JSON summary
      try {
        const summary = JSON.parse(stdout);
        assert(summary !== null, 'Native C++ simulator executed cleanly and returned valid JSON');
        assert(typeof summary.duration_ms === 'number', 'Summary contains valid duration_ms');
        assert(typeof summary.totals === 'object', 'Summary contains totals object');
        assert(typeof summary.totals.tx === 'number', 'Totals contains numeric tx count');
        assert(Array.isArray(summary.events), 'Summary contains events array');

        if (summary.events.length > 0) {
          const ev0 = summary.events[0];
          assertStrictEqual(ev0.origin, 1, 'Native trigger executed on Origin 1');
          assert(ev0.delivered === true, 'Native SOS delivered to Hub');
          assert(typeof ev0.latency_ms === 'number' && ev0.latency_ms > 0, `Native measured latency is valid (${ev0.latency_ms}ms)`);
        }

        console.log(`    Native Totals: TX=${summary.totals.tx}, Deliveries=${summary.totals.deliveries}, Collisions=${summary.totals.collisions}`);
        resolve();
      } catch (err) {
        reject(new Error(`Failed to parse native JSON summary: ${err.message}\nOutput: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

try {
  await runNativeSimTest();
  assert(true, 'Native C++ engine integration test passed');
} catch (err) {
  assert(false, `Native C++ engine test failed: ${err.message}`);
}

console.log('\n==========================================================');
console.log(`  ANALYTICS TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('==========================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
