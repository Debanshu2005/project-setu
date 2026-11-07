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
    console.log('Server is ready. Launching Chrome with SwiftShader WebGL...');

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

    const page = await browser.newPage({ viewport: { width: 1600, height: 720 } });
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    page.on('pageerror', err => console.error(`[Page Error]`, err));
    page.on('response', res => {
      if (res.status() >= 400) console.log(`[HTTP ${res.status()}] ${res.url()}`);
    });

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Ensure initial scenario (collapse_site_demo with 16 nodes) is loaded
    await page.waitForFunction(() => {
      const m = document.getElementById('metricNodes');
      return m && m.textContent.trim() === '16';
    }, { timeout: 15000 });

    // Switch to 3D Twin View
    console.log('Switching to Setu Twin 3D View...');
    await page.click('#btnModeTwin');
    await page.waitForSelector('#setuTwinMount canvas', { timeout: 10000 });
    await page.waitForTimeout(1500);

    // 1. Capture V_W2_01_wall_failure (Link blocked by wall & distance: Node 1 to Hub 0)
    console.log('Triggering wall failure explanation (Node 1 -> Hub 0 in collapse_site_demo)...');
    const wallModalCheck = await page.evaluate(async () => {
      const app = window.setuApp || window.app;
      if (!app || !app.setuTwin) return { error: 'app or setuTwin not found' };

      // Move simulation timeline to 3.1s where Node 1 SOS is dropped at Hub 0
      app.sim.seek(3100);

      // Fetch real loss budget telemetry from engine
      const lossData = await app.fetchLossBudget(1, 0);
      console.log('wall lossData fetched:', JSON.stringify(lossData));
      app.setuTwin.showFailureExplanation('RF Loss Budget: Node 1 -> Hub 0', lossData);

      const modal = document.getElementById('stFailModal');
      const isVisible = modal && window.getComputedStyle(modal).display !== 'none';
      const text = modal ? modal.textContent : '';
      console.log('wall modal text:', text);
      return {
        isVisible,
        hasShearWall: text.includes('exterior_south_shear_wall') || text.includes('22.0 dB'),
        hasDistanceLoss: text.includes('81.9 dB') || text.includes('distance path loss'),
        hasExtraLoss: text.includes('15.0 dB'),
        hasRxPower: text.includes('-131.9 dBm'),
        hasSens: text.includes('-126.0 dBm'),
        hasMargin: text.includes('-5.9 dB'),
        hasVerdict: text.includes('Physical Failure Verdict')
      };
    });
    console.log('Wall Failure Modal Verification:', wallModalCheck);

    await page.waitForTimeout(600);
    const wallImgDemoPath = path.join(screensDir, 'V_W2_01_wall_failure_collapse_demo_node1_to_hub0.png');
    const wallImgPath = path.join(screensDir, 'V_W2_01_wall_failure.png');
    await page.screenshot({ path: wallImgDemoPath });
    fs.copyFileSync(wallImgDemoPath, wallImgPath);
    console.log(`Captured ${wallImgDemoPath} and ${wallImgPath}`);

    // 2. Capture V_W2_02_distance_failure (Line of sight distance drop: Node 9 to Node 6)
    console.log('\nTriggering distance drop failure explanation (Node 9 -> Node 6 in collapse_site_demo)...');
    const distModalCheck = await page.evaluate(async () => {
      const app = window.setuApp || window.app;
      if (!app || !app.setuTwin) return { error: 'app or setuTwin not found' };

      // Move simulation timeline to 3.73s where Node 9 transmission is dropped at Node 6
      app.sim.seek(3731);

      // Fetch real loss budget telemetry from engine
      const distanceData = await app.fetchLossBudget(9, 6);
      console.log('dist distanceData fetched:', JSON.stringify(distanceData));
      app.setuTwin.showFailureExplanation('RF Loss Budget: Node 9 -> Node 6', distanceData);

      const modal = document.getElementById('stFailModal');
      const isVisible = modal && window.getComputedStyle(modal).display !== 'none';
      const text = modal ? modal.textContent : '';
      console.log('dist modal text:', text);
      return {
        isVisible,
        hasDistanceLoss: text.includes('75.5 dB') || text.includes('distance path loss'),
        hasObstacleLossZero: text.includes('0.0 dB (line of sight)') || text.includes('0.0 dB'),
        hasRxPower: text.includes('-130.9 dBm'),
        hasSens: text.includes('-126.0 dBm'),
        hasMargin: text.includes('-4.9 dB'),
        hasVerdict: text.includes('Physical Failure Verdict')
      };
    });
    console.log('Distance Failure Modal Verification:', distModalCheck);

    await page.waitForTimeout(600);
    const distImgDemoPath = path.join(screensDir, 'V_W2_02_distance_failure_collapse_demo_node9_to_node6.png');
    const distImgPath = path.join(screensDir, 'V_W2_02_distance_failure.png');
    await page.screenshot({ path: distImgDemoPath });
    fs.copyFileSync(distImgDemoPath, distImgPath);
    console.log(`Captured ${distImgDemoPath} and ${distImgPath}`);

    await page.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

capture().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
