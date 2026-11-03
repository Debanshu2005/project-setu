// Project Setu: Golden Baseline Regression Test Suite
// Verifies byte-identical determinism for all scenarios under the baseline realism profile.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findSimulator } from '../dashboard/sim_finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SCENARIOS_DIR = path.join(ROOT_DIR, 'scenarios');
const GOLDEN_DIR = path.join(ROOT_DIR, 'tests', 'golden');

const simPath = findSimulator(ROOT_DIR);
if (!simPath) {
  console.error('[ FAIL ] Native simulator binary not found in build directory.');
  process.exit(1);
}

function buildScenarioArgs(sc, outPath) {
  const p = sc.params || {};
  const survivors = p.survivors !== undefined ? p.survivors : 20;
  const relays = p.relays !== undefined ? p.relays : 5;
  const zone = p.zone !== undefined ? p.zone : 1200;
  const seed = p.seed !== undefined ? p.seed : 7;
  const duration = p.duration !== undefined ? p.duration : 30000;
  const sf = p.sf !== undefined ? p.sf : 7;
  const loss = p.loss !== undefined ? p.loss : 0.0;
  const pathExp = p.path_exp !== undefined ? p.path_exp : 3.5;
  const allowDisconnected = Boolean(p.allow_disconnected || p.allowDisconnected || sc.allow_disconnected);

  const args = [
    '--profile', 'baseline',
    '--survivors', String(survivors),
    '--relays', String(relays),
    '--zone', String(zone),
    '--seed', String(seed),
    '--duration', String(duration),
    '--sf', String(sf),
    '--loss', String(loss),
    '--path-exp', String(pathExp),
    '--trace', outPath
  ];
  if (allowDisconnected) {
    args.push('--allow-disconnected');
  }

  if (Array.isArray(sc.triggers)) {
    for (const tr of sc.triggers) {
      const id = tr.node !== undefined ? tr.node : tr.id;
      const t = tr.t;
      const kind = String(tr.kind || 'short').replace('_', '-');
      if (id !== undefined && t !== undefined) {
        args.push('--trigger', `${id}:${kind}@${t}`);
      }
    }
  }

  if (Array.isArray(sc.faults)) {
    for (const ft of sc.faults) {
      const t = ft.t;
      const target = String(ft.target || '');
      const kind = String(ft.kind || '');
      if (t !== undefined && target) {
        if (kind === 'kill') args.push('--kill', `${target}@${t}`);
        else if (kind === 'revive') args.push('--revive', `${target}@${t}`);
        else if (kind === 'gps-off') args.push('--gps-off', `${target}@${t}`);
        else if (kind === 'no-dr') args.push('--no-dr', `${target}@${t}`);
        else if (kind === 'block') args.push('--block', `${target}@${t}`);
        else if (kind === 'motion') args.push('--motion', `${target}:${ft.profile || 'moving'}@${t}`);
        else if (kind === 'battery') args.push('--battery', `${target}:${ft.battery !== undefined ? ft.battery : 100}@${t}`);
      }
    }
  }

  return args;
}

async function runSuite() {
  console.log('Project Setu: Golden Baseline Verification Suite');
  console.log(`Using binary: ${simPath}`);

  if (!fs.existsSync(GOLDEN_DIR)) {
    throw new Error(`Golden baselines directory not found at ${GOLDEN_DIR}`);
  }

  const scenarioFiles = fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.json')).sort();
  if (scenarioFiles.length === 0) {
    throw new Error('No scenario files found in scenarios directory');
  }

  console.log(`Checking ${scenarioFiles.length} scenario baseline traces...`);
  let passedCount = 0;
  let failedCount = 0;

  const tempOutPath = path.join(ROOT_DIR, 'tests', 'golden_temp_run.jsonl');

  try {
    for (const file of scenarioFiles) {
      const baseName = path.basename(file, '.json');
      const scPath = path.join(SCENARIOS_DIR, file);
      const goldenPath = path.join(GOLDEN_DIR, `${baseName}.jsonl`);

      if (!fs.existsSync(goldenPath)) {
        console.error(`  [ FAIL ] Missing golden baseline file for scenario: ${baseName}.jsonl`);
        failedCount++;
        continue;
      }

      const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
      const args = buildScenarioArgs(sc, tempOutPath);

      const res = spawnSync(simPath, args, { cwd: ROOT_DIR, encoding: 'utf8' });
      if (res.status !== 0) {
        console.error(`  [ FAIL ] Execution failed for ${file} with exit code ${res.status}: ${res.stderr}`);
        failedCount++;
        continue;
      }

      const actualBytes = fs.readFileSync(tempOutPath);
      const expectedBytes = fs.readFileSync(goldenPath);

      if (Buffer.compare(actualBytes, expectedBytes) === 0) {
        console.log(`  [ PASS ] ${baseName}: Byte-identical to golden baseline (${actualBytes.length} bytes)`);
        passedCount++;
      } else {
        console.error(`  [ FAIL ] ${baseName}: Byte mismatch! Expected ${expectedBytes.length} bytes, got ${actualBytes.length} bytes`);
        // Provide line level diagnostic
        const actualLines = actualBytes.toString('utf8').split('\n');
        const expectedLines = expectedBytes.toString('utf8').split('\n');
        const maxLines = Math.max(actualLines.length, expectedLines.length);
        for (let i = 0; i < maxLines; i++) {
          if (actualLines[i] !== expectedLines[i]) {
            console.error(`    First difference at line ${i + 1}:`);
            console.error(`    Expected: ${expectedLines[i] || '<EOF>'}`);
            console.error(`    Actual:   ${actualLines[i] || '<EOF>'}`);
            break;
          }
        }
        failedCount++;
      }
    }
  } finally {
    if (fs.existsSync(tempOutPath)) {
      fs.unlinkSync(tempOutPath);
    }
  }

  console.log('\nBaseline Verification Summary:');
  console.log(`  Total:  ${scenarioFiles.length}`);
  console.log(`  Passed: ${passedCount}`);
  console.log(`  Failed: ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
