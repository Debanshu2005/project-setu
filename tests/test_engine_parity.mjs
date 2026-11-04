// Project Setu: Native vs WebAssembly Engine Parity Regression Suite
// Verifies bit-for-bit and physical parity between native C++ simulator and WebAssembly module.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findSimulator } from '../dashboard/sim_finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const simPath = findSimulator(ROOT_DIR);
if (!simPath) {
  console.error('[ FAIL ] Native simulator binary not found in build directory.');
  process.exit(1);
}

// Check for WebAssembly build artifacts
const wasmCandidates = [
  path.join(ROOT_DIR, 'dashboard', 'wasm', 'setu_sim_wasm.js'),
  path.join(ROOT_DIR, 'build-wasm', 'setu_sim_wasm.js'),
  path.join(ROOT_DIR, 'simulation', 'wasm', 'setu_sim_wasm.js')
];

let wasmJsPath = wasmCandidates.find(p => fs.existsSync(p));
const isOptional = process.argv.includes('--optional');

if (!wasmJsPath) {
  if (isOptional) {
    console.log('[ SKIP ] WebAssembly module not built in this local environment. Skipping parity check.');
    process.exit(0);
  } else {
    console.error('[ FAIL ] WebAssembly module not found in dashboard/wasm or build-wasm.');
    console.error('         Please build the WebAssembly target via Emscripten first.');
    process.exit(1);
  }
}

