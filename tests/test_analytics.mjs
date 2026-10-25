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

// -------------------------------------------------------------
// Test Group 7: Controlled Trace PDR Scenarios & Energy Model
// -------------------------------------------------------------
console.log('\n[7/7] Testing Controlled Trace PDR Scenarios & Energy Model Telemetry...');

// Scenario 7.1: Five originated messages, two delivered, and three in flight
{
  const events = [
    { t: 100, ev: 'originate', node: 1, seq: 1 },
    { t: 100, ev: 'tx', node: 1, seq: 1 },
    { t: 200, ev: 'originate', node: 2, seq: 1 },
    { t: 200, ev: 'tx', node: 2, seq: 1 },
    { t: 300, ev: 'originate', node: 3, seq: 1 },
    { t: 300, ev: 'tx', node: 3, seq: 1 },
    { t: 400, ev: 'originate', node: 4, seq: 1 },
    { t: 400, ev: 'tx', node: 4, seq: 1 },
    { t: 500, ev: 'originate', node: 5, seq: 1 },
    { t: 500, ev: 'tx', node: 5, seq: 1 },
    // Deliveries for 1 and 2
    { t: 600, ev: 'alert', origin: 1, seq: 1, hops: 1, latency_ms: 500 },
    { t: 700, ev: 'alert', origin: 2, seq: 1, hops: 2, latency_ms: 500 }
    // 3, 4, 5 still in flight at t=800
  ];

  const res = calculateMetrics(events, new Map(), 800, { status: 'running' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 5, 'Scenario 1: 5 originated messages');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 2, 'Scenario 1: 2 delivered messages');
  assertStrictEqual(res.lifecycle.inFlight, 3, 'Scenario 1: 3 in-flight messages');
  assertStrictEqual(res.lifecycle.failed, 0, 'Scenario 1: 0 failed messages');
  assertStrictEqual(res.lifecycle.pdr, 40.0, 'Scenario 1: PDR is exactly 40.0%');
  assertStrictEqual(res.lifecycle.isProvisional, true, 'Scenario 1: PDR is provisional during active simulation');
  assertStrictEqual(res.lifecycle.pdrDisplay, '40.0%', 'Scenario 1: PDR display formatted as 40.0%');
}

// Scenario 7.2: Five originated messages, three delivered, one failed, and one in flight
{
  const events = [
    { t: 100, ev: 'originate', node: 1, seq: 1 },
    { t: 200, ev: 'originate', node: 2, seq: 1 },
    { t: 300, ev: 'originate', node: 3, seq: 1 },
    { t: 400, ev: 'originate', node: 4, seq: 1 },
    { t: 500, ev: 'originate', node: 5, seq: 1 },
    // Deliver 1, 2, 3
    { t: 600, ev: 'alert', origin: 1, seq: 1, hops: 1, latency_ms: 500 },
    { t: 700, ev: 'alert', origin: 2, seq: 1, hops: 1, latency_ms: 500 },
    { t: 800, ev: 'alert', origin: 3, seq: 1, hops: 2, latency_ms: 500 },
    // Node 4 exhausts retries and gives up
    { t: 850, ev: 'gave_up', node: 4 }
    // Node 5 still in flight
  ];

  const res = calculateMetrics(events, new Map(), 900, { status: 'running' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 5, 'Scenario 2: 5 originated messages');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 3, 'Scenario 2: 3 delivered messages');
  assertStrictEqual(res.lifecycle.failed, 1, 'Scenario 2: 1 permanently failed message');
  assertStrictEqual(res.lifecycle.inFlight, 1, 'Scenario 2: 1 in-flight message');
  assertStrictEqual(res.lifecycle.pdr, 60.0, 'Scenario 2: Observed delivery ratio is 60.0%');
  assertStrictEqual(res.lifecycle.isProvisional, true, 'Scenario 2: Marked provisional due to in-flight message');
}

