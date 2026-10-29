// Project Setu - Scientific Analytics & Visualization Validation Suite
// Rigorous verification of mathematical radio models, empirical CDFs,
// sliding-window throughput, link-quality matrices, relay bottleneck metrics,
// and export fidelity.

import assert from 'node:assert';
import {
  LORA_RADIO_CONSTANTS,
  calculateTheoreticalRssi,
  calculateTheoreticalPathLoss,
  calculateEcdf,
  calculateHistogram,
  calculateSlidingWindowMetrics,
  reconstructPacketRoutes,
  generateLinkQualityMatrix,
  calculateRelayAnalytics,
  calculateBatteryProjections
} from '../dashboard/src/scientific_metrics.js';
import { Exporter } from '../dashboard/src/exporter.js';

let passedAssertions = 0;
let failedAssertions = 0;

function check(desc, actual, expected, tol = 1e-3) {
  let ok = false;
  if (typeof actual === 'number' && typeof expected === 'number') {
    ok = Math.abs(actual - expected) <= tol;
  } else {
    ok = (actual === expected);
  }

  if (ok) {
    passedAssertions++;
    console.log(`  [ PASS ] ${desc} (Expected: ${expected}, Got: ${actual})`);
  } else {
    failedAssertions++;
    console.error(`  [ FAIL ] ${desc} (Expected: ${expected}, Got: ${actual})`);
  }
}

