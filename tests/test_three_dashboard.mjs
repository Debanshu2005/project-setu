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
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
