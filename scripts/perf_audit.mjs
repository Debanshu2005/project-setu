import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/scenarios`);
      if (res.ok) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server failed to start at ${url} within ${timeoutMs}ms`);
}

async function runScenarioAudit(browser, config) {
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: config.dpr,
    isMobile: config.isMobile,
    hasTouch: config.hasTouch,
    userAgent: config.userAgent
  });

  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  await client.send('Network.enable');

  if (config.throttleNetwork) {
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8, // 1.6 Mbps
      uploadThroughput: (750 * 1024) / 8 // 750 kbps
    });
  }

  if (config.cpuThrottlingRate && config.cpuThrottlingRate > 1) {
    await client.send('Emulation.setCPUThrottlingRate', {
      rate: config.cpuThrottlingRate
    });
  }

  // Tracking network requests and wire transfer
  let requestCount = 0;
  let transferredBytes = 0;
  const requests = [];

  client.on('Network.requestWillBeSent', params => {
    requestCount++;
    requests.push({
      url: params.request.url,
      type: params.type,
      time: params.wallTime
    });
  });

  client.on('Network.loadingFinished', params => {
    transferredBytes += params.encodedDataLength;
  });

  // Inject performance observer and rAF counter before page loads
  await page.addInitScript(() => {
    window.__perfData = {
      fcp: null,
      lcp: null,
      cls: 0,
      longTasks: [],
      appRafCount: 0
    };

    // Monkey patch requestAnimationFrame to count application animation callbacks
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = function(callback) {
      return origRaf.call(window, function(timestamp) {
        window.__perfData.appRafCount++;
        if (typeof callback === 'function') {
          callback(timestamp);
        }
      });
    };

    // Track First Contentful Paint
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            window.__perfData.fcp = entry.startTime;
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch (e) {}

    // Track Largest Contentful Paint
    try {
      new PerformanceObserver(list => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          window.__perfData.lcp = entries[entries.length - 1].startTime;
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}

    // Track Cumulative Layout Shift
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__perfData.cls += entry.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}

    // Track Long Tasks (tasks > 50ms)
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          window.__perfData.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch (e) {}
  });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[Browser Console Error] ${msg.text()}`);
  });
  page.on('pageerror', err => console.error(`[Page Error]`, err));

  const navStart = Date.now();
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  const loadDuration = Date.now() - navStart;

  await page.waitForSelector('#topologyCanvas', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Measure initial paint & DOM metrics
  const loadMetrics = await page.evaluate(() => {
    const perf = window.__perfData || {};
    const timing = performance.getEntriesByType('navigation')[0] || {};

    // Total Blocking Time: sum of (duration - 50ms) for long tasks
    let tbt = 0;
    (perf.longTasks || []).forEach(task => {
      if (task.duration > 50) {
        tbt += task.duration - 50;
      }
    });

    const domCount = document.getElementsByTagName('*').length;
    const memory = performance.memory ? performance.memory.usedJSHeapSize : null;

    // Tap target audit
    const interactives = Array.from(document.querySelectorAll('button, a, input, select, textarea, label, [role=\"button\"], .btn, .tab-btn'));
    let smallTargetsCount = 0;
    interactives.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) {
        smallTargetsCount++;
      }
    });

    // Small font audit (< 12px)
    const allEls = Array.from(document.querySelectorAll('*'));
    let smallFontsCount = 0;
    allEls.forEach(el => {
      if (el.children.length === 0 && el.textContent.trim().length > 0) {
        const fs = parseFloat(window.getComputedStyle(el).fontSize);
        if (fs > 0 && fs < 12) {
          smallFontsCount++;
        }
      }
    });

    const hasHorizontalScroll = document.documentElement.scrollWidth > window.innerWidth;

    return {
      fcp: perf.fcp || (timing.domContentLoadedEventEnd || 0),
      lcp: perf.lcp || perf.fcp || 0,
      cls: Number((perf.cls || 0).toFixed(4)),
      tbt: Math.round(tbt),
      longTasksCount: (perf.longTasks || []).length,
      domElements: domCount,
      usedHeapBytes: memory,
      smallTargetsCount,
      smallFontsCount,
      hasHorizontalScroll,
      rafCountAtLoad: perf.appRafCount
    };
  });

  // Measure Idle Animation Callbacks per second over 4 seconds
  const startRaf = await page.evaluate(() => window.__perfData.appRafCount);
  const startIdleRequests = requestCount;
  const idleWaitSeconds = 4;
  await page.waitForTimeout(idleWaitSeconds * 1000);
  const endRaf = await page.evaluate(() => window.__perfData.appRafCount);
  const endIdleRequests = requestCount;

  const idleRafPerSec = Math.round((endRaf - startRaf) / idleWaitSeconds);
  const idleRequestsCount = endIdleRequests - startIdleRequests;

  // Measure Hidden Tab Animation Callbacks per second
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  const hiddenStartRaf = await page.evaluate(() => window.__perfData.appRafCount);
  await page.waitForTimeout(2000);
  const hiddenEndRaf = await page.evaluate(() => window.__perfData.appRafCount);
  const hiddenRafPerSec = Math.round((hiddenEndRaf - hiddenStartRaf) / 2);

  // Restore visibility
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Measure Tab Switch Click-to-First-Paint for Setu Twin 3D
  let timeTo3dPaint = null;
  let rendererInfo = null;
  const mobileBtn = page.locator('#mobileBtnTwin');
  const isMobileVisible = await mobileBtn.isVisible().catch(() => false);
  const btnTwin = isMobileVisible ? mobileBtn : page.locator('#btnModeTwin');
  if (await btnTwin.count() > 0) {
    const t0 = Date.now();
    try {
      await btnTwin.click({ timeout: 60000 });
      await page.waitForSelector('#setuTwinMount canvas', { timeout: 60000 });
      timeTo3dPaint = Date.now() - t0;
      rendererInfo = await page.evaluate(() => {
        const twin = window.setuApp?.setuTwin;
        if (twin && twin.renderer) {
          return {
            drawCalls: twin.renderer.info.render.calls,
            triangles: twin.renderer.info.render.triangles,
            points: twin.renderer.info.render.points,
            lines: twin.renderer.info.render.lines,
            textures: twin.renderer.info.memory.textures,
            geometries: twin.renderer.info.memory.geometries
          };
        }
        return null;
      });
    } catch (e) {
      console.warn(`[Warning] 3D tab click timed out or failed: ${e.message}`);
    }
  }

  // Measure Repeat Visit (Warm Cache)
  let repeatTransferred = 0;
  let repeatRequests = 0;

  client.on('Network.requestWillBeSent', () => {
    repeatRequests++;
  });
  client.on('Network.loadingFinished', params => {
    repeatTransferred += params.encodedDataLength;
  });

  // Reset counters for repeat visit
  repeatRequests = 0;
  repeatTransferred = 0;

  const repeatStart = Date.now();
  await page.reload({ waitUntil: 'networkidle' });
  const repeatLoadDuration = Date.now() - repeatStart;
  await page.waitForTimeout(500);

  // Take screenshot for visual inspection
  const screenshotPath = path.join(projectRoot, 'docs', 'screens', 'perf', `${config.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  await context.close();

  return {
    profile: config.name,
    viewport: `${config.viewport.width}x${config.viewport.height}`,
    dpr: config.dpr,
    throttling: config.cpuThrottlingRate ? `${config.cpuThrottlingRate}x CPU, 1.6Mbps network` : 'None',
    transferredKB: Number((transferredBytes / 1024).toFixed(1)),
    requestCount,
    fcpMs: Math.round(loadMetrics.fcp),
    lcpMs: Math.round(loadMetrics.lcp),
    tbtMs: loadMetrics.tbt,
    cls: loadMetrics.cls,
    loadTimeMs: loadDuration,
    domElements: loadMetrics.domElements,
    heapMB: loadMetrics.usedHeapBytes ? Number((loadMetrics.usedHeapBytes / (1024 * 1024)).toFixed(2)) : null,
    idleRafPerSec,
    idleRequestsIn4s: idleRequestsCount,
    hiddenRafPerSec,
    timeTo3dPaintMs: timeTo3dPaint,
    rendererInfo,
    smallTargetsCount: loadMetrics.smallTargetsCount,
    smallFontsCount: loadMetrics.smallFontsCount,
    hasHorizontalScroll: loadMetrics.hasHorizontalScroll,
    repeatTransferredKB: Number((repeatTransferred / 1024).toFixed(1)),
    repeatRequestsCount: repeatRequests,
    screenshot: `docs/screens/perf/${config.name}.png`
  };
}

