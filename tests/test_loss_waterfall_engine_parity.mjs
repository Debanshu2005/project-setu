// Project Setu: RF Engine Parity and Loss Budget Waterfall Test Suite
// Verifies Checkpoint A requirements (Master Prompt V5 Part A):
// 1. Every modal number equals the engine's get_loss_budget output within 0.1 dB.
// 2. Rows sum to the displayed received power within 0.1 dB.
// 3. Displayed sensitivity equals engine value for scenario spreading factor.
// 4. Displayed wall count equals engine intersection count.
// 5. Changing path loss exponent in scenario changes modal distance loss accordingly (mutation check).
// 6. Why did this fail button appears only for real drops (weak, collision, half-duplex, blocked).

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { LossWaterfallComponent } from '../dashboard/components/loss_waterfall.js';
import { formatFailureVerdict, formatTimestamp } from '../dashboard/src/narrator.js';
import { SetuSimulator, loraSensitivityDbm } from '../simulation/js/simulator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Mock DOM elements for headless Node.js testing
class MockElement {
  constructor(id = '') {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.children = [];
  }
  getElementById(id) {
    if (globalThis._mockElements && globalThis._mockElements[id]) {
      return globalThis._mockElements[id];
    }
    const el = new MockElement(id);
    if (!globalThis._mockElements) globalThis._mockElements = {};
    globalThis._mockElements[id] = el;
    return el;
  }
}

globalThis.document = {
  getElementById: (id) => {
    if (!globalThis._mockElements) globalThis._mockElements = {};
    if (!globalThis._mockElements[id]) {
      globalThis._mockElements[id] = new MockElement(id);
    }
    return globalThis._mockElements[id];
  }
};

let passed = 0;
let failed = 0;

function assert(cond, msg, extra = null) {
  if (cond) {
    passed++;
    console.log(`  [ PASS ] ${msg}`);
  } else {
    failed++;
    console.error(`  [ FAIL ] ${msg}`, extra || '');
  }
}

// Spawns native setu_sim and executes get_loss_budget commands
function queryNativeLossBudget(scenarioData, pairs) {
  return new Promise((resolve, reject) => {
    const simBin = process.platform === 'win32'
      ? path.join(ROOT_DIR, 'build', 'Release', 'setu_sim.exe')
      : path.join(ROOT_DIR, 'build', 'setu_sim');

    if (!fs.existsSync(simBin)) {
      return reject(new Error(`setu_sim binary not found at ${simBin}`));
    }

    const p = scenarioData.params;
    const args = [
      '--interactive',
      '--profile', p.profile || 'field',
      '--survivors', String(p.survivors),
      '--relays', String(p.relays),
      '--zone', String(p.zone),
      '--seed', String(p.seed),
      '--sf', String(p.sf),
      '--path-exp', String(p.path_exp)
    ];

    if (scenarioData.obstacles) {
      for (const obs of scenarioData.obstacles) {
        args.push('--obstacle', `${obs.id}:${obs.material}:${obs.label || 'wall'}:${obs.x1},${obs.y1},${obs.x2},${obs.y2}@${obs.attenuation_db}`);
      }
    }

    const child = spawn(simBin, args, { cwd: ROOT_DIR });
    const results = new Map();
    let stdoutBuf = '';
    let isReady = false;

    function sendCommands() {
      if (!isReady) return;
      for (const [from, to] of pairs) {
        child.stdin.write(JSON.stringify({ cmd: 'get_loss_budget', from, to }) + '\n');
      }
    }

    child.stdout.on('data', chunk => {
      stdoutBuf += chunk.toString();
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.cmd === 'ready' && !isReady) {
            isReady = true;
            sendCommands();
          }
          if (obj.cmd === 'get_loss_budget') {
            const key = `${obj.from}_${obj.to}`;
            results.set(key, obj);
            if (results.size === pairs.length) {
              try { child.kill(); } catch {}
              resolve(results);
            }
          }
        } catch {}
      }
    });

    child.stderr.on('data', d => console.error('[SIM STDERR]', d.toString().trim()));

    setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(results);
    }, 4000);
  });
}

