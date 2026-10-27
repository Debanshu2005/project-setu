// Project Setu - Comprehensive Position Pipeline & Coordinate System Test Suite
// Validates Tests A through H as specified in engineering prompt.

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SimulationEngine,
  ORIGIN_LAT,
  ORIGIN_LON,
  M_PER_DEG_LAT,
  M_PER_DEG_LON,
  xyToE6,
  e6ToXy,
  computePositionErrorM
} from '../dashboard/src/simulation.js';
import { InspectorComponent } from '../dashboard/components/inspector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const NATIVE_BIN = path.resolve(ROOT, 'build', 'Release', 'setu_sim.exe');

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message, details = {}) {
  if (condition) {
    passedAssertions++;
    console.log(`  [ PASS ] ${message}`);
  } else {
    failedAssertions++;
    console.error(`  [ FAIL ] ${message}`, details);
  }
}

// Minimal mock DOM for InspectorComponent testing
class MockElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.innerHTML = '';
    this.style = {};
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: () => false
    };
    this.listeners = {};
  }

  querySelector(selector) {
    return new MockElement('div');
  }

  querySelectorAll(selector) {
    return [];
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
}

async function runNativeSimProcess(commands, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(NATIVE_BIN, ['--interactive'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';
    const responses = [];

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Native sim process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', chunk => {
      stdoutData += chunk.toString();
      const lines = stdoutData.split('\n');
      stdoutData = lines.pop(); // keep remainder
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          responses.push(parsed);
        } catch (e) {
          // non-JSON trace line
        }
      }
    });

    proc.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (stdoutData && stdoutData.trim()) {
        for (const line of stdoutData.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            responses.push(JSON.parse(trimmed));
          } catch (e) {}
        }
      }
      resolve({ responses, stdoutData, stderrData, code });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    for (const cmd of commands) {
      proc.stdin.write(JSON.stringify(cmd) + '\n');
    }
    proc.stdin.write('{"cmd":"exit"}\n');
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  PROJECT SETU POSITIONING PIPELINE REGRESSION SUITE (TESTS A-H)');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST A: Cartesian-to-Geographic Conversion
  // --------------------------------------------------------------------------
  console.log('[Test A] Cartesian-to-Geographic Conversion & Geodesic Transformation...');
  {
    // 1. Origin (0, 0)
    const oGeo = xyToE6(0, 0);
    assert(oGeo.lat_e6 === 22572600, `Origin latitude is exactly ${ORIGIN_LAT}° (22572600 e6)`, { got: oGeo.lat_e6 });
    assert(oGeo.lon_e6 === 88433800, `Origin longitude is exactly ${ORIGIN_LON}° (88433800 e6)`, { got: oGeo.lon_e6 });

    const oXy = e6ToXy(22572600, 88433800);
    assert(Math.abs(oXy.x) < 0.05 && Math.abs(oXy.y) < 0.05, 'Origin inverse conversion recovers (0.0, 0.0) within 0.05m', oXy);

    // 2. Known location: Node 18 benchmark coordinates (1109.4, 1021.5)
    const n18Geo = xyToE6(1109.4, 1021.5);
    assert(n18Geo.lat_e6 > 22572600, 'Positive Y shifts latitude north of origin', { lat_e6: n18Geo.lat_e6 });
    assert(n18Geo.lon_e6 > 88433800, 'Positive X shifts longitude east of origin', { lon_e6: n18Geo.lon_e6 });

    // Verify mathematical scaling: dy = 1021.5 / 111320 = ~0.009176°
    const expectedLatDeg = ORIGIN_LAT + (1021.5 / M_PER_DEG_LAT);
    const expectedLonDeg = ORIGIN_LON + (1109.4 / M_PER_DEG_LON);
    assert(Math.abs(n18Geo.lat - expectedLatDeg) < 1e-7, 'Latitude degrees match M_PER_DEG_LAT scaling', { got: n18Geo.lat, expected: expectedLatDeg });
    assert(Math.abs(n18Geo.lon - expectedLonDeg) < 1e-7, 'Longitude degrees match M_PER_DEG_LON scaling', { got: n18Geo.lon, expected: expectedLonDeg });

    // Round-trip precision test
    const n18Xy = e6ToXy(n18Geo.lat_e6, n18Geo.lon_e6);
    assert(Math.abs(n18Xy.x - 1109.4) < 0.1, 'Round-trip X precision is within 0.1m', { got: n18Xy.x, expected: 1109.4 });
    assert(Math.abs(n18Xy.y - 1021.5) < 0.1, 'Round-trip Y precision is within 0.1m', { got: n18Xy.y, expected: 1021.5 });

    // 3. Negative Quadrant (South-West: -750m, -400m)
    const swGeo = xyToE6(-750, -400);
    assert(swGeo.lat_e6 < 22572600, 'Negative Y shifts latitude south of origin');
    assert(swGeo.lon_e6 < 88433800, 'Negative X shifts longitude west of origin');
    const swXy = e6ToXy(swGeo.lat_e6, swGeo.lon_e6);
    assert(Math.abs(swXy.x - (-750)) < 0.1 && Math.abs(swXy.y - (-400)) < 0.1, 'South-West round-trip is within 0.1m');

    // 4. Distance / Position Error computation
    const p1 = xyToE6(0, 0);
    const p2 = xyToE6(30, 40); // 30m East, 40m North -> distance = 50.0m
    const distM = computePositionErrorM(p2.lat_e6, p2.lon_e6, p1.lat_e6, p1.lon_e6);
    assert(Math.abs(distM - 50.0) < 0.25, `Geodesic distance calculation is accurate (expected 50.0m, got ${distM.toFixed(2)}m)`);
  }

  // --------------------------------------------------------------------------
  // TEST B: Node Repositioning & Authoritative State Synchronization
  // --------------------------------------------------------------------------
  console.log('\n[Test B] Dragging Node 18 from (1109.4, 1021.5) to (1281.2, 701.8)...');
  {
    const simRes = await runNativeSimProcess([
      { cmd: 'init', survivors: 20, relays: 5, zone: 1200, seed: 7 },
      { cmd: 'reposition', node: 18, x: 1281.2, y: 701.8 },
      { cmd: 'get_state' }
    ]);

    // Find reposition command response
    const repoRes = simRes.responses.find(r => r.cmd === 'reposition' && r.node === 18);
    assert(repoRes && repoRes.ok === true, 'Native engine successfully executed reposition command on Node 18', repoRes);
    assert(repoRes.x === 1281.2 && repoRes.y === 701.8, 'Reposition response reflects new Cartesian coordinates (1281.2, 701.8)', repoRes);

    const expectedNewGeo = xyToE6(1281.2, 701.8);
    assert(Math.abs(repoRes.gt_lat_e6 - expectedNewGeo.lat_e6) <= 1, 'Reposition response updated ground-truth latitude to new position', { got: repoRes.gt_lat_e6, expected: expectedNewGeo.lat_e6 });
    assert(Math.abs(repoRes.gt_lon_e6 - expectedNewGeo.lon_e6) <= 1, 'Reposition response updated ground-truth longitude to new position', { got: repoRes.gt_lon_e6, expected: expectedNewGeo.lon_e6 });

    // Verify state polling does NOT revert coordinates
    const stateRes = simRes.responses.find(r => r.cmd === 'get_state');
    assert(stateRes && Array.isArray(stateRes.nodes), 'State response received from native engine');
    const n18State = stateRes.nodes.find(n => n.id === 18);
    assert(n18State !== undefined, 'Node 18 found in engine state');
    assert(n18State.x === 1281.2 && n18State.y === 701.8, 'State polling confirms Node 18 Cartesian position is authoritative (did not revert)', { x: n18State.x, y: n18State.y });
    assert(n18State.gt_lat_e6 === repoRes.gt_lat_e6, 'State polling confirms Node 18 geographic ground truth is authoritative', { gt_lat_e6: n18State.gt_lat_e6 });
  }

  // --------------------------------------------------------------------------
  // TEST C: Estimate Independence on Repositioning
  // --------------------------------------------------------------------------
  console.log('\n[Test C] Estimate Independence & Instantaneous Position Error Update...');
  {
    // Start simulation, trigger SOS on Node 1 so it takes GPS fixes, then drag it
    const simRes = await runNativeSimProcess([
      { cmd: 'init', survivors: 20, relays: 5, zone: 1200, seed: 7 },
      { cmd: 'trigger', node: 1, kind: 'short' },
      { cmd: 'step', ms: 1200 }, // allow GPS fix and transmission
      { cmd: 'get_state' }
    ]);

    const stateBefore = simRes.responses.find(r => r.cmd === 'get_state');
    const n1Before = stateBefore.nodes.find(n => n.id === 1);
    assert(n1Before.has_estimate === true, 'Node 1 acquired a position estimate during SOS', { est_lat: n1Before.est_lat_e6 });
    const estLatBefore = n1Before.est_lat_e6;
    const estLonBefore = n1Before.est_lon_e6;
    const oldX = n1Before.x;
    const oldY = n1Before.y;

    // Now drag Node 1 by 300m East and 400m North (hypot = 500m displacement)
    const newX = Math.round((oldX + 300.0) * 10) / 10;
    const newY = Math.round((oldY + 400.0) * 10) / 10;

    const dragRes = await runNativeSimProcess([
      { cmd: 'init', survivors: 20, relays: 5, zone: 1200, seed: 7 },
      { cmd: 'trigger', node: 1, kind: 'short' },
      { cmd: 'step', ms: 1200 },
      { cmd: 'reposition', node: 1, x: newX, y: newY },
      { cmd: 'get_state' }
    ]);

    const stateAfter = dragRes.responses.find(r => r.cmd === 'get_state');
    const n1After = stateAfter.nodes.find(n => n.id === 1);

    assert(n1After.est_lat_e6 === estLatBefore, 'Firmware estimate latitude was NOT overwritten by ground-truth repositioning', { before: estLatBefore, after: n1After.est_lat_e6 });
    assert(n1After.est_lon_e6 === estLonBefore, 'Firmware estimate longitude was NOT overwritten by ground-truth repositioning', { before: estLonBefore, after: n1After.est_lon_e6 });

    // Instantaneous error should now include the 500m displacement
    assert(n1After.pos_error_m >= 450.0 && n1After.pos_error_m <= 550.0, `Instantaneous position error reflects the physical 500m displacement (got: ${n1After.pos_error_m.toFixed(2)}m)`);
  }

  // --------------------------------------------------------------------------
  // TEST D: GNSS Measurement Update with Configured Noise
  // --------------------------------------------------------------------------
  console.log('\n[Test D] Simulated GNSS Measurement Noise & Update Processing...');
  {
    const simRes = await runNativeSimProcess([
      { cmd: 'init', survivors: 10, relays: 2, zone: 800, seed: 42 },
      { cmd: 'trigger', node: 2, kind: 'short' },
      { cmd: 'step', ms: 2000 },
      { cmd: 'get_state' }
    ]);

    const stateRes = simRes.responses.find(r => r.cmd === 'get_state');
    const n2 = stateRes.nodes.find(n => n.id === 2);
    assert(n2.has_estimate === true, 'Node 2 acquired GNSS fix');
    assert(n2.pos_error_m !== null && n2.pos_error_m >= 0.0, 'Position error is non-null after GNSS fix', { error: n2.pos_error_m });
    // Configured Gaussian noise has 1-sigma = 2.5m, 3-sigma = 7.5m
    assert(n2.pos_error_m > 0.0, 'Position estimate does NOT equal ground truth exactly when GNSS noise is enabled (realistic sensor model)', { error: n2.pos_error_m });
    assert(n2.pos_error_m < 15.0, 'Position error is within nominal GNSS noise bounds (< 15.0m)', { error: n2.pos_error_m });
  }

  // --------------------------------------------------------------------------
  // TEST E: GNSS Outage & Dead Reckoning Accumulation
  // --------------------------------------------------------------------------
  console.log('\n[Test E] GNSS Outage & Dead-Reckoning Accumulation...');
  {
    const simRes = await runNativeSimProcess([
      { cmd: 'init', survivors: 10, relays: 2, zone: 800, seed: 99 },
      // Disable GNSS hardware on Node 3
      { cmd: 'set_gnss', node: 3, gnss: false },
      { cmd: 'trigger', node: 3, kind: 'short' },
      { cmd: 'step', ms: 1500 },
      { cmd: 'get_state' }
    ]);

    const stateRes = simRes.responses.find(r => r.cmd === 'get_state');
    const n3 = stateRes.nodes.find(n => n.id === 3);
    assert(n3.gnss === false, 'GNSS is reported offline for Node 3');
    assert(n3.dr === true, 'Dead-Reckoning (MPU-6050) is active for Node 3');
    assert(n3.has_estimate === true, 'Dead-Reckoning generated position estimate');
    // DR has higher drift than GNSS
    assert(n3.pos_error_m > 0.0, 'Dead reckoning produced realistic position estimate with drift', { error: n3.pos_error_m });
  }

  // --------------------------------------------------------------------------
  // TEST F: Error Metrics Integrity & Unmeasured States
  // --------------------------------------------------------------------------
  console.log('\n[Test F] Error Metrics Integrity & Missing Sample Handling...');
  {
    // Fresh simulation at t=0 before any trigger: Node 5 should have NO samples and NO estimate
    const simRes = await runNativeSimProcess([
      { cmd: 'init', survivors: 10, relays: 2, zone: 800, seed: 123 },
      { cmd: 'get_state' }
    ]);

    const stateRes = simRes.responses.find(r => r.cmd === 'get_state');
    const n5 = stateRes.nodes.find(n => n.id === 5);

    assert(n5.has_estimate === false, 'Node at t=0 has no estimate (has_estimate = false)');
    assert(n5.est_lat_e6 === null, 'Node at t=0 serializes null for est_lat_e6 (not ground truth)');
    assert(n5.est_lon_e6 === null, 'Node at t=0 serializes null for est_lon_e6 (not ground truth)');
    assert(n5.pos_error_m === null, 'Node at t=0 serializes null for pos_error_m (not 0.00m)');
    assert(n5.pos_mae_m === null, 'Node at t=0 serializes null for pos_mae_m (not 0.00m)');
    assert(n5.pos_rmse_m === null, 'Node at t=0 serializes null for pos_rmse_m (not 0.00m)');

    // Test explicit estimator reset command
    const resetRes = await runNativeSimProcess([
      { cmd: 'init', survivors: 10, relays: 2, zone: 800, seed: 123 },
      { cmd: 'trigger', node: 5, kind: 'short' },
      { cmd: 'step', ms: 1500 },
      { cmd: 'reposition', node: 5, x: 500, y: 500 },
      { cmd: 'reset_estimator', node: 5 },
      { cmd: 'get_state' }
    ]);

    const resetCmd = resetRes.responses.find(r => r.cmd === 'reset_estimator' && r.node === 5);
    assert(resetCmd && resetCmd.ok === true, 'reset_estimator command executed successfully', resetCmd);
    assert(resetCmd.pos_error_m === 0.0, 'reset_estimator sets instantaneous error to 0.0m against current position');
    assert(resetCmd.est_lat_e6 === resetCmd.gt_lat_e6, 'reset_estimator sets estimated coordinates to current ground truth');
    assert(resetCmd.pos_mae_m === null, 'reset_estimator clears historical sample count (pos_mae_m is null for fresh trajectory)');
  }

  // --------------------------------------------------------------------------
  // TEST G: State Synchronization & Inspector Display
  // --------------------------------------------------------------------------
  console.log('\n[Test G] Inspector Component & State Synchronization...');
  {
    const sim = new SimulationEngine();
    const nodeEl = new MockElement();
    const pktEl = new MockElement();
    const inspector = new InspectorComponent(nodeEl, pktEl, sim);

    // 1. Inspect unmeasured node
    const unmeasuredNode = {
      id: 18,
      role: 'survivor',
      x: 1109.4,
      y: 1021.5,
      lat_e6: 22581776,
      lon_e6: 88444593,
      gt_lat_e6: 22581776,
      gt_lon_e6: 88444593,
      est_lat_e6: null,
      est_lon_e6: null,
      has_estimate: false,
      pos_error_m: null,
      pos_mae_m: null,
      pos_rmse_m: null,
      gnss_on: true,
      dr_on: true,
      gnss_status: 'acquiring',
      battery: 100
    };

    inspector.inspectNode(unmeasuredNode);
    assert(nodeEl.innerHTML.includes('X: 1109.4 m, Y: 1021.5 m'), 'Inspector displays Cartesian ground truth accurately');
    assert(nodeEl.innerHTML.includes('22.581776°, 88.444593°'), 'Inspector displays Geographic ground truth accurately');
    assert(nodeEl.innerHTML.includes('Not measured (No fix acquired)'), 'Inspector displays "Not measured (No fix acquired)" for unmeasured estimate (no 0.00 fallback)');
    assert(nodeEl.innerHTML.includes('Not measured'), 'Inspector displays "Not measured" for error metrics when sample count is 0');
    assert(nodeEl.innerHTML.includes('Reset Estimator'), 'Inspector renders explicit "Reset Estimator" control button');

    // 2. Drag node to new location
    unmeasuredNode.x = 1281.2;
    unmeasuredNode.y = 701.8;
    const newGeo = xyToE6(1281.2, 701.8);
    unmeasuredNode.lat_e6 = newGeo.lat_e6;
    unmeasuredNode.lon_e6 = newGeo.lon_e6;
    unmeasuredNode.gt_lat_e6 = newGeo.lat_e6;
    unmeasuredNode.gt_lon_e6 = newGeo.lon_e6;

    inspector.inspectNode(unmeasuredNode);
    assert(nodeEl.innerHTML.includes('X: 1281.2 m, Y: 701.8 m'), 'Inspector updates Cartesian ground truth to (1281.2, 701.8)');
    assert(nodeEl.innerHTML.includes(`${(newGeo.lat_e6 / 1e6).toFixed(6)}°, ${(newGeo.lon_e6 / 1e6).toFixed(6)}°`), 'Inspector updates Geographic ground truth consistently after drag');

    // 3. Inspect node with active fix and verified error
    const measuredNode = {
      ...unmeasuredNode,
      est_lat_e6: newGeo.lat_e6 + 25, // ~2.8m error
      est_lon_e6: newGeo.lon_e6 + 25,
      has_estimate: true,
      pos_error_m: 3.82,
      pos_mae_m: 3.50,
      pos_rmse_m: 3.75,
      gnss_status: 'valid_fix'
    };

    inspector.inspectNode(measuredNode);
    assert(nodeEl.innerHTML.includes('3.82 m'), 'Inspector displays verified instantaneous error in meters');
    assert(nodeEl.innerHTML.includes('3.50 m / 3.75 m'), 'Inspector displays verified MAE / RMSE in meters');
    assert(nodeEl.innerHTML.includes('GNSS 3D Satellite Fix (Active)'), 'Inspector displays active GNSS fix provenance');
  }

  // --------------------------------------------------------------------------
  // TEST H: Regression Verification (Trace Playback, Reposition Events, Exports)
  // --------------------------------------------------------------------------
  console.log('\n[Test H] Regression Check on Trace Events & Reposition Playback...');
  {
    const sim = new SimulationEngine();
    const traceEvents = [
      { t: 0, ev: 'node_init', id: 18, role: 'survivor', x: 100, y: 100, lat_e6: 22573498, lon_e6: 88434773 },
      { t: 1000, ev: 'reposition', node: 18, x: 250, y: 350 },
      { t: 2000, ev: 'estimator_reset', node: 18 }
    ];

    sim.loadTrace(traceEvents);
    assert(sim.nodes.get(18).x === 100, 'Initial trace playback state at t=0 is (100, 100)');

    // Seek to t=1500 (after reposition event)
    sim.seek(1500);
    const n18At1500 = sim.nodes.get(18);
    assert(n18At1500.x === 250 && n18At1500.y === 350, 'Trace scrubber replays reposition event correctly to (250, 350)');
    const expectedGeoAt1500 = xyToE6(250, 350);
    assert(n18At1500.gt_lat_e6 === expectedGeoAt1500.lat_e6, 'Trace scrubber updates geographic ground truth on reposition event');

    // Seek to t=2500 (after estimator_reset event)
    sim.seek(2500);
    const n18At2500 = sim.nodes.get(18);
    assert(n18At2500.pos_error_m === 0.0, 'Trace scrubber replays estimator_reset event setting pos_error_m to 0.0m');
  }

  console.log('\n================================================================');
  console.log(`  POSITIONING PIPELINE SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
  console.log('================================================================');

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
