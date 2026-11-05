import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function analyzeScreenshot(filePath, canvasCrop = { x: 260, y: 70, width: 940, height: 570 }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
  console.log('Testing Checkpoint V-B Visual and Radio Pixel Metrics...\n');

  const demoPath = path.join(projectRoot, 'docs', 'screens', 'V_W1_02_demo_t3.png');
  const demoMetrics = await analyzeScreenshot(demoPath);
  console.log('collapse_site_demo t=3.1s (V_W1_02_demo_t3.png):', demoMetrics);
  console.log('  Coverage >= 12%:', demoMetrics.coveragePct >= 12.0 ? 'PASS' : 'FAIL');
  console.log('  Mean Lum >= 35:', demoMetrics.meanLuminance >= 35.0 ? 'PASS' : 'FAIL');
  console.log('  P95 Lum >= 120:', demoMetrics.p95Luminance >= 120.0 ? 'PASS' : 'FAIL');
  console.log('  Cyan (Survivor) pixels present:', demoMetrics.cyanPixels > 10 ? 'PASS' : 'FAIL');
  console.log('  Amber (Relay / Wall) pixels present:', demoMetrics.amberPixels > 10 ? 'PASS' : 'FAIL');
  console.log('  Green (Hub) pixels present:', demoMetrics.greenPixels > 10 ? 'PASS' : 'FAIL');

  const subPath = path.join(projectRoot, 'docs', 'screens', 'scenario_7_subterranean.png');
  const subMetrics = await analyzeScreenshot(subPath);
  console.log('\ngps_denied_rescue (scenario_7_subterranean.png):', subMetrics);
  console.log('  Coverage >= 12%:', subMetrics.coveragePct >= 12.0 ? 'PASS' : 'FAIL');
  console.log('  Mean Lum >= 35:', subMetrics.meanLuminance >= 35.0 ? 'PASS' : 'FAIL');

  const hopPath = path.join(projectRoot, 'docs', 'screens', 'V_W1_03_demo_t8.png');
  const hopMetrics = await analyzeScreenshot(hopPath);
  console.log('\nIntermediate Hop t=8.2s (V_W1_03_demo_t8.png):', hopMetrics);
  console.log('  Coverage >= 12%:', hopMetrics.coveragePct >= 12.0 ? 'PASS' : 'FAIL');
  console.log('  Amber (Relay / Obstacle) pixels present:', hopMetrics.amberPixels > 10 ? 'PASS' : 'FAIL');

  const ackPath = path.join(projectRoot, 'docs', 'screens', 'V_W1_04_ack_buzz.png');
  const ackMetrics = await analyzeScreenshot(ackPath);
  console.log('\nACK Arrival t=4.5s (V_W1_04_ack_buzz.png):', ackMetrics);
  console.log('  Coverage >= 12%:', ackMetrics.coveragePct >= 12.0 ? 'PASS' : 'FAIL');
  console.log('  Green (Hub / ACK) pixels present:', ackMetrics.greenPixels > 10 ? 'PASS' : 'FAIL');

  const heatPath = path.join(projectRoot, 'docs', 'screens', 'V_heatmap_node1.png');
  const heatMetrics = await analyzeScreenshot(heatPath);
  console.log('\nCoverage Heatmap Node 1 (V_heatmap_node1.png):', heatMetrics);
  console.log('  Coverage >= 12%:', heatMetrics.coveragePct >= 12.0 ? 'PASS' : 'FAIL');
  console.log('  Amber path loss tiles present:', heatMetrics.amberPixels > 10 ? 'PASS' : 'FAIL');
}

run().catch(console.error);
