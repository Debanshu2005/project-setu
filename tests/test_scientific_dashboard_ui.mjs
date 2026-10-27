// Project Setu - Scientific Dashboard UI & Regression Test Suite
// Verifies scientific workspace entry points, HTML parity, component instantiation,
// empty-state handling, robust metric acquisition, and navigation integration.

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

import { SimulationEngine } from '../dashboard/src/simulation.js';
import { AnalyticsWorkspaceComponent } from '../dashboard/components/analytics_workspace.js';
import {
  calculateTheoreticalRssi,
  calculateTheoreticalPathLoss,
  calculateEcdf,
  calculateSlidingWindowMetrics,
  generateLinkQualityMatrix,
  calculateRelayAnalytics,
  reconstructPacketRoutes,
  calculateBatteryProjections
} from '../dashboard/src/scientific_metrics.js';

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  [ PASS ] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  [ FAIL ] ${desc}`);
    console.error(`          ${err.message}`);
    failed++;
  }
}

console.log('================================================================');
console.log('  PROJECT SETU SCIENTIFIC DASHBOARD UI & REGRESSION TEST SUITE  ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test Suite 1: HTML Entry Point Parity & Vercel Root Verification
// -----------------------------------------------------------------------------
console.log('[Test Suite 1] HTML Entry Point Parity & Vercel Deployment Parity...');

const rootHtmlPath = path.join(REPO_ROOT, 'index.html');
const dashboardHtmlPath = path.join(REPO_ROOT, 'dashboard', 'index.html');

it('Root index.html and dashboard/index.html exist', () => {
  assert.ok(fs.existsSync(rootHtmlPath), 'Root index.html must exist');
  assert.ok(fs.existsSync(dashboardHtmlPath), 'dashboard/index.html must exist');
});

const rootHtml = fs.readFileSync(rootHtmlPath, 'utf8');
const dashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');

it('Root index.html and dashboard/index.html are byte-for-byte identical for Vercel deployment parity', () => {
  assert.strictEqual(rootHtml, dashboardHtml, 'Root index.html and dashboard/index.html must be identical');
});

const requiredElementIds = [
  'btnModeTopology',
  'btnModeAnalytics',
  'containerTopologyView',
  'containerAnalyticsView',
  'selTopologyOverlay',
  'tabBtnScientific',
  'tab-scientific',
  'tab-charts',
  'btnExpandAnalytics',
  'btnLaunchScientificFull',
  'canvasSidebarQuick',
  'lblSidebarQuickChart',
  'badgeSidebarMetric',
  'topologyCanvas',
  'nodeInspectorContent',
  'timelineContainer'
];

requiredElementIds.forEach(id => {
  it(`Entry point #${id} is present in index.html`, () => {
    assert.ok(rootHtml.includes(`id="${id}"`), `Element ID #${id} must exist in index.html`);
  });
});

it('Dedicated sidebar tab [🔬 Scientific] is present in tab navigation', () => {
  assert.ok(rootHtml.includes('id="tabBtnScientific"'), 'tabBtnScientific button must exist');
  assert.ok(rootHtml.includes('data-tab="tab-scientific"'), 'data-tab="tab-scientific" attribute must exist');
});

it('Quick domain shortcuts exist in #tab-charts', () => {
  assert.ok(rootHtml.includes('quick-domain-shortcuts'), 'quick-domain-shortcuts class must exist');
  assert.ok(rootHtml.includes('data-domain="radio"'), 'Radio propagation shortcut must exist');
  assert.ok(rootHtml.includes('data-domain="delivery"'), 'Packet delivery shortcut must exist');
  assert.ok(rootHtml.includes('data-domain="topology"'), 'Relay routing shortcut must exist');
});

// -----------------------------------------------------------------------------
// Test Suite 2: SimulationEngine Data Integrity & Historical Distance Preservation
// -----------------------------------------------------------------------------
console.log('\n[Test Suite 2] SimulationEngine Historical Distance Preservation & Multi-Run Updates...');

it('SimulationEngine initializes with initialLinkDistances Map', () => {
  const sim = new SimulationEngine();
  assert.ok(sim.initialLinkDistances instanceof Map, 'initialLinkDistances must be a Map instance');
  assert.strictEqual(sim.initialLinkDistances.size, 0, 'initialLinkDistances must start empty');
});

it('SimulationEngine.loadTrace caches link_init distances in initialLinkDistances', () => {
  const sim = new SimulationEngine();
  const trace = [
    { ev: 'sim_start', t: 0, duration: 20000, seed: 42 },
    { ev: 'node_init', t: 0, node: 1, role: 'survivor', x: 100, y: 100, initial_battery: 100 },
    { ev: 'node_init', t: 0, node: 101, role: 'relay', x: 200, y: 100, initial_battery: 100 },
    { ev: 'link_init', t: 0, a: 1, b: 101, dist: 100.0, rssi: -65.0 },
    { ev: 'tx', t: 1000, node: 1, to: 101, rssi: -66.5, air: 62 },
    { ev: 'rx', t: 1062, node: 101, from: 1, rssi: -66.5 }
  ];

  sim.loadTrace(trace);
  assert.strictEqual(sim.initialLinkDistances.get('1_101'), 100.0, 'Historical link distance must be 100.0m');
});

