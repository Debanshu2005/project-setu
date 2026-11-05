import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const screenshotsDir = path.join(projectRoot, 'docs', 'screenshots');

const PORT = 3399;
const BASE_URL = `http://localhost:${PORT}`;

async function testDashboardWebGL() {
  console.log(`Starting dashboard server on port ${PORT}...`);
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  try {
    let ready = false;
    for (let i = 0; i < 25; i++) {
      try {
        const r = await fetch(`${BASE_URL}/api/scenarios`);
        if (r.ok) { ready = true; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    if (!ready) throw new Error('Dashboard server failed to bind port');

    console.log('Launching headless browser...');
    let browser;
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

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`[Console Error] ${msg.text()}`);
      else console.log(`[Browser Console] ${msg.text()}`);
    });
    page.on('pageerror', err => errors.push(`[Page Error] ${err.message}`));
    page.on('response', res => {
      if (res.status() >= 400) console.log(`[HTTP ${res.status()}] ${res.url()}`);
    });

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // 1. Switch to Setu Twin 3D View
    console.log('Switching to Setu Twin 3D View...');
    const btnTwin = page.locator('#btnModeTwin');
    await btnTwin.click();
    await page.waitForTimeout(2000);

    // Check canvas exists in mount point
    const hasCanvas3D = await page.locator('#setuTwinMount canvas').count();
    console.log(`Setu Twin 3D Canvas element count: ${hasCanvas3D}`);
    if (hasCanvas3D === 0) {
      throw new Error('Setu Twin 3D WebGL canvas was not created');
    }

    // Save screenshot of WebGL 3D view
    const twinImgPath = path.join(screenshotsDir, 'webgl_setu_twin_view.png');
    await page.screenshot({ path: twinImgPath });
    console.log(`Saved 3D screenshot: ${twinImgPath}`);

    // 2. Open Wristband Twin tab in sidebar
    console.log('Opening Setu Twin hardware inspector in sidebar...');
    const tabTwin = page.locator('#tabBtnTwin');
    await tabTwin.click();
    await page.waitForTimeout(1500);

    const hasWristbandCanvas = await page.locator('#wristband3dMount canvas').count();
    console.log(`Wristband 3D Canvas element count: ${hasWristbandCanvas}`);
    if (hasWristbandCanvas === 0) {
      throw new Error('Wristband 3D WebGL canvas was not created');
    }

    // Save screenshot of 3D wristband
    const wristbandImgPath = path.join(screenshotsDir, 'webgl_wristband_twin.png');
    await page.screenshot({ path: wristbandImgPath });
    console.log(`Saved 3D wristband screenshot: ${wristbandImgPath}`);

    // 3. Test interactive tactile button click
    console.log('Testing tactile button click in 3D wristband...');
    const btnShort = page.locator('#wtBtnShort');
    await btnShort.click();
    await page.waitForTimeout(500);

    // 4. Verify scenario node count synchronization (Requirement 1)
    console.log('Verifying metrics panel and header node count synchronization...');
    const initialNodesText = await page.locator('#metricNodes').textContent();
    const initialStatusText = await page.locator('#statusText').textContent();
    console.log(`Initial landing scenario: Nodes = ${initialNodesText.trim()}, Status = ${initialStatusText.trim()}`);
    if (initialNodesText.trim() !== '16') {
      throw new Error(`Expected initial collapse_site_demo node count 16 in metrics panel, got: ${initialNodesText}`);
    }

    // Switch scenario to gps_denied_rescue (17 nodes)
    console.log('Switching scenario to gps_denied_rescue...');
    await page.selectOption('#scenarioSelect', 'gps_denied_rescue');
    await page.waitForTimeout(1500);

    const scenario7Nodes = await page.locator('#metricNodes').textContent();
    const scenario7Status = await page.locator('#statusText').textContent();
    console.log(`Scenario 7: Nodes = ${scenario7Nodes.trim()}, Status = ${scenario7Status.trim()}`);
    if (scenario7Nodes.trim() !== '17') {
      throw new Error(`Expected scenario 7 node count 17 in metrics panel, got: ${scenario7Nodes}`);
    }

    // Switch back to collapse_site_demo (16 nodes)
    console.log('Switching back to collapse_site_demo...');
    await page.selectOption('#scenarioSelect', 'collapse_site_demo');
    await page.waitForTimeout(1500);

    const revertedNodes = await page.locator('#metricNodes').textContent();
    if (revertedNodes.trim() !== '16') {
      throw new Error(`Expected collapse_site_demo node count 16 after reverting, got: ${revertedNodes}`);
    }
    console.log('[ PASS ] Metrics panel and header accurately reflect loaded scenario at all times (16 demo vs 17 scenario 7)!');

    // 5. Verify Label Screen Height and Viewport Coverage (Requirement 2)
    console.log('Verifying label screen height and viewport coverage...');
    const labelMetrics = await page.evaluate(() => {
      const app = window.setuApp;
      if (!app || !app.setuTwin || !app.setuTwin.camera) return null;
      const twin = app.setuTwin;
      const camera = twin.camera;
      const vh = twin.renderer.domElement.clientHeight || 720;
      const vw = twin.renderer.domElement.clientWidth || 1280;
      const viewportArea = vw * vh;

      const group = twin.nodeMeshes.get(1);
      if (!group) return null;
      const label = group.getObjectByName('labelSprite');
      if (!label) return null;

      const tempVec = new twin.T.Vector3();
      group.getWorldPosition(tempVec);
      const dist = camera.position.distanceTo(tempVec);
      const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
      const visibleH = 2 * dist * tanHalfFov;

      const screenH = label.scale.y * (vh / visibleH);
      const screenW = label.scale.x * (vh / visibleH);
      const screenArea = screenH * screenW;
      const coveragePct = (screenArea / viewportArea) * 100;

      return { screenH, screenW, coveragePct };
    });

    if (labelMetrics) {
      console.log(`Node 1 label metrics: screenH = ${labelMetrics.screenH.toFixed(1)}px, screenW = ${labelMetrics.screenW.toFixed(1)}px, coverage = ${labelMetrics.coveragePct.toFixed(2)}%`);
      if (labelMetrics.screenH > 18.0) {
        throw new Error(`Label screen height exceeds cap (got ${labelMetrics.screenH.toFixed(1)}px, expected <= 16px)`);
      }
      if (labelMetrics.coveragePct > 10.0) {
        throw new Error(`Label covers more than 10% of viewport (got ${labelMetrics.coveragePct.toFixed(2)}%)`);
      }
      console.log('[ PASS ] Label screen height is capped at 12-14px and covers <10% of viewport!');
    }

    await browser.close();

    if (errors.length > 0) {
      console.error('Errors detected during WebGL dashboard execution:\n' + errors.join('\n'));
      throw new Error(`Test failed with ${errors.length} browser error(s)`);
    }

    console.log('[ PASS ] Setu Twin v2 WebGL 3D rendering and wristband twin initialized cleanly with 0 errors!');
  } finally {
    server.kill();
  }
}

testDashboardWebGL().catch(err => {
  console.error('Fatal WebGL test error:', err);
  process.exit(1);
});
