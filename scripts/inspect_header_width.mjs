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
  const port = 3605;
  const server = await startServer(port);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 1024, height: 458 }
  });

  await page.goto(`http://localhost:${port}/dashboard/index.html`);
  await page.waitForTimeout(1000);

  // Capture current layout at 1024x458
  await page.screenshot({ path: 'docs/screens/header_after_1024.png' });

  for (const width of [1440, 1280, 1120, 1024]) {
    await page.setViewportSize({ width, height: 458 });
    await page.waitForTimeout(300);

    const metrics = await page.evaluate(() => {
      const header = document.querySelector('.app-header');
      const brand = document.querySelector('.brand-section');
      const actions = document.querySelector('.header-actions');
      const brandChildren = Array.from(brand.children).map(c => ({
        id: c.id || c.className,
        width: Math.round(c.getBoundingClientRect().width)
      }));
      const actionChildren = Array.from(actions.children).map(c => ({
        id: c.id || c.querySelector('input')?.id || c.className,
        text: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 18),
        width: Math.round(c.getBoundingClientRect().width),
        right: Math.round(c.getBoundingClientRect().right),
        isClipped: c.getBoundingClientRect().right > window.innerWidth
      }));

      return {
        windowWidth: window.innerWidth,
        brandWidth: Math.round(brand.getBoundingClientRect().width),
        actionsScrollWidth: actions.scrollWidth,
        actionsClientWidth: actions.clientWidth,
        brandChildren,
        actionChildren
      };
    });

    console.log(`Viewport ${width}px:`, JSON.stringify(metrics, null, 2));
  }

  await browser.close();
  server.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