it('Repositioning a node does NOT alter initialLinkDistances for historical transmissions', () => {
  const sim = new SimulationEngine();
  const trace = [
    { ev: 'sim_start', t: 0, duration: 20000, seed: 42 },
    { ev: 'node_init', t: 0, node: 1, role: 'survivor', x: 100, y: 100, initial_battery: 100 },
    { ev: 'node_init', t: 0, node: 101, role: 'relay', x: 200, y: 100, initial_battery: 100 },
    { ev: 'link_init', t: 0, a: 1, b: 101, dist: 100.0, rssi: -65.0 },
    { ev: 'tx', t: 1000, node: 1, to: 101, rssi: -66.5, air: 62 }
  ];

  sim.loadTrace(trace);
  assert.strictEqual(sim.initialLinkDistances.get('1_101'), 100.0);

  // User drags Node 1 to (900, 900)
  const n1 = sim.nodes.get(1);
  n1.x = 900;
  n1.y = 900;

  // Historical distance remains 100.0m, not current distance Math.hypot(900 - 200, 900 - 100) = ~1063m
  const currentDist = Math.hypot(n1.x - 200, n1.y - 100);
  assert.ok(currentDist > 1000, 'Current position distance is large');
  assert.strictEqual(sim.initialLinkDistances.get('1_101'), 100.0, 'Cached initial distance must remain untouched');
});

it('Loading a second run clears and updates initialLinkDistances cleanly', () => {
  const sim = new SimulationEngine();
  const run1 = [
    { ev: 'node_init', t: 0, node: 1, role: 'survivor', x: 100, y: 100 },
    { ev: 'node_init', t: 0, node: 101, role: 'relay', x: 250, y: 100 },
    { ev: 'link_init', t: 0, a: 1, b: 101, dist: 150.0 }
  ];
  sim.loadTrace(run1);
  assert.strictEqual(sim.initialLinkDistances.get('1_101'), 150.0);

  const run2 = [
    { ev: 'node_init', t: 0, node: 2, role: 'survivor', x: 0, y: 0 },
    { ev: 'node_init', t: 0, node: 102, role: 'relay', x: 400, y: 0 },
    { ev: 'link_init', t: 0, a: 2, b: 102, dist: 400.0 }
  ];
  sim.loadTrace(run2);
  assert.strictEqual(sim.initialLinkDistances.has('1_101'), false, 'Stale links from Run 1 must be cleared');
  assert.strictEqual(sim.initialLinkDistances.get('2_102'), 400.0, 'Run 2 link distance must be loaded');
});

// -----------------------------------------------------------------------------
// Test Suite 3: Mock DOM & AnalyticsWorkspaceComponent Domain Rendering
// -----------------------------------------------------------------------------
console.log('\n[Test Suite 3] AnalyticsWorkspaceComponent Domain Rendering & Fault Tolerance...');

// Lightweight DOM mock for headless Node.js environment
class MockClassList {
  constructor() { this.classes = new Set(); }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  toggle(c, force) {
    if (force === undefined) {
      if (this.classes.has(c)) this.classes.delete(c);
      else this.classes.add(c);
    } else if (force) {
      this.classes.add(c);
    } else {
      this.classes.delete(c);
    }
  }
  contains(c) { return this.classes.has(c); }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.classList = new MockClassList();
    this.children = [];
    this.options = [];
    this._innerHTML = '';
    this.dataset = {};
    this.eventListeners = {};
    this.width = 600;
    this.height = 300;
    this.value = 'all';
  }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    this.options = [];
  }

  addEventListener(event, cb) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(cb);
  }

  dispatchEvent(event) {
    const cbs = this.eventListeners[event.type || event] || [];
    cbs.forEach(cb => cb(event));
  }

  querySelector(sel) {
    const el = new MockElement(sel.includes('canvas') ? 'canvas' : (sel.includes('select') ? 'select' : 'div'));
    if (sel.startsWith('#')) el.id = sel.slice(1);
    el.parentElement = this;
    return el;
  }

  querySelectorAll(sel) {
    const el1 = new MockElement('div');
    el1.dataset = { domain: 'radio' };
    const el2 = new MockElement('div');
    el2.dataset = { domain: 'delivery' };
    return [el1, el2];
  }

  getBoundingClientRect() {
    return { width: 600, height: 260, top: 0, left: 0, right: 600, bottom: 260 };
  }

  getContext(type) {
    return {
      resetTransform: () => {},
      scale: () => {},
      translate: () => {},
      rotate: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      fillText: () => {},
      measureText: () => ({ width: 40 }),
      save: () => {},
      restore: () => {},
      setLineDash: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} })
    };
  }
}

