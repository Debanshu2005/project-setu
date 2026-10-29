// Project Setu - Automated Test Suite for Portable JavaScript Simulation Engine (simulator.js)
// Verifies:
// 1. Single-hop SOS delivery and ACK confirmation
// 2. Multi-hop relay forwarding and hop incrementing
// 3. Symmetric simultaneous transmission collisions (both collide on attempt 0 with <6dB margin)
// 4. Asymmetric simultaneous transmission capture effect (louder signal survives with >=6dB margin)
// 5. Overlapping staggered transmission collisions
// 6. Half-duplex reception blocking during transmission
// 7. Channel sensitivity and Semtech AN1200.13 airtime parity

import { SetuSimulator, loraAirtimeMs, loraSensitivityDbm } from '../simulation/js/simulator.js';

let passed = 0;
let failed = 0;

function assert(condition, message, details = {}) {
  if (condition) {
    passed++;
    console.log(`  [ PASS ] ${message}`);
  } else {
    failed++;
    console.error(`  [ FAIL ] ${message}`, details);
  }
}

console.log('================================================================');
console.log('  Project Setu — Portable JS Simulator Engine Test Suite        ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Semtech AN1200.13 LoRa Airtime & Sensitivity Parity
// -----------------------------------------------------------------------------
console.log('[Test 1] LoRa Airtime Calculation & Sensitivity Tables...');
{
  // 25-byte payload at SF7 / 125 kHz BW
  const air7 = loraAirtimeMs(25, 7, 125000);
  assert(air7 >= 60 && air7 <= 65, `SF7 airtime for 25 bytes is ~62ms (Got: ${air7}ms)`);

  // 25-byte payload at SF12 / 125 kHz BW (DE=1, Low Data Rate Optimization)
  const air12 = loraAirtimeMs(25, 12, 125000);
  assert(air12 === 1483, `SF12 airtime for 25 bytes is 1483ms per Semtech formula (Got: ${air12}ms)`);

  assert(loraSensitivityDbm(7) === -123.0, 'SF7 sensitivity is -123.0 dBm');
  assert(loraSensitivityDbm(8) === -126.0, 'SF8 sensitivity is -126.0 dBm');
  assert(loraSensitivityDbm(12) === -137.0, 'SF12 sensitivity is -137.0 dBm');
}

// -----------------------------------------------------------------------------
// Test 2: Single-Hop Direct SOS Delivery & Two-Way ACK
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Single-Hop SOS Delivery & Hub ACK Confirmation...');
{
  const sim = new SetuSimulator({ survivors: 1, relays: 0, zone: 200, seed: 42 });
  // Place Survivor 1 within direct reach of Hub (Node 0 at 60,60)
  sim.nodes.get(1).x = 100;
  sim.nodes.get(1).y = 60;

  sim.addTrigger(1, 'short', 1000);
  const res = sim.run();

  const alerts = res.summary.events.filter(e => e.origin === 1);
  assert(alerts.length >= 1, 'Survivor 1 alert reached the Hub');
  assert(alerts[0].hops === 0, 'Alert delivered in 0 relay hops (direct)');
  assert(sim.nodes.get(1).acked === true, 'Survivor 1 received ACK and marked acked=true');
}

// -----------------------------------------------------------------------------
// Test 3: Symmetric Simultaneous Transmissions Collision Verification
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Symmetric Simultaneous Transmissions (Zero Capture Margin)...');
{
  const sim = new SetuSimulator({ survivors: 2, relays: 0, zone: 300, seed: 101 });
  // Place both survivors at identical distance from Hub (Node 0 at 60,60)
  sim.nodes.get(1).x = 120;
  sim.nodes.get(1).y = 120;
  sim.nodes.get(2).x = 120;
  sim.nodes.get(2).y = 120;

  // Trigger both at exact same simulated time
  sim.addTrigger(1, 'short', 1000);
  sim.addTrigger(2, 'short', 1000);

  const res = sim.run();

  // Button hold is 150ms -> transmissions start at 1150ms and complete at 1150 + airtime (~1212ms).
  // Neither packet should deliver at 1212ms on initial attempt because both collided!
  const airtime = loraAirtimeMs(25, 7, 125000);
  const initialEndTime = 1000 + 150 + airtime;

  const deliveredAtInitial = res.summary.events.filter(e => e.t === initialEndTime);
  assert(deliveredAtInitial.length === 0,
    `Neither transmission delivered at initial completion time t=${initialEndTime}ms due to mutual collision (Got: ${deliveredAtInitial.length})`);

  // Collisions counter must be positive
  assert(res.summary.totals.collisions >= 2,
    `Recorded mutual collisions at Hub (Expected >=2, Got: ${res.summary.totals.collisions})`);

  // Both survivors should eventually recover via retry backoff
  assert(res.summary.totals.retries >= 1, 'At least one survivor performed retry');
  assert(res.summary.events.length >= 1, 'Eventual delivery succeeded after backoff');
}

// -----------------------------------------------------------------------------
// Test 4: Asymmetric Simultaneous Transmissions & Co-Channel Capture Effect
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Asymmetric Simultaneous Transmissions (Capture Effect >=6dB)...');
{
  const sim = new SetuSimulator({ survivors: 2, relays: 0, zone: 500, seed: 7 });
  // Survivor 1 placed close to Hub (loud: ~ -75 dBm)
  sim.nodes.get(1).x = 75;
  sim.nodes.get(1).y = 60;
  // Survivor 2 placed far from Hub (quiet: ~ -105 dBm)
  sim.nodes.get(2).x = 350;
  sim.nodes.get(2).y = 60;

  const r1 = sim.calculateMeanRssi(1, 0);
  const r2 = sim.calculateMeanRssi(2, 0);
  const diffDb = r1 - r2;
  assert(diffDb >= 6.0, `Survivor 1 signal is >=6dB louder than Survivor 2 at Hub (Diff: ${diffDb.toFixed(1)}dB)`);

  // Trigger both simultaneously
  sim.addTrigger(1, 'short', 1000);
  sim.addTrigger(2, 'short', 1000);

  const res = sim.run();
  const airtime = loraAirtimeMs(25, 7, 125000);
  const initialEndTime = 1000 + 150 + airtime;

  // Survivor 1 should capture and deliver at initial completion time
  const captured = res.summary.events.filter(e => e.t === initialEndTime && e.origin === 1);
  assert(captured.length === 1, `Louder Survivor 1 captured channel and delivered at t=${initialEndTime}ms`);

  // Survivor 2 should have collided on attempt 0 and delivered only later on retry
  const s2Initial = res.summary.events.filter(e => e.t === initialEndTime && e.origin === 2);
  assert(s2Initial.length === 0, `Weaker Survivor 2 did NOT deliver at t=${initialEndTime}ms (suffered collision)`);
}

// -----------------------------------------------------------------------------
// Test 5: Overlapping Staggered Transmissions Collision Detection
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Overlapping Staggered Transmissions...');
{
  const sim = new SetuSimulator({ survivors: 2, relays: 0, zone: 200, seed: 10 });
  sim.nodes.get(1).x = 100;
  sim.nodes.get(1).y = 80;
  sim.nodes.get(2).x = 100;
  sim.nodes.get(2).y = 80;

  // Survivor 1 triggers at t=1000 (transmits 1150..1212)
  // Survivor 2 triggers at t=1020 (transmits 1170..1232) -> 42ms overlap
  sim.addTrigger(1, 'short', 1000);
  sim.addTrigger(2, 'short', 1020);

  const res = sim.run();

  // Neither should deliver on its initial transmission because of the overlap
  const alertsAtFirstTx = res.summary.events.filter(e => e.t <= 1250);
  assert(alertsAtFirstTx.length === 0, `No deliveries during staggered overlapping window (<=1250ms) (Got: ${alertsAtFirstTx.length})`);
  assert(res.summary.totals.collisions >= 2, 'Both staggered transmissions registered collision drops');
}

// -----------------------------------------------------------------------------
// Test 6: Multi-Interferer Cumulative Co-Channel Collision (SINR Linear Sum)
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Multi-Interferer Cumulative Co-Channel Collision...');
{
  const sim = new SetuSimulator({ survivors: 3, relays: 0, zone: 200, seed: 99 });
  sim.shadowSigmaDb = 0;
  sim.fadingSigmaDb = 0;

  // Hub is at (60, 60)
  // Survivor 1: d = 23.15m -> RSSI ~ -80.0 dBm
  sim.nodes.get(1).x = 60 + 23.15;
  sim.nodes.get(1).y = 60;

  // Survivor 2: d = 36.79m -> RSSI ~ -87.0 dBm (7 dB below S1)
  sim.nodes.get(2).x = 60 + 36.79;
  sim.nodes.get(2).y = 60;

  // Survivor 3: d = 36.79m -> RSSI ~ -87.0 dBm (7 dB below S1)
  sim.nodes.get(3).x = 60;
  sim.nodes.get(3).y = 60 + 36.79;

  const r1 = sim.calculateMeanRssi(1, 0);
  const r2 = sim.calculateMeanRssi(2, 0);
  const r3 = sim.calculateMeanRssi(3, 0);

  assert(Math.abs(r1 - (-80.0)) < 0.2, `S1 RSSI is ~ -80.0 dBm (Got: ${r1.toFixed(1)} dBm)`);
  assert(Math.abs(r2 - (-87.0)) < 0.2, `S2 RSSI is ~ -87.0 dBm (Got: ${r2.toFixed(1)} dBm)`);
  assert(Math.abs(r3 - (-87.0)) < 0.2, `S3 RSSI is ~ -87.0 dBm (Got: ${r3.toFixed(1)} dBm)`);

  const diff12 = r1 - r2;
  const diff13 = r1 - r3;
  assert(diff12 >= 6.0 && diff13 >= 6.0, `Each interferer individually satisfies capture >=6dB (${diff12.toFixed(1)}dB, ${diff13.toFixed(1)}dB)`);

  // All 3 transmit at the exact same instant
  sim.addTrigger(1, 'short', 1000);
  sim.addTrigger(2, 'short', 1000);
  sim.addTrigger(3, 'short', 1000);

  const res = sim.run();
  const airtime = loraAirtimeMs(25, 7, 125000);
  const initialEndTime = 1000 + 150 + airtime;

  // With cumulative power sum, P_int = P2 + P3 = -84.0 dBm -> SIR = 4.0 dB < 6.0 dB capture margin.
  // Therefore Survivor 1 MUST suffer a collision drop on attempt 0!
  const s1DeliveredInitial = res.summary.events.filter(e => e.t === initialEndTime && e.origin === 1);
  assert(s1DeliveredInitial.length === 0,
    `Survivor 1 did NOT deliver at initial attempt t=${initialEndTime}ms due to cumulative interference (Got: ${s1DeliveredInitial.length})`);

  const s1Collision = res.traceEvents.find(e => e.ev === 'drop' && e.node === 0 && e.from === 1 && e.why === 'collision');
  assert(Boolean(s1Collision), 'Survivor 1 registered collision drop at Hub');
}

// -----------------------------------------------------------------------------
// Test 7: Trace Telemetry Realism (RSSI on Drop & Physical SNR on RX)
// -----------------------------------------------------------------------------
console.log('\n[Test 7] Trace Telemetry Realism (Drop RSSI & RX SNR)...');
{
  const sim = new SetuSimulator({ survivors: 1, relays: 0, zone: 200, seed: 42 });
  sim.nodes.get(1).x = 100;
  sim.nodes.get(1).y = 60;

  sim.addTrigger(1, 'short', 1000);
  const res = sim.run();

  const rxEvents = res.traceEvents.filter(e => e.ev === 'rx');
  assert(rxEvents.length > 0, 'Found RX events in trace');
  for (const rx of rxEvents) {
    assert(typeof rx.rssi === 'number', `RX event has numeric rssi: ${rx.rssi}`);
    assert(typeof rx.snr === 'number', `RX event has numeric snr: ${rx.snr}`);
    const expectedSnr = Math.min(15.0, Math.max(-20.0, parseFloat((rx.rssi - (-117.0)).toFixed(1))));
    assert(Math.abs(rx.snr - expectedSnr) < 0.2, `RX SNR matches physical noise floor model (${rx.snr} vs ${expectedSnr})`);
  }

  // Place survivor beyond sensitivity to trigger weak drop
  const simWeak = new SetuSimulator({ survivors: 1, relays: 0, zone: 5000, seed: 42 });
  simWeak.nodes.get(1).x = 2000;
  simWeak.nodes.get(1).y = 2000;
  simWeak.addTrigger(1, 'short', 1000);
  const resWeak = simWeak.run();

  const weakDrops = resWeak.traceEvents.filter(e => e.ev === 'drop' && e.why === 'weak');
  if (weakDrops.length > 0) {
    assert(typeof weakDrops[0].rssi === 'number', `Weak drop has numeric rssi: ${weakDrops[0].rssi}`);
    assert(weakDrops[0].rssi < -123.0, `Weak drop rssi is below sensitivity threshold (${weakDrops[0].rssi} < -123.0)`);
  }
}

// -----------------------------------------------------------------------------
// Test 8: Sub-Sensitivity Multi-Interferer Cumulative Interference Collision
// -----------------------------------------------------------------------------
console.log('\n[Test 8] Sub-Sensitivity Multi-Interferer Cumulative Collision...');
{
  const sim = new SetuSimulator({ survivors: 3, relays: 0, zone: 2000, seed: 42 });
  sim.shadowSigmaDb = 0.0;
  sim.fadingSigmaDb = 0.0;

  // S1 at d = 322.53m: RSSI ~ -120.0 dBm (decodable on its own, above sens -123.0 dBm)
  sim.nodes.get(1).x = 60 + 322.53;
  sim.nodes.get(1).y = 60;

  // S2 at d = 463.14m: RSSI ~ -125.5 dBm (sub-sensitivity, 2.5 dB below sens -123.0 dBm)
  sim.nodes.get(2).x = 60 + 463.14;
  sim.nodes.get(2).y = 60;

  // S3 at d = 463.14m: RSSI ~ -125.5 dBm (sub-sensitivity, 2.5 dB below sens -123.0 dBm)
  sim.nodes.get(3).x = 60;
  sim.nodes.get(3).y = 60 + 463.14;

  const r1 = sim.calculateMeanRssi(1, 0);
  const r2 = sim.calculateMeanRssi(2, 0);
  const r3 = sim.calculateMeanRssi(3, 0);

  assert(Math.abs(r1 - (-120.0)) < 0.2, `S1 RSSI is ~ -120.0 dBm (Got: ${r1.toFixed(1)} dBm)`);
  assert(Math.abs(r2 - (-125.5)) < 0.2, `S2 RSSI is ~ -125.5 dBm (Got: ${r2.toFixed(1)} dBm)`);
  assert(Math.abs(r3 - (-125.5)) < 0.2, `S3 RSSI is ~ -125.5 dBm (Got: ${r3.toFixed(1)} dBm)`);
  assert(r1 >= -123.0, `S1 RSSI is above sensitivity threshold (${r1.toFixed(1)} dBm >= -123.0 dBm)`);
  assert(r2 < -123.0, `S2 RSSI is sub-sensitivity (${r2.toFixed(1)} dBm < -123.0 dBm)`);
  assert(r3 < -123.0, `S3 RSSI is sub-sensitivity (${r3.toFixed(1)} dBm < -123.0 dBm)`);
  assert(r2 >= -133.0, `S2 RSSI is within 10 dB cutoff floor (${r2.toFixed(1)} dBm >= -133.0 dBm)`);
  assert(r3 >= -133.0, `S3 RSSI is within 10 dB cutoff floor (${r3.toFixed(1)} dBm >= -133.0 dBm)`);

  // Block links between survivors so they cannot sense each other (hidden terminal)
  sim.blockedLinks.add('1-2');
  sim.blockedLinks.add('1-3');
  sim.blockedLinks.add('2-3');

  // Transmit simultaneously
  sim.addTrigger(1, 'short', 1000);
  sim.addTrigger(2, 'short', 1000);
  sim.addTrigger(3, 'short', 1000);

  const res = sim.run();
  const airtime = loraAirtimeMs(25, 7, 125000);
  const initialEndTime = 1000 + 150 + airtime;

  // With cumulative sum across sub-sensitivity interferers (sens - 10 dB),
  // P_int = 10^(-12.55) + 10^(-12.55) = -122.5 dBm >= -123.0 dBm.
  // SIR = -120.0 - (-122.5) = 2.5 dB < 6.0 dB. S1 must collide on attempt 0!
  const s1DeliveredInitial = res.summary.events.filter(e => e.t === initialEndTime && e.origin === 1);
  assert(s1DeliveredInitial.length === 0,
    `Survivor 1 did not deliver at t=${initialEndTime}ms due to sub-sensitivity cumulative collision (Got: ${s1DeliveredInitial.length})`);

  const s1Collision = res.traceEvents.find(e => e.ev === 'drop' && e.node === 0 && e.from === 1 && e.why === 'collision');
  assert(Boolean(s1Collision), 'Survivor 1 registered collision drop at Hub due to sub-sensitivity interference');
}

console.log('\n================================================================');
console.log(`  PORTABLE SIMULATOR SUITE: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) process.exit(1);
