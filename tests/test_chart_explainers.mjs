// Project Setu: Scientific Chart Explainers Test Suite
// Verifies explainer completeness, axis consistency, provenance rules,
// dynamic scenario fill, accessibility attributes, keyboard navigation, and mutation checks.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

import {
  CHART_EXPLAINERS,
  getAllExplainerIds,
  resolveExplainerId,
  formatExplainer,
  renderExplainerCardHtml
} from '../dashboard/src/chart_explainers.js';

import {
  ChartExplainerController
} from '../dashboard/components/scientific_charts.js';

let passedCount = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  [ PASS ] ${message}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('================================================================');
console.log('  PROJECT SETU: SCIENTIFIC CHART HOVER EXPLAINERS TEST SUITE    ');
console.log('================================================================\n');

// =============================================================
// Suite 1: Explainer Completeness & Coverage Test
// =============================================================
console.log('[Suite 1/6] Testing Explainer Completeness Across All Charts...');

const allExplainerIds = getAllExplainerIds();
check(allExplainerIds.length === 20, `Exactly 20 scientific charts are registered in explainers (Got: ${allExplainerIds.length})`);

const REQUIRED_SECTIONS = ['what', 'why', 'xy', 'howToRead', 'dataSources', 'caveats', 'expertDetails'];

function validateExplainerCompleteness(explainer) {
  for (const sec of REQUIRED_SECTIONS) {
    if (!explainer[sec] || typeof explainer[sec] !== 'string') {
      return { valid: false, reason: `Missing section: ${sec}` };
    }
    const val = explainer[sec].trim();
    if (val.length === 0) {
      return { valid: false, reason: `Empty section: ${sec}` };
    }
    if (/TODO|placeholder|lorem ipsum/i.test(val)) {
      return { valid: false, reason: `Placeholder found in ${sec}: ${val}` };
    }
    const words = val.split(/\s+/).filter(Boolean);
    if (words.length < 5) {
      return { valid: false, reason: `Section ${sec} too short (${words.length} words)` };
    }
  }
  return { valid: true };
}

for (const id of allExplainerIds) {
  const expl = CHART_EXPLAINERS[id];
  check(Boolean(expl), `Explainer definition exists for chart: ${id}`);
  const result = validateExplainerCompleteness(expl);
  check(result.valid, `Chart ${id} passes all 7 section completeness checks (${result.reason || 'OK'})`);
  check(Boolean(expl.axisExplanations && expl.axisExplanations.x && expl.axisExplanations.y), `Chart ${id} defines both X and Y axis hover explanations`);
}

// =============================================================
// Suite 2: Explainer Consistency with Actual Chart Configurations
// =============================================================
console.log('\n[Suite 2/6] Testing Explainer Consistency with Chart Definitions...');

const EXPECTED_CHART_AXES = {
  rssi_vs_distance_model: { xUnit: 'm', yUnit: 'dBm' },
  path_loss_vs_theory: { xUnit: 'm', yUnit: 'dB' },
  snr_vs_distance: { xUnit: 'm', yUnit: 'dB' },
  link_quality_matrix: { xUnit: 'Node ID', yUnit: 'Node ID' },
  pdr_timeline: { xUnit: 's', yUnit: '%' },
  latency_cdf: { xUnit: 'ms', yUnit: '%' },
  throughput_and_rate: { xUnit: 's', yUnit: 'bps / pps' },
  packet_loss_vs_distance: { xUnit: 'm', yUnit: '%' },
  delivered_by_hop_count: { xUnit: 'hops', yUnit: 'packets' },
  relay_activity: { xUnit: 's', yUnit: 'pkts / 2s' },
  collisions_vs_retransmission: { xUnit: 's', yUnit: 'collisions' },
  channel_loss_dynamics: { xUnit: 's', yUnit: 'drops / 2s' },
  fleet_soc: { xUnit: 's', yUnit: '%' },
  energy_vs_forwarding: { xUnit: 'pkts', yUnit: 'mAh' },
  trajectory_error_vectors: { xUnit: 'm', yUnit: 'm' },
  position_error_timeline: { xUnit: 's', yUnit: 'm' },
  ack_latency_cdf: { xUnit: 'ms', yUnit: '%' },
  comparative_latency_cdfs: { xUnit: 'ms', yUnit: '%' },
  sidebar_latency_cdf: { xUnit: 'ms', yUnit: '%' },
  sidebar_rssi_vs_distance: { xUnit: 'm', yUnit: 'dBm' }
};

