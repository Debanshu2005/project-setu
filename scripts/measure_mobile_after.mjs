// scripts/measure_mobile_after.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

async function main() {
  const PORT = 3799;
  const server = spawn('node', ['dashboard/server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe'
  });

  await new Promise((resolve, reject) => {
    server.stdout.on('data', data => {
      if (data.toString().includes('http://0.0.0.0:' + PORT)) resolve();
    });
    server.stderr.on('data', data => console.error(data.toString()));
    server.on('error', reject);
  });
  console.log('Server running on ' + PORT);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader']
  });

  const results = {};

  for (const [name, width, height] of [['390x844', 390, 844], ['360x740', 360, 740]]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 3
    });
    await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const stats = await page.evaluate(() => {
      // Find visible clickables with w < 44 or h < 44
      const clickables = Array.from(document.querySelectorAll('button, a, input, select, .view-toggle-btn, .timeline-btn, .thumb-btn'));
      let smallTargets = 0;
      const targetSizes = [];
      for (const el of clickables) {
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            if (rect.width < 44 || rect.height < 44) {
              smallTargets++;
              targetSizes.push({ tag: el.tagName, id: el.id, class: el.className, w: Math.round(rect.width), h: Math.round(rect.height) });
            }
          }
        }
      }

      // Check text < 11px
      const allEls = Array.from(document.querySelectorAll('*'));
      let smallFonts = 0;
      const fontList = [];
      for (const el of allEls) {
        if (el.children.length === 0 && el.textContent.trim().length > 0) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            const fs = parseFloat(style.fontSize);
            if (fs < 11) {
              smallFonts++;
              fontList.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 20), fs });
            }
          }
        }
      }

      const header = document.querySelector('.app-header');
      const headerH = header ? Math.round(header.getBoundingClientRect().height) : 0;
      const thumbBar = document.getElementById('mobileThumbBar');
      const thumbH = thumbBar ? Math.round(thumbBar.getBoundingClientRect().height) : 0;
      const sidebarRight = document.querySelector('.sidebar-right');
      const sheetH = sidebarRight ? Math.round(sidebarRight.getBoundingClientRect().height) : 0;

      return { totalClickables: clickables.length, smallTargets, smallFonts, headerH, thumbH, sheetH, sampleSmallTargets: targetSizes.slice(0, 5), sampleSmallFonts: fontList.slice(0, 5) };
    });

    results[name] = stats;
    console.log(name + ' Stats:', JSON.stringify(stats, null, 2));

    const ssPath = path.join('docs', 'screens', 'perf', 'after_' + name + '.png');
    await page.screenshot({ path: ssPath, fullPage: false });
    console.log('Saved screenshot to ' + ssPath);

    // Test tapping sheet handle to go to half
    await page.click('#sheetHandleBar');
    await page.waitForTimeout(400);
    const ssHalfPath = path.join('docs', 'screens', 'perf', 'sheet_half_' + name + '.png');
    await page.screenshot({ path: ssHalfPath, fullPage: false });
    console.log('Saved sheet half screenshot to ' + ssHalfPath);

    // Test tapping hamburger to open drawer
    await page.click('#btnMobileHeaderToggle');
    await page.waitForTimeout(400);
    const ssDrawerPath = path.join('docs', 'screens', 'perf', 'drawer_open_' + name + '.png');
    await page.screenshot({ path: ssDrawerPath, fullPage: false });
    console.log('Saved drawer screenshot to ' + ssDrawerPath);

    await page.close();
  }

  await browser.close();
  server.kill();

  if (!fs.existsSync('docs/perf/results')) fs.mkdirSync('docs/perf/results', { recursive: true });
  fs.writeFileSync('docs/perf/results/mobile_after.json', JSON.stringify(results, null, 2), 'utf8');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
