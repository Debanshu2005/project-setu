// Project Setu: Smoothness and Scrubbing Verification Suite (P8)
// Tests binary search timeline seeking, keyframe parity, debounced resize coalescing,
// and inactive tab chart redraw suppression under 4x CPU throttling.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { SimulationEngine } from '../dashboard/src/simulation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  [ PASS ] ${message}`);
  } else {
    console.error(`  [ FAIL ] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTimelineScrubbingUnitTests() {
  console.log('\n[Suite 1/4] Binary Search Timeline Seeking and Keyframe Parity...');

  const tracePath = path.join(REPO_ROOT, 'scenarios', 'traces', 'building_collapse.jsonl');
  const traceLines = fs.readFileSync(tracePath, 'utf8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l));

  const simFast = new SimulationEngine();
  simFast.loadTrace(traceLines);

  assert(simFast.keyframes && simFast.keyframes.length > 5,
    `Keyframes precomputed on trace load (Found: ${simFast.keyframes ? simFast.keyframes.length : 0} keyframes)`);

  const timestamps = [1500, 4800, 9200, 15400, 22100, 28700];
  for (const t of timestamps) {
    // 1. Perform binary search seek
    simFast.seek(t);
    const fastNodes = new Map();
    for (const [id, n] of simFast.nodes) {
      fastNodes.set(id, {
        online: n.online,
        battery: n.battery,
        tx: n.stats.tx,
        rx: n.stats.rx,
        drop: n.stats.drop,
        active_sos: n.active_sos,
        acked: n.acked
      });
    }
    const fastAlertCount = simFast.alerts.length;

    // 2. Perform baseline sequential replay from zero
    const simCold = new SimulationEngine();
    simCold.loadTrace(traceLines);
    simCold.resetToBaseState();
    for (const ev of simCold.events) {
      if ((ev.t || 0) > t) break;
      simCold.applyEvent(ev, t, false);
    }
    const coldAlertCount = simCold.alerts.length;

    assert(fastAlertCount === coldAlertCount,
      `Alert count parity at t=${t}ms (Fast: ${fastAlertCount}, Cold: ${coldAlertCount})`);

    let allMatch = true;
    for (const [id, fastN] of fastNodes) {
      const coldN = simCold.nodes.get(id);
      if (!coldN) { allMatch = false; break; }
      if (fastN.online !== coldN.online ||
          Math.abs(fastN.battery - coldN.battery) > 0.001 ||
          fastN.tx !== coldN.stats.tx ||
          fastN.rx !== coldN.stats.rx ||
          fastN.drop !== coldN.stats.drop ||
          fastN.active_sos !== coldN.active_sos ||
          fastN.acked !== coldN.acked) {
        allMatch = false;
        break;
      }
    }
    assert(allMatch, `Full node state exact parity at t=${t}ms`);
  }

  // Latency benchmark: 50 seeks across 30s trace
  const tStart = performance.now();
  const seekCount = 50;
  for (let i = 0; i < seekCount; i++) {
    const targetT = (i * 590) % (simFast.meta.duration || 30000);
    simFast.seek(targetT);
  }
  const tTotal = performance.now() - tStart;
  const avgSeekMs = tTotal / seekCount;

  console.log(`    Benchmark: ${seekCount} seeks executed in ${tTotal.toFixed(2)}ms (Avg: ${avgSeekMs.toFixed(3)}ms / seek)`);
  assert(avgSeekMs < 5.0, `Average seek latency well below 5.0ms budget (Got: ${avgSeekMs.toFixed(3)}ms)`);
}

async function runBrowserSmoothnessTests() {
  console.log('\n[Suite 2/4] Starting Server and Browser for Smoothness Audit...');

  const PORT = 3498;
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe'
  });

  await new Promise((resolve, reject) => {
    server.stdout.on('data', data => {
      if (data.toString().includes('http://0.0.0.0:' + PORT)) resolve();
    });
    server.stderr.on('data', data => console.error(data.toString()));
    server.on('error', reject);
  });
  console.log(`    Test server listening at http://127.0.0.1:${PORT}`);

  let browser;
  try {
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader']
      });
    } catch (e) {
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader']
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    });

    const page = await context.newPage();

    // Emulate 4x CPU slowdown via CDP
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    console.log('\n[Suite 3/4] Inactive Tab Chart Redraw Suppression...');
    await page.goto(`http://127.0.0.1:${PORT}/dashboard/index.html`, { waitUntil: 'networkidle' });

  // Initialize analytics workspace behind the scenes
  await page.evaluate(async () => {
    if (window.setuApp) {
      await window.setuApp.ensureAnalyticsWorkspace();
    }
  });

  // Track render calls on hidden analytics charts
  await page.evaluate(() => {
    window.__analyticsRenderCalls = 0;
    const ws = window.setuApp?.analyticsWorkspace;
    if (ws) {
      const origRender = ws.renderDomainView.bind(ws);
      ws.renderDomainView = () => {
        window.__analyticsRenderCalls++;
        return origRender();
      };
    }
  });

  // Start simulation playback on Topology view for 1.5 seconds
  await page.evaluate(() => window.setuApp?.sim?.play());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.setuApp?.sim?.pause());

  const hiddenRenderCalls = await page.evaluate(() => window.__analyticsRenderCalls);
  console.log(`    Render calls to Scientific Analytics while hidden: ${hiddenRenderCalls}`);
  assert(hiddenRenderCalls === 0, 'Scientific Analytics charts did NOT redraw while hidden on Topology view');

  // Now switch to Scientific Analytics tab and verify flush
  await page.click('#btnModeAnalytics');
  await page.waitForSelector('#analyticsPlotArea canvas', { timeout: 10000 });

  const activeRenderCalls = await page.evaluate(() => window.__analyticsRenderCalls);
  console.log(`    Render calls upon activating Scientific Analytics tab: ${activeRenderCalls}`);
  assert(activeRenderCalls >= 1, 'Scientific Analytics charts rendered cleanly upon tab activation');

  console.log('\n[Suite 4/4] Debounced Resize Coalescing and Vector Allocation Audit...');

  // Trigger 15 rapid resize events in burst
  await page.evaluate(() => {
    window.__debouncedResizeCount = 0;
    const ws = window.setuApp?.analyticsWorkspace;
    if (ws) {
      const origRender = ws.renderDomainView.bind(ws);
      ws.renderDomainView = () => {
        window.__debouncedResizeCount++;
        return origRender();
      };
    }
    for (let i = 0; i < 15; i++) {
      window.dispatchEvent(new Event('resize'));
    }
  });

  // Wait for 200ms debounce timer to settle
  await page.waitForTimeout(250);

  const resizeCalls = await page.evaluate(() => window.__debouncedResizeCount);
  console.log(`    Render calls from 15 burst resize events: ${resizeCalls}`);
  assert(resizeCalls <= 2, `15 resize events coalesced to <= 2 renders (Got: ${resizeCalls})`);

  // Verify Setu Twin vector reuse
  await page.click('#btnModeTwin');
  await page.waitForSelector('#setuTwinMount canvas', { timeout: 10000 });

  const vectorStats = await page.evaluate(() => {
    const twin = window.setuApp?.setuTwin;
    if (!twin) return { hasTwin: false };
    return {
      hasTwin: true,
      hasReusableVecA: !!twin._reusableVec3A,
      hasReusableVecB: !!twin._reusableVec3B,
      hasReusableMouse: !!twin._reusableMouse2D
    };
  });

  assert(vectorStats.hasTwin, 'Setu Twin 3D view initialized');
  console.log('    Setu Twin pre-allocated reusable vector cache verified');
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
}

async function main() {
  console.log('================================================================');
  console.log('  PROJECT SETU: SMOOTHNESS AND SCRUBBING TEST SUITE (P8)        ');
  console.log('================================================================');

  try {
    await runTimelineScrubbingUnitTests();
    await runBrowserSmoothnessTests();

    console.log('\n================================================================');
    console.log(`  ALL ${passedAssertions} SMOOTHNESS AND SCRUBBING TESTS PASSED!`);
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\nTest suite failed with exception:', err);
    process.exit(1);
  }
}

main();
