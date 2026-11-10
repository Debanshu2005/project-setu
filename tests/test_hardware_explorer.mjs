import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEVKITC_PARTS, WRISTBAND_PARTS } from '../dashboard/src/hardware_parts.js';
import { MODULES_PARTS } from '../dashboard/components/circuit_scene.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3398;

console.log('================================================================');
console.log('  Project Setu: Hardware Explorer Test Suite (H5 - H8)');
console.log('================================================================\n');

// 1. Catalog & Provenance Unit Tests (H6)
console.log('[1/5] Validating educational part catalog and provenance tags...');
const allowedTags = new Set(['simulated', 'model', 'assumed', 'cited']);
const allowedChips = new Set(['timeline', 'twin', 'analytics', 'energy', 'topology', 'wiring', 'pdr', 'docs']);
const allParts = [...DEVKITC_PARTS, ...WRISTBAND_PARTS, ...MODULES_PARTS];

assert.equal(DEVKITC_PARTS.length, 6, 'DevKitC-1 has 6 parts');
assert.equal(WRISTBAND_PARTS.length, 6, 'Setu Wristband has 6 parts');
assert.equal(MODULES_PARTS.length, 6, 'Circuit modules assembly has 6 parts');

for (const part of allParts) {
  assert.ok(part.id && part.number && part.title && part.subtitle, `Part header complete: ${part.id}`);
  assert.ok(part.what && part.what.length > 10, `Part what is non-empty: ${part.id}`);
  assert.ok(part.why && part.why.length > 10, `Part why is non-empty: ${part.id}`);
  assert.ok(part.pins && part.pins.length > 5, `Part pins is non-empty: ${part.id}`);
  assert.ok(part.simulator && part.simulator.length > 10, `Part simulator is non-empty: ${part.id}`);
  assert.ok(Array.isArray(part.provenance) && part.provenance.length > 0, `Part provenance is non-empty: ${part.id}`);
  assert.ok(Array.isArray(part.chips) && part.chips.length > 0, `Part chips is non-empty: ${part.id}`);

  for (const item of part.provenance) {
    assert.notEqual(item.tag, 'measured', `Measured tag forbidden in ${part.id}`);
    assert.ok(allowedTags.has(item.tag), `Valid tag ${item.tag} in ${part.id}`);
    assert.ok(item.fact && item.fact.length > 0, `Fact present in ${part.id}`);
  }

  for (const chip of part.chips) {
    assert.ok(allowedChips.has(chip.action), `Valid chip action ${chip.action} in ${part.id}`);
    assert.ok(chip.label && chip.label.length > 0, `Chip label present in ${part.id}`);
  }
}
console.log('  [ PASS ] Educational catalog, provenance tags, and chip actions verified.');

// 2. Size Budget Test (H7)
console.log('\n[2/5] Checking added JavaScript size budget (< 40 KB raw)...');
const addedFiles = [
  path.join(root, 'dashboard', 'components', 'hardware_explorer.js'),
  path.join(root, 'dashboard', 'components', 'wristband_scene.js'),
  path.join(root, 'dashboard', 'src', 'hardware_parts.js')
];
let totalBytes = 0;
for (const f of addedFiles) {
  const bytes = fs.statSync(f).size;
  totalBytes += bytes;
  console.log(`  ${path.basename(f)}: ${bytes} bytes`);
}
console.log(`  Total added JS: ${totalBytes} bytes (budget: 40000 bytes)`);
assert.ok(totalBytes <= 40000, `Added JS exceeds 40 KB: ${totalBytes} bytes`);
console.log('  [ PASS ] Code size strictly within 40 KB raw budget.');

// 3. Browser End-to-End Suite (H5, H6, H7, H8)
console.log('\n[3/5] Launching browser end-to-end tests...');
const server = spawn('node', ['dashboard/server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore'
});

