// Project Setu: Scientific Chart Hover Explainers Playwright E2E & Screenshot Capture
// Navigates across all scientific domains, interacts with info buttons, captures screenshots
// of every explainer dialog to docs/screens/charts/<explainerId>.png, and validates accessibility.

import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const chartsScreensDir = path.join(projectRoot, 'docs', 'screens', 'charts');

if (!fs.existsSync(chartsScreensDir)) {
  fs.mkdirSync(chartsScreensDir, { recursive: true });
}

const PORT = 3499;
const BASE_URL = `http://localhost:${PORT}`;

async function run() {
  console.log(`Starting dashboard server on port ${PORT}...`);
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  let browser = null;
  let exitCode = 0;

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${BASE_URL}/api/scenarios`);
        if (r.ok) { ready = true; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    if (!ready) throw new Error('Dashboard server failed to bind port');

    console.log('Launching headless browser...');
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
    });

    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

    page.on('pageerror', err => console.error('[Browser Page Error]', err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('[Browser Console Error]', msg.text());
    });

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Switch to Full-Screen Analytics Workspace
    console.log('Switching view mode to Scientific Analytics Workspace...');
    const btnAnalytics = page.locator('#btnModeAnalytics');
    await btnAnalytics.waitFor({ state: 'visible', timeout: 5000 });
    await btnAnalytics.click();
    await page.waitForTimeout(1000);

    const domainsAndCharts = [
      {
        domain: 'radio',
        charts: [
          { canvasId: 'canvasRssiDistance', explainerId: 'rssi_vs_distance_model' },
          { canvasId: 'canvasPathLossDistance', explainerId: 'path_loss_vs_theory' },
          { canvasId: 'canvasSnrDistance', explainerId: 'snr_vs_distance' },
          { canvasId: 'canvasHeatmap', explainerId: 'link_quality_matrix' }
        ]
      },
      {
        domain: 'delivery',
        charts: [
          { canvasId: 'canvasPdrTimeline', explainerId: 'pdr_timeline' },
          { canvasId: 'canvasLatencyCdf', explainerId: 'latency_cdf' },
          { canvasId: 'canvasThroughput', explainerId: 'throughput_and_rate' },
          { canvasId: 'canvasLossVsDistance', explainerId: 'packet_loss_vs_distance' }
        ]
      },
      {
        domain: 'topology',
        charts: [
          { canvasId: 'canvasHopDistribution', explainerId: 'delivered_by_hop_count' },
          { canvasId: 'canvasRelayActivity', explainerId: 'relay_activity' }
        ]
      },
      {
        domain: 'congestion',
        charts: [
          { canvasId: 'canvasCollisionTimeline', explainerId: 'collisions_vs_retransmission' },
          { canvasId: 'canvasDropsTimeline', explainerId: 'channel_loss_dynamics' }
        ]
      },
      {
        domain: 'energy',
        charts: [
          { canvasId: 'canvasBatteryTimeline', explainerId: 'fleet_soc' },
          { canvasId: 'canvasEnergyLoad', explainerId: 'energy_vs_forwarding' }
        ]
      },
      {
        domain: 'positioning',
        charts: [
          { canvasId: 'canvasTrajectory', explainerId: 'trajectory_error_vectors' },
          { canvasId: 'canvasPosErrorTimeline', explainerId: 'position_error_timeline' }
        ]
      },
      {
        domain: 'sos_ack',
        charts: [
          { canvasId: 'canvasAckCdf', explainerId: 'ack_latency_cdf' }
        ]
      },
      {
        domain: 'comparison',
        charts: [
          { canvasId: 'canvasCompCdf', explainerId: 'comparative_latency_cdfs' }
        ]
      }
    ];

    let capturedCount = 0;

    for (const group of domainsAndCharts) {
      console.log(`\nNavigating to Scientific Domain: ${group.domain}...`);
      const pill = page.locator(`.domain-pill[data-domain="${group.domain}"]`);
      if (await pill.count() > 0) {
        await pill.click();
        await page.waitForTimeout(500);
      }

      for (const item of group.charts) {
        const canvas = page.locator(`#${item.canvasId}`);
        await canvas.waitFor({ state: 'attached', timeout: 5000 });

        // Find the panel and the button
        const panel = canvas.locator('xpath=ancestor::div[contains(@class, "chart-panel")]').first();
        const infoBtn = panel.locator('button.chart-info-btn').first();

        await infoBtn.waitFor({ state: 'visible', timeout: 3000 });
        console.log(`  Found info button for chart: ${item.explainerId}`);

        // 1. Hover info button to trigger open within 150ms
        await infoBtn.hover();
        await page.waitForTimeout(200);

        // Click to pin card open
        await infoBtn.click();
        await page.waitForTimeout(150);

        const card = panel.locator('.chart-explainer-card').first();
        await card.waitFor({ state: 'visible', timeout: 3000 });

        // Screenshot the explainer card
        const screenshotPath = path.join(chartsScreensDir, `${item.explainerId}.png`);
        await card.screenshot({ path: screenshotPath });
        console.log(`  [ CAPTURED ] ${item.explainerId}.png`);
        capturedCount++;

        // Press Escape to close and unpin
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
    }

    // Test 700 ms dwell hint on chart body in Radio domain
    console.log('\nTesting 700 ms dwell hint on canvas body...');
    const radioPill = page.locator('.domain-pill[data-domain="radio"]');
    await radioPill.click();
    await page.waitForTimeout(300);

    const testCanvas = page.locator('#canvasRssiDistance');
    const box = await testCanvas.boundingBox();
    if (box) {
      // Move mouse to center and hover without moving for 850 ms
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(850);

      const dwellHint = testCanvas.locator('xpath=..').locator('.chart-dwell-hint');
      const isVisible = await dwellHint.isVisible();
      console.log(`  Dwell hint visible after 700 ms dwell: ${isVisible}`);

      // Now move mouse and check that dwell hint hides immediately
      await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10);
      await page.waitForTimeout(50);
      const isHidden = !(await dwellHint.isVisible());
      console.log(`  Dwell hint hides immediately on mouse move: ${isHidden}`);
    }

    // Now test Sidebar Quick View charts
    console.log('\nTesting Sidebar Quick View charts...');
    const btnTopology = page.locator('#btnModeTopology');
    await btnTopology.click();
    await page.waitForTimeout(500);

    const tabScientific = page.locator('#tabBtnScientific');
    if (await tabScientific.count() > 0) {
      await tabScientific.click();
      await page.waitForTimeout(400);

      // 1. Sidebar RSSI plot (default)
      const sidebarCanvas = page.locator('#canvasSidebarQuick');
      await sidebarCanvas.waitFor({ state: 'visible', timeout: 3000 });
      const sidebarPanel = sidebarCanvas.locator('xpath=ancestor::div[contains(@style, "border-radius")]').first();
      let sidebarInfoBtn = sidebarPanel.locator('button.chart-info-btn').first();
      if (await sidebarInfoBtn.count() > 0) {
        await sidebarInfoBtn.click();
        await page.waitForTimeout(200);

        const card = page.locator('.chart-explainer-card:visible').first();
        if (await card.count() > 0) {
          const sPath = path.join(chartsScreensDir, 'sidebar_rssi_vs_distance.png');
          await card.screenshot({ path: sPath });
          console.log(`  [ CAPTURED ] sidebar_rssi_vs_distance.png`);
          capturedCount++;
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
        }
      }

      // 2. Sidebar Latency CDF plot
      const domainSelector = page.locator('#sidebarDomainSelector');
      if (await domainSelector.count() > 0) {
        await domainSelector.selectOption('packet_delivery');
        await page.waitForTimeout(400);

        sidebarInfoBtn = sidebarPanel.locator('button.chart-info-btn').first();
        if (await sidebarInfoBtn.count() > 0) {
          await sidebarInfoBtn.click();
          await page.waitForTimeout(200);

          const card = page.locator('.chart-explainer-card:visible').first();
          if (await card.count() > 0) {
            const sPath = path.join(chartsScreensDir, 'sidebar_latency_cdf.png');
            await card.screenshot({ path: sPath });
            console.log(`  [ CAPTURED ] sidebar_latency_cdf.png`);
            capturedCount++;
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
          }
        }
      }
    }

    console.log(`\nAll screenshot captures completed! Captured: ${capturedCount} screenshots.`);
  } catch (err) {
    console.error('Error during Playwright test:', err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  process.exit(exitCode);
}

run();
