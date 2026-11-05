import { spawn } from 'child_process';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const screensDir = path.join(projectRoot, 'docs', 'screens');

if (!fs.existsSync(screensDir)) {
  fs.mkdirSync(screensDir, { recursive: true });
}

const PORT = 3377;
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
    console.log('Server is ready. Launching Chrome with SwiftShader...');

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
    });

    // 1. Desktop 1600x720 Landing View
    const pageDesk = await browser.newPage({ viewport: { width: 1600, height: 720 } });
    await pageDesk.goto(BASE_URL, { waitUntil: 'networkidle' });
    await pageDesk.waitForTimeout(1500);

    // Switch to 3D Twin View
    await pageDesk.click('#btnModeTwin');
    await pageDesk.waitForTimeout(1500);

    await pageDesk.screenshot({ path: path.join(screensDir, 'V_W1_01_landing.png') });
    console.log('Captured docs/screens/V_W1_01_landing.png');

    // 2. Mobile 390x844 Landing View
    const pageMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await pageMobile.goto(BASE_URL, { waitUntil: 'networkidle' });
    await pageMobile.waitForTimeout(1500);
    await pageMobile.click('#btnModeTwin');
    await pageMobile.waitForTimeout(1500);
    await pageMobile.screenshot({ path: path.join(screensDir, 'V_W1_01_landing_mobile.png') });
    console.log('Captured docs/screens/V_W1_01_landing_mobile.png');
    await pageMobile.close();

    // 3. Load collapse_site_demo and capture t=3s (First SOS)
    console.log('Loading collapse_site_demo...');
    await pageDesk.selectOption('#scenarioSelect', 'collapse_site_demo');
    await pageDesk.waitForTimeout(2000);

    // Seek to 3.0s (3000ms) where SOS packet originates
    await pageDesk.evaluate(() => {
      if (window.app && window.app.sim) {
        window.app.sim.seek(3.1);
      }
    });
    await pageDesk.waitForTimeout(1500);

    await pageDesk.screenshot({ path: path.join(screensDir, 'V_W1_02_demo_t3.png') });
    console.log('Captured docs/screens/V_W1_02_demo_t3.png');

    // 4. Load scenario 7 (gps_denied_rescue) showing subterranean structure
    console.log('Loading gps_denied_rescue...');
    await pageDesk.selectOption('#scenarioSelect', 'gps_denied_rescue');
    await pageDesk.waitForTimeout(2000);
    await pageDesk.screenshot({ path: path.join(screensDir, 'scenario_7_subterranean.png') });
    console.log('Captured docs/screens/scenario_7_subterranean.png');

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

