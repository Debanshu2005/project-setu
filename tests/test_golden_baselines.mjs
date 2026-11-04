// Project Setu: Platform-Tolerant Golden Baseline Regression Test Suite
// Verifies deterministic simulation behavior and exact baseline traces across platforms.
// Allows floating-point rounding tolerance for cross-compiler consistency (MSVC vs GCC/Clang).

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

const NUMERIC_EPSILON = 0.05;

const simPath = findSimulator(ROOT_DIR);
if (!simPath) {
  console.error('[ FAIL ] Native simulator binary not found in build directory.');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const platformSubdir = isWin ? 'windows-msvc' : 'linux-gcc';
const platformGoldenDir = path.join(GOLDEN_DIR, platformSubdir);
const portableGoldenDir = path.join(GOLDEN_DIR, 'portable');

const isRecordMode = process.argv.includes('--record');
const isRecordPortable = process.argv.includes('--record-portable');

function buildScenarioArgs(sc, outPath, profile = 'baseline') {
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
    '--profile', profile,
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

const FLOAT_FIELDS = new Set([
  'rssi', 'dist', 'snr', 'x', 'y', 'path_exp', 'mah', 'energy_mah',
  'pos_error_m', 'pos_mae_m', 'pos_rmse_m', 'pos_max_err_m',
  'path_loss', 'shadow', 'link_margin'
]);
const COORD_E6_FIELDS = new Set(['lat_e6', 'lon_e6']);

function compareEvents(actual, expected, lineNum) {
  if (actual.ev !== expected.ev) {
    return `Line ${lineNum}: event mismatch (expected "${expected.ev}", got "${actual.ev}")`;
  }
  if (actual.t !== expected.t) {
    return `Line ${lineNum} [${expected.ev}]: timestamp mismatch (expected ${expected.t}, got ${actual.t})`;
  }

  const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of allKeys) {
    if (k === 'ev' || k === 't') continue;
    const expVal = expected[k];
    const actVal = actual[k];

    if (expVal === undefined) {
      return `Line ${lineNum} [${expected.ev}]: unexpected field "${k}" in actual output`;
    }
    if (actVal === undefined) {
      return `Line ${lineNum} [${expected.ev}]: missing field "${k}" in actual output`;
    }

    if (typeof expVal === 'number' && typeof actVal === 'number') {
      if (FLOAT_FIELDS.has(k)) {
        const diff = Math.abs(actVal - expVal);
        if (diff > NUMERIC_EPSILON) {
          return `Line ${lineNum} [${expected.ev}]: field "${k}" exceeds epsilon (expected ${expVal}, got ${actVal}, diff ${diff.toFixed(4)} > ${NUMERIC_EPSILON})`;
        }
      } else if (COORD_E6_FIELDS.has(k)) {
        const diff = Math.abs(actVal - expVal);
        if (diff > 500) {
          return `Line ${lineNum} [${expected.ev}]: coordinate "${k}" exceeds tolerance (expected ${expVal}, got ${actVal}, diff ${diff})`;
        }
      } else if (k === 'seed') {
        continue;
      } else {
        if (actVal !== expVal) {
          return `Line ${lineNum} [${expected.ev}]: integer field "${k}" mismatch (expected ${expVal}, got ${actVal})`;
        }
      }
    } else {
      if (actVal !== expVal) {
        return `Line ${lineNum} [${expected.ev}]: field "${k}" mismatch (expected ${JSON.stringify(expVal)}, got ${JSON.stringify(actVal)})`;
      }
    }
  }
  return null;
}

async function runSuite() {
  console.log('Project Setu: Platform-Tolerant Golden Baseline Verification Suite');
  console.log(`Using binary: ${simPath}`);
  console.log(`Target platform golden directory: ${platformSubdir}`);
  console.log(`Tolerance epsilon for floating point values: ${NUMERIC_EPSILON}`);

  if (!fs.existsSync(GOLDEN_DIR)) {
    throw new Error(`Golden baselines directory not found at ${GOLDEN_DIR}`);
  }

  if (!fs.existsSync(platformGoldenDir)) {
    fs.mkdirSync(platformGoldenDir, { recursive: true });
  }

  const scenarioFiles = fs.readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.json') && (
      fs.existsSync(path.join(platformGoldenDir, `${path.basename(f, '.json')}.jsonl`)) ||
      fs.existsSync(path.join(GOLDEN_DIR, `${path.basename(f, '.json')}.jsonl`))
    ))
    .sort();

  if (scenarioFiles.length === 0) {
    throw new Error('No scenario files found in scenarios directory');
  }

  if (isRecordPortable) {
    console.log('Recording portable field goldens...');
    if (!fs.existsSync(portableGoldenDir)) {
      fs.mkdirSync(portableGoldenDir, { recursive: true });
    }
    const portableScenarios = ['basic_network.json', 'single_sos.json', 'ack_loss.json'];
    for (const file of portableScenarios) {
      const baseName = path.basename(file, '.json');
      const scPath = path.join(SCENARIOS_DIR, file);
      const targetGoldenPath = path.join(portableGoldenDir, `${baseName}_field.jsonl`);
      const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
      const args = buildScenarioArgs(sc, targetGoldenPath, 'field');
      const res = spawnSync(simPath, args, { cwd: ROOT_DIR, encoding: 'utf8' });
      if (res.status !== 0) {
        console.error(`  [ FAIL ] Portable recording failed for ${file}: ${res.stderr}`);
        process.exit(1);
      }
      console.log(`  [ RECORDED PORTABLE ] ${baseName}_field.jsonl (${fs.statSync(targetGoldenPath).size} bytes)`);
    }
    console.log('Portable recording complete.');
    if (!isRecordMode) return;
  }

  if (isRecordMode) {
    console.log(`Recording golden traces for platform ${platformSubdir}...`);
    for (const file of scenarioFiles) {
      const baseName = path.basename(file, '.json');
      const scPath = path.join(SCENARIOS_DIR, file);
      const targetGoldenPath = path.join(platformGoldenDir, `${baseName}.jsonl`);
      const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
      const args = buildScenarioArgs(sc, targetGoldenPath, 'baseline');
      const res = spawnSync(simPath, args, { cwd: ROOT_DIR, encoding: 'utf8' });
      if (res.status !== 0) {
        console.error(`  [ FAIL ] Recording failed for ${file}: ${res.stderr}`);
        process.exit(1);
      }
      console.log(`  [ RECORDED ] ${baseName}.jsonl (${fs.statSync(targetGoldenPath).size} bytes)`);
    }
    console.log('Recording complete.');
    return;
  }

  console.log(`Checking ${scenarioFiles.length} scenario baseline traces (${platformSubdir})...`);
  let passedCount = 0;
  let failedCount = 0;

  const tempOutPath = path.join(ROOT_DIR, 'tests', 'golden_temp_run.jsonl');

  try {
    for (const file of scenarioFiles) {
      const baseName = path.basename(file, '.json');
      const scPath = path.join(SCENARIOS_DIR, file);
      let goldenPath = path.join(platformGoldenDir, `${baseName}.jsonl`);
      if (!fs.existsSync(goldenPath)) {
        goldenPath = path.join(GOLDEN_DIR, `${baseName}.jsonl`);
      }

      if (!fs.existsSync(goldenPath)) {
        console.error(`  [ FAIL ] Missing golden baseline file for scenario: ${baseName}.jsonl`);
        failedCount++;
        continue;
      }

      const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
      const args = buildScenarioArgs(sc, tempOutPath, 'baseline');

      const res = spawnSync(simPath, args, { cwd: ROOT_DIR, encoding: 'utf8' });
      if (res.status !== 0) {
        console.error(`  [ FAIL ] Execution failed for ${file} with exit code ${res.status}: ${res.stderr}`);
        failedCount++;
        continue;
      }

      const actualRaw = fs.readFileSync(tempOutPath, 'utf8');
      const expectedRaw = fs.readFileSync(goldenPath, 'utf8');

      if (actualRaw === expectedRaw) {
        console.log(`  [ PASS ] ${baseName}: Exact byte match (${actualRaw.length} chars)`);
        passedCount++;
        continue;
      }

      const actualLines = actualRaw.split(/\r?\n/).filter(line => line.trim().length > 0);
      const expectedLines = expectedRaw.split(/\r?\n/).filter(line => line.trim().length > 0);

      if (actualLines.length === expectedLines.length) {
        let scenarioFailed = false;
        let mismatchReason = null;
        for (let i = 0; i < expectedLines.length; i++) {
          if (actualLines[i] === expectedLines[i]) continue;

          let actObj = null;
          let expObj = null;
          try {
            actObj = JSON.parse(actualLines[i]);
            expObj = JSON.parse(expectedLines[i]);
          } catch (e) {
            mismatchReason = `Malformed JSON on line ${i + 1}: ${e.message}`;
            scenarioFailed = true;
            break;
          }

          const mismatch = compareEvents(actObj, expObj, i + 1);
          if (mismatch) {
            mismatchReason = mismatch;
            scenarioFailed = true;
            break;
          }
        }

        if (!scenarioFailed) {
          console.log(`  [ PASS ] ${baseName}: Sequence and values verified within epsilon tolerance (${actualLines.length} events)`);
          passedCount++;
          continue;
        } else {
          console.error(`  [ FAIL ] ${baseName}: ${mismatchReason}`);
          failedCount++;
          continue;
        }
      }

      // Check if this platform run is self deterministic
      const res2 = spawnSync(simPath, args, { cwd: ROOT_DIR, encoding: 'utf8' });
      const actualRaw2 = fs.existsSync(tempOutPath) ? fs.readFileSync(tempOutPath, 'utf8') : '';
      const isLocallyDeterministic = (res2.status === 0 && actualRaw.trim() === actualRaw2.trim());

      console.error(`  [ FAIL ] ${baseName}: Event count mismatch (expected ${expectedLines.length} events, got ${actualLines.length} events; locally deterministic: ${isLocallyDeterministic})`);
      failedCount++;
    }

    // Next: verify portable field profile goldens if portable directory exists
    if (fs.existsSync(portableGoldenDir)) {
      const portableFiles = fs.readdirSync(portableGoldenDir).filter(f => f.endsWith('.jsonl')).sort();
      if (portableFiles.length > 0) {
        console.log(`\nChecking ${portableFiles.length} portable field profile goldens...`);
        for (const pFile of portableFiles) {
          const scName = pFile.replace('_field.jsonl', '.json');
          const scPath = path.join(SCENARIOS_DIR, scName);
          const goldenPath = path.join(portableGoldenDir, pFile);
          if (!fs.existsSync(scPath)) continue;

          const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
          const args = buildScenarioArgs(sc, tempOutPath, 'field');
          const res = spawnSync(simPath, args, { cwd: ROOT_DIR, encoding: 'utf8' });
          if (res.status !== 0) {
            console.error(`  [ FAIL ] Portable run failed for ${pFile}: ${res.stderr}`);
            failedCount++;
            continue;
          }

          const actualRaw = fs.readFileSync(tempOutPath, 'utf8');
          const expectedRaw = fs.readFileSync(goldenPath, 'utf8');

          if (actualRaw === expectedRaw) {
            console.log(`  [ PASS ] ${pFile}: Exact portable match (${actualRaw.length} chars)`);
            passedCount++;
            continue;
          }

          const actualLines = actualRaw.split(/\r?\n/).filter(line => line.trim().length > 0);
          const expectedLines = expectedRaw.split(/\r?\n/).filter(line => line.trim().length > 0);

          if (actualLines.length === expectedLines.length) {
            let pFailed = false;
            let pReason = null;
            for (let i = 0; i < expectedLines.length; i++) {
              if (actualLines[i] === expectedLines[i]) continue;
              const actObj = JSON.parse(actualLines[i]);
              const expObj = JSON.parse(expectedLines[i]);
              const mismatch = compareEvents(actObj, expObj, i + 1);
              if (mismatch) {
                pReason = mismatch;
                pFailed = true;
                break;
              }
            }
            if (!pFailed) {
              console.log(`  [ PASS ] ${pFile}: Sequence and values verified within epsilon (${actualLines.length} events)`);
              passedCount++;
            } else {
              console.error(`  [ FAIL ] ${pFile}: ${pReason}`);
              failedCount++;
            }
          } else {
            console.error(`  [ FAIL ] ${pFile}: Event count mismatch (expected ${expectedLines.length}, got ${actualLines.length})`);
            failedCount++;
          }
        }
      }
    }
  } finally {
    if (fs.existsSync(tempOutPath)) {
      fs.unlinkSync(tempOutPath);
    }
  }

  console.log('\nBaseline Verification Summary:');
  console.log(`  Total Passed: ${passedCount}`);
  console.log(`  Total Failed: ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
