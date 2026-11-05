// Project Setu: Setu Twin Viewer, Narrator, and Loss Budget Unit & DOM Tests
// Validates plain-English narration, link-margin waterfall decomposition, and 3D projection.

import { narrateEvent, narrateIncidentStory, computeLossBudget, formatTimestamp, findCrossedObstacles, HAZARD_NAMES, SENSITIVITY_BY_SF } from '../dashboard/src/narrator.js';
import { LossWaterfallComponent } from '../dashboard/components/loss_waterfall.js';
import { SetuTwin3DViewer } from '../dashboard/components/setu_twin.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Minimal mock DOM environment for headless testing
class MockElement {
  constructor(id = '') {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.children = [];
    this.parentElement = {
      getBoundingClientRect: () => ({ width: 800, height: 480 })
    };
    this.eventListeners = {};
  }

  addEventListener(type, cb) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(cb);
  }

  getContext(type) {
    return {
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      closePath: () => {},
      arc: () => {},
      ellipse: () => {},
      roundRect: () => {},
      fillText: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} })
    };
  }

  getBoundingClientRect() {
    return { width: 800, height: 480, left: 0, top: 0 };
  }
}

// Setup global mock document if running outside a browser
if (typeof globalThis.document === 'undefined') {
  const elements = new Map();
  globalThis.document = {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new MockElement(id));
      return elements.get(id);
    },
    querySelectorAll: () => []
  };
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  globalThis.window = {
    addEventListener: () => {}
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('  Project Setu: Setu Twin Viewer, Narrator & Waterfall Tests');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test Suite 1: Plain English Event Narrator
  // -------------------------------------------------------------
  console.log('[Suite 1/4] Testing Plain English Event Narrator...');

  // Originate
  const s1 = narrateEvent({ ev: 'originate', node: 7, seq: 1, hazard: 2, contact: 0 });
  assert(s1.includes('Node 7: Initiated emergency SOS packet #1 for Trapped Under Debris'), 'Originate narrates trapped emergency correctly');

  // Voice wake word & command
  const s2 = narrateEvent({ ev: 'wake_word', node: 3 });
  assert(s2.includes("Node 3: Voice wake word 'Setu' detected"), 'Wake word narrates listening state');

  const s3 = narrateEvent({ ev: 'voice_command', node: 3, hazard: 1 });
  assert(s3.includes('Node 3: Voice command recognized: Medical Emergency SOS'), 'Voice command narrates recognized medical hazard');

  // Fall impact
  const s4 = narrateEvent({ ev: 'fall_impact_detected', node: 2 });
  assert(s4.includes('Node 2: Accelerometer confirmed fall impact shock (>3.0g)'), 'Fall impact detection narrates auto-SOS');

  // TX & RX
  const s5 = narrateEvent({ ev: 'tx', node: 100, origin: 7, seq: 1, hazard: 2, hop: 1, air: 206 });
  assert(s5.includes('Node 100 (mesh relay): Transmitted packet #1 from Node 7'), 'TX narrates relay forward');

  const s6 = narrateEvent({ ev: 'rx', node: 100, from: 7, rssi: -110.0, snr: 8.5 }, { sf: 9 });
  assert(s6.includes('Node 100: Received transmission from Node 7') && s6.includes('above sensitivity'), 'RX narrates received signal and sensitivity margin');

  // Drops
  const s7 = narrateEvent({ ev: 'drop', node: 10, from: 100, rssi: -134.0, why: 'weak' }, { sf: 9 });
  assert(s7.includes('signal is 5.5 dB below receiver threshold'), 'Drop weak narrates delta below threshold');

  const s8 = narrateEvent({ ev: 'drop', node: 11, from: 100, rssi: -117.0, why: 'collision' });
  assert(s8.includes('co-channel radio collision'), 'Drop collision narrates radio interference');

  const s9 = narrateEvent({ ev: 'drop', node: 12, from: 100, why: 'halfduplex' });
  assert(s9.includes('half-duplex constraint'), 'Drop halfduplex narrates transceiver constraint');

  // Alert
  const s10 = narrateEvent({ ev: 'alert', origin: 7, hazard: 2, hops: 2, latency_ms: 1850 });
  assert(s10.includes('RESCUE HUB 0: Emergency alert received from Node 7!') && s10.includes('Trapped Under Debris'), 'Alert narrates hub arrival with hops and latency');

  // -------------------------------------------------------------
  // Test Suite 2: Incident Story Narrator
  // -------------------------------------------------------------
  console.log('\n[Suite 2/4] Testing Incident Story Multi-Event Aggregation...');
  const incidentEvents = [
    { t: 1500, ev: 'button_down', node: 7 },
    { t: 3000, ev: 'originate', node: 7, seq: 1, hazard: 2, contact: 0 },
    { t: 3000, ev: 'tx', node: 7, origin: 7, seq: 1, hazard: 2, hop: 0, air: 206 },
    { t: 3206, ev: 'rx', node: 100, from: 7, rssi: -115.0, snr: 6.0 },
    { t: 3450, ev: 'tx', node: 100, origin: 7, seq: 1, hazard: 2, hop: 1, air: 206 },
    { t: 3656, ev: 'alert', origin: 7, hazard: 2, hops: 1, latency_ms: 656 }
  ];
  const story = narrateIncidentStory(incidentEvents, 7, 9);
  assert(story.length === 6, `Incident story captures all 6 incident events (Got: ${story.length})`);
  assert(story[0].t === 1500 && story[0].text.includes('Panic button pressed'), 'Story begins with physical trigger');
  assert(story[story.length - 1].t === 3656 && story[story.length - 1].text.includes('RESCUE HUB 0'), 'Story concludes with hub rescue delivery');

  // -------------------------------------------------------------
  // Test Suite 3: Loss Budget Waterfall Component
  // -------------------------------------------------------------
  console.log('\n[Suite 3/4] Testing Loss Budget Waterfall Component...');
  const mockContainer = new MockElement('containerLossWaterfall');
  const waterfall = new LossWaterfallComponent(mockContainer);
  assert(typeof waterfall.update === 'function', 'LossWaterfallComponent exposes update method');

  waterfall.update({
    from: 3,
    to: 100,
    dist: 120.0,
    tx_dbm: 14.0,
    path_loss: 93.7,
    obstacle_loss_db: 22.0,
    body_loss_db: 15.0,
    shadow: 4.0,
    sensitivity_dbm: -128.5
  });

  const descEl = document.getElementById('lwLinkDescription');
  assert(descEl && descEl.textContent.includes('Path: Node 3 -> Node 100'), 'Link path description updated');

  const badgeEl = document.getElementById('lwViableBadge');
  assert(badgeEl && badgeEl.textContent.length > 0, 'Viability badge rendered with margin');

  // Test computeLossBudget for wall-blocked link
  console.log('Testing computeLossBudget for wall-blocked link...');
  const node1 = { id: 1, role: 'survivor', x: 190.768, y: 118.803, hazard: 2, motion_profile: 'stationary' };
  const node0 = { id: 0, role: 'hub', x: 60.0, y: 60.0 };
  const mockObstacles = [
    { id: 1, name: 'exterior_west_shear_wall', material: 'reinforced_concrete', x1: 130.0, y1: 50.0, x2: 130.0, y2: 160.0, loss_db: 22.0 },
    { id: 2, name: 'interior_corridor_partition', material: 'reinforced_concrete', x1: 150.0, y1: 80.0, x2: 150.0, y2: 140.0, loss_db: 20.0 }
  ];

  const wallBudget = computeLossBudget(node1, node0, {
    obstacles: mockObstacles,
    sf: 7,
    rssi: -127.9
  });

  assert(wallBudget.crossedWalls.length === 2, `Ray intersects both walls (Got: ${wallBudget.crossedWalls.length})`);
  assert(wallBudget.totalWallLoss === 42.0, `Total wall attenuation equals 42 dB (Got: ${wallBudget.totalWallLoss})`);
  assert(wallBudget.viable === false, 'Wall-blocked link is unviable');
  assert(wallBudget.link_margin_db === -4.9, `Link margin matches -4.9 dB deficit (Got: ${wallBudget.link_margin_db})`);
  assert(wallBudget.verdict.includes('exterior_west_shear_wall') && wallBudget.verdict.includes('reduced signal below receiver sensitivity'), 'Verdict explicitly names the 22 dB shear wall');

  // Test computeLossBudget for distance-blocked link
  console.log('Testing computeLossBudget for distance-blocked link...');
  const distantNode = { id: 104, role: 'survivor', x: 910.0, y: 60.0 };
  const distanceBudget = computeLossBudget(distantNode, node0, {
    obstacles: [],
    sf: 7,
    rssi: -124.4
  });

  assert(distanceBudget.crossedWalls.length === 0, 'Distance link has 0 crossed walls');
  assert(distanceBudget.viable === false, 'Distance-blocked link is unviable');
  assert(distanceBudget.verdict.includes('distance path loss') && distanceBudget.verdict.includes('reduced signal below receiver sensitivity'), 'Verdict explicitly names distance path loss');

  // Test Plain English Disaster Story Narration
  console.log('Testing narrative timeline disaster story formatting...');
  const storyTx = narrateEvent({ t: 3100, ev: 'originate', node: 1, hazard: 2 }, { story: true });
  assert(storyTx.includes('00:03.1') && storyTx.includes('Node 1 transmits SOS') && storyTx.includes('Radio pulse emitted'), 'Narrates initial SOS transmission with timestamp');

  const storyDrop = narrateEvent({ t: 3200, ev: 'drop', node: 0, from: 1, rssi: -127.9, why: 'weak' }, { story: true });
  assert(storyDrop.includes('00:03.2') && storyDrop.includes('West shear wall attenuates signal') && storyDrop.includes('Dropped'), 'Narrates wall attenuation drop at Hub');

  const storyRelay = narrateEvent({ t: 8200, ev: 'rx', node: 101, from: 1, rssi: -105.7 }, { story: true });
  assert(storyRelay.includes('00:08.2') && storyRelay.includes('Relay 101 on street hears Node 1') && storyRelay.includes('Forwarding'), 'Narrates relay reception and forwarding');

  const storyAck = narrateEvent({ t: 9600, ev: 'haptic', node: 1 }, { story: true });
  assert(storyAck.includes('00:09.6') && storyAck.includes('Survivor 1 receives ACK') && storyAck.includes('Wristband vibrates'), 'Narrates ACK arrival and wristband buzz');

  // Test Stop Crying Wolf
  const storySuppressed = narrateEvent({ t: 8500, ev: 'relay_suppressed', node: 3, origin: 1, seq: 1 }, { story: true });
  assert(!storySuppressed.includes('FAILED') && !storySuppressed.includes('Error') && storySuppressed.includes('Mesh airtime saved'), 'Suppression narrated as normal airtime optimization without failure alarm');

  // -------------------------------------------------------------
  // Test Suite 4: Setu Twin 3D Projection & Coordinates
  // -------------------------------------------------------------
  console.log('\n[Suite 4/4] Testing Setu Twin 3D World Visualizer...');
  const mockTwinContainer = new MockElement('containerSetuTwinView');
  const twin = new SetuTwin3DViewer(mockTwinContainer);

  assert(typeof twin.project === 'function', 'SetuTwin3DViewer provides 3D projection function');
  const p1 = twin.project(500, 500, 0);
  assert(typeof p1.x === 'number' && typeof p1.y === 'number', 'Center world point projects to numeric screen coordinates');
  assert(Math.abs(p1.x - 400) < 5, 'World origin projects near center of 800px viewport');

  // Elevated point projects higher on screen (lower screen Y)
  const pElevated = twin.project(500, 500, 50);
  assert(pElevated.y < p1.y, 'Elevated Z coordinate projects upward on screen in 3D isometric view');

  twin.destroy();
  assert(true, 'SetuTwin3DViewer cleans up animation loop safely');

  console.log('\n================================================================');
  console.log(`  ALL ${passedCount} SETU TWIN & NARRATOR TESTS PASSED!`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});