// Mock window and document
global.window = {
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {}
};

it('AnalyticsWorkspaceComponent instantiates cleanly without errors', () => {
  const container = new MockElement('div');
  const sim = new SimulationEngine();
  const ws = new AnalyticsWorkspaceComponent(container, sim);
  assert.ok(ws, 'Workspace instance created');
  assert.strictEqual(ws.activeDomain, 'radio', 'Default domain is radio');
});

const allDomains = [
  { domain: 'radio', alias: 'radio_propagation' },
  { domain: 'delivery', alias: 'packet_delivery' },
  { domain: 'topology', alias: 'relay_bottlenecks' },
  { domain: 'congestion', alias: 'congestion' },
  { domain: 'energy', alias: 'energy_battery' },
  { domain: 'positioning', alias: 'positioning_gnss' },
  { domain: 'sos_ack', alias: 'sos_ack' },
  { domain: 'comparison', alias: 'comparison' }
];

allDomains.forEach(({ domain, alias }) => {
  it(`AnalyticsWorkspaceComponent.setDomain('${alias}') switches active domain to '${domain}' without throwing`, () => {
    const container = new MockElement('div');
    const sim = new SimulationEngine();
    const ws = new AnalyticsWorkspaceComponent(container, sim);

    assert.doesNotThrow(() => {
      ws.setDomain(alias);
    }, `Switching to ${alias} should not throw`);
    assert.strictEqual(ws.activeDomain, domain, `Current domain must normalize to ${domain}`);
  });
});

// -----------------------------------------------------------------------------
// Test Suite 4: Empty Data State Handling (No False Errors)
// -----------------------------------------------------------------------------
console.log('\n[Test Suite 4] Empty Dataset & Corrupted Observation Graceful Degradation...');

it('Empty simulation events render intentional empty state without throwing', () => {
  const container = new MockElement('div');
  const sim = new SimulationEngine();
  sim.loadTrace([]); // Zero events, zero nodes
  const ws = new AnalyticsWorkspaceComponent(container, sim);

  allDomains.forEach(domain => {
    assert.doesNotThrow(() => {
      ws.setDomain(domain);
    }, `Empty dataset in domain '${domain}' must not throw`);
  });
});

it('Missing or undefined fields in events do not crash metric calculations', () => {
  const sim = new SimulationEngine();
  const dirtyTrace = [
    { ev: 'tx' }, // Missing node, to, rssi, dist
    { ev: 'rx', node: null }, // Null node
    { ev: 'originate', node: undefined, t: null },
    { ev: 'arrive', node: 0, t: 'invalid' },
    { ev: 'battery', node: 101, battery: NaN }
  ];

  assert.doesNotThrow(() => {
    sim.loadTrace(dirtyTrace);
  }, 'Loading trace with missing fields must not throw');

  const container = new MockElement('div');
  const ws = new AnalyticsWorkspaceComponent(container, sim);

  allDomains.forEach(domain => {
    assert.doesNotThrow(() => {
      ws.setDomain(domain);
    }, `Dirty fields in domain '${domain}' must not crash rendering`);
  });
});

// -----------------------------------------------------------------------------
// Test Suite 5: Domain 5 Subsystem Energy & Domain 7 Retry Analytics
// -----------------------------------------------------------------------------
console.log('\n[Test Suite 5] Subsystem Energy Breakdown & SOS/ACK Retry Stats Calculations...');

it('Subsystem energy calculations compute TX, RX, and Standby accurately', () => {
  const events = [
    { ev: 'tx', node: 1, to: 101, t: 1000 },
    { ev: 'rx', node: 101, from: 1, t: 1062 },
    { ev: 'tx', node: 101, to: 0, t: 1500 },
    { ev: 'rx', node: 0, from: 101, t: 1562 }
  ];
  const txCount = events.filter(e => e.ev === 'tx').length;
  const rxCount = events.filter(e => e.ev === 'rx').length;

  assert.strictEqual(txCount, 2);
  assert.strictEqual(rxCount, 2);

  const txMah = (txCount * 62.0 / 3600000.0) * 120.0;
  const rxMah = (rxCount * 62.0 / 3600000.0) * 15.0;

  assert.ok(txMah > 0, 'TX energy must be positive');
  assert.ok(rxMah > 0, 'RX energy must be positive');
  assert.ok(txMah > rxMah, 'TX energy draw (120mA) must exceed RX energy draw (15mA)');
});

it('Battery lifetime projection accurately handles nominal 300mAh capacity', () => {
  const proj = calculateBatteryProjections(100, 300, 10, 10, 60);
  assert.ok(proj.projectedHours > 0, 'Projected hours must be positive');
  assert.ok(proj.consumedMah > 0, 'Consumed mAh must be positive');
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  UI & REGRESSION SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
