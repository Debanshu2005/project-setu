import { spawn } from 'child_process';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const screenshotsDir = path.join(projectRoot, 'docs', 'screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const PORT = 3344;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/scenarios`);
      if (res.ok) return true;
    } catch (e) {
      // Wait for server to bind
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server failed to start at ${url} within ${timeoutMs}ms`);
}

async function captureScreenshots() {
  console.log(`Starting server on port ${PORT}...`);
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  try {
    await waitForServer(BASE_URL);
    console.log('Server is ready. Launching headless browser...');

    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });

    const page = await context.newPage();
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Wait 1.5s for initial canvas and UI setup
    await page.waitForTimeout(1500);

    // 1. Capture Topology View
    const topologyPath = path.join(screenshotsDir, 'current_topology_view.png');
    await page.screenshot({ path: topologyPath });
    console.log(`Saved: ${topologyPath}`);

    // 2. Switch to Setu Twin 3D View
    const twinBtn = page.locator('#btnModeTwin');
    if (await twinBtn.count() > 0) {
      await twinBtn.click();
      await page.waitForTimeout(1000);
      const twinPath = path.join(screenshotsDir, 'current_setu_twin_view.png');
      await page.screenshot({ path: twinPath });
      console.log(`Saved: ${twinPath}`);
    }

    // 3. Switch to Scientific Analytics View
    const analyticsBtn = page.locator('#btnModeAnalytics');
    if (await analyticsBtn.count() > 0) {
      await analyticsBtn.click();
      await page.waitForTimeout(1000);
      const analyticsPath = path.join(screenshotsDir, 'current_analytics_view.png');
      await page.screenshot({ path: analyticsPath });
      console.log(`Saved: ${analyticsPath}`);
    }

    // 4. Switch back to Topology and open Setu Twin hardware tab in sidebar
    const topologyBtn = page.locator('#btnModeTopology');
    if (await topologyBtn.count() > 0) {
      await topologyBtn.click();
      await page.waitForTimeout(500);
    }
    const tabTwin = page.locator('#tabBtnTwin');
    if (await tabTwin.count() > 0) {
      await tabTwin.click();
      await page.waitForTimeout(800);
      const hardwareTwinPath = path.join(screenshotsDir, 'current_wristband_twin.png');
      await page.screenshot({ path: hardwareTwinPath });
      console.log(`Saved: ${hardwareTwinPath}`);
    }

    await browser.close();
    console.log('All screenshots captured successfully.');
  } finally {
    server.kill();
  }
}

captureScreenshots().catch(err => {
  console.error('Fatal error capturing screenshots:', err);
  process.exit(1);
});
