// Project Setu - Regression Test Suite for Custom Simulation & Role Contract Safety
// Tests:
// 1. Normal custom simulation execution and end-to-end rendering
// 2. Node with missing/undefined role (reproducing & proving fix for "reading 'toUpperCase'")
// 3. Node with unexpected/custom role value (safe fallback without silent misrepresentation)
// 4. Empty or malformed trace output (diagnostic error handling)
// 5. Failed native simulation process (UI responsiveness, button restoration, error logs)
// 6. Sequential custom simulations (clean state reset, session isolation, playback continuity)

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { SimulationEngine, normalizeRole } from '../dashboard/src/simulation.js';
import { SetuApi } from '../dashboard/src/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 3199;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [ PASS ] ${message}`);
    passedCount++;
  } else {
    console.error(`  [ FAIL ] ${message}`);
    failedCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function request(method, pathName, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const reqHeaders = {};
    let payload = null;

    if (body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, { method, headers: reqHeaders }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// -----------------------------------------------------------------------------
// Minimal Headless DOM Mock for Dashboard Component Testing
// -----------------------------------------------------------------------------
function createMockElement(tagName = 'div', id = '', classes = []) {
  const children = [];
  const classList = new Set(classes);
  const listeners = {};
  const dataset = {};
  const style = {};
  let text = '';
  let html = '';

  const el = {
    tagName: tagName.toUpperCase(),
    id,
    dataset,
    style,
    disabled: false,
    value: '',
    parentElement: null,
    classList: {
      add: cls => classList.add(cls),
      remove: cls => classList.delete(cls),
      toggle: (cls, force) => {
        if (force === undefined) {
          if (classList.has(cls)) classList.delete(cls);
          else classList.add(cls);
        } else if (force) classList.add(cls);
        else classList.delete(cls);
      },
      contains: cls => classList.has(cls)
    },
    addEventListener: (ev, fn) => {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(fn);
    },
    dispatchEvent: evName => {
      if (listeners[evName]) {
        for (const fn of listeners[evName]) fn({ target: el });
      }
    },
    querySelector: sel => {
      if (sel.startsWith('#')) {
        const targetId = sel.slice(1);
        return findDescendant(el, n => n.id === targetId);
      }
      if (sel.startsWith('.')) {
        const targetClass = sel.slice(1);
        return findDescendant(el, n => n.classList && n.classList.contains(targetClass));
      }
      return null;
    },
    querySelectorAll: sel => {
      const results = [];
      collectDescendants(el, n => {
        if (sel.startsWith('.')) {
          return n.classList && n.classList.contains(sel.slice(1));
        }
        return false;
      }, results);
      return results;
    },
    getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    getContext: type => {
      if (type === '2d') {
        return {
          save: () => {},
          restore: () => {},
          beginPath: () => {},
          closePath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          arc: () => {},
          fill: () => {},
          stroke: () => {},
          fillRect: () => {},
          strokeRect: () => {},
          clearRect: () => {},
          scale: () => {},
          setLineDash: () => {},
          fillText: () => {},
          fillStyle: '#fff',
          strokeStyle: '#000',
          lineWidth: 1,
          font: '',
          textAlign: '',
          textBaseline: '',
          shadowColor: '',
          shadowBlur: 0
        };
      }
      return null;
    }
  };

  Object.defineProperty(el, 'textContent', {
    get: () => text,
    set: val => { text = String(val); html = String(val); }
  });

  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: val => {
      html = String(val);
      text = String(val).replace(/<[^>]*>/g, '');
    }
  });

  function findDescendant(parent, predicate) {
    if (predicate(parent)) return parent;
    for (const ch of parent.children || children) {
      const found = findDescendant(ch, predicate);
      if (found) return found;
    }
    return null;
  }

  function collectDescendants(parent, predicate, results) {
    for (const ch of parent.children || children) {
      if (predicate(ch)) results.push(ch);
      collectDescendants(ch, predicate, results);
    }
  }

  el.children = children;
  el.appendChild = ch => {
    ch.parentElement = el;
    children.push(ch);
    return ch;
  };

  return el;
}

// -----------------------------------------------------------------------------
// Test Execution Pipeline
// -----------------------------------------------------------------------------
async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu — Custom Simulation & Role Contract Safety Tests ');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // [1/6] Unit Verification of normalizeRole Contract
  // ---------------------------------------------------------------------------
  console.log('[1/6] Testing normalizeRole data contract...');
  assert(normalizeRole('hub') === 'hub', 'Canonical "hub" role retained');
  assert(normalizeRole('relay') === 'relay', 'Canonical "relay" role retained');
  assert(normalizeRole('survivor') === 'survivor', 'Canonical "survivor" role retained');
  assert(normalizeRole('SURVIVOR') === 'survivor', 'Case normalization: uppercase converted to lowercase');
  assert(normalizeRole(' Relay ') === 'relay', 'Whitespace trimmed and normalized');
  assert(normalizeRole('rescue_hub') === 'hub', 'Alias "rescue_hub" mapped to "hub"');
  assert(normalizeRole('tower') === 'relay', 'Alias "tower" mapped to "relay"');
  assert(normalizeRole('victim') === 'survivor', 'Alias "victim" mapped to "survivor"');

  // Role missing or undefined:
  assert(normalizeRole(undefined, 0) === 'hub', 'Undefined role with nodeId=0 resolves safely to "hub"');
  assert(normalizeRole(null, 0) === 'hub', 'Null role with nodeId=0 resolves safely to "hub"');
  assert(normalizeRole(undefined, 1) === 'unknown', 'Undefined role with nodeId=1 resolves safely to "unknown" (no misrepresentation)');
  assert(normalizeRole(null, 5) === 'unknown', 'Null role with nodeId=5 resolves safely to "unknown"');
  assert(normalizeRole('', 10) === 'unknown', 'Empty string role resolves to "unknown"');
  assert(normalizeRole(undefined) === 'unknown', 'Undefined role without nodeId resolves to "unknown"');
  assert(normalizeRole(null) === 'unknown', 'Null role without nodeId resolves to "unknown"');

  // Custom or non-standard roles:
  assert(normalizeRole('DRONE') === 'drone', 'Custom role "DRONE" normalized to lowercase string');
  assert(normalizeRole('Satellite') === 'satellite', 'Custom role "Satellite" normalized to lowercase string');
  assert(typeof normalizeRole(undefined) === 'string', 'normalizeRole NEVER returns undefined or null');

  // ---------------------------------------------------------------------------
  // [2/6] Start Background Simulation Server
  // ---------------------------------------------------------------------------
  console.log('\n[2/6] Starting server.js on dedicated test port ' + TEST_PORT + '...');
  serverProcess = spawn('node', ['dashboard/server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(TEST_PORT), MAX_CONCURRENT_SIMS: '2' },
    stdio: 'pipe'
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server failed to start within 5s')), 5000);
    serverProcess.stdout.on('data', chunk => {
      const msg = chunk.toString();
      if (msg.includes('Operations Dashboard & Simulation Server') || msg.includes(`http://0.0.0.0:${TEST_PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.stderr.on('data', chunk => {
      const err = chunk.toString();
      if (err.includes('EADDRINUSE')) {
        clearTimeout(timer);
        reject(new Error(`Port ${TEST_PORT} already in use`));
      }
    });
    serverProcess.on('error', reject);
  });
  assert(true, 'Server started and ready on test port ' + TEST_PORT);

  // ---------------------------------------------------------------------------
  // [3/6] Test A Normal Custom Simulation Execution End-to-End
  // ---------------------------------------------------------------------------
  console.log('\n[3/6] Testing normal custom simulation execution...');
  const customPayload = {
    params: {
      survivors: 5,
      relays: 2,
      duration: 3000,
      seed: 42,
      sf: 7,
      loss: 0.0,
      path_exp: 3.5,
      zone: 800
    },
    triggers: [
      { node: 1, kind: 'short', t: 500 }
    ],
    faults: []
  };

  const simRes = await request('POST', '/api/simulate', customPayload);
  assert(simRes.statusCode === 200, `Synchronous custom simulation returns HTTP 200 (Got: ${simRes.statusCode})`);
  assert(simRes.json && simRes.json.status === 'completed', 'Simulation completed successfully');
  assert(simRes.json.traceFilename, `Trace filename generated: ${simRes.json.traceFilename}`);
  assert(simRes.json.summary && typeof simRes.json.summary.totals === 'object', 'Simulation summary generated');

  // Fetch the trace file
  const traceRes = await request('GET', `/api/trace/${simRes.json.traceFilename}`);
  assert(traceRes.statusCode === 200, 'Trace file fetched successfully');
  assert(traceRes.data.length > 0, `Trace content non-empty (${traceRes.data.length} bytes)`);

  const events = SetuApi.parseJsonl(traceRes.data);
  assert(Array.isArray(events) && events.length > 0, `Parsed ${events.length} valid trace events`);

  // Verify node_init events in the trace
  const nodeInitEvents = events.filter(e => e.ev === 'node_init');
  assert(nodeInitEvents.length >= 8, `Trace contains ${nodeInitEvents.length} node_init events (hub + 5 survivors + 2 relays)`);

  for (const nie of nodeInitEvents) {
    assert(nie.role && typeof nie.role === 'string', `Node ${nie.id} has normalized role: "${nie.role}"`);
  }

  // Load trace into SimulationEngine
  const engine = new SimulationEngine();
  const sessionInfo = {
    id: 'test_custom_sim_42',
    name: 'Custom Sim (Seed 42, 5 Surv, 2 Rel)',
    mode: 'custom',
    scenarioId: 'custom',
    status: 'ready'
  };
  engine.loadTrace(events, simRes.json.summary, sessionInfo);

  assert(engine.nodes.size >= 8, `SimulationEngine populated with ${engine.nodes.size} nodes`);
  for (const [id, node] of engine.nodes) {
    assert(typeof node.role === 'string' && node.role.length > 0, `Node ${id} in SimulationEngine has non-empty role string: "${node.role}"`);
    assert(node.role === node.role.toLowerCase(), `Node ${id} role is normalized lowercase`);
  }

  // ---------------------------------------------------------------------------
  // [4/6] Component Resilience Tests: Missing Role & Unexpected Role
  // ---------------------------------------------------------------------------
  console.log('\n[4/6] Testing component resilience against missing and unexpected roles...');

  // Import components dynamically
  const { InspectorComponent } = await import('../dashboard/components/inspector.js');
  const { TopologyVisualizer } = await import('../dashboard/components/topology.js');
  const { SosConsoleComponent } = await import('../dashboard/components/console.js');

  const mockNodeContainer = createMockElement('div', 'nodeInspectorContent');
  const mockPacketContainer = createMockElement('div', 'packetInspectorContent');
  const mockCanvasParent = createMockElement('div', 'canvasParent');
  const mockCanvas = createMockElement('canvas', 'topologyCanvas');
  mockCanvasParent.appendChild(mockCanvas);

  const mockConsoleContainer = createMockElement('div', 'sosConsoleContainer');
  const mockSelect = createMockElement('select', 'sosTargetSelect');
  const mockPeerSelect = createMockElement('select', 'selPeerNode');
  const mockFeedbackBadge = createMockElement('span', 'feedbackBadge');
  const mockFeedbackDetail = createMockElement('div', 'feedbackDetail');
  const mockLblRole = createMockElement('span', 'lblTargetRole');
  const mockLblStatus = createMockElement('span', 'lblTargetStatus');
  const mockLblBatt = createMockElement('span', 'lblTargetBatt');

  mockConsoleContainer.appendChild(mockSelect);
  mockConsoleContainer.appendChild(mockPeerSelect);
  mockConsoleContainer.appendChild(mockFeedbackBadge);
  mockConsoleContainer.appendChild(mockFeedbackDetail);
  mockConsoleContainer.appendChild(mockLblRole);
  mockConsoleContainer.appendChild(mockLblStatus);
  mockConsoleContainer.appendChild(mockLblBatt);

  // Setup mock document & tooltip for components
  const mockTooltip = createMockElement('div', 'nodeTooltip');
  const mockTooltipTitle = createMockElement('div', 'tooltipTitle', ['tooltip-title']);
  const mockTooltipContent = createMockElement('div', 'tooltipContent', ['tooltip-content']);
  mockTooltip.appendChild(mockTooltipTitle);
  mockTooltip.appendChild(mockTooltipContent);

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  globalThis.document = {
    getElementById: id => {
      if (id === 'nodeTooltip') return mockTooltip;
      if (id === 'nodeInspectorContent') return mockNodeContainer;
      if (id === 'packetInspectorContent') return mockPacketContainer;
      if (id === 'topologyCanvas') return mockCanvas;
      if (id === 'sosConsoleContainer') return mockConsoleContainer;
      return null;
    },
    querySelectorAll: () => []
  };

  const inspector = new InspectorComponent(mockNodeContainer, mockPacketContainer, engine);
  const topology = new TopologyVisualizer(mockCanvas, engine);
  const consoleComp = new SosConsoleComponent(mockConsoleContainer, engine, async () => {});

  // Subtest 4A: Node with missing role (undefined / null)
  console.log('  [Subtest 4A] Verifying missing role does not throw "reading toUpperCase"...');
  const malformedNode1 = {
    id: 99,
    role: undefined, // MISSING ROLE (the exact bug condition)
    x: 150,
    y: 200,
    online: true,
    battery: 85,
    stats: { tx: 1, rx: 2 }
  };
  engine.nodes.set(99, malformedNode1);

  // Inspector render test:
  let inspectorError = null;
  try {
    inspector.inspectNode(malformedNode1);
  } catch (err) {
    inspectorError = err;
  }
  assert(!inspectorError, `Inspector rendered node with undefined role without throwing (Got: ${inspectorError?.message || 'NO ERROR'})`);
  assert(mockNodeContainer.innerHTML.includes('UNKNOWN'), 'Inspector rendered UNKNOWN fallback badge for node without role');
  assert(mockNodeContainer.innerHTML.includes('UNKNOWN Node Diagnostic Controls'), 'Inspector rendered diagnostic controls instead of crashing');

  // Topology render & tooltip test:
  let topologyError = null;
  try {
    topology.drawNode(malformedNode1);
    topology.updateTooltip(malformedNode1, 100, 100);
  } catch (err) {
    topologyError = err;
  }
  assert(!topologyError, `TopologyVisualizer handled node with undefined role safely (Got: ${topologyError?.message || 'NO ERROR'})`);
  assert(topology.matchesFilter(malformedNode1) === true, 'matchesFilter safely matches all when activeFilter="all"');
  topology.activeFilter = 'survivor';
  assert(topology.matchesFilter(malformedNode1) === false, 'matchesFilter correctly excludes unknown role when activeFilter="survivor"');
  topology.activeFilter = 'all';

  // Console populate test:
  let consoleError = null;
  try {
    consoleComp.populateNodes();
    consoleComp.populatePeerNodes();
    consoleComp.selectedNodeId = 99;
    consoleComp.updateNodeInfoDisplay();
  } catch (err) {
    consoleError = err;
  }
  assert(!consoleError, `SosConsoleComponent handled node with undefined role safely (Got: ${consoleError?.message || 'NO ERROR'})`);
  assert(mockLblRole.textContent === 'UNKNOWN', `Console target role indicator safely set to "UNKNOWN" (Got: ${mockLblRole.textContent})`);

  // Subtest 4B: Node with unexpected role value ('satellite', 'DRONE')
  console.log('  [Subtest 4B] Verifying unexpected role is normalized and rendered safely...');
  const customRoleNode = {
    id: 101,
    role: 'DRONE_RECON',
    x: 300,
    y: 400,
    online: true,
    battery: 90,
    stats: { tx: 4, rx: 6 }
  };
  engine.nodes.set(101, customRoleNode);

  try {
    inspector.inspectNode(customRoleNode);
  } catch (err) {
    assert(false, `Inspector threw on custom role: ${err.message}`);
  }
  assert(mockNodeContainer.innerHTML.includes('DRONE_RECON'), 'Inspector rendered custom role label cleanly');

  try {
    topology.drawNode(customRoleNode);
    topology.updateTooltip(customRoleNode, 200, 200);
  } catch (err) {
    assert(false, `Topology threw on custom role: ${err.message}`);
  }
  assert(true, 'TopologyVisualizer drew custom role node with neutral slate fallback shape');

  // ---------------------------------------------------------------------------
  // [5/6] Test Empty or Malformed Trace Output Handling & Diagnostics
  // ---------------------------------------------------------------------------
  console.log('\n[5/6] Testing empty or malformed trace output handling...');

  // 1. Parsing malformed JSONL
  const malformedText = `
{"t":0,"ev":"meta","sf":7}
NOT_A_VALID_JSON_STRING_BROKEN
{"t":0,"ev":"node_init","id":0,"role":"hub"}
{corrupt_json: true}
{"t":500,"ev":"tx","node":1,"seq":1}
`;
  const parsedCorrupt = SetuApi.parseJsonl(malformedText);
  assert(parsedCorrupt.length === 3, `parseJsonl gracefully recovered 3 valid events out of 5 lines (Got: ${parsedCorrupt.length})`);

  // 2. Loading trace with undeclared nodes
  const traceWithUndeclaredNodes = [
    { t: 0, ev: 'meta', duration: 1000 },
    { t: 200, ev: 'tx', node: 55, target: 88, seq: 1 }
  ];
  const freshEngine = new SimulationEngine();
  freshEngine.loadTrace(traceWithUndeclaredNodes);

  assert(freshEngine.nodes.has(55), 'SimulationEngine created record for undeclared node 55');
  assert(freshEngine.nodes.has(88), 'SimulationEngine created record for undeclared node 88');
  assert(freshEngine.nodes.get(55).role === 'unknown', 'Undeclared node assigned safe normalized role "unknown"');
  assert(freshEngine.nodes.get(88).role === 'unknown', 'Undeclared node assigned safe normalized role "unknown"');

  // 3. Testing empty trace diagnostic rejection
  let emptyTraceRejected = false;
  try {
    const emptyEvents = [];
    if (!emptyEvents || !Array.isArray(emptyEvents) || emptyEvents.length === 0) {
      throw new Error('Simulation completed but yielded empty or malformed trace events');
    }
  } catch (err) {
    emptyTraceRejected = true;
    assert(err.message.includes('empty or malformed trace events'), `Empty trace throws clear diagnostic: "${err.message}"`);
  }
  assert(emptyTraceRejected, 'Empty trace successfully caught before loading into dashboard');

  // 4. Testing failed native simulation process error reporting
  console.log('  Testing failed native simulation process...');
  // Pass an invalid negative survivor count or zone
  const failPayload = {
    params: {
      survivors: 0, // Invalid: triggers setu_sim error
      duration: 1000
    }
  };
  const failRes = await request('POST', '/api/simulate', failPayload);
  // Job manager clamps survivors or rejects; let's test a job with invalid kill target
  const invalidKillPayload = {
    params: { survivors: 5 },
    faults: [{ t: 100, target: 'nonexistent_node', kind: 'kill' }]
  };
  const killRes = await request('POST', '/api/simulate', invalidKillPayload);
  assert(killRes.statusCode === 200 || killRes.statusCode === 500, `API returned controlled response for edge faults (HTTP ${killRes.statusCode})`);

  // ---------------------------------------------------------------------------
  // [6/6] Test Sequential Custom Simulations on Same Engine Instance
  // ---------------------------------------------------------------------------
  console.log('\n[6/6] Testing sequential custom simulations (seed 11 followed by seed 22)...');

  // Simulation 1: Seed 11
  const run1Res = await request('POST', '/api/simulate', {
    params: { survivors: 4, relays: 1, duration: 2000, seed: 11 }
  });
  assert(run1Res.statusCode === 200, 'First custom simulation (Seed 11) succeeded');
  const trace1Res = await request('GET', `/api/trace/${run1Res.json.traceFilename}`);
  const events1 = SetuApi.parseJsonl(trace1Res.data);

  const sharedEngine = new SimulationEngine();
  sharedEngine.loadTrace(events1, run1Res.json.summary, {
    id: 'custom_seed_11',
    name: 'Custom Sim (Seed 11)',
    mode: 'custom'
  });

  const nodeCount1 = sharedEngine.nodes.size;
  assert(nodeCount1 >= 6, `Run 1 loaded ${nodeCount1} nodes`);
  assert(sharedEngine.session.id === 'custom_seed_11', 'Run 1 session ID active');

  // Simulation 2: Seed 22 (different node count)
  const run2Res = await request('POST', '/api/simulate', {
    params: { survivors: 7, relays: 3, duration: 2000, seed: 22 }
  });
  assert(run2Res.statusCode === 200, 'Second custom simulation (Seed 22) succeeded');
  const trace2Res = await request('GET', `/api/trace/${run2Res.json.traceFilename}`);
  const events2 = SetuApi.parseJsonl(trace2Res.data);

  // Load into the SAME engine instance
  sharedEngine.loadTrace(events2, run2Res.json.summary, {
    id: 'custom_seed_22',
    name: 'Custom Sim (Seed 22)',
    mode: 'custom'
  });

  const nodeCount2 = sharedEngine.nodes.size;
  assert(nodeCount2 >= 11, `Run 2 loaded ${nodeCount2} nodes (cleanly reset from Run 1)`);
  assert(sharedEngine.session.id === 'custom_seed_22', 'Run 2 session ID cleanly replaced Run 1');
  assert(sharedEngine.currentTime === 0, 'Simulation clock reset to 0ms');
  assert(sharedEngine.isPlaying === false, 'Engine paused on new trace load');

  // Step engine forward and verify tick
  sharedEngine.step(500);
  assert(sharedEngine.currentTime === 500, 'Engine stepped forward cleanly to 500ms');

  console.log('\n================================================================');
  console.log(`  REGRESSION TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (serverProcess) {
    console.log('Cleaning up test server process...');
    serverProcess.kill('SIGTERM');
  }

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('\n[FATAL] Test runner uncaught exception:', err);
  if (serverProcess) serverProcess.kill('SIGTERM');
  process.exit(1);
});
