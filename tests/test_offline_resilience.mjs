// Project Setu: Disaster-Response Offline Resilience Verification Suite (P7)
// Verifies service worker precaching, offline app shell loading, demo trace playback,
// honest offline mode badges, and graceful degradation when network is severed.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 3999;
const BASE_URL = `http://localhost:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [ FAIL ] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [ PASS ] ${message}`);
}

async function runOfflineSuite() {
  console.log('================================================================');
  console.log('  Project Setu: Offline Resilience & Service Worker Suite (P7)  ');
  console.log('================================================================');

  let server;
  let browser;

  try {
    // 1. Start Dashboard Server
    console.log(`\n[1/5] Starting Dashboard Server on test port ${PORT}...`);
    server = spawn('node', ['dashboard/server.js'], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore'
    });

    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${BASE_URL}/api/status`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // Retry
      }
      await new Promise(r => setTimeout(r, 200));
    }
    assert(ready, `Server running and responding on port ${PORT}`);

    // 2. Launch Chromium
    console.log('\n[2/5] Launching Chromium with Service Worker support...');
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
      });
    } catch {
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    // 3. First Visit: Prime Cache and Wait for Service Worker Activation
    console.log('\n[3/5] First Visit: Priming Service Worker and Precaching App Shell...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Wait for Service Worker registration and active state
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg && reg.active);
    });
    assert(swRegistered, 'Service Worker registered and transitioned to active state');

    // Give service worker 1 second to populate precache cache entries
    await page.waitForTimeout(1000);

    const cachedKeys = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      if (cacheNames.length === 0) return [];
      const cache = await caches.open(cacheNames[0]);
      const requests = await cache.keys();
      return requests.map(r => new URL(r.url).pathname);
    });

    assert(cachedKeys.length > 5, `Service Worker precache contains assets (Found: ${cachedKeys.length} cached entries)`);
    assert(cachedKeys.some(p => p.includes('bundle.css') || p.includes('main.css')), 'Stylesheet is cached in offline storage');
    assert(cachedKeys.some(p => p.includes('app.js')), 'Core application script is cached');
    assert(cachedKeys.some(p => p.includes('collapse_site_demo')), 'Demo scenario trace is cached for offline playback');

    // 4. Simulate Complete Network Severance (Offline Mode)
    console.log('\n[4/5] Severing Network: Simulating Disconnected Disaster Field Zone...');
    await context.setOffline(true);

    // Reload the page while completely offline
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const offlineState = await page.evaluate(() => {
      const isOnline = navigator.onLine;
      const offlineBadge = document.getElementById('badgeOfflineMode');
      const engineBadge = document.getElementById('engineBadge');
      const statusText = document.getElementById('statusText');
      const canvas = document.getElementById('topologyCanvas');
      const app = window.setuApp;

      return {
        hasApp: Boolean(app),
        badgeExists: Boolean(offlineBadge),
        badgeStyleDisplay: offlineBadge ? offlineBadge.style.display : null,
        badgeComputedDisplay: offlineBadge ? window.getComputedStyle(offlineBadge).display : null,
        navigatorOnline: isOnline,
        offlineBadgeVisible: offlineBadge ? window.getComputedStyle(offlineBadge).display !== 'none' : false,
        engineBadgeText: engineBadge ? engineBadge.textContent : '',
        statusContent: statusText ? statusText.textContent : '',
        hasCanvas: Boolean(canvas),
        nodeCount: app?.sim?.nodes ? app.sim.nodes.size : 0,
        isReplayMode: app?.mode === 'replay'
      };
    });

    assert(!offlineState.navigatorOnline, 'Browser reports navigator.onLine is false');
    assert(offlineState.offlineBadgeVisible, 'Offline badge "OFFLINE (REPLAY ONLY)" is clearly displayed in header');
    assert(offlineState.engineBadgeText.includes('Offline') || offlineState.engineBadgeText.includes('Replay'),
      `Engine badge honestly reports offline status (Got: "${offlineState.engineBadgeText}")`);
    assert(offlineState.hasCanvas, 'Topology canvas element loaded and initialized offline');
    assert(offlineState.nodeCount >= 16, `Offline demo scenario loaded full node topology (Got: ${offlineState.nodeCount} nodes)`);

    // 5. Test Offline Playback and Timeline Scrubbing
    console.log('\n[5/5] Testing Offline Playback, Event Processing, and Timeline Scrubbing...');
    const playbackProgress = await page.evaluate(async () => {
      const app = window.setuApp;
      if (!app || !app.sim) return null;

      const initialTime = app.sim.currentTime;
      app.sim.play();

      // Let simulation tick for 800ms
      await new Promise(r => setTimeout(r, 800));

      const playingTime = app.sim.currentTime;
      app.sim.pause();

      // Test timeline scrub
      app.sim.seek(15.0);
      const seekTime = app.sim.currentTime;

      return {
        initialTime,
        playingTime,
        seekTime
      };
    });

    assert(playbackProgress !== null, 'Setu app instance accessible and initialized offline');
    assert(playbackProgress.playingTime > playbackProgress.initialTime,
      `Simulation time advances during offline playback (${playbackProgress.initialTime.toFixed(1)}s -> ${playbackProgress.playingTime.toFixed(1)}s)`);
    assert(Math.abs(playbackProgress.seekTime - 15.0) < 0.5,
      `Timeline scrubbing functions accurately while offline (Sought 15.0s, Got: ${playbackProgress.seekTime.toFixed(1)}s)`);

    // Re-enable network to verify clean recovery
    await context.setOffline(false);
    await page.waitForTimeout(500);

    const onlineRestored = await page.evaluate(() => {
      const offlineBadge = document.getElementById('badgeOfflineMode');
      return {
        offlineBadgeHidden: offlineBadge ? window.getComputedStyle(offlineBadge).display === 'none' : true
      };
    });
    assert(onlineRestored.offlineBadgeHidden, 'Offline badge automatically hides when network connectivity is restored');

    console.log('\n================================================================');
    console.log('  ALL OFFLINE RESILIENCE & SERVICE WORKER ASSERTIONS PASSED!    ');
    console.log('================================================================\n');
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

runOfflineSuite().catch(err => {
  console.error('\nFatal test failure in test_offline_resilience.mjs:', err);
  process.exit(1);
});