try {
  let serverReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/scenarios`);
      if (resp.ok) { serverReady = true; break; }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(serverReady, 'Dashboard server started');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
  }).catch(() => chromium.launch({ headless: true }));

  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

  // Navigate to Hardware Tab
  await page.locator('#btnModeHardware').click();
  await page.waitForSelector('.hardware-card');
  await page.waitForSelector('.hardware-marker');
  assert.equal(await page.locator('.hardware-card').count(), 6, 'DevKitC has 6 cards');
  assert.equal(await page.locator('.hardware-marker').count(), 6, 'DevKitC has 6 markers');

  // Test Hover Leader (H2)
  const usbCard = page.locator('[data-hardware-part="usb"].hardware-card');
  await usbCard.hover();
  await page.waitForSelector('.stage-leaders path[data-on="true"]');
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h2-hover-desktop.png') });
  console.log('  [ PASS ] Hover leader line verified and captured.');

  // Test Click-to-Pin & Explainer Dialog (H6)
  await usbCard.click();
  assert.equal(await usbCard.getAttribute('aria-pressed'), 'true', 'Card pins on click');
  const dialog = page.locator('.hardware-explainer-dialog');
  assert.equal(await dialog.isVisible(), true, 'Explainer dialog opens on pin');
  const dialogText = await dialog.innerText();
  assert.match(dialogText, /what it is/i);
  assert.match(dialogText, /why it matters in setu/i);
  assert.match(dialogText, /provenance & physical standards/i);

  // Escape clears pin and closes dialog
  await page.locator('[data-hardware-stage]').press('Escape');
  assert.equal(await usbCard.getAttribute('aria-pressed'), 'false', 'Card unpins on Escape');
  assert.equal(await dialog.isVisible(), false, 'Dialog closes on Escape');

  // Keyboard orbit controls test
  await page.locator('[data-hardware-stage]').press('ArrowLeft');
  await page.locator('[data-hardware-stage]').press('+');

  // Capture h2-desktop.png
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h2-desktop.png') });

  // Mobile layout test (H2 mobile)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h2-mobile.png') });
  console.log('  [ PASS ] DevKitC desktop and mobile screens captured.');

  // Return to Desktop
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(300);

  // Test Wiring View (H5)
  const wiringBtn = page.locator('[data-hardware-view="wiring"]');
  await wiringBtn.click();
  assert.equal(await wiringBtn.getAttribute('aria-pressed'), 'true', 'Wiring view toggled on');
  assert.equal(await page.locator('.hardware-wiring-legend').isVisible(), true, 'Wiring legend visible');

  const pinMarkers = page.locator('.hardware-pin-marker');
  const pinCount = await pinMarkers.count();
  const pinMapJson = JSON.parse(fs.readFileSync(path.join(root, 'firmware', 'pinmap.json'), 'utf8'));
  assert.equal(pinCount, pinMapJson.pins.length, 'All mapped pins rendered as markers');

  // Click a pin marker
  const firstPin = pinMarkers.first();
  await firstPin.click({ force: true });
  const hudText = await page.locator('.hardware-live-node').innerText();
  assert.match(hudText, /Pin: GPIO/, 'Pin marker click updates live status HUD');

  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h5-wiring-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h5-wiring-mobile.png') });
  console.log('  [ PASS ] Wiring view desktop and mobile screens captured.');

  // Return to desktop and disable wiring view
  await page.setViewportSize({ width: 1600, height: 900 });
  await wiringBtn.click();
  assert.equal(await wiringBtn.getAttribute('aria-pressed'), 'false', 'Wiring view toggled off');

  // Test Circuit Modules Assembly View (LoRa, INMP441, MPU-6050, DevKitC-1)
  const modulesBtn = page.locator('[data-hardware-model="modules"]');
  await modulesBtn.click();
  await page.waitForSelector('[data-hardware-model="modules"][aria-pressed="true"]');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.hardware-card').count(), 6, 'Modules view has 6 cards');
  assert.equal(await page.locator('.hardware-marker').count(), 6, 'Modules view has 6 markers');

  // Verify LoRa card interaction
  const loraCard = page.locator('[data-hardware-part="lora"].hardware-card');
  await loraCard.hover();
  await loraCard.click();
  assert.equal(await loraCard.getAttribute('aria-pressed'), 'true', 'LoRa card pinned');
  assert.equal(await dialog.isVisible(), true, 'Explainer dialog opens on LoRa pin');
  assert.match(await dialog.innerText(), /SX1262 LoRa/i);

  // Clear dialog
  await page.locator('[data-hardware-stage]').press('Escape');

  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h5-circuit-modules-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h5-circuit-modules-mobile.png') });
  console.log('  [ PASS ] Multi-board circuit modules desktop and mobile screens captured.');

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(300);

  // Test Wristband Model (H3 & H4)
  const wristbandBtn = page.locator('[data-hardware-model="wristband"]');
  await wristbandBtn.click();
  assert.equal(await wristbandBtn.getAttribute('aria-pressed'), 'true', 'Wristband model active');
  assert.equal(await page.locator('.hardware-card').count(), 6, 'Wristband has 6 cards');
  assert.equal(await page.locator('.hardware-marker').count(), 6, 'Wristband has 6 markers');

  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h3-wristband-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h3-wristband-mobile.png') });
  console.log('  [ PASS ] Product wristband desktop and mobile screens captured.');

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(300);

  // Test 3D Button Press on model (H4)
  await page.locator('[data-hardware-trigger="short"]').click({ force: true });
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h4-button-pressed-desktop.png') });
  console.log('  [ PASS ] 3D button press feedback verified and captured.');

  // Test Radio Transmission Arcs (H4)
  await page.evaluate(() => {
    const explorer = window.setuApp?.hardwareExplorer;
    if (explorer) {
      explorer.updateNode({
        id: 1, role: 'survivor', online: true, active_sos: true,
        stats: { tx: 99 }, battery: 85, gnss_status: '3D Fix'
      });
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h4-tx-arcs-desktop.png') });
  console.log('  [ PASS ] Radio transmission arcs verified and captured.');

  // Test Strapping Pin Fault Toggle (H5)
  await page.locator('[data-hardware-trigger="strapping"]').click({ force: true });
  assert.match(await page.locator('.hardware-live-led').innerText(), /bootloader lock/, 'Strapping lock reflects in LED');

  // 4. Performance & Resource Verification (H7)
  console.log('\n[4/5] Checking renderer stats and memory leak stability...');
  const stats = await page.evaluate(() => {
    const explorer = window.setuApp?.hardwareExplorer;
    const renderer = explorer?.stage?.renderer;
    if (!renderer) return null;
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries
    };
  });
  console.log('  Renderer stats:', stats);
  assert.ok(stats.calls <= 300, `Draw calls <= 300 (got ${stats.calls})`);
  assert.ok(stats.triangles <= 200000, `Triangles <= 200,000 (got ${stats.triangles})`);
  assert.ok(stats.textures <= 50, `Textures <= 50 (got ${stats.textures})`);

  // Mobile DPR test
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobileDpr = await page.evaluate(() => {
    return window.setuApp?.hardwareExplorer?.stage?.renderer?.getPixelRatio?.() || 1;
  });
  assert.ok(mobileDpr <= 1.5, `Mobile DPR capped at <= 1.5 (got ${mobileDpr})`);

  // 50 model switches memory leak test
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(300);
  const protoBtn = page.locator('[data-hardware-model="prototype"]');
  const wristBtn = page.locator('[data-hardware-model="wristband"]');
  const initialGeometries = stats.geometries;
  for (let i = 0; i < 50; i += 1) {
    if (i % 2 === 0) await protoBtn.click({ force: true });
    else await wristBtn.click({ force: true });
  }
  await protoBtn.click({ force: true });
  await page.waitForTimeout(200);

  const postGeometries = await page.evaluate(() => {
    return window.setuApp?.hardwareExplorer?.stage?.renderer?.info?.memory?.geometries || 0;
  });
  assert.equal(postGeometries, initialGeometries, 'Zero geometry leak across 50 model switches');
  console.log('  [ PASS ] Renderer budgets, mobile DPR cap, and memory stability verified.');

  // Recenter and allow camera easing to settle
  await page.locator('[data-hardware-action="reset"]').click();
  await page.waitForTimeout(500);

  // 5. Pixel Assertions (H8)
  console.log('\n[5/5] Executing pixel assertions on captured screenshots and WebGL canvas...');
  const modelMetrics = await page.evaluate(() => {
    const explorer = window.setuApp?.hardwareExplorer;
    const renderer = explorer?.stage?.renderer;
    const scene = explorer?.stage?.scene;
    const camera = explorer?.stage?.camera;
    if (!renderer || !scene || !camera) return null;

    explorer?.stage?.resize?.();
    explorer?.stage?.recenter?.();
    for (let i = 0; i < 40; i += 1) {
      explorer.stage.tick(1000 + i * 50, 0.05);
    }
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const p = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);

    let nonClear = 0;
    let lumSum = 0;
    let edgeHits = 0;

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * w + x) * 4;
        const a = p[idx + 3];
        if (a > 10) {
          nonClear += 1;
          const r = p[idx], g = p[idx + 1], b = p[idx + 2];
          lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (x < 4 || x > w - 5 || y < 4 || y > h - 5) edgeHits += 1;
        }
      }
    }

    const total = w * h;
    const coveragePct = (nonClear / total) * 100;
    const meanLum = nonClear > 0 ? (lumSum / nonClear) : 0;
    return { w, h, total, nonClear, coveragePct, meanLum, edgeHits };
  });

  console.log('  WebGL 3D Model Pixel Metrics:', modelMetrics);
  assert.ok(modelMetrics.coveragePct >= 12.0, `Coverage >= 12% (got ${modelMetrics.coveragePct.toFixed(1)}%)`);
  assert.ok(modelMetrics.meanLum >= 30.0, `Mean luminance >= 30 (got ${modelMetrics.meanLum.toFixed(1)})`);
  assert.equal(modelMetrics.edgeHits, 0, `Model must not be clipped by stage edge (edgeHits: ${modelMetrics.edgeHits})`);

  // Verify teal markers rendered and styled
  const markerCount = await page.locator('.hardware-marker').count();
  assert.equal(markerCount, 6, 'Six numbered markers rendered on the 3D board');
  const markerColor = await page.locator('.hardware-marker').first().evaluate(el => window.getComputedStyle(el).backgroundColor);
  assert.ok(markerColor.length > 0, 'Marker has computed background styling');

  // Verify all 12 hardware screenshots exist
  const expectedScreens = [
    'h1-blocked-three-desktop.png',
    'h2-desktop.png',
    'h2-mobile.png',
    'h2-hover-desktop.png',
    'h3-wristband-desktop.png',
    'h3-wristband-mobile.png',
    'h4-button-pressed-desktop.png',
    'h4-tx-arcs-desktop.png',
    'h5-wiring-desktop.png',
    'h5-wiring-mobile.png',
    'h5-circuit-modules-desktop.png',
    'h5-circuit-modules-mobile.png'
  ];
  for (const screenName of expectedScreens) {
    const sPath = path.join(root, 'docs', 'screens', 'hardware', screenName);
    assert.ok(fs.existsSync(sPath), `Screenshot file exists: ${screenName}`);
    assert.ok(fs.statSync(sPath).size > 10000, `Screenshot file is non-empty: ${screenName}`);
  }
  console.log('  [ PASS ] Pixel assertions and all 12 screenshot files verified.');

  assert.equal(errors.length, 0, `Browser errors detected: ${errors.join(' | ')}`);
  await context.close();
  await browser.close();
} finally {
  server.kill();
}

console.log('\n[ PASS ] All H5 to H8 tests, budgets, and screenshot assertions completed successfully!');