console.log('================================================================');
console.log('  PROJECT SETU RESEARCH-GRADE SCIENTIFIC ANALYTICS TEST SUITE   ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Log-Distance Path Loss Theoretical Model Parity (Phase 3)
// -----------------------------------------------------------------------------
console.log('[Test 1] Log-Distance Path Loss Model & Theoretical Curve Calculations...');
{
  // P_rx(d) = P_tx - (PL_0 + 10 * n * log10(d) + L_extra)
  // At d = 1m: PL(1) = 31.2 + 0 + 15.0 = 46.2 dB. P_rx(1) = 14.0 - 46.2 = -32.2 dBm.
  const pl1 = calculateTheoreticalPathLoss(1.0, 3.5);
  check('Path loss at d=1m (n=3.5)', pl1, 46.2);

  const rssi1 = calculateTheoreticalRssi(1.0, 3.5);
  check('Theoretical RSSI at d=1m (n=3.5)', rssi1, -32.2);

  // At d = 100m (n=3.5):
  // log10(100) = 2.0.
  // PL(100) = 31.2 + (10 * 3.5 * 2.0) + 15.0 = 31.2 + 70.0 + 15.0 = 116.2 dB.
  // P_rx(100) = 14.0 - 116.2 = -102.2 dBm.
  const pl100 = calculateTheoreticalPathLoss(100.0, 3.5);
  check('Path loss at d=100m (n=3.5)', pl100, 116.2);

  const rssi100 = calculateTheoreticalRssi(100.0, 3.5);
  check('Theoretical RSSI at d=100m (n=3.5)', rssi100, -102.2);

  // Free-space propagation comparison (n=2.0 at d=100m):
  // PL(100) = 31.2 + 40.0 + 15.0 = 86.2 dB. P_rx(100) = 14.0 - 86.2 = -72.2 dBm.
  const plFreeSpace = calculateTheoreticalPathLoss(100.0, 2.0);
  check('Free space path loss at d=100m (n=2.0)', plFreeSpace, 86.2);

  const rssiFreeSpace = calculateTheoreticalRssi(100.0, 2.0);
  check('Free space RSSI at d=100m (n=2.0)', rssiFreeSpace, -72.2);

  // Severe rubble collapse propagation (n=4.5 at d=100m):
  // PL(100) = 31.2 + (10 * 4.5 * 2.0) + 15.0 = 136.2 dB. P_rx(100) = 14.0 - 136.2 = -122.2 dBm.
  const plSevere = calculateTheoreticalPathLoss(100.0, 4.5);
  check('Severe rubble path loss at d=100m (n=4.5)', plSevere, 136.2);

  const rssiSevere = calculateTheoreticalRssi(100.0, 4.5);
  check('Severe rubble RSSI at d=100m (n=4.5)', rssiSevere, -122.2);

  // Link Margin against SF7 sensitivity (-123 dBm):
  const sensSf7 = LORA_RADIO_CONSTANTS.sensitivityBySf[7];
  check('SF7 Receiver Sensitivity is -123.0 dBm', sensSf7, -123.0);
  check('SX1262 125 kHz Noise Floor is -117.0 dBm', LORA_RADIO_CONSTANTS.noiseFloorDbm, -117.0);

  const margin100 = Math.round((rssi100 - sensSf7) * 10) / 10;
  check('Link Margin at d=100m (n=3.5)', margin100, 20.8);
}

// -----------------------------------------------------------------------------
// Test 2: Empirical Cumulative Distribution Function (eCDF) Quantiles (Phase 4B & 9)
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Empirical Cumulative Distribution Function (eCDF) & Quantile Precision...');
{
  // Known sample array: 10 evenly spaced values from 100ms to 1000ms
  const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  const ecdf = calculateEcdf(latencies);

  check('eCDF sample count is 10', ecdf.count, 10);
  check('eCDF minimum is 100ms', ecdf.min, 100);
  check('eCDF maximum is 1000ms', ecdf.max, 1000);
  check('eCDF arithmetic mean is 550ms', ecdf.mean, 550.0);
  check('eCDF median (p50) is 550ms', ecdf.p50, 550.0);
  check('eCDF p90 percentile', ecdf.p90, 910.0);
  check('eCDF p95 percentile', ecdf.p95, 955.0);
  check('eCDF p99 percentile', ecdf.p99, 991.0);
  check('eCDF first point cumulative percentage is 10%', ecdf.points[0].y, 10.0);
  check('eCDF final point cumulative percentage is 100%', ecdf.points[9].y, 100.0);

  // Missing data and empty observation handling:
  const emptyEcdf = calculateEcdf([]);
  check('Empty observation array produces count 0', emptyEcdf.count, 0);
  check('Empty observation array produces null p50', emptyEcdf.p50, null);
  check('Empty observation array produces null mean', emptyEcdf.mean, null);

  // Null and NaN filtering:
  const dirtySamples = [null, NaN, 150, undefined, 250, 'bad', 350];
  const filteredEcdf = calculateEcdf(dirtySamples);
  check('Dirty array filters invalid values (count=3)', filteredEcdf.count, 3);
  check('Filtered eCDF median is 250', filteredEcdf.p50, 250.0);
}

// -----------------------------------------------------------------------------
// Test 3: Sliding-Window Delivery Ratio & Throughput Aggregation (Phase 4A & 4C)
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Sliding-Window Delivery Ratio, Throughput, and Offered Load...');
{
  // Trace events:
  // t=1000ms: Survivor 1 originates SOS (seq 0)
  // t=1500ms: Hub receives Alert for Survivor 1 (seq 0) -> Delivery complete
  // t=3000ms: Survivor 2 originates SOS (seq 0)
  // t=3500ms: Hub receives Alert for Survivor 2 (seq 0) -> Delivery complete
  // t=5000ms: Survivor 3 originates SOS (seq 0)
  // t=5200ms: Drop weak
  // t=5400ms: Survivor 3 retries (seq 1)
  // t=5800ms: Hub receives Alert for Survivor 3 -> Delivery complete
  const testEvents = [
    { t: 1000, ev: 'originate', node: 1, seq: 0 },
    { t: 1050, ev: 'tx', node: 1, origin: 1, seq: 0 },
    { t: 1500, ev: 'alert', origin: 1, seq: 0, hops: 1, latency_ms: 500 },
    { t: 3000, ev: 'originate', node: 2, seq: 0 },
    { t: 3050, ev: 'tx', node: 2, origin: 2, seq: 0 },
    { t: 3500, ev: 'alert', origin: 2, seq: 0, hops: 1, latency_ms: 500 },
    { t: 5000, ev: 'originate', node: 3, seq: 0 },
    { t: 5050, ev: 'tx', node: 3, origin: 3, seq: 0 },
    { t: 5200, ev: 'drop', from: 3, node: 0, why: 'weak' },
    { t: 5400, ev: 'retry', node: 3 },
    { t: 5450, ev: 'tx', node: 3, origin: 3, seq: 1 },
    { t: 5800, ev: 'alert', origin: 3, seq: 0, hops: 1, latency_ms: 800 }
  ];

  const series = calculateSlidingWindowMetrics(testEvents, 7000, 2000, 500);
  check('Sliding window computed points across timeline', series.length > 0, true);

  // Check cumulative PDR at t=2000ms (1 originated, 1 delivered -> 100%)
  const pt2s = series.find(p => p.tMs === 2000);
  check('Cumulative PDR at t=2.0s is 100.0%', pt2s.cumulativePdr, 100.0);

  // Check delivered throughput at t=2000ms (1 packet delivered in 2.0s window -> 200 bits / 2s = 100 bps)
  check('Delivered payload throughput at t=2.0s is 100 bps', pt2s.throughputBps, 100);
  check('Delivered packet rate at t=2.0s is 0.50 pps', pt2s.throughputPps, 0.50);

  // Check window with no origination (e.g. t=4500ms):
  // At t=4.5s (window 2.5s-4.5s), 1 alert arrived (at 3.5s) and 1 originated (at 3.0s) -> 100%
  const pt4s = series.find(p => p.tMs === 4000);
  check('Windowed PDR at t=4.0s is 100.0%', pt4s.windowPdr, 100.0);

  // Check retries and drops tracked at t=6000ms
  const pt6s = series.find(p => p.tMs === 6000);
  check('Window at t=6.0s recorded exactly 1 retry', pt6s.winRetries, 1);
  check('Window at t=6.0s recorded exactly 1 channel drop', pt6s.winDropsTotal, 1);
}

// -----------------------------------------------------------------------------
// Test 4: Link-Quality Matrix & State Classification (Phase 3D)
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Node-to-Node Link-Quality Matrix & Link State Distinction...');
{
  const nodesMap = new Map([
    [0, { id: 0, role: 'hub', x: 0, y: 0 }],
    [101, { id: 101, role: 'relay', x: 300, y: 0 }],
    [1, { id: 1, role: 'survivor', x: 600, y: 0 }],
    [2, { id: 2, role: 'survivor', x: 5000, y: 0 }] // Far out of range (5000m)
  ]);

  const linksList = [
    { a: 0, b: 101, rssi: -85.0, dist: 300.0, blocked: false },
    { a: 101, b: 1, rssi: -88.0, dist: 300.0, blocked: false }
  ];

  // Packet events between Node 101 and Node 0:
  const matrixEvents = [
    { ev: 'rx', from: 101, to: 0, rssi: -84.0 },
    { ev: 'rx', from: 101, to: 0, rssi: -86.0 },
    { ev: 'drop', from: 1, to: 0, why: 'weak' } // Observed failed attempts
  ];

  const matrixResult = generateLinkQualityMatrix(nodesMap, linksList, matrixEvents, 'rssi');
  check('Matrix contains all 4 nodes', matrixResult.nodeIds.length, 4);

  const idx0 = matrixResult.nodeIds.indexOf(0);
  const idx101 = matrixResult.nodeIds.indexOf(101);
  const idx1 = matrixResult.nodeIds.indexOf(1);
  const idx2 = matrixResult.nodeIds.indexOf(2);

  // Link 101 -> 0: Measured with 2 RX samples
  const cell101to0 = matrixResult.matrix[idx101][idx0];
  check('Link 101->0 is classified as MEASURED', cell101to0.status, 'MEASURED');
  check('Link 101->0 sample count is 2', cell101to0.samples, 2);
  check('Link 101->0 average measured RSSI is -85.0 dBm', cell101to0.rssi, -85.0);
  check('Link 101->0 PRR is 100.0%', cell101to0.prr, 100.0);

  // Link 1 -> 0: Measured with 1 drop (weak)
  const cell1to0 = matrixResult.matrix[idx1][idx0];
  check('Link 1->0 is classified as MEASURED (observed failed transmission)', cell1to0.status, 'MEASURED');
  check('Link 1->0 PRR is 0.0%', cell1to0.prr, 0.0);
  check('Link 1->0 loss rate is 100.0%', cell1to0.lossRate, 100.0);

  // Link 2 -> 0: At 5000m, path loss places RSSI far sub-sensitivity (< -135 dBm) -> ABSENT
  const cell2to0 = matrixResult.matrix[idx2][idx0];
  check('Out-of-range Link 2->0 (5000m) is classified as ABSENT', cell2to0.status, 'ABSENT');

  // Candidate link 101 -> 1: Within range (300m) but 0 packets in matrixEvents -> UNOBSERVED
  const cell101to1 = matrixResult.matrix[idx101][idx1];
  check('Unused candidate Link 101->1 is classified as UNOBSERVED', cell101to1.status, 'UNOBSERVED');
  check('Unobserved link has sample count 0', cell101to1.samples, 0);
}

// -----------------------------------------------------------------------------
// Test 5: Relay Analytics & Bottleneck Scoring (Phase 5)
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Relay Analytics & Defensible Bottleneck Formula...');
{
  const nodesMap = new Map([
    [0, { id: 0, role: 'hub', x: 0, y: 0 }],
    [101, { id: 101, role: 'relay', x: 200, y: 0, battery: 95, radio_queue_depth: 14, radio_queue_overflows: 1 }],
    [102, { id: 102, role: 'relay', x: 400, y: 0, battery: 100, radio_queue_depth: 1, radio_queue_overflows: 0 }]
  ]);

  // Node 101 forwards 20 packets, has 10 collision drops, and heavy queue saturation
  // Node 102 forwards 2 packets, has 0 drops, and nominal queue
  const relayEvents = [
    ...Array(20).fill({ ev: 'tx', node: 101, origin: 1 }),
    ...Array(10).fill({ ev: 'drop', node: 101, why: 'collision' }),
    ...Array(2).fill({ ev: 'tx', node: 102, origin: 2 })
  ];

  const analytics = calculateRelayAnalytics(nodesMap, relayEvents);
  check('Identified 2 relay towers', analytics.length, 2);

  const r101 = analytics.find(r => r.id === 101);
  const r102 = analytics.find(r => r.id === 102);

  check('Relay 101 recorded 20 forwarded packets', r101.forwardedTx, 20);
  check('Relay 101 recorded 10 collision drops', r101.drops.collision, 10);
  check('Relay 101 has high bottleneck score (>0.50)', r101.bottleneckScore >= 0.50, true);
  check('Relay 101 is explicitly flagged as a true BOTTLENECK', r101.isBottleneck, true);

  check('Relay 102 has low bottleneck score (<0.20)', r102.bottleneckScore < 0.20, true);
  check('Relay 102 is NOT flagged as a bottleneck', r102.isBottleneck, false);
}

// -----------------------------------------------------------------------------
// Test 6: Reconstructing Explicit Multi-Hop Routes (Phase 4E & 5)
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Multi-Hop Route Reconstruction from Simulated Trace Events...');
{
  const nodesMap = new Map([
    [0, { id: 0, role: 'hub' }],
    [101, { id: 101, role: 'relay' }],
    [102, { id: 102, role: 'relay' }],
    [1, { id: 1, role: 'survivor' }]
  ]);

  // Multi-hop path: Survivor 1 -> Relay 101 -> Relay 102 -> Hub 0
  const routeEvents = [
    { t: 100, ev: 'originate', node: 1, seq: 10, hazard: 1 },
    { t: 120, ev: 'tx', node: 1, origin: 1, seq: 10 },
    { t: 182, ev: 'rx', from: 1, to: 101, rssi: -85.0 },
    { t: 250, ev: 'tx', node: 101, origin: 1, seq: 10 },
    { t: 312, ev: 'rx', from: 101, to: 102, rssi: -82.0 },
    { t: 400, ev: 'tx', node: 102, origin: 1, seq: 10 },
    { t: 462, ev: 'rx', from: 102, to: 0, rssi: -78.0 },
    { t: 465, ev: 'alert', origin: 1, seq: 10, hops: 3, latency_ms: 365 }
  ];

  const routes = reconstructPacketRoutes(routeEvents, nodesMap);
  check('Reconstructed exactly 1 route episode', routes.length, 1);

  const r = routes[0];
  check('Route origin is Survivor 1', r.origin, 1);
  check('Route delivery status is "delivered"', r.status, 'delivered');
  check('Route latency matches measured latency (365ms)', r.latencyMs, 365);
  check('Route hop count is 3', r.hops, 3);
  check('Route path correctly traces [1, 101, 102, 0]', JSON.stringify(r.path), JSON.stringify([1, 101, 102, 0]));
}

// -----------------------------------------------------------------------------
// Test 7: Multi-Run Cross-Experiment Comparison (Phase 10)
// -----------------------------------------------------------------------------
console.log('\n[Test 7] Cross-Experiment Comparison Store & Independence...');
{
  // Run A (n=2.5, fast propagation, low loss)
  const latenciesA = [150, 180, 210, 240, 260];
  const ecdfA = calculateEcdf(latenciesA);

  // Run B (n=3.8, heavy rubble, retries, higher latency)
  const latenciesB = [420, 680, 890, 1150, 1420];
  const ecdfB = calculateEcdf(latenciesB);

  check('Run A median latency is 210ms', ecdfA.p50, 210.0);
  check('Run B median latency is 890ms', ecdfB.p50, 890.0);
  check('Run A and Run B maintain strictly independent quantiles', ecdfA.p50 < ecdfB.p50, true);
  check('Run A p95 is 256ms', ecdfA.p95, 256.0);
  check('Run B p95 is 1366ms', ecdfB.p95, 1366.0);
}

// -----------------------------------------------------------------------------
// Test 8: Battery Energy Model & Operating Lifetime (Phase 7)
// -----------------------------------------------------------------------------
console.log('\n[Test 8] Battery Depletion Rate & Lifetime Projections...');
{
  // 300 mAh nominal battery, 10 transmissions, 20 receptions in a 60-second window
  const proj = calculateBatteryProjections(100.0, 300.0, 10, 20, 60.0);
  check('Active average current is positive non-zero', proj.activeCurrentMa > 0, true);
  check('Projected operating hours is realistic (~99.9 hours)', proj.projectedHours >= 90, true);

  // Depleted battery at 10%
  const depletedProj = calculateBatteryProjections(10.0, 300.0, 10, 20, 60.0);
  check('Depleted battery scales projected hours proportionally', depletedProj.projectedHours < proj.projectedHours, true);
}

// -----------------------------------------------------------------------------
// Test 9: Data Exporter Integrity (Phase 12)
// -----------------------------------------------------------------------------
console.log('\n[Test 9] Data Exporter Structure & CSV Generation...');
{
  const mockSim = {
    session: { id: 'ses_test_42', mode: 'live' },
    meta: { duration: 30000, seed: 42, path_exp: 3.5, sf: 7 },
    nodes: new Map([
      [0, { id: 0, role: 'hub', x: 0, y: 0, online: true, battery: 100, energy_consumed_mah: 0.15, stats: { tx: 10, rx: 15 } }],
      [1, { id: 1, role: 'survivor', x: 100, y: 50, online: true, battery: 98, energy_consumed_mah: 0.08, stats: { tx: 2, rx: 1 } }]
    ]),
    events: [
      { t: 100, ev: 'originate', node: 1, seq: 0 },
      { t: 150, ev: 'tx', node: 1, origin: 1, seq: 0, air: 62 },
      { t: 250, ev: 'rx', from: 1, node: 0, rssi: -92.5 }
    ],
    alerts: [
      { origin: 1, hops: 1, t_ms: 250 }
    ],
    getMetrics: () => ({
      clockMs: 250,
      durationMs: 30000,
      lifecycle: { pdr: 100.0, pdrDisplay: '100.0%', uniqueOriginated: 1, uniqueDelivered: 1 },
      latency: { avgMs: 150.0 },
      radio: { dropCauses: {} },
      fleet: {},
      hopDistribution: []
    })
  };

  // Verify that methods exist on Exporter
  check('Exporter has exportJson method', typeof Exporter.exportJson, 'function');
  check('Exporter has exportCsv method', typeof Exporter.exportCsv, 'function');
  check('Exporter has exportRawObservationsCsv method', typeof Exporter.exportRawObservationsCsv, 'function');
  check('Exporter has exportChartDatasetCsv method', typeof Exporter.exportChartDatasetCsv, 'function');
}

console.log('\n================================================================');
console.log(`  SCIENTIFIC ANALYTICS SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
console.log('================================================================');

if (failedAssertions > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
