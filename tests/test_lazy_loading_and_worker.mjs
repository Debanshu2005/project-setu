// Project Setu - Automated Lazy Loading & Web Worker Verification Suite
// Verifies that heavy components (3D twin, Three.js, analytics, charts, waterfall, narrator)
// load on demand and do not block initial landing, and that trace parsing is offloaded.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SetuApi } from '../dashboard/src/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function runTests() {
  console.log('Starting Lazy Loading and Worker Verification Suite...');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Inspect app.js top level imports
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'dashboard', 'src', 'app.js'), 'utf8');
  const importLines = appJs.split('\n').filter(l => l.startsWith('import '));

  const heavyModules = [
    'analytics_workspace.js',
    'setu_twin.js',
    'wristband_twin.js',
    'loss_waterfall.js',
    'scientific_charts.js',
    'narrator.js'
  ];

  for (const mod of heavyModules) {
    const hasStatic = importLines.some(l => l.includes(mod));
    assert(!hasStatic, `app.js does not statically import ${mod} at startup`);
  }

  // 2. Verify dynamic import methods exist in app.js
  assert(appJs.includes('async ensureAnalyticsWorkspace()'), 'app.js has async ensureAnalyticsWorkspace');
  assert(appJs.includes('async ensureTwin3D()'), 'app.js has async ensureTwin3D');
  assert(appJs.includes('async ensureWristbandTwin()'), 'app.js has async ensureWristbandTwin');
  assert(appJs.includes('async ensureLossWaterfall()'), 'app.js has async ensureLossWaterfall');
  assert(appJs.includes('async getNarrator()'), 'app.js has async getNarrator');

  // 3. Verify trace_worker.js exists and has message handler
  const workerPath = path.join(ROOT_DIR, 'dashboard', 'src', 'trace_worker.js');
  assert(fs.existsSync(workerPath), 'trace_worker.js exists');
  const workerContent = fs.readFileSync(workerPath, 'utf8');
  assert(workerContent.includes('self.onmessage'), 'trace_worker.js defines onmessage handler');

  // 4. Verify SetuApi has parseJsonlAsync and falls back gracefully
  assert(typeof SetuApi.parseJsonlAsync === 'function', 'SetuApi has parseJsonlAsync static method');
  const sampleJsonl = '{"t":0,"ev":"meta","sf":7}\n{"t":10,"ev":"tx","node":1}\n';
  const asyncParsed = await SetuApi.parseJsonlAsync(sampleJsonl);
  assert(Array.isArray(asyncParsed) && asyncParsed.length === 2, 'parseJsonlAsync returns parsed events array');
  assert(asyncParsed[0].ev === 'meta' && asyncParsed[1].node === 1, 'parsed events match input data');

  console.log(`\nLazy Loading & Worker Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