async function main() {
  console.log('Starting Project Setu server for performance audit...');
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  let browser;
  try {
    await waitForServer(BASE_URL);
    console.log(`Server online at ${BASE_URL}`);

    // Launch Chromium with WebGL support
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--no-sandbox']
      });
    } catch (e) {
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--no-sandbox']
      });
    }

    console.log('Auditing Profile 1: Desktop (1600x900, DPR 1, unthrottled)...');
    const desktopResult = await runScenarioAudit(browser, {
      name: 'desktop_baseline',
      viewport: { width: 1600, height: 900 },
      dpr: 1,
      isMobile: false,
      hasTouch: false,
      throttleNetwork: false,
      cpuThrottlingRate: 1
    });

    console.log('Auditing Profile 2: Mobile Standard (390x844, DPR 3, 4x CPU, 1.6Mbps network)...');
    const mobileResult = await runScenarioAudit(browser, {
      name: 'mobile_390x844_baseline',
      viewport: { width: 390, height: 844 },
      dpr: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
      throttleNetwork: true,
      cpuThrottlingRate: 4
    });

    console.log('Auditing Profile 3: Mobile Small (360x740, DPR 2, 4x CPU, 1.6Mbps network)...');
    const mobileSmallResult = await runScenarioAudit(browser, {
      name: 'mobile_360x740_baseline',
      viewport: { width: 360, height: 740 },
      dpr: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
      throttleNetwork: true,
      cpuThrottlingRate: 4
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const auditData = {
      timestamp: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || 'local-working-tree',
      desktop: desktopResult,
      mobile: mobileResult,
      mobileSmall: mobileSmallResult
    };

    const resultsDir = path.join(projectRoot, 'docs', 'perf', 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const outJsonPath = path.join(resultsDir, `${timestamp}.json`);
    const latestJsonPath = path.join(resultsDir, 'latest.json');
    fs.writeFileSync(outJsonPath, JSON.stringify(auditData, null, 2));
    fs.writeFileSync(latestJsonPath, JSON.stringify(auditData, null, 2));

    console.log('\n================================================================');
    console.log('  PROJECT SETU PERFORMANCE AUDIT RESULTS SUMMARY');
    console.log('================================================================');
    console.log(`Report JSON: ${outJsonPath}`);
    console.log('\n| Metric | Desktop (1600x900) | Mobile (390x844, 4x CPU, 1.6Mbps) | Budget (Mobile) |');
    console.log('|---|---|---|---|');
    console.log(`| Transferred at load | ${desktopResult.transferredKB} KB | ${mobileResult.transferredKB} KB | <= 150 KB (gzip) |`);
    console.log(`| Requests at load | ${desktopResult.requestCount} | ${mobileResult.requestCount} | N/A |`);
    console.log(`| First Contentful Paint | ${desktopResult.fcpMs} ms | ${mobileResult.fcpMs} ms | <= 1800 ms |`);
    console.log(`| Largest Contentful Paint | ${desktopResult.lcpMs} ms | ${mobileResult.lcpMs} ms | <= 2500 ms |`);
    console.log(`| Total Blocking Time | ${desktopResult.tbtMs} ms | ${mobileResult.tbtMs} ms | <= 200 ms |`);
    console.log(`| Cumulative Layout Shift | ${desktopResult.cls} | ${mobileResult.cls} | <= 0.1 |`);
    console.log(`| Idle rAF callbacks / sec | ${desktopResult.idleRafPerSec} | ${mobileResult.idleRafPerSec} | 0 |`);
    console.log(`| Hidden rAF callbacks / sec | ${desktopResult.hiddenRafPerSec} | ${mobileResult.hiddenRafPerSec} | 0 |`);
    console.log(`| Repeat Visit Transferred | ${desktopResult.repeatTransferredKB} KB | ${mobileResult.repeatTransferredKB} KB | <= 10 KB |`);
    console.log(`| Small Tap Targets (<44px) | ${desktopResult.smallTargetsCount} | ${mobileResult.smallTargetsCount} | 0 primary |`);
    console.log(`| Small Text Fonts (<12px) | ${desktopResult.smallFontsCount} | ${mobileResult.smallFontsCount} | 0 body |`);
    console.log('================================================================\n');

  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch(err => {
  console.error('Performance audit failed:', err);
  process.exit(1);
});