for (const [id, expected] of Object.entries(EXPECTED_CHART_AXES)) {
  const expl = CHART_EXPLAINERS[id];
  check(Boolean(expl), `Chart ${id} defined for consistency evaluation`);
  check(expl.xy.includes('X axis:') && expl.xy.includes('versus') && expl.xy.includes('Y axis:'), `Chart ${id} follows strict X versus Y syntax`);
  if (expected.xUnit !== 'Node ID') {
    check(expl.xy.toLowerCase().includes(expected.xUnit.toLowerCase()), `Chart ${id} references expected X unit: ${expected.xUnit}`);
  }
}

// =============================================================
// Suite 3: Provenance Rules & Zero Bench Measurement Enforcement
// =============================================================
console.log('\n[Suite 3/6] Testing Provenance Tags and Zero Bench Measurement Rule...');

const ALLOWED_PROVENANCE_TAGS = new Set(['simulated', 'model', 'cited', 'assumed']);
const explainersSourcePath = path.join(ROOT_DIR, 'dashboard', 'src', 'chart_explainers.js');
const explainersSourceCode = fs.readFileSync(explainersSourcePath, 'utf8');

check(!/measured/i.test(explainersSourceCode), 'Word measured does not appear in chart_explainers.js');

for (const id of allExplainerIds) {
  const expl = CHART_EXPLAINERS[id];
  check(Array.isArray(expl.provenanceTags) && expl.provenanceTags.length > 0, `Chart ${id} defines at least one provenance tag`);
  for (const tag of expl.provenanceTags) {
    check(ALLOWED_PROVENANCE_TAGS.has(tag), `Tag [${tag}] in chart ${id} is in allowed set`);
  }
}

// =============================================================
// Suite 4: Dynamic Scenario Fill Test (SF8 vs SF7 Sensitivity)
// =============================================================
console.log('\n[Suite 4/6] Testing Dynamic Scenario Fill...');

const explainerSf8 = formatExplainer('rssi_vs_distance_model', { sf: 8 });
check(explainerSf8.howToRead.includes('-126.0 dBm'), 'SF8 formatExplainer fills demodulation sensitivity -126.0 dBm');
check(explainerSf8.howToRead.includes('SF8'), 'SF8 formatExplainer includes SF8 identifier');

const explainerSf7 = formatExplainer('rssi_vs_distance_model', { sf: 7 });
check(explainerSf7.howToRead.includes('-123.0 dBm'), 'SF7 formatExplainer fills demodulation sensitivity -123.0 dBm');
check(explainerSf7.howToRead.includes('SF7'), 'SF7 formatExplainer includes SF7 identifier');

const explainerCustomExp = formatExplainer('path_loss_vs_theory', { pathExp: 3.5 });
check(explainerCustomExp.howToRead.includes('3.5'), 'Custom path loss exponent 3.5 dynamically filled into text');

// =============================================================
// Suite 5: Accessibility & DOM Behavior Test
// =============================================================
console.log('\n[Suite 5/6] Testing Accessibility Attributes & DOM Controller...');

class MockDomElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.eventListeners = {};
  }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  removeAttribute(k) { delete this.attributes[k]; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentElement = null;
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  contains(el) {
    if (el === this) return true;
    for (const child of this.children) {
      if (child.contains(el)) return true;
    }
    return false;
  }

  insertBefore(newEl, refEl) {
    newEl.parentElement = this;
    const idx = this.children.indexOf(refEl);
    if (idx === -1) this.children.push(newEl);
    else this.children.splice(idx, 0, newEl);
    return newEl;
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const targetId = selector.slice(1);
      if (this.id === targetId) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    if (selector.includes('chart-info-btn') || selector.includes('explainer-close-btn') || selector.includes('chart-explainer-card')) {
      const cls = selector.replace('.', '').replace('#', '');
      if (this.className.includes(cls)) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    if (selector.includes('span') || selector.includes('title')) {
      if (this.className.includes('chart-title') || this.id.includes('lbl')) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  addEventListener(type, cb) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(cb);
  }

  dispatchEvent(evt) {
    const type = typeof evt === 'string' ? evt : evt.type;
    const cbs = this.eventListeners[type] || [];
    cbs.forEach(cb => cb(evt));
  }

  focus() {
    this.focused = true;
  }

  getBoundingClientRect() {
    return { width: 600, height: 260, top: 0, left: 0, right: 600, bottom: 260 };
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.className && cur.className.includes(selector.replace('.', ''))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
}

// Setup global mock environment
globalThis.document = {
  createElement: (tag) => new MockDomElement(tag),
  addEventListener: (type, cb) => {
    if (!globalThis.document.listeners) globalThis.document.listeners = {};
    if (!globalThis.document.listeners[type]) globalThis.document.listeners[type] = [];
    globalThis.document.listeners[type].push(cb);
  },
  removeEventListener: (type, cb) => {
    if (!globalThis.document.listeners || !globalThis.document.listeners[type]) return;
    const idx = globalThis.document.listeners[type].indexOf(cb);
    if (idx !== -1) globalThis.document.listeners[type].splice(idx, 1);
  },
  body: new MockDomElement('body')
};

const mockPanel = new MockDomElement('div');
mockPanel.className = 'chart-panel';

const mockTitle = new MockDomElement('span');
mockTitle.className = 'chart-title';
mockTitle.textContent = 'Simulated RSSI vs Distance Model';
mockPanel.appendChild(mockTitle);

const mockCanvasWrapper = new MockDomElement('div');
mockPanel.appendChild(mockCanvasWrapper);

const mockCanvas = new MockDomElement('canvas', 'canvasRssiDistance');
mockCanvasWrapper.appendChild(mockCanvas);

const controller = new ChartExplainerController(null, mockCanvas, {
  title: 'Simulated RSSI vs Distance Model',
  explainerId: 'rssi_vs_distance_model'
});

check(Boolean(controller.buttonEl), 'Controller created info button element');
check(controller.buttonEl.getAttribute('role') === 'button', 'Info button has role=button');
check(controller.buttonEl.getAttribute('aria-haspopup') === 'dialog', 'Info button has aria-haspopup=dialog');
check(controller.buttonEl.getAttribute('aria-expanded') === 'false', 'Info button aria-expanded is initially false');

// Keyboard focus opens card within 150ms
controller.buttonEl.dispatchEvent({ type: 'focus' });
await new Promise(r => setTimeout(r, 140));
check(controller.isOpen === true, 'Keyboard focus on trigger opens card within 150 ms');
check(controller.buttonEl.getAttribute('aria-expanded') === 'true', 'aria-expanded reflects true when open');

// Explainer markup contains dialog role and accessible label
const cardHtml = renderExplainerCardHtml(CHART_EXPLAINERS['rssi_vs_distance_model']);
check(cardHtml.includes('role="dialog"'), 'Explainer card has role=dialog');
check(cardHtml.includes('aria-label="Graph explanation:'), 'Explainer card has accessible aria-label');

// Escape closes card and returns focus to trigger
let escapeHandler = (globalThis.document.listeners?.keydown || []).slice(-1)[0];
if (escapeHandler) {
  escapeHandler({ key: 'Escape', stopPropagation: () => {} });
  check(controller.isOpen === false, 'Escape key closes the explainer dialog');
  check(controller.buttonEl.getAttribute('aria-expanded') === 'false', 'aria-expanded reverts to false on close');
  check(controller.buttonEl.focused === true, 'Escape returns keyboard focus to trigger button');
}

// 700 ms dwell timer test
mockCanvas.dispatchEvent({ type: 'mousemove' });
check(Boolean(controller.dwellTimer), 'Canvas mousemove schedules dwell timer');
await new Promise(r => setTimeout(r, 750));
check(controller.hintEl && controller.hintEl.style.display !== 'none', '700 ms dwell without mouse movement displays hint pill');

mockCanvas.dispatchEvent({ type: 'mousemove' });
check(controller.hintEl.style.display === 'none', 'Subsequent mouse movement immediately hides hint pill');

controller.destroy();

// =============================================================
// Suite 6: Mutation Tests (Completeness & Missing Explainer Checks)
// =============================================================
console.log('\n[Suite 6/6] Testing Mutation Guardrails...');

// Mutation 1: Delete a required section from a cloned explainer and assert it fails
const mutatedExplainer = { ...CHART_EXPLAINERS['rssi_vs_distance_model'] };
delete mutatedExplainer.expertDetails;
const mutation1Result = validateExplainerCompleteness(mutatedExplainer);
check(!mutation1Result.valid && mutation1Result.reason.includes('Missing section: expertDetails'), 'Mutation check fails when expertDetails section is deleted');

// Mutation 2: Dummy chart without explainer resolution fails
const dummyId = resolveExplainerId('canvasNonexistentRandomId', 'Unknown Random Title');
check(dummyId === null, 'Unknown canvas ID and title resolves to null');

console.log('\n================================================================');
console.log(`  ALL ${passedCount} SCIENTIFIC CHART EXPLAINER TESTS PASSED!`);
console.log('================================================================\n');
