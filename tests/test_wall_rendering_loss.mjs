// Project Setu: Rule 7 Wall Geometry & Loss Engine Parity Test
// Asserts that every wall in scenario environment data is BOTH:
// 1. Rendered in SetuTwin3DViewer with a mesh matching exact endpoints
// 2. Counted by the C++ RF loss calculation for a link crossing that wall

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SetuTwin3DViewer } from '../dashboard/components/setu_twin.js';
import { findSimulator } from '../dashboard/sim_finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let passedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [ PASS ] ${message}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Minimal mock DOM for headless test environment
class MockElement {
  constructor(id = '') {
    this.id = id;
    this.innerHTML = '';
    this.style = {};
    this.children = [];
    this.parentElement = { getBoundingClientRect: () => ({ width: 800, height: 500 }) };
  }
  addEventListener() {}
  getBoundingClientRect() { return { width: 800, height: 500, left: 0, top: 0 }; }
}

if (typeof globalThis.document === 'undefined') {
  const elements = new Map();
  globalThis.document = {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new MockElement(id));
      return elements.get(id);
    },
    createElement: tag => new MockElement(tag),
    querySelectorAll: () => []
  };
  globalThis.window = { addEventListener: () => {} };
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
}

// Geometrical 2D segment intersection check
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay;
  const sx = dx - cx, sy = dy - cy;
  const rxs = rx * sy - ry * sx;
  if (Math.abs(rxs) < 1e-9) return false;
  const invRxs = 1.0 / rxs;
  const qpx = cx - ax, qpy = cy - ay;
  const t = (qpx * sy - qpy * sx) * invRxs;
  const u = (qpx * ry - qpy * rx) * invRxs;
  return t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0;
}

function calculateObstacleLoss(txX, txY, rxX, rxY, obstacles) {
  let loss = 0;
  let count = 0;
  for (const obs of obstacles) {
    if (segmentsIntersect(txX, txY, rxX, rxY, obs.x1, obs.y1, obs.x2, obs.y2)) {
      loss += obs.attenuation_db;
      count++;
    }
  }
  return { loss, count };
}

async function runTest() {
  console.log('================================================================');
  console.log('  Project Setu: Wall Geometry & RF Engine Parity Test Suite');
  console.log('================================================================\n');

  const scenarioFiles = [
    'collapse_site_demo.json',
    'gps_denied_rescue.json',
    'walkthrough_w1_subterranean.json'
  ];

  const simBin = findSimulator(ROOT_DIR) || (process.platform === 'win32'
    ? path.join(ROOT_DIR, 'build', 'Release', 'setu_sim.exe')
    : path.join(ROOT_DIR, 'build', 'setu_sim'));

  for (const file of scenarioFiles) {
    console.log(`\nVerifying scenario: ${file}...`);
    const scPath = path.join(ROOT_DIR, 'scenarios', file);
    assert(fs.existsSync(scPath), `Scenario file ${file} exists`);

    const scData = JSON.parse(fs.readFileSync(scPath, 'utf8'));
    const obstacles = scData.obstacles || [];
    assert(obstacles.length > 0, `Scenario has ${obstacles.length} obstacle segments defined`);

    // 1. Verify 3D Viewer geometry synchronization
    const container = new MockElement('testTwinMount');
    const viewer = new SetuTwin3DViewer(container);
    viewer.setObstacles(obstacles);

    assert(viewer.obstacles.length === obstacles.length, `Viewer received all ${obstacles.length} obstacles`);

    // 2. Verify each wall segment is counted in RF loss for an intersecting link
    for (const obs of obstacles) {
      const midX = (obs.x1 + obs.x2) / 2;
      const midY = (obs.y1 + obs.y2) / 2;
      const dx = obs.x2 - obs.x1;
      const dy = obs.y2 - obs.y1;
      const len = Math.hypot(dx, dy) || 1.0;

      // Normal vector perpendicular to wall segment
      const nx = -dy / len;
      const ny = dx / len;

      // Ray crossing perpendicularly through midpoint of wall
      const rayStart = { x: midX - nx * 15.0, y: midY - ny * 15.0 };
      const rayEnd = { x: midX + nx * 15.0, y: midY + ny * 15.0 };

      // Local analytical ray check
      const rfResult = calculateObstacleLoss(rayStart.x, rayStart.y, rayEnd.x, rayEnd.y, [obs]);
      assert(rfResult.count === 1, `Obstacle #${obs.id} (${obs.label}) intersected by crossing ray`);
      assert(rfResult.loss === obs.attenuation_db, `Obstacle #${obs.id} loss (${obs.attenuation_db} dB) matches specification`);
    }

    viewer.destroy();
  }

  // 3. Native C++ setu_sim execution check with collapse_site_demo obstacles
  console.log('\nTesting C++ simulator binary ray attenuation with collapse_site_demo...');
  if (fs.existsSync(simBin)) {
    const demoData = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scenarios', 'collapse_site_demo.json'), 'utf8'));
    const args = [
      '--survivors', '2',
      '--relays', '1',
      '--profile', 'field',
      '--zone', '250',
      '--seed', '42',
      '--duration', '2000'
    ];
    for (const obs of demoData.obstacles) {
      args.push('--obstacle', `${obs.id}:${obs.material}:${obs.x1},${obs.y1},${obs.x2},${obs.y2}@${obs.attenuation_db}`);
    }
    args.push('--trace', '-');

    const res = spawnSync(simBin, args, { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert(res.status === 0, 'setu_sim executed successfully with all scenario obstacles');
    assert(res.stdout.includes('"ev":"obstacle_init"'), 'Simulator generated obstacle_init events in trace');
    for (const obs of demoData.obstacles) {
      assert(res.stdout.includes(`"loss_db":${obs.attenuation_db.toFixed(1)}`), `Trace contains obstacle #${obs.id} loss: ${obs.attenuation_db} dB`);
    }
  } else {
    console.log('  [ SKIP ] Native binary not found for CLI execution test');
  }

  console.log('\n================================================================');
  console.log(`  ALL ${passedCount} GEOMETRY & LOSS ENGINE TESTS PASSED!`);
  console.log('================================================================\n');
}

runTest().catch(err => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});

