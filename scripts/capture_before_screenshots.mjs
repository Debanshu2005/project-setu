import { spawn } from 'child_process';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const beforeDir = path.join(projectRoot, 'docs', 'screens', 'before');

if (!fs.existsSync(beforeDir)) {
  fs.mkdirSync(beforeDir, { recursive: true });
}

const PORT = 3388;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/scenarios`);
      if (res.ok) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server failed to start at ${url} within ${timeoutMs}ms`);
}

async function capture() {
  console.log(`Starting server on port ${PORT}...`);
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  let browser;
  try {
    await waitForServer(BASE_URL);
    console.log('Server is ready. Launching Chrome...');

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
    });

    // 1. Desktop 1600x720 Landing
    const pageDesk = await browser.newPage({ viewport: { width: 1600, height: 720 } });
    await pageDesk.goto(BASE_URL, { waitUntil: 'networkidle' });
    await pageDesk.waitForTimeout(1500);

    await pageDesk.screenshot({ path: path.join(beforeDir, 'V_W1_01_landing_desktop.png') });
    console.log('Captured before V_W1_01_landing_desktop.png');

    // 2. Mobile 390x844 Landing
    const pageMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await pageMobile.goto(BASE_URL, { waitUntil: 'networkidle' });
    await pageMobile.waitForTimeout(1500);
    await pageMobile.screenshot({ path: path.join(beforeDir, 'V_W1_01_landing_mobile.png') });
    console.log('Captured before V_W1_01_landing_mobile.png');
    await pageMobile.close();

    // 3. Switch to 3D Twin View on desktop
    await pageDesk.click('#btnModeTwin');
    await pageDesk.waitForTimeout(2000);
    await pageDesk.screenshot({ path: path.join(beforeDir, 'setu_twin_view_desktop.png') });
    console.log('Captured before setu_twin_view_desktop.png');

    // 4. Open Wristband Twin tab
    await pageDesk.click('#tabBtnTwin');
    await pageDesk.waitForTimeout(1500);
    await pageDesk.screenshot({ path: path.join(beforeDir, 'wristband_panel_desktop.png') });
    console.log('Captured before wristband_panel_desktop.png');

    // 5. Load scenario 7 (gps_denied_rescue) in 3D view
    await pageDesk.selectOption('#scenarioSelect', 'gps_denied_rescue');
    await pageDesk.waitForTimeout(2000);
    await pageDesk.screenshot({ path: path.join(beforeDir, 'scenario_7_subterranean.png') });
    console.log('Captured before scenario_7_subterranean.png');

    // 6. Load building_collapse in 3D view
    await pageDesk.selectOption('#scenarioSelect', 'building_collapse');
    await pageDesk.waitForTimeout(2000);
    await pageDesk.screenshot({ path: path.join(beforeDir, 'scenario_building_collapse.png') });
    console.log('Captured before scenario_building_collapse.png');

    await pageDesk.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

capture().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});

