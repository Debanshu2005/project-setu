import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 3388;
const BASE_URL = `http://localhost:${PORT}`;

async function testThreeImport() {
  const server = spawn('node', ['dashboard/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  try {
    // Wait for server to be ready
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(`${BASE_URL}/api/scenarios`);
        if (r.ok) { ready = true; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    if (!ready) throw new Error('Server not ready');

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();

    let threeLoaded = false;
    let threeRevision = null;
    let errorOccurred = null;

    page.on('console', msg => {
      const text = msg.text();
      if (text.startsWith('THREE_VERSION:')) {
        threeLoaded = true;
        threeRevision = text.split(':')[1];
      }
    });

    page.on('pageerror', err => {
      errorOccurred = err;
    });

    const testHtml = [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '  <script type="importmap">',
      '  {',
      '    "imports": {',
      `      "three": "${BASE_URL}/vendor/three/three.module.js",`,
      `      "three/addons/": "${BASE_URL}/vendor/three/"`,
      '    }',
      '  }',
      '  </script>',
      '</head>',
      '<body>',
      '  <script type="module">',
      '    import * as THREE from "three";',
      '    import { OrbitControls } from "three/addons/OrbitControls.js";',
      '    console.log("THREE_VERSION:" + THREE.REVISION);',
      '    if (typeof OrbitControls === "function") {',
      '      console.log("ORBIT_CONTROLS_OK");',
      '    }',
      '  </script>',
      '</body>',
      '</html>'
    ].join('\n');

    await page.setContent(testHtml);
    await page.waitForTimeout(1000);
    await browser.close();

    if (errorOccurred) {
      throw errorOccurred;
    }

    if (!threeLoaded) {
      throw new Error('Three.js failed to load');
    }

    console.log(`[ PASS ] Three.js vendored ES module loaded cleanly! Revision: ${threeRevision}`);
  } finally {
    server.kill();
  }
}

testThreeImport().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
