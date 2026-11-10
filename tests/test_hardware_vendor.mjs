import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'dashboard', 'vendor', 'esp-labs');
const expectedParts = ['usb', 'buttons', 'rgb', 'module', 'antenna', 'headers'];
const portedFiles = ['stage3d.js', 'toon.js', 'esp32-scene.js', 'board.js', 'palette.js'];

for (const file of portedFiles) {
  const source = fs.readFileSync(path.join(vendor, file), 'utf8');
  assert.match(source, /Adapted from esp-labs-web/);
  assert.match(source, /MIT License/);
}

const { PART_ANCHORS } = await import('../dashboard/vendor/esp-labs/esp32-scene.js');
assert.deepEqual(Object.keys(PART_ANCHORS).sort(), expectedParts.slice().sort());
for (const part of expectedParts) {
  assert.equal(PART_ANCHORS[part].length, 3, `${part} has a 3D anchor`);
}

const notice = fs.readFileSync(path.join(vendor, 'THIRD_PARTY_NOTICE.txt'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'docs', 'THIRD_PARTY.md'), 'utf8');
assert.match(notice, /MIT License/);
assert.match(registry, /esp-labs-web procedural board modules/);
assert.match(fs.readFileSync(path.join(vendor, 'README.md'), 'utf8'), /src\/ui\/stage3d\/stage3d\.ts/);

const PORT = 3397;
const server = spawn('node', ['dashboard/server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore'
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/scenarios`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(ready, true, 'dashboard server starts for fallback verification');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.route('**/vendor/three/three.module.js', route => route.fulfill({ status: 503, body: 'Three.js blocked for fallback test' }));
  await page.locator('#btnModeHardware').click();
  await page.waitForSelector('.hardware-fallback', { timeout: 10000 });
  await page.screenshot({ path: path.join(root, 'docs', 'screens', 'hardware', 'h1-blocked-three-desktop.png') });
  assert.match(await page.locator('.hardware-fallback').innerText(), /static board preview/);
  assert.equal(await page.locator('#btnModeHardware').count(), 1, 'dashboard remains usable when Three.js is blocked');
  await context.close();
  await browser.close();
} finally {
  server.kill();
}

console.log('[ PASS ] Hardware vendor modules have MIT attribution and anchors for every part.');