// Scenario 7.3: Five originated messages, all delivered (100% PDR)
{
  const events = [
    { t: 100, ev: 'originate', node: 1, seq: 1 },
    { t: 200, ev: 'originate', node: 2, seq: 1 },
    { t: 300, ev: 'originate', node: 3, seq: 1 },
    { t: 400, ev: 'originate', node: 4, seq: 1 },
    { t: 500, ev: 'originate', node: 5, seq: 1 },
    { t: 600, ev: 'alert', origin: 1, seq: 1, hops: 1, latency_ms: 500 },
    { t: 700, ev: 'alert', origin: 2, seq: 1, hops: 2, latency_ms: 500 },
    { t: 800, ev: 'alert', origin: 3, seq: 1, hops: 1, latency_ms: 500 },
    { t: 900, ev: 'alert', origin: 4, seq: 1, hops: 2, latency_ms: 500 },
    { t: 1000, ev: 'alert', origin: 5, seq: 1, hops: 3, latency_ms: 500 }
  ];

  const res = calculateMetrics(events, new Map(), 1200, { status: 'running' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 5, 'Scenario 3: 5 originated messages');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 5, 'Scenario 3: 5 delivered messages');
  assertStrictEqual(res.lifecycle.inFlight, 0, 'Scenario 3: 0 in flight');
  assertStrictEqual(res.lifecycle.failed, 0, 'Scenario 3: 0 failed');
  assertStrictEqual(res.lifecycle.pdr, 100.0, 'Scenario 3: True PDR is 100.0%');
  assertStrictEqual(res.lifecycle.isProvisional, false, 'Scenario 3: Non-provisional delivery complete');
}

// Scenario 7.4: Retries and duplicate receptions
{
  const events = [
    // Initial transmission attempt 0
    { t: 1000, ev: 'originate', node: 1, seq: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1, origin: 1 },
    { t: 1062, ev: 'drop', to: 0, why: 'collision' },
    // Retransmission attempt 1 with incremented seq to evade mesh loop filters
    { t: 2000, ev: 'retry', node: 1, attempt: 1 },
    { t: 2000, ev: 'originate', node: 1, seq: 2 },
    { t: 2000, ev: 'tx', node: 1, seq: 2, origin: 1 },
    // Duplicate demodulations at multiple intermediate nodes
    { t: 2062, ev: 'rx', node: 2, from: 1, seq: 2 },
    { t: 2062, ev: 'rx', node: 3, from: 1, seq: 2 },
    { t: 2062, ev: 'rx', node: 0, from: 1, seq: 2 },
    { t: 2062, ev: 'alert', origin: 1, seq: 2, hops: 1, latency_ms: 1062 }
  ];

  const res = calculateMetrics(events, new Map(), 3000, { status: 'running' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 1, 'Scenario 4: Retries do NOT inflate originated count (originated is 1)');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 1, 'Scenario 4: Unique delivered is 1');
  assertStrictEqual(res.lifecycle.retries, 1, 'Scenario 4: Retransmission count recorded accurately as 1');
  assertStrictEqual(res.lifecycle.inFlight, 0, 'Scenario 4: In flight is 0 (delivered on retry)');
  assertStrictEqual(res.lifecycle.pdr, 100.0, 'Scenario 4: PDR is 100.0%');
  assertStrictEqual(res.radio.rxTotal, 3, 'Scenario 4: Physical duplicate demodulations recorded in radio layer (3 RXs)');
}

