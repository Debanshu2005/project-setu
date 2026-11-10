// Project Setu: Disaster-Response Offline Service Worker (P7)
// Caches application shell, static assets, 3D vendored modules, and demo trace
// Enables offline mesh visualization, timeline playback, and diagnostics in disaster zones

const CACHE_NAME = 'setu-cache-v2';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/dashboard/index.html',
  '/styles/bundle.css',
  '/styles/main.css',
  '/styles/topology.css',
  '/styles/controls.css',
  '/styles/inspector.css',
  '/src/app.js',
  '/src/api.js',
  '/src/simulation.js',
  '/src/metrics.js',
  '/src/packet_parser.js',
  '/src/exporter.js',
  '/src/wasm_loader.js',
  '/src/trace_worker.js',
  '/src/webgl_tier.js',
  '/src/chart_explainers.js',
  '/src/narrator.js',
  '/src/scientific_metrics.js',
  '/components/inspector.js',
  '/components/timeline.js',
  '/components/topology.js',
  '/components/charts.js',
  '/components/console.js',
  '/components/node_health.js',
  '/components/loss_waterfall.js',
  '/components/setu_twin.js',
  '/components/wristband_twin.js',
  '/components/analytics_workspace.js',
  '/components/scientific_charts.js',
  '/vendor/three.module.js',
  '/vendor/three/addons/controls/OrbitControls.js',
  '/vendor/three/addons/geometries/TextGeometry.js',
  '/vendor/three/addons/loaders/FontLoader.js',
  '/vendor/three/addons/fonts/helvetiker_regular.typeface.json',
  '/scenarios/collapse_site_demo.json',
  '/scenarios/traces/collapse_site_demo.jsonl',
  '/api/trace/collapse_site_demo.jsonl',
  '/api/scenarios',
  '/api/status'
];

const FALLBACK_SCENARIOS = JSON.stringify([
  {
    id: 'collapse_site_demo',
    name: 'Earthquake Collapse Site (Demo)',
    description: 'Earthquake rubble collapse site offline replay demo',
    trace: '/scenarios/traces/collapse_site_demo.jsonl',
    nodes: 16
  }
]);

const FALLBACK_STATUS = JSON.stringify({
  status: 'offline',
  engine: 'offline',
  mode: 'replay',
  message: 'Core C++ engine is offline. Replay mode active.'
});

// Install Event: Pre-cache application shell and demo scenario assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async url => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response && response.ok) {
              await cache.put(url, response);
            }
          } catch {
            // Precache error for optional route handled safely
          }
        })
      );
    })
  );
});

// Activate Event: Clean up outdated caches and claim clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch Event: Serve cached assets when offline, handle API fallbacks gracefully
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Non-GET requests (e.g. POST /api/simulate)
  if (req.method !== 'GET') {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(
          JSON.stringify({
            offline: true,
            error: 'Core C++ engine is unreachable while offline. Mesh replay is active.'
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        );
      })
    );
    return;
  }

  // Navigation requests (HTML document)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req);
          if (cached) return cached;
          const fallback = await cache.match('/index.html') || await cache.match('/dashboard/index.html') || await cache.match('/');
          if (fallback) return fallback;
          return new Response('Offline: App shell unavailable', { status: 503 });
        })
    );
    return;
  }

  // API status check fallback
  if (url.pathname === '/api/status') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req);
          if (cached) return cached;
          return new Response(FALLBACK_STATUS, {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        })
    );
    return;
  }

  // API scenarios list fallback
  if (url.pathname === '/api/scenarios') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req);
          if (cached) return cached;
          return new Response(FALLBACK_SCENARIOS, {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        })
    );
    return;
  }

  // Static Assets and Trace Files: Cache-First with Network Revalidation
  event.respondWith(
    caches.match(req).then(async cachedResponse => {
      if (cachedResponse) {
        // Fetch in background to update cache if network is available
        fetch(req).then(netRes => {
          if (netRes && netRes.ok) {
            caches.open(CACHE_NAME).then(c => c.put(req, netRes));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // Check alternate path mappings in cache
      const cache = await caches.open(CACHE_NAME);
      const pathname = url.pathname;
      let altMatch = null;
      if (pathname.startsWith('/dashboard/')) {
        altMatch = await cache.match(pathname.replace('/dashboard', ''));
      } else {
        altMatch = await cache.match('/dashboard' + pathname);
      }
      if (altMatch) return altMatch;

      // If not cached, fetch from network and store in cache
      return fetch(req)
        .then(netRes => {
          if (netRes && netRes.ok) {
            const clone = netRes.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return netRes;
        })
        .catch(async () => {
          // If request was for demo trace file, check alternative paths in cache
          if (pathname.includes('collapse_site_demo')) {
            const traceAlt = await cache.match('/scenarios/traces/collapse_site_demo.jsonl') ||
                             await cache.match('/api/trace/collapse_site_demo.jsonl');
            if (traceAlt) return traceAlt;
          }
          return new Response('Resource unavailable offline', { status: 503 });
        });
    })
  );
});