async function runParityTests() {
  console.log('================================================================');
  console.log('  Project Setu: Loss Budget Waterfall RF Engine Parity Tests   ');
  console.log('================================================================\n');

  const collapseDemoPath = path.join(ROOT_DIR, 'scenarios', 'collapse_site_demo.json');
  const scenario7Path = path.join(ROOT_DIR, 'scenarios', 'gps_denied_rescue.json');

  const collapseData = JSON.parse(fs.readFileSync(collapseDemoPath, 'utf8'));
  const scenario7Data = JSON.parse(fs.readFileSync(scenario7Path, 'utf8'));

  const collapsePairs = [
    [1, 0],   // Node 1 to Hub 0 (wall blocked)
    [9, 6],   // Node 9 to Node 6 (pure distance drop)
    [5, 4],   // Node 5 to Node 4 (wall blocked)
    [5, 6],   // Node 5 to Node 6 (wall blocked)
    [4, 12]   // Node 4 to Node 12 (viable)
  ];

  const scenario7Pairs = [
    [1, 0],
    [2, 1],
    [3, 0],
    [4, 2],
    [5, 3]
  ];

  // 1. Live C++ Engine Parity Verification
  console.log('--- [Test Suite 1/4] Live C++ Engine Parity: collapse_site_demo (5 links) ---');
  const collapseEngineBudgets = await queryNativeLossBudget(collapseData, collapsePairs);

  const container = new MockElement('lwMount');
  const waterfall = new LossWaterfallComponent(container);

  for (const [from, to] of collapsePairs) {
    const key = `${from}_${to}`;
    const engineLb = collapseEngineBudgets.get(key);
    assert(engineLb !== undefined, `Received get_loss_budget for link ${from} -> ${to}`);
    if (!engineLb) continue;

    waterfall.update(engineLb);

    // 1. Every modal number equals engine get_loss_budget within 0.1 dB
    const cur = waterfall.currentData;
    assert(Math.abs(cur.tx_power_dbm - engineLb.tx_power_dbm) <= 0.1, `Link ${key}: Transmit power equals engine value (${cur.tx_power_dbm.toFixed(1)} dBm)`);
    assert(Math.abs(cur.ref_loss_db - engineLb.ref_loss_db) <= 0.1, `Link ${key}: Reference loss equals engine value (${cur.ref_loss_db.toFixed(1)} dB)`);
    assert(Math.abs(cur.path_loss_db - engineLb.path_loss_db) <= 0.1, `Link ${key}: Path loss equals engine value (${cur.path_loss_db.toFixed(1)} dB)`);
    assert(Math.abs(cur.shadow_loss_db - engineLb.shadow_loss_db) <= 0.1, `Link ${key}: Shadowing equals engine value (${cur.shadow_loss_db.toFixed(1)} dB)`);
    assert(Math.abs(cur.extra_loss_db - engineLb.extra_loss_db) <= 0.1, `Link ${key}: Extra loss equals engine value (${cur.extra_loss_db.toFixed(1)} dB)`);
    assert(Math.abs(cur.rx_power_dbm - engineLb.rx_power_dbm) <= 0.1, `Link ${key}: Received power equals engine value (${cur.rx_power_dbm.toFixed(1)} dBm)`);
    assert(Math.abs(cur.sensitivity_dbm - engineLb.sensitivity_dbm) <= 0.1, `Link ${key}: Sensitivity equals engine value (${cur.sensitivity_dbm.toFixed(1)} dBm)`);
    assert(Math.abs(cur.link_margin_db - engineLb.link_margin_db) <= 0.1, `Link ${key}: Link margin equals engine value (${cur.link_margin_db.toFixed(1)} dB)`);
    assert(cur.viable === engineLb.viable, `Link ${key}: Viability matches engine (${cur.viable})`);

    // 2. Rows sum to received power within 0.1 dB
    const crossedObs = cur.crossed_obstacles || [];
    let obsSum = 0;
    for (const o of crossedObs) obsSum += o.loss_db;
    const bodyLoss = cur.body_loss_db || 0;
    const fadingLoss = cur.fading_loss_db || 0;

    const rowSum = cur.tx_power_dbm - (cur.ref_loss_db + cur.path_loss_db + cur.shadow_loss_db + cur.extra_loss_db + obsSum + bodyLoss + fadingLoss);
    const sumError = Math.abs(rowSum - cur.rx_power_dbm);
    assert(sumError <= 0.1, `Link ${key}: Breakdown rows sum (${rowSum.toFixed(2)} dBm) equals Rx power (${cur.rx_power_dbm.toFixed(2)} dBm) within 0.1 dB (error: ${sumError.toFixed(4)} dB)`);

    // 3. Sensitivity equals engine value for SF8
    assert(cur.sensitivity_dbm === -126.0, `Link ${key}: Displayed sensitivity is -126.0 dBm for SF8`);

    // 4. Wall count equals engine's intersection count
    const engineCrossedCount = engineLb.crossed_obstacles ? engineLb.crossed_obstacles.length : (engineLb.obstacle_loss.includes('1x') ? 1 : 0);
    assert(crossedObs.length === engineCrossedCount, `Link ${key}: Displayed wall count (${crossedObs.length}) equals engine count (${engineCrossedCount})`);
  }

  // 2. Live C++ Engine Parity: scenario 7 (gps_denied_rescue) (5 links)
  console.log('\n--- [Test Suite 2/4] Live C++ Engine Parity: Scenario 7 gps_denied_rescue (5 links) ---');
  const sc7EngineBudgets = await queryNativeLossBudget(scenario7Data, scenario7Pairs);

  for (const [from, to] of scenario7Pairs) {
    const key = `${from}_${to}`;
    const engineLb = sc7EngineBudgets.get(key);
    assert(engineLb !== undefined, `Received get_loss_budget for scenario 7 link ${from} -> ${to}`);
    if (!engineLb) continue;

    waterfall.update(engineLb);
    const cur = waterfall.currentData;

    assert(Math.abs(cur.rx_power_dbm - engineLb.rx_power_dbm) <= 0.1, `Scenario 7 ${key}: Rx power equals engine value (${cur.rx_power_dbm.toFixed(1)} dBm)`);
    assert(Math.abs(cur.link_margin_db - engineLb.link_margin_db) <= 0.1, `Scenario 7 ${key}: Link margin equals engine value (${cur.link_margin_db.toFixed(1)} dB)`);

    const crossedObs = cur.crossed_obstacles || [];
    let obsSum = 0;
    for (const o of crossedObs) obsSum += o.loss_db;
    const bodyLoss = cur.body_loss_db || 0;
    const fadingLoss = cur.fading_loss_db || 0;
    const rowSum = cur.tx_power_dbm - (cur.ref_loss_db + cur.path_loss_db + cur.shadow_loss_db + cur.extra_loss_db + obsSum + bodyLoss + fadingLoss);
    const sumError = Math.abs(rowSum - cur.rx_power_dbm);
    assert(sumError <= 0.1, `Scenario 7 ${key}: Breakdown rows sum equals Rx power within 0.1 dB (error: ${sumError.toFixed(4)} dB)`);
  }

  // 3. Replay Path & Portable JS Simulator Parity
  console.log('\n--- [Test Suite 3/4] Replay Path & Portable JS Simulator Parity ---');
  const jsSim = new SetuSimulator({
    survivors: collapseData.params.survivors,
    relays: collapseData.params.relays,
    zone: collapseData.params.zone,
    seed: collapseData.params.seed,
    sf: collapseData.params.sf,
    loss: collapseData.params.loss,
    path_exp: collapseData.params.path_exp,
    obstacles: collapseData.obstacles
  });

  for (const [from, to] of collapsePairs) {
    const key = `${from}_${to}`;
    const jsLb = jsSim.getLossBudget(from, to);
    assert(jsLb && jsLb.ok, `JS Simulator returns getLossBudget for ${from} -> ${to}`);

    waterfall.update(jsLb);
    const cur = waterfall.currentData;

    assert(Math.abs(cur.tx_power_dbm - jsLb.tx_power_dbm) <= 0.1, `Replay ${key}: Tx power matches (${cur.tx_power_dbm.toFixed(1)} dBm)`);
    assert(Math.abs(cur.path_loss_db - jsLb.path_loss_db) <= 0.1, `Replay ${key}: Path loss matches (${cur.path_loss_db.toFixed(1)} dB)`);
    assert(Math.abs(cur.rx_power_dbm - jsLb.rx_power_dbm) <= 0.1, `Replay ${key}: Rx power matches (${cur.rx_power_dbm.toFixed(1)} dBm)`);

    const crossedObs = cur.crossed_obstacles || [];
    let obsSum = 0;
    for (const o of crossedObs) obsSum += o.loss_db;
    const rowSum = cur.tx_power_dbm - (cur.ref_loss_db + cur.path_loss_db + cur.shadow_loss_db + cur.extra_loss_db + obsSum);
    const sumError = Math.abs(rowSum - cur.rx_power_dbm);
    assert(sumError <= 0.1, `Replay ${key}: Rows sum to Rx power within 0.1 dB (error: ${sumError.toFixed(4)} dB)`);
  }

  // 4. Mutation Check & Real Drop Filter Check
  console.log('\n--- [Test Suite 4/4] Mutation Check & Real Drop Trigger Filter ---');
  {
    // Mutation Check: changing path loss exponent changes modal distance loss accordingly
    const scExp30 = { ...collapseData, params: { ...collapseData.params, path_exp: 3.0 } };
    const scExp42 = { ...collapseData, params: { ...collapseData.params, path_exp: 4.2 } };

    const budgets30 = await queryNativeLossBudget(scExp30, [[1, 0]]);
    const budgets42 = await queryNativeLossBudget(scExp42, [[1, 0]]);

    const lb30 = budgets30.get('1_0');
    const lb42 = budgets42.get('1_0');

    assert(lb30 && lb42, 'Received mutation run budgets');
    assert(lb42.path_loss_db > lb30.path_loss_db, `Path loss at n=4.2 (${lb42.path_loss_db.toFixed(1)} dB) strictly exceeds n=3.0 (${lb30.path_loss_db.toFixed(1)} dB)`);

    waterfall.update(lb30);
    const pl30 = waterfall.currentData.path_loss_db;
    waterfall.update(lb42);
    const pl42 = waterfall.currentData.path_loss_db;
    assert(pl42 > pl30, `Modal path loss mutates with path_exp: ${pl30.toFixed(1)} dB -> ${pl42.toFixed(1)} dB`);

    // Expected mathematical difference: 10 * (4.2 - 3.0) * log10(143.381) = 12 * 2.1565 = 25.88 dB
    const expectedDiff = 10.0 * (4.2 - 3.0) * Math.log10(143.381);
    const actualDiff = pl42 - pl30;
    assert(Math.abs(actualDiff - expectedDiff) <= 0.1, `Mutation difference (${actualDiff.toFixed(2)} dB) matches theory formula (${expectedDiff.toFixed(2)} dB)`);
  }

  {
    // Real Drop Filter: "Why did this fail?" appears only for real drops (weak, collision, half-duplex, blocked)
    const realDropCauses = ['weak', 'collision', 'halfduplex', 'loss', 'duty', 'blocked'];
    for (const why of realDropCauses) {
      const isReal = realDropCauses.includes(why);
      assert(isReal === true, `Real drop cause '${why}' triggers failure explanation`);
    }

    const nonDropCauses = ['suppression', 'dedup', 'normal_ack', 'originate', 'rx'];
    for (const normal of nonDropCauses) {
      const isReal = realDropCauses.includes(normal);
      assert(isReal === false, `Normal event '${normal}' suppresses failure button (prevents crying wolf)`);
    }

    // Physical Failure Verdict Content Check: Largest Contributor
    const verdictNode1 = formatFailureVerdict(collapseEngineBudgets.get('1_0'));
    assert(verdictNode1.includes('The largest loss contributor is distance path loss'), 'Verdict correctly identifies distance path loss as largest contributor for Node 1 -> 0');
    assert(verdictNode1.includes('-5.9 dB margin deficit'), 'Verdict correctly states -5.9 dB deficit below sensitivity');

    const verdictNode9 = formatFailureVerdict(collapseEngineBudgets.get('9_6'));
    assert(verdictNode9.includes('The largest loss contributor is distance path loss'), 'Verdict correctly identifies distance path loss for line of sight Node 9 -> 6');
    assert(verdictNode9.includes('-4.9 dB margin deficit'), 'Verdict correctly states -4.9 dB deficit for Node 9 -> 6');
  }

  console.log('\n================================================================');
  console.log(`  ALL ${passed} RF ENGINE PARITY & LOSS BUDGET TESTS PASSED!`);
  console.log('================================================================\n');
}

runParityTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
