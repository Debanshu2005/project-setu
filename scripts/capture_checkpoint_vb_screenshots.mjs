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

    // 3. Scenario 7 Subterranean View (gps_denied_rescue)
    console.log('Loading gps_denied_rescue...');
    await pageDesk.selectOption('#scenarioSelect', 'gps_denied_rescue');
    await pageDesk.waitForTimeout(2000);
    await pageDesk.screenshot({ path: path.join(screensDir, 'scenario_7_subterranean.png') });
    console.log('Captured docs/screens/scenario_7_subterranean.png');

    // 4. Return to collapse_site_demo for V3 radio walkthrough
    console.log('Loading collapse_site_demo for V3 radio walkthrough...');
    await pageDesk.selectOption('#scenarioSelect', 'collapse_site_demo');
    await pageDesk.waitForTimeout(2000);

    // 4A. V_W1_02_demo_t3.png: First SOS at t=3.1s
    // Node 1 transmits SOS, packet pulse travels toward Hub 0 and relays,
    // airtime ring expands, crossed shear wall highlights with -22 dB badge,
    // receiver drop flash appears at Hub 0.
    console.log('Triggering t=3.1s radio pulse and wall attenuation...');
    await pageDesk.evaluate(() => {
      const app = window.setuApp || window.app;
      if (app) {
        app.sim.seek(3080);
        if (app.setuTwin) {
          app.setuTwin.triggerPacketPulse(1, 0, 2, 1, 62);
          app.setuTwin.triggerDropFlash(0, 'weak');
        }
      }
    });
    await pageDesk.waitForTimeout(250);
    await pageDesk.screenshot({ path: path.join(screensDir, 'V_W1_02_demo_t3.png') });
    console.log('Captured docs/screens/V_W1_02_demo_t3.png');

    // 4B. V_W1_03_demo_t8.png: Intermediate hop packet at t=8.2s
    console.log('Triggering t=8.2s intermediate hop radio pulse...');
    await pageDesk.evaluate(() => {
      const app = window.setuApp || window.app;
      if (app) {
        app.sim.seek(8200);
        if (app.setuTwin) {
          app.setuTwin.triggerPacketPulse(7, 101, 1, 2, 62);
        }
      }
    });
    await pageDesk.waitForTimeout(250);
    await pageDesk.screenshot({ path: path.join(screensDir, 'V_W1_03_demo_t8.png') });
    console.log('Captured docs/screens/V_W1_03_demo_t8.png');

    // 4C. V_W1_04_ack_buzz.png: ACK arrival and survivor wristband buzzing at t=4.5s
    console.log('Triggering t=4.5s ACK arrival and wristband buzz...');
    await pageDesk.evaluate(() => {
      const app = window.setuApp || window.app;
      if (app) {
        app.sim.seek(4500);
        if (app.setuTwin) {
          app.setuTwin.triggerPacketPulse(0, 1, 3, 1, 62);
        }
        if (app.wristbandTwin) {
          app.wristbandTwin.triggerHaptic();
        }
      }
    });
    await pageDesk.waitForTimeout(250);
    await pageDesk.screenshot({ path: path.join(screensDir, 'V_W1_04_ack_buzz.png') });
    console.log('Captured docs/screens/V_W1_04_ack_buzz.png');

    // 4D. V_heatmap_node1.png: Coverage heatmap toggled on for Node 1
    console.log('Toggling coverage heatmap for Node 1...');
    await pageDesk.evaluate(async () => {
      const app = window.setuApp || window.app;
      if (app && app.setuTwin) {
        app.setuTwin.selectedNodeId = 1;
        await app.setuTwin.toggleCoverageHeatmap();
      }
    });
    await pageDesk.waitForTimeout(600);
    await pageDesk.screenshot({ path: path.join(screensDir, 'V_heatmap_node1.png') });
    console.log('Captured docs/screens/V_heatmap_node1.png');

    // Scene object verification for V3 test requirement
    const sceneVerification = await pageDesk.evaluate(() => {
      const app = window.setuApp || window.app;
      const twin = app && app.setuTwin;
      if (!twin) return { error: 'Twin not initialized' };
      return {
        linkCount: twin.linkObjects ? twin.linkObjects.length : 0,
        activePulses: twin.activePulses ? twin.activePulses.length : 0,
        airtimeRings: twin.airtimeRings ? twin.airtimeRings.length : 0,
        wallHighlights: twin.wallHighlights ? twin.wallHighlights.length : 0,
        heatmapTiles: twin.heatmapGroup ? twin.heatmapGroup.children.length : 0
      };
    });
    console.log('V3 Scene Objects Verification:', sceneVerification);

    await pageDesk.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

capture().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
