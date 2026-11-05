import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function analyzeScreenshot(filePath, canvasCrop = { x: 260, y: 70, width: 940, height: 570 }) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Screenshot file not found: ${filePath}`);
  }

  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader']
    });
  } catch (e) {
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader']
    });
  }
  const page = await browser.newPage();

  const base64Data = fs.readFileSync(filePath).toString('base64');
  const dataUrl = `data:image/png;base64,${base64Data}`;

  const metrics = await page.evaluate(async ({ dataUrl, crop }) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = crop.width;
        canvas.height = crop.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);

        const imgData = ctx.getImageData(0, 0, crop.width, crop.height);
        const data = imgData.data;
        const totalPixels = crop.width * crop.height;

        // Clear color is approximately slate navy: R=12, G=21, B=39 (0x0c1527)
        const clearR = 12;
        const clearG = 21;
        const clearB = 39;

        let nonClearCount = 0;
        let luminanceSum = 0;
        const luminances = [];

        let cyanCount = 0;   // Survivor: R < 60, G > 170, B > 190
        let amberCount = 0;  // Relay / Wall: R > 190, G > 110, B < 80
        let greenCount = 0;  // Hub / ACK: R < 60, G > 140, B < 160
        let redCount = 0;    // Red / Weak link: R > 180, G < 80, B < 80
        let purpleCount = 0; // Purple / Packet pulse: R > 130, G < 100, B > 180

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const diff = Math.max(Math.abs(r - clearR), Math.abs(g - clearG), Math.abs(b - clearB));
          if (diff > 18) {
            nonClearCount++;
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            luminanceSum += lum;
            luminances.push(lum);

            // Role and Radio physics colors
            if (r < 60 && g > 170 && b > 190) cyanCount++;
            else if (r > 190 && g > 110 && b < 80) amberCount++;
            else if (r < 60 && g > 140 && b < 160) greenCount++;
            else if (r > 180 && g < 80 && b < 80) redCount++;
            else if (r > 130 && g < 100 && b > 180) purpleCount++;
          }
        }

        luminances.sort((a, b) => a - b);
        const p95Idx = Math.floor(luminances.length * 0.95);
        const p95 = luminances.length > 0 ? luminances[p95Idx] : 0;
        const meanLum = nonClearCount > 0 ? luminanceSum / nonClearCount : 0;
        const coveragePct = (nonClearCount / totalPixels) * 100;

        resolve({
          totalPixels,
          nonClearCount,
          coveragePct: Math.round(coveragePct * 10) / 10,
          meanLuminance: Math.round(meanLum * 10) / 10,
          p95Luminance: Math.round(p95 * 10) / 10,
          cyanPixels: cyanCount,
          amberPixels: amberCount,
          greenPixels: greenCount,
          redPixels: redCount,
          purplePixels: purpleCount
        });
      };
      img.src = dataUrl;
    });
  }, { dataUrl, crop: canvasCrop });

  await browser.close();
  return metrics;
}

async function run() {
  console.log('================================================================');
  console.log('  Project Setu: Automated Pixel & Radio Visual Assertions Suite');
  console.log('================================================================\n');

  // Baseline at time zero (Landing state: no packet in flight)
  const landingPath = path.join(projectRoot, 'docs', 'screens', 'V_W1_01_landing.png');
  const t0Metrics = await analyzeScreenshot(landingPath);
  console.log('[Baseline t=0.0s] V_W1_01_landing.png:', t0Metrics);
  assert.ok(t0Metrics.coveragePct >= 12.0, `Baseline coverage must be >= 12% (got ${t0Metrics.coveragePct}%)`);
  assert.ok(t0Metrics.meanLuminance >= 35.0, `Baseline mean luminance must be >= 35 (got ${t0Metrics.meanLuminance})`);
  console.log('  [ PASS ] Baseline landing scene is non-empty and lit (Coverage: ' + t0Metrics.coveragePct + '%)');

  // In-flight transmission moment (t=3.1s: Trapped SOS packet in flight)
  const inFlightPath = path.join(projectRoot, 'docs', 'screens', 'V_W1_02_demo_t3.png');
  const inFlightMetrics = await analyzeScreenshot(inFlightPath);
  console.log('\n[In-Flight t=3.1s] V_W1_02_demo_t3.png:', inFlightMetrics);

  // Core Requirement 4 Assertion: link/pulse pixels at an in flight moment must exceed link pixels at time zero
  console.log(`Comparing in-flight packet pulse pixels: t=3.1s (${inFlightMetrics.purplePixels}) vs t=0.0s (${t0Metrics.purplePixels})...`);
  assert.ok(
    inFlightMetrics.purplePixels > t0Metrics.purplePixels,
    `In-flight radio packet pulse pixels (${inFlightMetrics.purplePixels}) must strictly exceed baseline at time zero (${t0Metrics.purplePixels})`
  );
  console.log('  [ PASS ] In-flight radio packet pulse pixels strictly exceed time zero baseline!');

  assert.ok(inFlightMetrics.purplePixels > 100, `In-flight pulse pixels must be visible (>100, got ${inFlightMetrics.purplePixels})`);
  assert.ok(inFlightMetrics.amberPixels > 100, `Amber wall crossing highlight pixels must be visible (>100, got ${inFlightMetrics.amberPixels})`);
  assert.ok(inFlightMetrics.coveragePct >= 12.0, `Coverage must be >= 12% (got ${inFlightMetrics.coveragePct}%)`);
  assert.ok(inFlightMetrics.meanLuminance >= 35.0, `Mean luminance must be >= 35 (got ${inFlightMetrics.meanLuminance})`);
  assert.ok(inFlightMetrics.p95Luminance >= 120.0, `P95 luminance must be >= 120 (got ${inFlightMetrics.p95Luminance})`);
  console.log('  [ PASS ] In-flight radio physics, wall attenuation, and scene luminance assertions passed!');

  // Intermediate hop (t=8.2s)
  const hopPath = path.join(projectRoot, 'docs', 'screens', 'V_W1_03_demo_t8.png');
  const hopMetrics = await analyzeScreenshot(hopPath);
  assert.ok(hopMetrics.amberPixels > 100, `Intermediate hop amber pixels must be visible (>100, got ${hopMetrics.amberPixels})`);
  console.log('  [ PASS ] Intermediate hop relay packet and obstacle highlights passed!');

  // ACK return (t=4.5s)
  const ackPath = path.join(projectRoot, 'docs', 'screens', 'V_W1_04_ack_buzz.png');
  const ackMetrics = await analyzeScreenshot(ackPath);
  assert.ok(ackMetrics.greenPixels > 100, `ACK arrival green pixels must be visible (>100, got ${ackMetrics.greenPixels})`);
  console.log('  [ PASS ] ACK arrival green airtime ring assertions passed!');

  // Subterranean rescue cutaway
  const subPath = path.join(projectRoot, 'docs', 'screens', 'scenario_7_subterranean.png');
  const subMetrics = await analyzeScreenshot(subPath);
  assert.ok(subMetrics.coveragePct >= 12.0, `Scenario 7 coverage must be >= 12% (got ${subMetrics.coveragePct}%)`);
  assert.ok(subMetrics.meanLuminance >= 35.0, `Scenario 7 mean luminance must be >= 35 (got ${subMetrics.meanLuminance})`);
  console.log('  [ PASS ] Subterranean cutaway coverage and luminance assertions passed!');

  // Coverage heatmap overlay
  const heatPath = path.join(projectRoot, 'docs', 'screens', 'V_heatmap_node1.png');
  const heatMetrics = await analyzeScreenshot(heatPath);
  assert.ok(heatMetrics.amberPixels > 100, `Heatmap path loss tiles must be visible (>100, got ${heatMetrics.amberPixels})`);
  console.log('  [ PASS ] Coverage heatmap path loss overlay assertions passed!');

  console.log('\n================================================================');
  console.log('  ALL PIXEL & RADIO PHYSICS VISUAL ASSERTIONS PASSED!');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n[ FAIL ] Pixel assertion error:', err.message);
  process.exit(1);
});
