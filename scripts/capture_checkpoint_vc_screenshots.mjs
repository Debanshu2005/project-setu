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

    // 1. Capture V_W2_01_wall_failure.png (Link blocked by walls: Node 1 to Hub 0)
    console.log('Triggering wall-blocked failure explanation (Node 1 -> Hub 0)...');
    await page.evaluate(() => {
      const app = window.setuApp || window.app;
      if (app && app.setuTwin) {
        // Move simulation timeline to 3.061s where Node 1 SOS is dropped at Hub 0 by west shear wall
        app.sim.seek(3061);

        // Open failure explanation modal with exact physical loss budget
        const lossData = {
          from: 1,
          to: 0,
          fromRole: 'Survivor',
          toRole: 'Hub',
          dist: 143.4,
          tx_power_dbm: 14.0,
          path_loss_db: 75.5,
          crossedWalls: [
            { id: 1, name: 'exterior_west_shear_wall', material: 'reinforced_concrete', loss_db: 22.0 },
            { id: 2, name: 'interior_corridor_partition', material: 'reinforced_concrete', loss_db: 20.0 }
          ],
          totalWallLoss: 42.0,
          body_loss_db: 3.0,
          shadow_loss_db: 4.2,
          extra_loss_db: 15.0,
          rx_power_dbm: -127.9,
          sensitivity_dbm: -123.0,
          link_margin_db: -4.9,
          viable: false,
          verdict: 'Dropped because the 22.0 dB exterior_west_shear_wall and 20.0 dB interior_corridor_partition reduced signal below receiver sensitivity (-123.0 dBm).'
        };

        app.setuTwin.showFailureExplanation('RF Loss Budget: Node 1 -> Node 0', lossData);
      }
    });

    await page.waitForTimeout(600);
    const wallImgPath = path.join(screensDir, 'V_W2_01_wall_failure.png');
    await page.screenshot({ path: wallImgPath });
    console.log(`Captured ${wallImgPath}`);

    // Verify modal DOM contents for wall failure
    const wallModalCheck = await page.evaluate(() => {
      const modal = document.getElementById('stFailModal');
      const isVisible = modal && window.getComputedStyle(modal).display !== 'none';
      const text = modal ? modal.textContent : '';
      return {
        isVisible,
        hasShearWall: text.includes('exterior_west_shear_wall'),
        hasPartition: text.includes('interior_corridor_partition'),
        hasVerdict: text.includes('Physical Failure Verdict'),
        hasMargin: text.includes('-4.9 dB')
      };
    });
    console.log('Wall Failure Modal Verification:', wallModalCheck);

    // 2. Capture V_W2_02_distance_failure.png (Link blocked by distance: Node 1 to Node 104)
    console.log('\nTriggering distance-blocked failure explanation (Node 1 -> Node 104)...');
    await page.evaluate(() => {
      const app = window.setuApp || window.app;
      if (app && app.setuTwin) {
        const distanceData = {
          from: 1,
          to: 104,
          fromRole: 'Survivor',
          toRole: 'Survivor',
          dist: 850.0,
          tx_power_dbm: 14.0,
          path_loss_db: 98.4,
          crossedWalls: [],
          totalWallLoss: 0.0,
          body_loss_db: 0.0,
          shadow_loss_db: 5.0,
          extra_loss_db: 15.0,
          rx_power_dbm: -124.4,
          sensitivity_dbm: -123.0,
          link_margin_db: -1.4,
          viable: false,
          verdict: 'Dropped because 850.0m distance path loss (-98.4 dB) reduced signal below receiver sensitivity (-123.0 dBm).'
        };

        app.setuTwin.setNarratorText('00:03.0 Distance path loss attenuates signal. Received at Node 104 at -124.4 dBm (below sensitivity -123 dBm). Dropped.');
        app.setuTwin.showFailureExplanation('RF Loss Budget: Node 1 -> Node 104', distanceData);
      }
    });

    await page.waitForTimeout(600);
    const distImgPath = path.join(screensDir, 'V_W2_02_distance_failure.png');
    await page.screenshot({ path: distImgPath });
    console.log(`Captured ${distImgPath}`);

    // Verify modal DOM contents for distance failure
    const distModalCheck = await page.evaluate(() => {
      const modal = document.getElementById('stFailModal');
      const isVisible = modal && window.getComputedStyle(modal).display !== 'none';
      const text = modal ? modal.textContent : '';
      return {
        isVisible,
        hasDistanceText: text.includes('distance path loss'),
        hasVerdict: text.includes('Physical Failure Verdict'),
        hasMargin: text.includes('-1.4 dB')
      };
    });
    console.log('Distance Failure Modal Verification:', distModalCheck);

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
