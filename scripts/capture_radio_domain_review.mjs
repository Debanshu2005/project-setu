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
  const port = 3599;
  const server = await startServer(port);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 }
  });

  await page.goto(`http://localhost:${port}/dashboard/index.html`);
  await page.waitForTimeout(1000);

  // Switch to analytics
  await page.click('#btnModeAnalytics');
  await page.waitForTimeout(600);

  // Capture top view
  await page.screenshot({ path: 'docs/screens/V_radio_workspace_top.png' });

  // Scroll down in plot area to view Plot 3C and Plot 3D
  await page.evaluate(() => {
    const root = document.querySelector('.analytics-workspace-root');
    if (root) root.scrollTop = 420;
  });
  await page.waitForTimeout(600);

  // Capture bottom view
  await page.screenshot({ path: 'docs/screens/V_radio_workspace_bottom.png' });

  await browser.close();
  server.close();
  console.log('Screenshots captured successfully to docs/screens/V_radio_workspace_*.png');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