// Scenario 7.5: Multiple relay transmissions for a single logical message
{
  const events = [
    { t: 1000, ev: 'originate', node: 1, seq: 1 },
    { t: 1000, ev: 'tx', node: 1, seq: 1, origin: 1 }
  ];

  // 10 intermediate relay towers forward the packet
  for (let i = 0; i < 10; ++i) {
    events.push({ t: 1100 + i * 50, ev: 'tx', node: 100 + i, seq: 1, origin: 1 });
  }
  events.push({ t: 1700, ev: 'alert', origin: 1, seq: 1, hops: 5, latency_ms: 700 });

  const res = calculateMetrics(events, new Map(), 2000, { status: 'running' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 1, 'Scenario 5: 1 unique originated message');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 1, 'Scenario 5: 1 unique delivered message');
  assertStrictEqual(res.lifecycle.relayForwards, 10, 'Scenario 5: Exactly 10 relay forward transmissions recorded');
  assertStrictEqual(res.radio.relayForwardsTotal, 10, 'Scenario 5: Radio telemetry matches 10 relay transmissions');
  assertStrictEqual(res.lifecycle.pdr, 100.0, 'Scenario 5: PDR is 100.0% (relay forwards do NOT distort message population)');
}

// Scenario 7.6: Completed simulation with unresolved messages
{
  const events = [
    { t: 100, ev: 'originate', node: 1, seq: 1 },
    { t: 200, ev: 'originate', node: 2, seq: 1 },
    { t: 300, ev: 'originate', node: 3, seq: 1 },
    { t: 400, ev: 'originate', node: 4, seq: 1 },
    { t: 500, ev: 'originate', node: 5, seq: 1 },
    // Deliver 2 messages
    { t: 600, ev: 'alert', origin: 1, seq: 1, hops: 1, latency_ms: 500 },
    { t: 700, ev: 'alert', origin: 2, seq: 1, hops: 2, latency_ms: 500 }
    // 3 messages remained in flight when simulation terminated
  ];

  const res = calculateMetrics(events, new Map(), 1000, { status: 'completed' });
  assertStrictEqual(res.lifecycle.uniqueOriginated, 5, 'Scenario 6: 5 originated messages');
  assertStrictEqual(res.lifecycle.uniqueDelivered, 2, 'Scenario 6: 2 delivered messages');
  assertStrictEqual(res.lifecycle.unresolved, 3, 'Scenario 6: 3 messages unresolved at session completion');
  assertStrictEqual(res.lifecycle.inFlight, 0, 'Scenario 6: 0 in flight once completed');
  assertStrictEqual(res.lifecycle.isProvisional, false, 'Scenario 6: Final PDR is NOT provisional');
  assertStrictEqual(res.lifecycle.pdr, 40.0, 'Scenario 6: Final PDR is 40.0% using documented terminal policy');
}

// Scenario 7.7: Node energy consumption telemetry & Fleet Health verification
{
  const sim = new SimulationEngine();
  const trace = [
    { t: 0, ev: 'meta', duration: 5000 },
    { t: 0, ev: 'node_init', id: 1, role: 'survivor', battery: 100, initial_battery: 100 },
    { t: 0, ev: 'node_init', id: 2, role: 'survivor', battery: 100, initial_battery: 100 },
    { t: 0, ev: 'node_init', id: 3, role: 'survivor', battery: 100, initial_battery: 100 },
    // Node 1 performs 2 transmissions: 2 * 1.500 mAh = 3.000 mAh (1.0% drop -> 99%)
    { t: 1000, ev: 'tx', node: 1, seq: 1, energy_mah: 1.500, battery: 100 },
    { t: 2000, ev: 'tx', node: 1, seq: 1, energy_mah: 3.000, battery: 99 },
    // Node 2 performs 3 receptions: 3 * 0.300 mAh = 0.900 mAh (0.3% drop -> round(99.7) = 100%)
    { t: 1062, ev: 'rx', node: 2, from: 1, energy_mah: 0.300, battery: 100 },
    { t: 2062, ev: 'rx', node: 2, from: 1, energy_mah: 0.600, battery: 100 },
    { t: 3062, ev: 'rx', node: 2, from: 1, energy_mah: 0.900, battery: 100 }
    // Node 3 is idle: 0 mAh consumed, battery 100%
  ];

  sim.loadTrace(trace, null, { id: 'energy_test', name: 'Energy Telemetry Test', mode: 'replay' });
  sim.seek(4000);

  const n1 = sim.nodes.get(1);
  const n2 = sim.nodes.get(2);
  const n3 = sim.nodes.get(3);

  assertStrictEqual(n1.stats.tx, 2, 'Energy Model: Node 1 has 2 TXs');
  assertStrictEqual(n1.energy_consumed_mah, 3.000, 'Energy Model: Node 1 consumed exactly 3.000 mAh');
  assertStrictEqual(n1.battery, 99, 'Energy Model: Node 1 battery decreased to 99%');

  assertStrictEqual(n2.stats.rx, 3, 'Energy Model: Node 2 has 3 RXs');
  assertStrictEqual(n2.energy_consumed_mah, 0.900, 'Energy Model: Node 2 consumed exactly 0.900 mAh');
  assertStrictEqual(n2.battery, 100, 'Energy Model: Node 2 battery remains 100% (0.3% drain does not round to 99%)');

  assertStrictEqual(n3.stats.tx, 0, 'Energy Model: Node 3 has 0 TXs');
  assertStrictEqual(n3.energy_consumed_mah, 0.000, 'Energy Model: Node 3 consumed 0.000 mAh');
  assertStrictEqual(n3.battery, 100, 'Energy Model: Node 3 battery is 100%');

  const m = sim.getMetrics();
  assertStrictEqual(m.fleet.totalEnergyConsumedMah, 3.900, 'Fleet Health: Total energy consumed across fleet is 3.900 mAh');
  assertStrictEqual(m.fleet.avgBatteryPct, 100, 'Fleet Health: Fleet average battery rounded is 100%');
}

