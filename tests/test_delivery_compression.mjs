// Project Setu - Automated Delivery, Compression, and Caching Verification Suite
// Tests gzip/brotli compression, ETag calculation, 304 Not Modified handling,
// and Cache-Control headers across static assets, vendor files, and traces.

import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 3105;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function request(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const req = http.request(url, { headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          bodyBuffer,
          text: () => bodyBuffer.toString('utf8')
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('Starting Delivery Compression and Caching Verification Suite...');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Verify byte parity between index.html and dashboard/index.html
  const rootIndex = fs.readFileSync(path.join(ROOT_DIR, 'index.html'));
  const dashIndex = fs.readFileSync(path.join(ROOT_DIR, 'dashboard', 'index.html'));
  assert(rootIndex.equals(dashIndex), 'Root index.html and dashboard/index.html are byte identical');

  // Spawn test server
  const serverProcess = spawn('node', ['dashboard/server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stderr.on('data', chunk => {
    const str = chunk.toString();
    if (!str.includes('EADDRINUSE')) {
      console.error(`[Server stderr] ${str.trim()}`);
    }
  });

  // Wait for server to listen
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server failed to start within 5s')), 5000);
    const check = async () => {
      try {
        const res = await request('/health');
        if (res.statusCode === 200) {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {}
      setTimeout(check, 100);
    };
    check();
  });

  try {
    // 2. Test application HTML compression, ETag, and no-cache
    const htmlGzip = await request('/', { 'Accept-Encoding': 'gzip' });
    assert(htmlGzip.statusCode === 200, 'GET / returns HTTP 200');
    assert(htmlGzip.headers['content-encoding'] === 'gzip', 'GET / has Content-Encoding: gzip');
    assert(htmlGzip.headers['cache-control'] === 'no-cache', 'GET / has Cache-Control: no-cache');
    assert(Boolean(htmlGzip.headers['etag']), 'GET / has ETag header');
    assert(htmlGzip.headers['vary']?.includes('Accept-Encoding'), 'GET / has Vary: Accept-Encoding');
    const decompressedHtml = zlib.gunzipSync(htmlGzip.bodyBuffer).toString('utf8');
    assert(decompressedHtml.includes('Project Setu'), 'GET / decompresses to valid HTML');

    // 3. Test If-None-Match on HTML returns 304
    const htmlEtag = htmlGzip.headers['etag'];
    const html304 = await request('/', { 'If-None-Match': htmlEtag });
    assert(html304.statusCode === 304, 'GET / with matching If-None-Match returns 304 Not Modified');
    assert(html304.bodyBuffer.length === 0, 'GET / 304 response has empty body');
    assert(html304.headers['cache-control'] === 'no-cache', '304 response maintains Cache-Control');

    // 4. Test Brotli compression for application JS
    const jsBr = await request('/src/app.js', { 'Accept-Encoding': 'br' });
    assert(jsBr.statusCode === 200, 'GET /src/app.js returns HTTP 200');
    assert(jsBr.headers['content-encoding'] === 'br', 'GET /src/app.js has Content-Encoding: br');
    assert(jsBr.headers['cache-control'] === 'no-cache', 'GET /src/app.js has Cache-Control: no-cache');
    const decompressedJs = zlib.brotliDecompressSync(jsBr.bodyBuffer).toString('utf8');
    assert(decompressedJs.includes('SimulationEngine'), 'GET /src/app.js decompresses to valid JavaScript');

    // 5. Test 304 for application JS
    const jsEtag = jsBr.headers['etag'];
    const js304 = await request('/src/app.js', { 'If-None-Match': jsEtag });
    assert(js304.statusCode === 304, 'GET /src/app.js with matching If-None-Match returns 304');
    assert(js304.bodyBuffer.length === 0, 'GET /src/app.js 304 has empty body');

    // 6. Test vendor caching policy (immutable for 1 year)
    const vendorRes = await request('/vendor/three/three.module.js', { 'Accept-Encoding': 'gzip' });
    assert(vendorRes.statusCode === 200, 'GET vendor three.module.js returns 200');
    assert(vendorRes.headers['content-encoding'] === 'gzip', 'Vendor file has Content-Encoding: gzip');
    assert(vendorRes.headers['cache-control'] === 'public, max-age=31536000, immutable', 'Vendor file has immutable 1-year cache policy');
    const decompressedVendor = zlib.gunzipSync(vendorRes.bodyBuffer).toString('utf8');
    assert(decompressedVendor.includes('WebGLRenderer'), 'Vendor file decompresses to Three.js');

    // 7. Test vendor 304
    const vendorEtag = vendorRes.headers['etag'];
    const vendor304 = await request('/vendor/three/three.module.js', { 'If-None-Match': vendorEtag });
    assert(vendor304.statusCode === 304, 'Vendor file with matching ETag returns 304');

    // 8. Test trace endpoint /api/trace/:filename with gzip streaming
    const traceGzip = await request('/api/trace/collapse_site_demo.jsonl', { 'Accept-Encoding': 'gzip' });
    assert(traceGzip.statusCode === 200, 'GET /api/trace/collapse_site_demo.jsonl returns 200');
    assert(traceGzip.headers['content-encoding'] === 'gzip', 'Trace endpoint streams with gzip');
    assert(traceGzip.headers['cache-control'] === 'public, max-age=86400', 'Trace endpoint has 1-day Cache-Control');
    assert(Boolean(traceGzip.headers['etag']), 'Trace endpoint sets ETag from stat');
    const decompressedTrace = zlib.gunzipSync(traceGzip.bodyBuffer).toString('utf8');
    assert(decompressedTrace.includes('"ev"') || decompressedTrace.includes('"event"'), 'Trace decompresses to valid jsonl trace');

    // 9. Test trace endpoint 304
    const traceEtag = traceGzip.headers['etag'];
    const trace304 = await request('/api/trace/collapse_site_demo.jsonl', { 'If-None-Match': traceEtag });
    assert(trace304.statusCode === 304, 'Trace endpoint with matching ETag returns 304');
    assert(trace304.bodyBuffer.length === 0, 'Trace 304 response has empty body');

    // 10. Test modulepreload tags present in index.html
    assert(decompressedHtml.includes('<link rel="modulepreload" href="./src/app.js" />'), 'modulepreload tag present for app.js');
    assert(decompressedHtml.includes('<link rel="modulepreload" href="./src/simulation.js" />'), 'modulepreload tag present for simulation.js');
    assert(decompressedHtml.includes('<link rel="modulepreload" href="./components/topology.js" />'), 'modulepreload tag present for topology.js');

  } finally {
    serverProcess.kill('SIGTERM');
  }

  console.log(`\nDelivery Verification Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