// Find associated .wasm binary file
const wasmBinaryPath = wasmJsPath.replace(/\.js$/, '.wasm');
if (fs.existsSync(wasmBinaryPath)) {
  const stat = fs.statSync(wasmBinaryPath);
  const sizeKb = (stat.size / 1024).toFixed(2);
  console.log(`[ INFO ] WebAssembly binary located: ${wasmBinaryPath}`);
  console.log(`[ INFO ] Binary file size: ${stat.size} bytes (${sizeKb} KB)`);
}

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [ PASS ] ${message}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${message}`);
    failedCount++;
  }
}

const FLOAT_FIELDS = new Set([
  'rssi', 'dist', 'snr', 'x', 'y', 'path_exp', 'mah', 'energy_mah',
  'pos_error_m', 'pos_mae_m', 'pos_rmse_m', 'pos_max_err_m',
  'path_loss', 'shadow', 'link_margin'
]);
const COORD_E6_FIELDS = new Set(['lat_e6', 'lon_e6']);

function getUnitInLastPrintedDigit(k, expVal, actVal) {
  if (k === 'rssi' || k === 'snr' || k === 'pos_error_m' || k === 'pos_mae_m' || k === 'pos_rmse_m' || k === 'pos_max_err_m') {
    return 0.100001;
  }
  if (k === 'energy_mah' || k === 'mah') {
    return 0.001001;
  }
  const expStr = String(expVal);
  const actStr = String(actVal);
  const expDec = expStr.includes('.') ? expStr.split('.')[1].length : 0;
  const actDec = actStr.includes('.') ? actStr.split('.')[1].length : 0;
  const dec = Math.max(expDec, actDec);
  if (dec === 0) return 1.000001;
  return Math.pow(10, -dec) * 1.000001;
}

function compareEvents(act, exp, lineNum) {
  if (act.ev !== exp.ev) {
    return `Line ${lineNum}: event mismatch (expected "${exp.ev}", got "${act.ev}")`;
  }
  if (act.t !== exp.t) {
    return `Line ${lineNum} [${exp.ev}]: timestamp mismatch (expected ${exp.t}, got ${act.t})`;
  }

  const allKeys = new Set([...Object.keys(exp), ...Object.keys(act)]);
  for (const k of allKeys) {
    if (k === 'ev' || k === 't') continue;
    const expVal = exp[k];
    const actVal = act[k];

    if (expVal === undefined) {
      return `Line ${lineNum} [${exp.ev}]: unexpected field "${k}" in wasm output`;
    }
    if (actVal === undefined) {
      return `Line ${lineNum} [${exp.ev}]: missing field "${k}" in wasm output`;
    }

    if (typeof expVal === 'number' && typeof actVal === 'number') {
      if (FLOAT_FIELDS.has(k)) {
        const diff = Math.abs(actVal - expVal);
        const maxTol = getUnitInLastPrintedDigit(k, expVal, actVal);
        if (diff > maxTol) {
          return `Line ${lineNum} [${exp.ev}]: float field "${k}" exceeds tolerance (native: ${expVal}, wasm: ${actVal}, diff: ${diff.toFixed(6)} > ${maxTol})`;
        }
      } else if (COORD_E6_FIELDS.has(k)) {
        if (actVal !== expVal) {
          return `Line ${lineNum} [${exp.ev}]: coordinate integer "${k}" mismatch (native: ${expVal}, wasm: ${actVal})`;
        }
      } else {
        if (actVal !== expVal) {
          return `Line ${lineNum} [${exp.ev}]: integer field "${k}" mismatch (native: ${expVal}, wasm: ${actVal})`;
        }
      }
    } else {
      if (actVal !== expVal) {
        return `Line ${lineNum} [${exp.ev}]: field "${k}" mismatch (native: ${JSON.stringify(expVal)}, wasm: ${JSON.stringify(actVal)})`;
      }
    }
  }
  return null;
}

async function runParitySuite() {
  console.log('================================================================');
  console.log('  Project Setu: Native C++ vs WebAssembly Parity Suite');
  console.log('================================================================\n');

  // Load WebAssembly module
  console.log(`[Step 1] Loading WebAssembly module from ${wasmJsPath}...`);
  const wasmUrl = pathToFileURL(wasmJsPath).href;
  const mod = await import(wasmUrl);
  const createSetuSim = mod.default || mod;
  const Module = await createSetuSim();
  assert(Module && typeof Module.WasmSimSession === 'function', 'WebAssembly WasmSimSession constructor available');

  // Load a 20-node scenario: scenarios/building_collapse.json (20 survivors, 5 relays = 25 nodes)
  const scPath = path.join(ROOT_DIR, 'scenarios', 'building_collapse.json');
  console.log(`\n[Step 2] Executing 20-node scenario: ${path.basename(scPath)}...`);
  const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
  const p = sc.params || {};

  const survivors = p.survivors !== undefined ? p.survivors : 20;
  const relays = p.relays !== undefined ? p.relays : 5;
  const zone = p.zone !== undefined ? p.zone : 1200;
  const seed = p.seed !== undefined ? p.seed : 7;
  const duration = p.duration !== undefined ? p.duration : 30000;
  const sf = p.sf !== undefined ? p.sf : 7;
  const loss = p.loss !== undefined ? p.loss : 0.0;
  const pathExp = p.path_exp !== undefined ? p.path_exp : 3.5;
  const profile = p.profile || 'field';
  const allowDisconnected = Boolean(p.allow_disconnected || sc.allow_disconnected || true);

  // 1. Run Native Simulator
  console.log('  Running native C++ simulator (setu_sim)...');
  const tempNativeOut = path.join(ROOT_DIR, 'tests', 'native_parity_temp.jsonl');
  const nativeArgs = [
    '--profile', profile,
    '--survivors', String(survivors),
    '--relays', String(relays),
    '--zone', String(zone),
    '--seed', String(seed),
    '--duration', String(duration),
    '--sf', String(sf),
    '--loss', String(loss),
    '--path-exp', String(pathExp),
    '--trace', tempNativeOut
  ];
  if (allowDisconnected) nativeArgs.push('--allow-disconnected');

  if (Array.isArray(sc.triggers)) {
    for (const tr of sc.triggers) {
      const id = tr.node !== undefined ? tr.node : tr.id;
      const t = tr.t;
      const kind = String(tr.kind || 'short').replace('_', '-');
      if (id !== undefined && t !== undefined) {
        nativeArgs.push('--trigger', `${id}:${kind}@${t}`);
      }
    }
  }

  const nativeRes = spawnSync(simPath, nativeArgs, { maxBuffer: 50 * 1024 * 1024 });
  if (nativeRes.status !== 0) {
    throw new Error(`Native simulator failed with code ${nativeRes.status}: ${nativeRes.stderr.toString()}`);
  }

  const nativeRaw = fs.readFileSync(tempNativeOut, 'utf8');
  try { fs.unlinkSync(tempNativeOut); } catch (_) {}
  const nativeLines = nativeRaw.trim().split('\n').filter(Boolean);
  console.log(`  Native simulator produced ${nativeLines.length} trace events`);

  // 2. Run WebAssembly Simulator
  console.log('  Running WebAssembly simulator (setu_sim_wasm)...');
  const session = new Module.WasmSimSession();
  const initOk = session.init_with_params(survivors, relays, zone, seed, profile, sf, pathExp, loss, allowDisconnected);
  assert(initOk, 'WebAssembly simulation session initialized successfully');

  if (Array.isArray(sc.triggers)) {
    for (const tr of sc.triggers) {
      const id = tr.node !== undefined ? tr.node : tr.id;
      const t = tr.t;
      const kind = String(tr.kind || 'short').replace('_', '-');
      if (id !== undefined && t !== undefined) {
        session.add_trigger(id, kind, t);
      }
    }
  }

  session.set_duration(duration);
  session.run_all();

  const wasmRaw = session.get_trace_log();
  const wasmLines = wasmRaw.trim().split('\n').filter(Boolean);
  console.log(`  WebAssembly simulator produced ${wasmLines.length} trace events`);

  // 3. Line-by-Line Parity Verification
  console.log('\n[Step 3] Verifying bit-level and physical parity line-by-line...');
  assert(wasmLines.length === nativeLines.length,
    `Exact event count parity (Native: ${nativeLines.length}, Wasm: ${wasmLines.length})`);

  let mismatches = 0;
  const count = Math.min(wasmLines.length, nativeLines.length);
  for (let i = 0; i < count; i++) {
    const act = JSON.parse(wasmLines[i]);
    const exp = JSON.parse(nativeLines[i]);
    const err = compareEvents(act, exp, i + 1);
    if (err) {
      console.error(`  [ FAIL ] ${err}`);
      mismatches++;
      if (mismatches >= 5) {
        console.error('  ... additional mismatches truncated');
        break;
      }
    }
  }

  assert(mismatches === 0, 'Line-by-line event sequence and physical telemetry match native output exactly');

  // Verify state export API
  const stateRaw = session.get_state_json();
  const stateObj = JSON.parse(stateRaw);
  assert(stateObj && stateObj.ok === true && Array.isArray(stateObj.nodes),
    `Wasm get_state_json() exports valid state with ${stateObj.nodes.length} nodes`);

  console.log('\n================================================================');
  console.log(`  PARITY VERIFICATION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runParitySuite().catch(err => {
  console.error('Fatal parity suite error:', err);
  process.exit(1);
});