// Scenario 7.8: Native Simulator C++ Trace and Metrics Parity
{
  const simExe = path.join(rootDir, 'build', 'Release', 'setu_sim.exe');
  await new Promise((resolve, reject) => {
    // Run native sim with trace output
    const proc = spawn(simExe, [
      '--survivors', '3',
      '--relays', '2',
      '--duration', '4000',
      '--seed', '42',
      '--trigger', '1:short@500',
      '--trace', '-'
    ], { cwd: rootDir });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', c => { stdout += c.toString(); });
    proc.stderr.on('data', c => { stderr += c.toString(); });

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Exit code ${code}: ${stderr}`));

      const lines = stdout.trim().split('\n');
      const traceEvents = [];
      let summaryObj = null;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.ev) traceEvents.push(parsed);
        } catch {}
      }

      const summaryMatch = stdout.match(/\{\r?\n\s*"seed":[\s\S]*$/);
      if (summaryMatch) {
        try {
          summaryObj = JSON.parse(summaryMatch[0]);
        } catch {}
      }

      assert(traceEvents.length > 0, 'Native trace produced valid JSONL events');
      assert(summaryObj !== null, 'Native simulator produced final summary totals');

      const nativeMetrics = calculateMetrics(traceEvents, new Map(), 4000, { status: 'completed' });
      assert(nativeMetrics.lifecycle.uniqueOriginated >= 1, 'Native trace originated at least 1 SOS alert');
      assert(nativeMetrics.lifecycle.uniqueDelivered >= 1, 'Native trace delivered SOS alert to hub');
      assertStrictEqual(nativeMetrics.lifecycle.pdr, 100.0, 'Native single-trigger run achieves 100.0% PDR');
      assert(nativeMetrics.radio.txTotal === summaryObj.totals.tx, 'Radio TX totals match native C++ engine totals');
      assert(nativeMetrics.radio.relayForwardsTotal === summaryObj.totals.relay_tx, 'Relay forwards match native C++ engine relay_tx');

      console.log(`    Native Parity Verified: TX=${nativeMetrics.radio.txTotal}, Relays=${nativeMetrics.radio.relayForwardsTotal}, PDR=${nativeMetrics.lifecycle.pdr}%`);
      resolve();
    });
  });
}

console.log('\n==========================================================');
console.log(`  ANALYTICS TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('==========================================================\n');

if (failedTests > 0) {
  process.exit(1);
}

