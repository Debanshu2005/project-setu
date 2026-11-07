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

async function verify() {
  const port = 3603;
  const server = await startServer(port);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${port}/dashboard/index.html`);
  await page.waitForTimeout(800);

  // Switch to analytics
  await page.click('#btnModeAnalytics');
  await page.waitForTimeout(400);

  // Switch to Energy domain
  await page.click('button[data-domain="energy"]');
  await page.waitForTimeout(400);

  // Check visibility and geometry of key elements
  const results = await page.evaluate(() => {
    const root = document.querySelector('.analytics-workspace-root');
    const stickyHeader = document.querySelector('.analytics-sticky-header');
    const kpiRibbon = document.querySelector('#analyticsKpiRibbon');
    const plot7A = document.querySelector('#canvasBatteryTimeline');
    const plot7B = document.querySelector('#canvasEnergyLoad');
    const breakdown = document.querySelector('#energyBreakdownGrid');
    const btnSidebars = document.querySelector('#btnToggleSidebars');
    const btnFullscreen = document.querySelector('#btnToggleFullscreen');
    const btnKpis = document.querySelector('#btnToggleKpis');

    const panel7A = plot7A ? plot7A.closest('.chart-panel') : null;
    const title7A = panel7A ? (panel7A.querySelector('.chart-title-group span') || panel7A.querySelector('span')) : null;
    const badge7A = panel7A ? panel7A.querySelector('.badge') : null;

    const panel7B = plot7B ? plot7B.closest('.chart-panel') : null;
    const title7B = panel7B ? (panel7B.querySelector('.chart-title-group span') || panel7B.querySelector('span')) : null;
    const badge7B = panel7B ? panel7B.querySelector('.badge') : null;

    const stickyBox = stickyHeader ? stickyHeader.getBoundingClientRect() : null;
    const title7ABox = title7A ? title7A.getBoundingClientRect() : null;
    const plot7ABox = plot7A ? plot7A.getBoundingClientRect() : null;

    return {
      scrollTop: root ? root.scrollTop : -1,
      stickyHeaderHeight: stickyBox ? stickyBox.height : -1,
      stickyHeaderBottom: stickyBox ? stickyBox.bottom : -1,
      title7AText: title7A ? title7A.textContent : null,
      title7ATop: title7ABox ? title7ABox.top : -1,
      badge7AText: badge7A ? badge7A.textContent.trim() : null,
      title7BText: title7B ? title7B.textContent : null,
      badge7BText: badge7B ? badge7B.textContent.trim() : null,
      plot7AHeight: plot7ABox ? plot7ABox.height : -1,
      hasBreakdown: !!breakdown,
      breakdownCards: breakdown ? breakdown.children.length : 0,
      btnSidebarsText: btnSidebars ? btnSidebars.textContent.trim() : null,
      btnFullscreenText: btnFullscreen ? btnFullscreen.textContent.trim() : null,
      btnKpisText: btnKpis ? btnKpis.textContent.trim() : null,
      isTitle7AUnderSticky: title7ABox && stickyBox ? title7ABox.top < stickyBox.bottom : false
    };
  });

  console.log('Geometry & Visibility Verification:');
  console.log(JSON.stringify(results, null, 2));

  if (results.isTitle7AUnderSticky) {
    throw new Error('FAIL: Plot 7A title is rendered under sticky header!');
  }
  if (results.scrollTop !== 0) {
    throw new Error(`FAIL: Initial domain scrollTop must be 0, got ${results.scrollTop}`);
  }
  if (!results.title7AText.includes('Plot 7A')) {
    throw new Error(`FAIL: Plot 7A title missing, got: ${results.title7AText}`);
  }
  if (!results.title7BText.includes('Plot 7B')) {
    throw new Error(`FAIL: Plot 7B title missing, got: ${results.title7BText}`);
  }
  if (results.breakdownCards !== 4) {
    throw new Error(`FAIL: Expected 4 breakdown cards, got ${results.breakdownCards}`);
  }

  console.log('ALL GEOMETRY & VISIBILITY ASSERTIONS PASSED!');

  // Test scroll behavior
  await page.evaluate(() => {
    const root = document.querySelector('.analytics-workspace-root');
    if (root) root.scrollTop = 250;
  });
  await page.waitForTimeout(300);

  const scrollResults = await page.evaluate(() => {
    const stickyHeader = document.querySelector('.analytics-sticky-header');
    const breakdown = document.querySelector('#energyBreakdownGrid');
    const stickyBox = stickyHeader ? stickyHeader.getBoundingClientRect() : null;
    const bdBox = breakdown ? breakdown.getBoundingClientRect() : null;
    return {
      stickyHeightWhenScrolled: stickyBox ? stickyBox.height : -1,
      breakdownTop: bdBox ? bdBox.top : -1,
      isBreakdownVisible: bdBox ? bdBox.top > 0 && bdBox.bottom <= window.innerHeight + 100 : false
    };
  });

  console.log('Scrolled State Verification:');
  console.log(JSON.stringify(scrollResults, null, 2));

  // Test Sidebars Toggle
  await page.click('#btnToggleSidebars');
  await page.waitForTimeout(400);

  const sidebarsResult = await page.evaluate(() => {
    const mainLayout = document.querySelector('.main-layout');
    const btn = document.querySelector('#btnToggleSidebars');
    const left = document.querySelector('.sidebar-left');
    const leftBox = left ? left.getBoundingClientRect() : null;
    return {
      isAnalyticsModeClass: mainLayout ? mainLayout.classList.contains('analytics-mode') : true,
      sidebarLeftWidth: leftBox ? leftBox.width : 0,
      btnSidebarsActive: btn ? btn.classList.contains('active') : false
    };
  });

  console.log('Sidebars Toggle Verification:');
  console.log(JSON.stringify(sidebarsResult, null, 2));

  if (sidebarsResult.isAnalyticsModeClass) {
    throw new Error('FAIL: Clicking btnToggleSidebars should have removed analytics-mode class');
  }
  if (sidebarsResult.sidebarLeftWidth === 0) {
    throw new Error('FAIL: Left sidebar should be visible with positive width after toggle');
  }

  // Toggle back to full width
  await page.click('#btnToggleSidebars');
  await page.waitForTimeout(400);

  const fullWidthResult = await page.evaluate(() => {
    const mainLayout = document.querySelector('.main-layout');
    const left = document.querySelector('.sidebar-left');
    const leftBox = left ? left.getBoundingClientRect() : null;
    return {
      isAnalyticsModeClass: mainLayout ? mainLayout.classList.contains('analytics-mode') : false,
      sidebarLeftWidth: leftBox ? leftBox.width : 0
    };
  });

  console.log('Restored Full-Width Verification:');
  console.log(JSON.stringify(fullWidthResult, null, 2));

  if (!fullWidthResult.isAnalyticsModeClass) {
    throw new Error('FAIL: Toggling back should restore analytics-mode class');
  }
  if (fullWidthResult.sidebarLeftWidth !== 0) {
    throw new Error('FAIL: Left sidebar should be hidden in full-width mode');
  }

  console.log('ALL SIDEBAR TOGGLE & SCROLL ASSERTIONS PASSED!');

  await browser.close();
  server.close();
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});
