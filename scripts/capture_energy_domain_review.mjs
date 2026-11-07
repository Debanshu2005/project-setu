import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function startServer(port) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wasm': 'application/wasm'
  };

  const rootDir = process.cwd();

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/dashboard/index.html';

    let filePath = path.join(rootDir, reqPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(rootDir, 'dashboard', reqPath);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

async function main() {
  const port = 3602;
  const server = await startServer(port);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // 1. Capture on 1280x800 desktop
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 }
  });

  await page.goto(`http://localhost:${port}/dashboard/index.html`);
  await page.waitForTimeout(1000);

  // Switch to analytics
  await page.click('#btnModeAnalytics');
  await page.waitForTimeout(600);

  // Switch to Energy domain
  await page.click('button[data-domain="energy"]');
  await page.waitForTimeout(600);

  // Verify scrollTop is 0 and capture top view
  const topScroll = await page.evaluate(() => {
    const root = document.querySelector('.analytics-workspace-root');
    return root ? root.scrollTop : -1;
  });
  console.log('Top scroll position:', topScroll);
  await page.screenshot({ path: 'docs/screens/V_energy_workspace_top.png' });

  // Scroll down to view the Subsystem Energy Breakdown
  await page.evaluate(() => {
    const root = document.querySelector('.analytics-workspace-root');
    if (root) root.scrollTop = 260;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screens/V_energy_workspace_breakdown.png' });

  // Toggle sidebars visible
  await page.click('#btnToggleSidebars');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screens/V_energy_workspace_with_sidebars.png' });

  // 2. Capture on compact 1024x462 viewport (matching user screen)
  const compactPage = await browser.newPage({
    viewport: { width: 1024, height: 462 }
  });

  await compactPage.goto(`http://localhost:${port}/dashboard/index.html`);
  await compactPage.waitForTimeout(1000);
  await compactPage.click('#btnModeAnalytics');
  await compactPage.waitForTimeout(600);
  await compactPage.click('button[data-domain="energy"]');
  await compactPage.waitForTimeout(600);

  // Capture compact screen top view
  await compactPage.screenshot({ path: 'docs/screens/V_energy_workspace_compact_top.png' });

  // Toggle KPI ribbon off on compact screen for maximum chart room
  await compactPage.click('#btnToggleKpis');
  await compactPage.waitForTimeout(500);
  await compactPage.screenshot({ path: 'docs/screens/V_energy_workspace_compact_no_kpi.png' });

  await browser.close();
  server.close();
  console.log('Energy domain review screenshots captured successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
