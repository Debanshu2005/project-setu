// Project Setu: Physics Mutation Smoke Test Suite
// Verifies that tests and simulation metrics are sensitive to physical parameter perturbations.
// Per Rule 4: A suite that cannot fail is not a suite.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findSimulator } from '../dashboard/sim_finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const sim = findSimulator(ROOT_DIR);
if (!sim) {
  console.error('[ FAIL ] Native simulator binary not found.');
  process.exit(1);
}

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [ PASS ] ${message}`);
    passCount++;
  } else {
    console.error(`  [ FAIL ] ${message}`);
    failCount++;
  }
}

function runSimulator(args) {
  const res = spawnSync(sim, args, { maxBuffer: 50 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`Simulator failed with code ${res.status}: ${res.stderr.toString()}`);
  }
  const lines = res.stdout.toString().split('\n').map(l => l.trim()).filter(Boolean);
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
      } catch (_) {}
    }
  }

  let summary = null;
  if (summaryLines.length > 0) {
    try {
      summary = JSON.parse(summaryLines.join('\n'));
    } catch (_) {}
  }
  return { summary, events };
}

console.log('================================================================');
console.log('  Project Setu: Physics Mutation Smoke Suite (Rule 4 Check)');
console.log('================================================================\n');

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Mutation Test 1: Path Loss Exponent Perturbation
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
console.log('[Mutation 1/4] Perturbing Path Loss Exponent (3.0 vs 4.8)...');
try {
  const nominalRun = runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1000',
    '--seed', '42',
    '--duration', '20000',
    '--path-exp', '3.0',
    '--profile', 'field',
    '--allow-disconnected',
    '--trigger', '1:short@1000',
    '--trigger', '2:long@1200',
    '--trigger', '3:short@1400',
    '--trace', '-'
  ]);

  const perturbedRun = runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1000',
    '--seed', '42',
    '--duration', '20000',
    '--path-exp', '4.8',
    '--profile', 'field',
    '--allow-disconnected',
    '--trigger', '1:short@1000',
    '--trigger', '2:long@1200',
    '--trigger', '3:short@1400',
    '--trace', '-'
  ]);

  const nominalWeakDrops = nominalRun.events.filter(e => e.ev === 'drop' && e.why === 'weak').length;
  const perturbedWeakDrops = perturbedRun.events.filter(e => e.ev === 'drop' && e.why === 'weak').length;
  const nominalAlerts = nominalRun.events.filter(e => e.ev === 'alert').length;
  const perturbedAlerts = perturbedRun.events.filter(e => e.ev === 'alert').length;

  assert(perturbedWeakDrops > nominalWeakDrops,
    `Perturbing path loss exponent increases weak signal drops (Nominal: ${nominalWeakDrops}, Perturbed: ${perturbedWeakDrops})`);
  assert(nominalAlerts >= perturbedAlerts,
    `Higher path loss degrades or bounds alert delivery (Nominal: ${nominalAlerts}, Perturbed: ${perturbedAlerts})`);
} catch (err) {
  console.error('  [ FAIL ] Mutation 1 error:', err.message);
  failCount++;
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Mutation Test 2: LoRa Capture Threshold Perturbation
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
console.log('\n[Mutation 2/4] Perturbing LoRa Co-Channel Capture Threshold (1.0 dB vs 25.0 dB)...');
try {
  const scFile = path.join(ROOT_DIR, 'scenarios', 'congested_disaster.json');
  const sc = JSON.parse(fs.readFileSync(scFile, 'utf8'));
  const p = sc.params;

  function buildCongestedArgs(capDb) {
    const args = [
      '--profile', 'field',
      '--capture', String(capDb),
      '--survivors', String(p.survivors),
      '--relays', String(p.relays),
      '--zone', String(p.zone),
      '--seed', String(p.seed),
      '--duration', String(p.duration),
      '--sf', String(p.sf),
      '--loss', String(p.loss || 0),
      '--path-exp', String(p.path_exp || 3.0),
      '--allow-disconnected',
      '--trace', '-'
    ];
    if (sc.triggers) {
      for (const tr of sc.triggers) {
        args.push('--trigger', `${tr.node}:${tr.kind.replace('_', '-')}@${tr.t}`);
      }
    }
    return args;
  }

  const runCap1 = runSimulator(buildCongestedArgs(1.0));
  const runCap25 = runSimulator(buildCongestedArgs(25.0));

  const coll1 = runCap1.events.filter(e => e.ev === 'drop' && e.why === 'collision').length;
  const coll25 = runCap25.events.filter(e => e.ev === 'drop' && e.why === 'collision').length;
  const alerts1 = runCap1.events.filter(e => e.ev === 'alert').length;
  const alerts25 = runCap25.events.filter(e => e.ev === 'alert').length;

  assert(coll1 !== coll25,
    `Capture threshold perturbation alters collision drop dynamics (Cap 1.0 dB: ${coll1}, Cap 25.0 dB: ${coll25})`);
  assert(alerts1 !== alerts25,
    `Capture threshold perturbation alters delivered alert count (Cap 1.0 dB: ${alerts1}, Cap 25.0 dB: ${alerts25})`);
} catch (err) {
  console.error('  [ FAIL ] Mutation 2 error:', err.message);
  failCount++;
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Mutation Test 3: Receiver and DSP Energy Accounting Perturbation
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
console.log('\n[Mutation 3/4] Perturbing Receiver/DSP Energy (Always-on Wake Word vs On-Demand)...');
try {
  const nominalRun = runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1000',
    '--seed', '7',
    '--duration', '30000',
    '--profile', 'field',
    '--allow-disconnected',
    '--trace', '-'
  ]);

  const onDemandRun = runSimulator([
    '--survivors', '20',
    '--relays', '5',
    '--zone', '1000',
    '--seed', '7',
    '--duration', '30000',
    '--profile', 'field',
    '--no-wake-word',
    '--allow-disconnected',
    '--trace', '-'
  ]);

  const nominalMah = nominalRun.summary && nominalRun.summary.totals ? nominalRun.summary.totals.total_energy_mah : null;
  const onDemandMah = onDemandRun.summary && onDemandRun.summary.totals ? onDemandRun.summary.totals.total_energy_mah : null;

  assert(typeof nominalMah === 'number',
    `Nominal run reports total consumed energy (${nominalMah} mAh)`);
  assert(typeof onDemandMah === 'number',
    `On-demand run reports total consumed energy (${onDemandMah} mAh)`);
  assert(nominalMah > 3.0 * onDemandMah,
    `Always-on acoustic DSP consumes significantly more energy than on-demand mode (${nominalMah} vs ${onDemandMah} mAh)`);
} catch (err) {
  console.error('  [ FAIL ] Mutation 3 error:', err.message);
  failCount++;
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Mutation Test 4: Physical Random Loss Channel Perturbation
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
console.log('\n[Mutation 4/4] Perturbing Random Loss Channel (0.0 vs 0.35 Loss Probability)...');
try {
  const cleanRun = runSimulator([
    '--survivors', '15',
    '--relays', '3',
    '--zone', '800',
    '--seed', '19',
    '--duration', '20000',
    '--loss', '0.0',
    '--profile', 'field',
    '--allow-disconnected',
    '--trigger', '1:short@1000',
    '--trigger', '2:short@2000',
    '--trigger', '3:short@3000',
    '--trace', '-'
  ]);

  const lossyRun = runSimulator([
    '--survivors', '15',
    '--relays', '3',
    '--zone', '800',
    '--seed', '19',
    '--duration', '20000',
    '--loss', '0.35',
    '--profile', 'field',
    '--allow-disconnected',
    '--trigger', '1:short@1000',
    '--trigger', '2:short@2000',
    '--trigger', '3:short@3000',
    '--trace', '-'
  ]);

  const cleanLossDrops = cleanRun.events.filter(e => e.ev === 'drop' && e.why === 'loss').length;
  const lossyLossDrops = lossyRun.events.filter(e => e.ev === 'drop' && e.why === 'loss').length;

  assert(cleanLossDrops === 0, `Clean channel has zero random loss drops (Got: ${cleanLossDrops})`);
  assert(lossyLossDrops > 0, `Perturbed lossy channel generates random packet drops (Got: ${lossyLossDrops})`);
} catch (err) {
  console.error('  [ FAIL ] Mutation 4 error:', err.message);
  failCount++;
}

console.log('\n================================================================');
console.log(`  MUTATION SMOKE SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
}
