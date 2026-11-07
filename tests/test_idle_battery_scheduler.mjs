// Project Setu: Automated Battery and Idle Scheduler Verification Suite (P4)
// Verifies that idle and backgrounded tabs consume zero continuous rAF callbacks,
// that 3D twin views render strictly on demand, and that Page Visibility API
// pauses all loops and resumes cleanly.

import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 3499;
const BASE_URL = `http://localhost:${PORT}`;

async function runIdleSchedulerTests() {
  console.log('================================================================');
  console.log('  Project Setu: Idle Battery Scheduler Verification Suite (P4)  ');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [ PASS ] ${message}`);
      passed++;
    } else {
      console.error(`  [ FAIL ] ${message}`);
      failed++;
    }
  }

  // Phase 1: Static Architectural Integrity Checks
  console.log('\n[Phase 1] Verifying Static Code Implementation for P4...');
  const simJs = fs.readFileSync(path.join(projectRoot, 'dashboard', 'src', 'simulation.js'), 'utf8');
  const setuTwinJs = fs.readFileSync(path.join(projectRoot, 'dashboard', 'components', 'setu_twin.js'), 'utf8');
  const wristbandJs = fs.readFileSync(path.join(projectRoot, 'dashboard', 'components', 'wristband_twin.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(projectRoot, 'dashboard', 'src', 'app.js'), 'utf8');

  assert(simJs.includes('document.hidden'), 'simulation.js checks document.hidden');
  assert(simJs.includes("addEventListener('visibilitychange'"), 'simulation.js listens to visibilitychange');
  assert(setuTwinJs.includes('requestRender()'), 'setu_twin.js implements requestRender');
  assert(setuTwinJs.includes('setActive('), 'setu_twin.js implements setActive');
  assert(setuTwinJs.includes("addEventListener('visibilitychange'"), 'setu_twin.js listens to visibilitychange');
  assert(!setuTwinJs.includes('this.animId = requestAnimationFrame(render);'), 'setu_twin.js has no unconditional render loop');

  assert(wristbandJs.includes('requestRender()'), 'wristband_twin.js implements requestRender');
  assert(wristbandJs.includes('setActive('), 'wristband_twin.js implements setActive');
  assert(wristbandJs.includes("addEventListener('visibilitychange'"), 'wristband_twin.js listens to visibilitychange');
  assert(!wristbandJs.includes('this.animId = requestAnimationFrame(render);'), 'wristband_twin.js has no unconditional render loop');

  assert(appJs.includes('setuTwin.setActive'), 'app.js manages setuTwin active state');
  assert(appJs.includes('wristbandTwin.setActive'), 'app.js manages wristbandTwin active state');
  assert(appJs.includes("addEventListener('visibilitychange'"), 'app.js handles global visibilitychange');

  // Phase 2: Playwright Headless Browser Runtime Measurements
  console.log('\n[Phase 2] Starting Dashboard Server on port ' + PORT + '...');
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  let browser = null;
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${BASE_URL}/api/scenarios`);
        if (r.ok) { ready = true; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    if (!ready) throw new Error('Dashboard server failed to start on port ' + PORT);

    console.log('Launching Chromium with software WebGL...');
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
      });
    } catch (e) {
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
      });
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Inject rAF counter
    await page.addInitScript(() => {
      window.__rafCount = 0;
      const origRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = function(cb) {
        return origRaf.call(window, function(ts) {
          window.__rafCount++;
          cb(ts);
        });
      };
    });

    console.log('Navigating to landing page (Topology view)...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Test 1: Idle rAF on Landing
    const landingStartRaf = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(3000);
    const landingEndRaf = await page.evaluate(() => window.__rafCount);
    const landingIdleRaf = landingEndRaf - landingStartRaf;
    assert(landingIdleRaf === 0, `Initial landing idle rAF callbacks over 3s is 0 (Got: ${landingIdleRaf})`);

    // Test 2: Background Hidden Page
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenStartRaf = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(2000);
    const hiddenEndRaf = await page.evaluate(() => window.__rafCount);
    const hiddenIdleRaf = hiddenEndRaf - hiddenStartRaf;
    assert(hiddenIdleRaf === 0, `Hidden tab rAF callbacks over 2s is 0 (Got: ${hiddenIdleRaf})`);

    // Restore visibility
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);

    // Test 3: Setu Twin 3D View On-Demand Rendering
    console.log('Switching to Setu Twin 3D view...');
    await page.click('#btnModeTwin');
    await page.waitForSelector('#setuTwinMount canvas', { timeout: 15000 });
    // Allow initial scene setup frames to settle
    await page.waitForTimeout(2000);

    const twinIdleStartRaf = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(3000);
    const twinIdleEndRaf = await page.evaluate(() => window.__rafCount);
    const twinIdleRaf = twinIdleEndRaf - twinIdleStartRaf;
    assert(twinIdleRaf === 0, `Setu Twin 3D idle rAF callbacks over 3s is 0 (Got: ${twinIdleRaf})`);

    // Test 4: Switching back to Topology deactivates Setu Twin
    console.log('Switching back to Topology view...');
    await page.click('#btnModeTopology');
    await page.waitForTimeout(1000);

    const isTwinActive = await page.evaluate(() => window.setuApp?.setuTwin?.isActive);
    assert(isTwinActive === false, 'Setu Twin isActive is false when Topology view is active');

    const topoStartRaf = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(2000);
    const topoEndRaf = await page.evaluate(() => window.__rafCount);
    assert((topoEndRaf - topoStartRaf) === 0, 'Zero rAF callbacks after switching away from 3D twin');

    // Test 5: Wristband Twin On-Demand Rendering
    console.log('Opening Wristband Twin tab in sidebar...');
    await page.click('#tabBtnTwin');
    await page.waitForSelector('#wristband3dMount canvas', { timeout: 15000 });
    await page.waitForTimeout(2000);

    const wbIdleStartRaf = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(3000);
    const wbIdleEndRaf = await page.evaluate(() => window.__rafCount);
    const wbIdleRaf = wbIdleEndRaf - wbIdleStartRaf;
    assert(wbIdleRaf === 0, `Wristband Twin idle rAF callbacks over 3s is 0 (Got: ${wbIdleRaf})`);

    // Test 6: Tactile button press triggers animation and then stops
    console.log('Testing tactile button trigger and settling...');
    const preBtnRaf = await page.evaluate(() => window.__rafCount);
    await page.click('#wtBtnShort');
    await page.waitForTimeout(500);
    const postBtnRaf = await page.evaluate(() => window.__rafCount);
    assert(postBtnRaf > preBtnRaf, `Tactile button click rendered frames on demand (Got: ${postBtnRaf - preBtnRaf} frames)`);

    // Wait for button animation and haptics to finish
    await page.waitForTimeout(1500);
    const settleStartRaf = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(2000);
    const settleEndRaf = await page.evaluate(() => window.__rafCount);
    assert((settleEndRaf - settleStartRaf) === 0, 'Wristband Twin settles to 0 rAF after interaction completes');

    // Test 7: Simulation playback pauses on hidden and resumes on visible
    console.log('Testing simulation playback pause on background hide...');
    await page.click('#btnPlay');
    await page.waitForTimeout(600);
    const isPlayingBefore = await page.evaluate(() => window.setuApp?.sim?.isPlaying);
    assert(isPlayingBefore === true, 'Simulation is playing after clicking Play');

    // Hide page
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(200);

    const isPlayingHidden = await page.evaluate(() => window.setuApp?.sim?.isPlaying);
    assert(isPlayingHidden === false, 'Simulation is paused when document becomes hidden');

    const hiddenSimStart = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(2000);
    const hiddenSimEnd = await page.evaluate(() => window.__rafCount);
    assert((hiddenSimEnd - hiddenSimStart) === 0, 'Simulation generates 0 rAF while page is hidden');

    // Restore page
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);

    const isPlayingRestored = await page.evaluate(() => window.setuApp?.sim?.isPlaying);
    assert(isPlayingRestored === true, 'Simulation resumes playing when document becomes visible');

    // Pause cleanly
    await page.click('#btnPlay');
    await page.waitForTimeout(200);

  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log('\n================================================================');
  console.log(`  IDLE SCHEDULER SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runIdleSchedulerTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
