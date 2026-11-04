// Project Setu: Field Profile Energy Accounting Regression Test
// Validates that the Field profile charges continuous LoRa RX via idle draw,
// avoiding duplicate legacy percentage rx charges.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSimulator } from '../dashboard/sim_finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

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

function runSim(extraArgs = []) {
  const simBin = findSimulator(ROOT_DIR);
  if (!simBin) {
    throw new Error('Simulator binary (setu_sim) not found');
  }

  const baseArgs = [
    '--survivors', '27',
    '--relays', '5',
    '--zone', '1000',
    '--seed', '42',
    '--duration', '35000',
    '--profile', 'field',
    '--allow-disconnected',
    '--trigger', '1:short@1000',
    '--trigger', '2:short@2000',
    '--trigger', '3:short@3000',
    '--trace', '-'
  ];

  const args = [...baseArgs, ...extraArgs];
  const res = spawnSync(simBin, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });

  if (res.status !== 0 || res.error) {
    const err = res.error ? res.error.message : (res.stderr || res.stdout);
    throw new Error(`setu_sim failed with code ${res.status}: ${err}`);
  }

  const lines = (res.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
  const events = [];
  const summaryLines = [];
  let inSummary = false;

  for (const line of lines) {
    if (line === '{' || inSummary) {
      inSummary = true;
      summaryLines.push(line);
    } else {
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }

  const summary = JSON.parse(summaryLines.join('\n'));
  return { summary, events };
}

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu: Field Profile Battery Energy Regression Suite');
  console.log('================================================================\n');

  // Test 1: Field profile with default continuous voice DSP (76.1 mA idle)
  console.log('[Test 1/2] Field profile with default wake word DSP (76.1 mA idle)...');
  const res1 = runSim();
  const totals1 = res1.summary.totals;
  const nodes1 = res1.summary.nodes; // 33 nodes

  assert(totals1.deliveries > 500, `High packet activity achieved (${totals1.deliveries} deliveries)`);
  assert(totals1.tx > 100, `Multi-hop forwarding executed (${totals1.tx} transmissions)`);

  // Analytic expectation:
  // 33 nodes * 76.1 mA * (34s / 3600s) = 23.718 mAh idle
  // Transmit airtime energy: 141 tx * (40.4 mA incremental) * (0.062s / 3600s) ~ 0.098 mAh
  // Total expected ~ 23.82 mAh.
  const idleHours = 34.0 / 3600.0;
  const expectedIdleMah1 = nodes1 * 76.1 * idleHours;
  const expectedTotalMah1 = expectedIdleMah1 + (totals1.tx * 40.4 * (0.062 / 3600.0));

  const simTotalMah1 = totals1.total_energy_mah;
  const relDiff1 = Math.abs(simTotalMah1 - expectedTotalMah1) / expectedTotalMah1;

  console.log(`  Analytic expected: ${expectedTotalMah1.toFixed(3)} mAh | Simulated: ${simTotalMah1.toFixed(3)} mAh | Diff: ${(relDiff1 * 100).toFixed(2)}%`);
  assert(relDiff1 <= 0.10, `Simulated total energy matches analytic expectation within 10 percent (Diff: ${(relDiff1 * 100).toFixed(2)}%)`);
  assert(simTotalMah1 < 50.0, `Energy is not inflated by legacy 1 mAh per rx bug (Got: ${simTotalMah1.toFixed(3)} mAh, expected < 50 mAh, buggy was ~952 mAh)`);

  // Verify per-node trace energy_mah values
  const rxEvents = res1.events.filter(e => e.ev === 'rx' && typeof e.energy_mah === 'number');
  assert(rxEvents.length > 0, `Trace contains valid rx events (${rxEvents.length} events)`);
  const maxNodeMah = Math.max(...rxEvents.map(e => e.energy_mah));
  assert(maxNodeMah < 2.0, `Per-node consumed energy in trace is physically bounded (Max node energy: ${maxNodeMah.toFixed(3)} mAh)`);

  // Test 2: Field profile without continuous voice DSP (11.1 mA idle)
  console.log('\n[Test 2/2] Field profile with on-demand DSP (--no-wake-word, 11.1 mA idle)...');
  const res2 = runSim(['--no-wake-word']);
  const totals2 = res2.summary.totals;
  const nodes2 = res2.summary.nodes;

  const expectedIdleMah2 = nodes2 * 11.1 * idleHours;
  const expectedTotalMah2 = expectedIdleMah2 + (totals2.tx * 40.4 * (0.062 / 3600.0));
  const simTotalMah2 = totals2.total_energy_mah;
  const relDiff2 = Math.abs(simTotalMah2 - expectedTotalMah2) / expectedTotalMah2;

  console.log(`  Analytic expected: ${expectedTotalMah2.toFixed(3)} mAh | Simulated: ${simTotalMah2.toFixed(3)} mAh | Diff: ${(relDiff2 * 100).toFixed(2)}%`);
  assert(relDiff2 <= 0.10, `On-demand DSP energy matches analytic expectation within 10 percent (Diff: ${(relDiff2 * 100).toFixed(2)}%)`);
  assert(simTotalMah2 < 10.0, `On-demand DSP energy is bounded (Got: ${simTotalMah2.toFixed(3)} mAh, expected < 10 mAh)`);

  console.log('\n================================================================');
  console.log(`  ALL ${passedCount} FIELD PROFILE ENERGY TESTS PASSED!`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
