// Project Setu: Device-Adaptive WebGL Quality Tiers and Scenario Switch Memory Leak Test
// Verifies hardware tier detection, DPR capping (<=1.5 mobile, <=2.0 desktop),
// texture caching, clean Three.js resource disposal, and 10x scenario switch stability.

import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { getWebGLQualityTier, disposeThreeObject } from '../dashboard/src/webgl_tier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 3499;
const BASE_URL = `http://localhost:${PORT}`;

let passedCount = 0;
let failedCount = 0;

function assertTest(desc, cond, details = '') {
  if (cond) {
    console.log(`  [ PASS ] ${desc}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${desc} ${details ? '(' + details + ')' : ''}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu: Device-Adaptive WebGL and Memory Leak Test Suite');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // Part 1: Unit Tests for Quality Tier Detection
  // -------------------------------------------------------------------------
  console.log('[1/4] Testing Hardware Profile and Quality Tier Classification...');

  const tierMobile = getWebGLQualityTier(null, { isMobile: true, cores: 8, dpr: 3.0 });
  assertTest('Mobile device is classified as low tier', tierMobile.tier === 'low');
  assertTest('Mobile DPR is strictly capped at 1.0 for low tier', tierMobile.dprCap === 1.0);
  assertTest('Mobile effective DPR does not exceed 1.0 even on DPR 3 screen', tierMobile.effectiveDpr === 1.0);
  assertTest('Mobile tier disables shadows to preserve battery', tierMobile.shadows === false);
  assertTest('Mobile max particles budgeted to 100', tierMobile.maxParticles === 100);

  const tierSoftware = getWebGLQualityTier(null, {
    isMobile: false,
    cores: 16,
    dpr: 2.0,
    rendererStr: 'Google SwiftShader'
  });
  assertTest('SwiftShader software renderer classified as low tier', tierSoftware.tier === 'low');
  assertTest('SwiftShader DPR capped at 1.0', tierSoftware.dprCap === 1.0);

  const tierLaptop = getWebGLQualityTier(null, {
    isMobile: false,
    cores: 6,
    dpr: 2.0,
    rendererStr: 'Intel(R) Iris(R) Xe Graphics'
  });
  assertTest('Integrated Intel laptop GPU classified as medium tier', tierLaptop.tier === 'medium');
  assertTest('Medium tier DPR capped at 1.5', tierLaptop.dprCap === 1.5);
  assertTest('Medium tier enables basic shadows', tierLaptop.shadows === true && tierLaptop.shadowType === 'basic');
  assertTest('Medium tier max particles budgeted to 300', tierLaptop.maxParticles === 300);

  const tierDesktop = getWebGLQualityTier(null, {
    isMobile: false,
    cores: 16,
    dpr: 3.0,
    rendererStr: 'NVIDIA GeForce RTX 4080'
  });
  assertTest('High-end desktop GPU classified as high tier', tierDesktop.tier === 'high');
  assertTest('Desktop DPR capped at 2.0 (never 3.0 even on Retina)', tierDesktop.dprCap === 2.0);
  assertTest('Desktop tier enables PCF soft shadows', tierDesktop.shadows === true && tierDesktop.shadowType === 'pcf');
  assertTest('Desktop max particles budgeted to 800', tierDesktop.maxParticles === 800);

  // -------------------------------------------------------------------------
  // Part 2: Unit Tests for Recursive Resource Disposal
  // -------------------------------------------------------------------------
  console.log('\n[2/4] Testing Recursive Three.js Resource Disposal Logic...');

  let geomDisposed = false;
  let matDisposed = false;
  let mapDisposed = false;
  let bumpDisposed = false;

  const mockMesh = {
    geometry: { dispose: () => { geomDisposed = true; } },
    material: {
      map: { dispose: () => { mapDisposed = true; } },
      bumpMap: { dispose: () => { bumpDisposed = true; } },
      dispose: () => { matDisposed = true; }
    },
    children: []
  };

  const mockRoot = {
    children: [mockMesh]
  };

  disposeThreeObject(mockRoot);
  assertTest('Geometry dispose method called', geomDisposed);
  assertTest('Material map texture dispose called', mapDisposed);
  assertTest('Material bumpMap texture dispose called', bumpDisposed);
  assertTest('Material dispose method called', matDisposed);

  // -------------------------------------------------------------------------
  // Part 3: Live Browser Test: DPR Capping and Dynamic Texture Caching
  // -------------------------------------------------------------------------
  console.log('\n[3/4] Launching Headless Chromium to Verify Live DPR and Texture Caching...');

  let server;
  let browser;

  try {
    server = spawn('node', ['dashboard/server.js'], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore'
    });

    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${BASE_URL}/api/scenarios`);
        if (r.ok) { ready = true; break; }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 200));
    }
    assertTest('Dashboard server started on test port', ready);

    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
      });
    } catch (_) {
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
      });
    }

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3
    });
    const page = await context.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    // Switch to Setu Twin 3D View
    const mobileTwin = page.locator('#mobileBtnTwin');
    if (await mobileTwin.isVisible()) {
      await mobileTwin.click();
    } else {
      await page.locator('#btnModeTwin').click();
    }
    await page.waitForSelector('#setuTwinMount canvas', { timeout: 15000 });
    await page.waitForTimeout(1000);

    const clientReport = await page.evaluate(() => {
      const app = window.setuApp;
      if (!app || !app.setuTwin) return null;
      const twin = app.setuTwin;
      const renderer = twin.renderer;
      const pixelRatio = renderer ? renderer.getPixelRatio() : null;
      const qualityTier = twin.qualityTier;
      const cacheSize = twin.labelTextureCache ? twin.labelTextureCache.size : 0;
      const memInfo = renderer ? { ...renderer.info.memory } : null;

      return {
        hasTwin: true,
        pixelRatio,
        qualityTier,
        cacheSize,
        memInfo
      };
    });

    assertTest('Setu Twin 3D component mounted and initialized', clientReport?.hasTwin === true);
    assertTest('Quality tier is detected and assigned', Boolean(clientReport?.qualityTier));
    assertTest('DPR on mobile profile is capped at <= 1.5', clientReport?.pixelRatio <= 1.5, `Got: ${clientReport?.pixelRatio}`);
    assertTest('Node label textures are stored in labelTextureCache', clientReport?.cacheSize > 0, `Size: ${clientReport?.cacheSize}`);

    // -------------------------------------------------------------------------
    // Part 4: 10x Scenario Switch Stability and Memory Leak Verification
    // -------------------------------------------------------------------------
    console.log('\n[4/4] Executing 10 Consecutive Scenario Switches to Verify Disposal...');

    // On mobile viewports, ensure header drawer is open so scenario selector is interactable
    const btnDrawer = page.locator('#btnMobileHeaderToggle');
    if (await btnDrawer.isVisible() && !(await page.locator('#scenarioSelect').isVisible())) {
      await btnDrawer.click();
    }

    // Warm up one cycle so all unique node textures and shader programs are compiled
    await page.selectOption('#scenarioSelect', 'gps_denied_rescue');
    await page.waitForTimeout(600);
    await page.selectOption('#scenarioSelect', 'collapse_site_demo');
    await page.waitForTimeout(600);

    const baselineMemory = await page.evaluate(() => {
      const twin = window.setuApp?.setuTwin;
      if (twin) twin.requestRender();
      return {
        geometries: twin?.renderer?.info?.memory?.geometries || 0,
        textures: twin?.renderer?.info?.memory?.textures || 0,
        heapMb: (performance.memory ? performance.memory.usedJSHeapSize : 0) / (1024 * 1024)
      };
    });

    console.log(`  [Baseline] Geometries: ${baselineMemory.geometries}, Textures: ${baselineMemory.textures}, Heap: ${baselineMemory.heapMb.toFixed(2)} MB`);

    // Perform 10 consecutive switches
    for (let i = 0; i < 10; i++) {
      const scenarioTarget = (i % 2 === 0) ? 'gps_denied_rescue' : 'collapse_site_demo';
      await page.selectOption('#scenarioSelect', scenarioTarget);
      await page.waitForTimeout(300);
    }

    // Ensure we settle on initial baseline scenario
    await page.selectOption('#scenarioSelect', 'collapse_site_demo');
    await page.waitForTimeout(600);

    const postSwitchMemory = await page.evaluate(() => {
      const twin = window.setuApp?.setuTwin;
      if (twin) twin.requestRender();
      return {
        geometries: twin?.renderer?.info?.memory?.geometries || 0,
        textures: twin?.renderer?.info?.memory?.textures || 0,
        heapMb: (performance.memory ? performance.memory.usedJSHeapSize : 0) / (1024 * 1024)
      };
    });

    console.log(`  [Post-10x] Geometries: ${postSwitchMemory.geometries}, Textures: ${postSwitchMemory.textures}, Heap: ${postSwitchMemory.heapMb.toFixed(2)} MB`);

    const geomDelta = Math.abs(postSwitchMemory.geometries - baselineMemory.geometries);
    const texDelta = Math.abs(postSwitchMemory.textures - baselineMemory.textures);
    const heapGrowthMb = postSwitchMemory.heapMb - baselineMemory.heapMb;

    assertTest('Three.js geometry count returns to baseline within +/- 2', geomDelta <= 2, `Delta: ${geomDelta}`);
    assertTest('Three.js texture count returns to baseline within +/- 2', texDelta <= 2, `Delta: ${texDelta}`);
    assertTest('JS heap growth after 10 scenario switches is strictly under 15 MB', heapGrowthMb < 15, `Growth: ${heapGrowthMb.toFixed(2)} MB`);

  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }

  console.log('\n================================================================');
  console.log(`  WEBGL ADAPTIVE & LEAK SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
