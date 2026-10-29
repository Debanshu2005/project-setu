// Project Setu - Scientific Metrics & Analytics Computation Engine
// Authoritative mathematical models, theoretical curves, empirical CDFs,
// sliding-window time-series aggregations, and topology route reconstruction.

export const LORA_RADIO_CONSTANTS = Object.freeze({
  txPowerDbm: 14.0,           // Default transmit power (dBm)
  refLossDb: 31.2,            // Free-space path loss at 1m (868 MHz)
  defaultPathExp: 3.5,        // Urban rubble / debris path loss exponent
  extraLossDb: 15.0,          // Body absorption and small wristband antenna penalty
  shadowSigmaDb: 4.0,         // Log-normal shadowing standard deviation (dB)
  fadingSigmaDb: 1.5,         // Fast fading standard deviation (dB)
  captureMarginDb: 6.0,       // Co-channel capture effect threshold (dB)
  noiseFloorDbm: -117.0,      // SX1262 thermal noise floor at 125 kHz BW (kT*B + NF: -174 + 51 + 6)
  sensitivityBySf: {          // Receiver sensitivity threshold (dBm) by Spreading Factor (125 kHz BW)
    7: -123.0,
    8: -126.0,
    9: -129.0,
    10: -132.0,
    11: -134.5,
    12: -137.0
  },
  nominalBatteryMah: 300.0,   // Nominal 1S LiPo capacity (mAh)
  txCurrentMa: 120.0,         // SX1262 TX current at +14 dBm
  rxCurrentMa: 15.0,          // SX1262 RX listening current
  idleCurrentMa: 1.5          // Standby MCU + sensors current
});

/**
 * Computes theoretical received power (RSSI in dBm) using the Log-Distance Path Loss model.
 * P_rx(d) = P_tx - (PL_0 + 10 * n * log10(d / d_0) + L_extra)
 *
 * @param {number} distanceM - Distance in meters
 * @param {number} [pathExp=3.5] - Path loss exponent (n)
 * @param {number} [txPowerDbm=14.0] - Transmit power in dBm
 * @param {number} [extraLossDb=15.0] - Extra body/antenna loss in dB
 * @param {number} [refLossDb=31.2] - Reference path loss at 1m in dB
 * @returns {number} Predicted mean RSSI in dBm
 */
export function calculateTheoreticalRssi(
  distanceM,
  pathExp = LORA_RADIO_CONSTANTS.defaultPathExp,
  txPowerDbm = LORA_RADIO_CONSTANTS.txPowerDbm,
  extraLossDb = LORA_RADIO_CONSTANTS.extraLossDb,
  refLossDb = LORA_RADIO_CONSTANTS.refLossDb
) {
  const d = Math.max(1.0, distanceM);
  const pathLoss = refLossDb + 10.0 * pathExp * Math.log10(d) + extraLossDb;
  return txPowerDbm - pathLoss;
}

/**
 * Computes theoretical path loss in dB for a given distance.
 * PL(d) = PL_0 + 10 * n * log10(d) + L_extra
 *
 * @param {number} distanceM - Distance in meters
 * @param {number} [pathExp=3.5] - Path loss exponent (n)
 * @param {number} [extraLossDb=15.0] - Extra body/antenna loss in dB
 * @param {number} [refLossDb=31.2] - Reference loss at 1m
 * @returns {number} Path loss in dB
 */
export function calculateTheoreticalPathLoss(
  distanceM,
  pathExp = LORA_RADIO_CONSTANTS.defaultPathExp,
  extraLossDb = LORA_RADIO_CONSTANTS.extraLossDb,
  refLossDb = LORA_RADIO_CONSTANTS.refLossDb
) {
  const d = Math.max(1.0, distanceM);
  return refLossDb + 10.0 * pathExp * Math.log10(d) + extraLossDb;
}

/**
 * Computes the Empirical Cumulative Distribution Function (eCDF) of an array of numerical values.
 * Returns sorted points { x, y } where y is in [0, 100]% along with statistical percentiles.
 *
 * @param {Array<number>} values - Array of raw observations (e.g. latency, error)
 * @returns {{
 *   points: Array<{ x: number, y: number }>,
 *   count: number,
 *   min: number|null,
 *   max: number|null,
 *   mean: number|null,
 *   p50: number|null,
 *   p90: number|null,
 *   p95: number|null,
 *   p99: number|null
 * }}
 */
export function calculateEcdf(values = []) {
  const valid = values.filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
  if (valid.length === 0) {
    return {
      points: [],
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p90: null,
      p95: null,
      p99: null
    };
  }

  valid.sort((a, b) => a - b);
  const n = valid.length;
  const points = [];

  for (let i = 0; i < n; i++) {
    const pct = ((i + 1) / n) * 100.0;
    points.push({ x: valid[i], y: Math.round(pct * 100) / 100 });
  }

  const getPercentile = (p) => {
    if (n === 0) return null;
    const rank = (p / 100) * (n - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    const weight = rank - low;
    return Math.round((valid[low] * (1 - weight) + valid[high] * weight) * 100) / 100;
  };

  const sum = valid.reduce((acc, v) => acc + v, 0);
  const mean = Math.round((sum / n) * 100) / 100;

  return {
    points,
    count: n,
    min: valid[0],
    max: valid[n - 1],
    mean,
    p50: getPercentile(50),
    p90: getPercentile(90),
    p95: getPercentile(95),
    p99: getPercentile(99)
  };
}

/**
 * Computes a histogram with uniform binning for a continuous measurement distribution.
 *
 * @param {Array<number>} values - Array of observations
 * @param {number} [binCount=15] - Number of bins
 * @returns {{
 *   bins: Array<{ binStart: number, binEnd: number, binCenter: number, count: number, density: number }>,
 *   count: number,
 *   min: number|null,
 *   max: number|null
 * }}
 */
export function calculateHistogram(values = [], binCount = 15) {
  const valid = values.filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
  if (valid.length === 0) {
    return { bins: [], count: 0, min: null, max: null };
  }

  valid.sort((a, b) => a - b);
  const min = valid[0];
  const max = valid[valid.length - 1];
  const n = valid.length;

  if (min === max) {
    return {
      bins: [{ binStart: min, binEnd: max, binCenter: min, count: n, density: 1.0 }],
      count: n,
      min,
      max
    };
  }

  const width = (max - min) / binCount;
  const bins = [];
  for (let b = 0; b < binCount; b++) {
    const start = min + b * width;
    const end = start + width;
    bins.push({
      binStart: Math.round(start * 100) / 100,
      binEnd: Math.round(end * 100) / 100,
      binCenter: Math.round((start + width / 2) * 100) / 100,
      count: 0,
      density: 0
    });
  }

  for (const v of valid) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }

  for (const b of bins) {
    b.density = Math.round((b.count / (n * width)) * 1000) / 1000;
  }

  return { bins, count: n, min, max };
}

/**
 * Calculates time-series with a sliding window across simulation time.
 * Computes:
 * - Windowed Delivery Ratio (%) vs Cumulative Delivery Ratio (%)
 * - Delivered Payload Throughput (bits/sec and packets/sec)
 * - Windowed Collision & Drop Rates
 * - Windowed Retries
 *
 * @param {Array<Object>} events - Simulation trace events
 * @param {number} totalDurationMs - Total simulation time in ms
 * @param {number} [windowMs=2000] - Sliding window duration in ms
 * @param {number} [stepMs=500] - Sample step interval in ms
 * @returns {Array<Object>} Time-aligned series points
 */
export function calculateSlidingWindowMetrics(events = [], totalDurationMs = 30000, windowMs = 2000, stepMs = 500) {
  if (!events || events.length === 0) return [];

  const maxT = Math.max(totalDurationMs, events[events.length - 1]?.t || 0);
  const points = [];

  // Index events for fast sliding window queries
  const originates = [];
  const alerts = [];
  const drops = [];
  const retries = [];
  const txs = [];
  const rxs = [];

  for (const ev of events) {
    if (typeof ev.t !== 'number') continue;
    if (ev.ev === 'originate') originates.push(ev);
    else if (ev.ev === 'alert') alerts.push(ev);
    else if (ev.ev === 'drop') drops.push(ev);
    else if (ev.ev === 'retry') retries.push(ev);
    else if (ev.ev === 'tx') txs.push(ev);
    else if (ev.ev === 'rx') rxs.push(ev);
  }

  const PAYLOAD_BITS_PER_SOS = 25 * 8; // 25-byte Setu binary packet

  // Cumulative state tracking
  let cumUniqueOriginated = 0;
  let cumUniqueDelivered = 0;
  const seenOriginates = new Set();
  const seenAlerts = new Set();

  for (let t = 0; t <= maxT; t += stepMs) {
    const wStart = Math.max(0, t - windowMs);
    const wEnd = t;
    const windowSec = (wEnd - wStart) / 1000.0;

    // 1. Cumulative tracking up to t
    for (const o of originates) {
      if (o.t <= t) {
        const key = `${o.node}_${o.seq !== undefined ? o.seq : 0}`;
        if (!seenOriginates.has(key)) {
          seenOriginates.add(key);
          cumUniqueOriginated++;
        }
      }
    }

    for (const a of alerts) {
      if (a.t <= t) {
        const key = `${a.origin}_${a.seq !== undefined ? a.seq : 0}`;
        if (!seenAlerts.has(key)) {
          seenAlerts.add(key);
          cumUniqueDelivered++;
        }
      }
    }

    const cumulativePdr = cumUniqueOriginated > 0
      ? Math.round((cumUniqueDelivered / cumUniqueOriginated) * 1000) / 10
      : null;

    // 2. Sliding window observations (in [wStart, wEnd])
    let winOriginated = 0;
    let winDelivered = 0;
    let winCollisions = 0;
    let winDropsTotal = 0;
    let winRetries = 0;
    let winTx = 0;
    let winRx = 0;

    const winOriginSet = new Set();
    for (const o of originates) {
      if (o.t >= wStart && o.t <= wEnd) {
        const key = `${o.node}_${o.seq !== undefined ? o.seq : 0}`;
        if (!winOriginSet.has(key)) {
          winOriginSet.add(key);
          winOriginated++;
        }
      }
    }

    const winAlertSet = new Set();
    for (const a of alerts) {
      if (a.t >= wStart && a.t <= wEnd) {
        const key = `${a.origin}_${a.seq !== undefined ? a.seq : 0}`;
        if (!winAlertSet.has(key)) {
          winAlertSet.add(key);
          winDelivered++;
        }
      }
    }

    for (const d of drops) {
      if (d.t >= wStart && d.t <= wEnd) {
        winDropsTotal++;
        if (d.why === 'collision') winCollisions++;
      }
    }

    for (const r of retries) {
      if (r.t >= wStart && r.t <= wEnd) winRetries++;
    }

    for (const tx of txs) {
      if (tx.t >= wStart && tx.t <= wEnd) winTx++;
    }

    for (const rx of rxs) {
      if (rx.t >= wStart && rx.t <= wEnd) winRx++;
    }

    // Windowed PDR: ratio of delivered alerts to originated in this window
    // If no messages originated in this window, report null (unavailable/sparse)
    const windowPdr = winOriginated > 0
      ? Math.round((winDelivered / winOriginated) * 1000) / 10
      : null;

    // Throughput: delivered payload bits / second and packets / second
    const throughputBps = windowSec > 0
      ? Math.round((winDelivered * PAYLOAD_BITS_PER_SOS) / windowSec)
      : 0;

    const throughputPps = windowSec > 0
      ? Math.round((winDelivered / windowSec) * 100) / 100
      : 0;

    const offeredLoadPps = windowSec > 0
      ? Math.round((winOriginated / windowSec) * 100) / 100
      : 0;

    const collisionRate = winTx > 0
      ? Math.round((winCollisions / winTx) * 1000) / 10
      : 0.0;

    points.push({
      tSec: Math.round((t / 1000.0) * 100) / 100,
      tMs: t,
      cumulativePdr,
      windowPdr,
      throughputBps,
      throughputPps,
      offeredLoadPps,
      winOriginated,
      winDelivered,
      winCollisions,
      winDropsTotal,
      winRetries,
      winTx,
      winRx,
      collisionRate
    });
  }

  return points;
}

/**
 * Reconstructs explicit packet transmission routes through the mesh topology.
 * Associates initial originated SOS messages with subsequent relay forwards and final hub arrival.
 *
 * @param {Array<Object>} events - Simulation events
 * @param {Map|Object} nodesMap - Nodes map
 * @returns {Array<{
 *   origin: number,
 *   seq: number,
 *   hazard: number,
 *   originatedAt: number,
 *   deliveredAt: number|null,
 *   latencyMs: number|null,
 *   hops: number,
 *   path: Array<number>, // e.g. [1, 101, 103, 0]
 *   status: 'delivered'|'in_flight'|'failed'|'acked',
 *   retries: number,
 *   linksTraversed: Array<{ from: number, to: number, t: number, rssi?: number }>
 * }>}
 */
export function reconstructPacketRoutes(events = [], nodesMap = new Map()) {
  const routes = new Map(); // key `${origin}_${seq}` -> route object

  for (const ev of events) {
    if (ev.ev === 'originate') {
      const seq = ev.seq !== undefined ? ev.seq : 0;
      const key = `${ev.node}_${seq}`;
      routes.set(key, {
        origin: ev.node,
        seq,
        hazard: ev.hazard || 0,
        originatedAt: ev.t,
        deliveredAt: null,
        latencyMs: null,
        hops: 1,
        path: [ev.node],
        status: 'in_flight',
        retries: 0,
        linksTraversed: []
      });
    } else if (ev.ev === 'tx') {
      const isRelay = (ev.node >= 100) || (ev.origin !== undefined && ev.origin !== ev.node);
      const origin = ev.origin !== undefined ? ev.origin : ev.node;
      const seq = ev.seq !== undefined ? ev.seq : 0;
      const key = `${origin}_${seq}`;
      const r = routes.get(key);
      if (r && isRelay) {
        if (!r.path.includes(ev.node)) {
          r.path.push(ev.node);
        }
      }
    } else if (ev.ev === 'rx') {
      const rxNode = ev.node !== undefined ? ev.node : ev.to;
      const txNode = ev.from;
      if (txNode !== undefined && rxNode !== undefined) {
        // Record link traversed if associated with a candidate route
        for (const [, r] of routes) {
          if (r.path.includes(txNode) && !r.path.includes(rxNode)) {
            r.linksTraversed.push({
              from: txNode,
              to: rxNode,
              t: ev.t,
              rssi: ev.rssi
            });
            break;
          }
        }
      }
    } else if (ev.ev === 'alert') {
      const seq = ev.seq !== undefined ? ev.seq : 0;
      const key = `${ev.origin}_${seq}`;
      const r = routes.get(key);
      if (r) {
        r.deliveredAt = ev.t;
        r.latencyMs = typeof ev.latency_ms === 'number' ? ev.latency_ms : (ev.t - r.originatedAt);
        r.hops = ev.hops || r.path.length;
        if (!r.path.includes(0)) r.path.push(0);
        r.status = 'delivered';
      }
    } else if (ev.ev === 'ack_rx') {
      const refSeq = ev.ref_seq !== undefined ? ev.ref_seq : (ev.seq !== undefined ? ev.seq : 0);
      const key = `${ev.node}_${refSeq}`;
      const r = routes.get(key);
      if (r) {
        r.status = 'acked';
      }
    } else if (ev.ev === 'gave_up') {
      for (const [, r] of routes) {
        if (r.origin === ev.node && r.status === 'in_flight') {
          r.status = 'failed';
        }
      }
    } else if (ev.ev === 'retry') {
      for (const [, r] of routes) {
        if (r.origin === ev.node && r.status === 'in_flight') {
          r.retries++;
        }
      }
    }
  }

  return Array.from(routes.values());
}

/**
 * Generates an N x N Link-Quality Heatmap Matrix for all pairs of nodes.
 * Explicitly distinguishes:
 * - 'ABSENT': Out of physical radio range or blocked
 * - 'UNOBSERVED': In range according to topology/model, but zero packet transmissions attempted between them
 * - 'MEASURED': Transmissions observed (with sample count, RSSI, SNR, PRR %, Packet Loss Rate)
 *
 * @param {Map|Object} nodesMap - All simulation nodes
 * @param {Array<Object>} linksList - Base topology links
 * @param {Array<Object>} events - Simulation trace events
 * @param {string} [metricType='rssi'] - 'rssi' | 'snr' | 'prr' | 'loss_rate' | 'link_margin'
 * @returns {{
 *   nodeIds: Array<number>,
 *   nodes: Array<Object>,
 *   matrix: Array<Array<{
 *     from: number,
 *     to: number,
 *     status: 'ABSENT'|'UNOBSERVED'|'MEASURED',
 *     samples: number,
 *     rssi: number|null,
 *     snr: number|null,
 *     prr: number|null,
 *     lossRate: number|null,
 *     linkMargin: number|null,
 *     distanceM: number|null
 *   }>>
 * }}
 */
export function generateLinkQualityMatrix(nodesMap = new Map(), linksList = [], events = [], metricType = 'rssi') {
  const nodes = Array.from(nodesMap.values()).sort((a, b) => a.id - b.id);
  const nodeIds = nodes.map(n => n.id);
  const n = nodeIds.length;
  const idToIndex = new Map(nodeIds.map((id, idx) => [id, idx]));

  // Initialize matrix
  const matrix = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => {
      const fromId = nodeIds[r];
      const toId = nodeIds[c];
      const na = nodes[r];
      const nb = nodes[c];
      const dist = (na && nb) ? Math.round(Math.hypot(na.x - nb.x, na.y - nb.y) * 10) / 10 : null;

      return {
        from: fromId,
        to: toId,
        status: fromId === toId ? 'ABSENT' : 'UNOBSERVED',
        samples: 0,
        txAttempts: 0,
        rxSuccess: 0,
        drops: 0,
        rssiSum: 0,
        snrSum: 0,
        snrCount: 0,
        rssi: null,
        snr: null,
        prr: null,
        lossRate: null,
        linkMargin: null,
        distanceM: dist
      };
    })
  );

  // Mark base topology links
  for (const lk of linksList) {
    const r = idToIndex.get(lk.a);
    const c = idToIndex.get(lk.b);
    if (r !== undefined && c !== undefined) {
      if (lk.blocked) {
        matrix[r][c].status = 'ABSENT';
        matrix[c][r].status = 'ABSENT';
      } else {
        if (typeof lk.rssi === 'number') {
          matrix[r][c].rssi = lk.rssi;
          matrix[c][r].rssi = lk.rssi;
        }
      }
    }
  }

  // Accumulate actual simulated packet events
  for (const ev of events) {
    if (ev.ev === 'rx') {
      const fromId = ev.from;
      const toId = ev.node !== undefined ? ev.node : ev.to;
      const r = idToIndex.get(fromId);
      const c = idToIndex.get(toId);
      if (r !== undefined && c !== undefined && r !== c) {
        const cell = matrix[r][c];
        cell.samples++;
        cell.rxSuccess++;
        if (typeof ev.rssi === 'number') {
          cell.rssiSum += ev.rssi;
        }
        if (typeof ev.snr === 'number') {
          cell.snrSum += ev.snr;
          cell.snrCount++;
        }
      }
    } else if (ev.ev === 'drop') {
      const fromId = ev.from;
      const toId = ev.node !== undefined ? ev.node : ev.to;
      const r = idToIndex.get(fromId);
      const c = idToIndex.get(toId);
      if (r !== undefined && c !== undefined && r !== c) {
        const cell = matrix[r][c];
        cell.samples++;
        cell.drops++;
      }
    }
  }

  // Compute final link metrics
  const sensitivity = LORA_RADIO_CONSTANTS.sensitivityBySf[7] || -123.0;
  const noiseFloor = LORA_RADIO_CONSTANTS.noiseFloorDbm || -117.0;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (r === c) continue;
      const cell = matrix[r][c];
      if (cell.samples > 0) {
        cell.status = 'MEASURED';
        const avgRssi = cell.rxSuccess > 0 ? (cell.rssiSum / cell.rxSuccess) : null;
        cell.rssi = avgRssi !== null ? Math.round(avgRssi * 10) / 10 : null;
        const avgSnr = cell.snrCount > 0 ? (cell.snrSum / cell.snrCount) : (avgRssi !== null ? (avgRssi - noiseFloor) : null);
        cell.snr = avgSnr !== null ? Math.round(avgSnr * 10) / 10 : null;
        cell.linkMargin = avgRssi !== null ? Math.round((avgRssi - sensitivity) * 10) / 10 : null;
        cell.prr = Math.round((cell.rxSuccess / cell.samples) * 1000) / 10;
        cell.lossRate = Math.round((cell.drops / cell.samples) * 1000) / 10;
      } else {
        // If not measured, check if distance puts it beyond physical reach (< -135 dBm)
        if (cell.distanceM !== null) {
          const predicted = calculateTheoreticalRssi(cell.distanceM);
          if (predicted < -135.0) {
            cell.status = 'ABSENT';
          } else {
            cell.status = 'UNOBSERVED';
            cell.rssi = Math.round(predicted * 10) / 10;
            cell.linkMargin = Math.round((predicted - sensitivity) * 10) / 10;
          }
        }
      }
    }
  }

  return { nodeIds, nodes, matrix };
}

/**
 * Computes deep Relay Analytics and Defensible Bottleneck Index.
 * Bottleneck Index formula:
 * B_i = 0.40 * (Forwarding Load) + 0.35 * (Drop Rate) + 0.25 * (Queue Saturation)
 * Where each component is strictly bounded in [0.0, 1.0].
 *
 * @param {Map|Object} nodesMap - All nodes
 * @param {Array<Object>} events - Simulation events
 * @returns {Array<Object>} Sorted list of relay analytics objects
 */
export function calculateRelayAnalytics(nodesMap = new Map(), events = []) {
  const relays = new Map();

  for (const [, n] of nodesMap) {
    if (n.role === 'relay' || n.id >= 100) {
      relays.set(n.id, {
        id: n.id,
        role: n.role,
        x: n.x,
        y: n.y,
        battery: n.battery,
        energyConsumedMah: n.energy_consumed_mah || 0,
        originatedTx: 0,
        forwardedTx: 0,
        receptions: 0,
        successfulForwards: 0,
        retries: 0,
        suppressedBackoffs: 0,
        drops: { weak: 0, collision: 0, halfduplex: 0, loss: 0, total: 0 },
        queuePressure: {
          buttonQueueDepth: n.button_queue_depth || 0,
          radioQueueDepth: n.radio_queue_depth || 0,
          overflows: (n.button_queue_overflows || 0) + (n.radio_queue_overflows || 0)
        },
        bottleneckScore: 0.0,
        isBottleneck: false
      });
    }
  }

  let totalNetworkForwards = 0;

  for (const ev of events) {
    if (ev.ev === 'tx') {
      const isRelay = (ev.node >= 100) || (ev.origin !== undefined && ev.origin !== ev.node);
      const r = relays.get(ev.node);
      if (r) {
        if (isRelay) {
          r.forwardedTx++;
          r.successfulForwards++;
          totalNetworkForwards++;
        } else {
          r.originatedTx++;
        }
      }
    } else if (ev.ev === 'rx') {
      const rxNode = ev.node !== undefined ? ev.node : ev.to;
      const r = relays.get(rxNode);
      if (r) r.receptions++;
    } else if (ev.ev === 'drop') {
      const dropNode = ev.node !== undefined ? ev.node : ev.to;
      const r = relays.get(dropNode);
      if (r) {
        r.drops.total++;
        if (ev.why === 'weak') r.drops.weak++;
        else if (ev.why === 'collision') r.drops.collision++;
        else if (ev.why === 'halfduplex') r.drops.halfduplex++;
        else r.drops.loss++;
      }
    } else if (ev.ev === 'relay_suppressed' || ev.ev === 'suppress') {
      const r = relays.get(ev.node);
      if (r) r.suppressedBackoffs++;
    } else if (ev.ev === 'retry') {
      const r = relays.get(ev.node);
      if (r) r.retries++;
    }
  }

  const result = Array.from(relays.values());

  for (const r of result) {
    // 1. Forwarding Load component [0, 1]
    const loadComp = totalNetworkForwards > 0 ? (r.forwardedTx / totalNetworkForwards) : 0.0;

    // 2. Drop Rate component [0, 1]
    const totalAttempts = r.receptions + r.drops.total;
    const dropComp = totalAttempts > 0 ? (r.drops.total / totalAttempts) : 0.0;

    // 3. Queue Saturation component [0, 1] (Nominal queue depth limit is 16)
    const queueComp = Math.min(1.0, (r.queuePressure.radioQueueDepth / 16.0) + (r.queuePressure.overflows > 0 ? 0.5 : 0.0));

    // Defensible Weighted Bottleneck Score
    const score = 0.40 * loadComp + 0.35 * dropComp + 0.25 * queueComp;
    r.bottleneckScore = Math.round(score * 1000) / 1000;
    r.isBottleneck = score >= 0.50 || (r.drops.collision >= 5 && loadComp >= 0.3);
  }

  result.sort((a, b) => b.bottleneckScore - a.bottleneckScore);
  return result;
}

/**
 * Computes projected battery lifetime based on measured current drain and transmit rate.
 *
 * @param {number} currentBatteryPct - Current State of Charge (%)
 * @param {number} nominalCapacityMah - Nominal battery capacity (mAh)
 * @param {number} txCount - Transmissions in session
 * @param {number} rxCount - Receptions in session
 * @param {number} durationSec - Simulation duration in seconds
 * @returns {{
 *   projectedHours: number|null,
 *   activeCurrentMa: number,
 *   energyPerSosDeliveryMah: number|null
 * }}
 */
export function calculateBatteryProjections(currentBatteryPct, nominalCapacityMah = 300.0, txCount = 0, rxCount = 0, durationSec = 30) {
  if (durationSec <= 0) return { projectedHours: null, activeCurrentMa: 0, energyPerSosDeliveryMah: null };

  const durationHours = durationSec / 3600.0;
  // SX1262 LoRa airtime per packet ~ 62ms
  const airtimeHours = (txCount * 0.062) / 3600.0;
  const rxAirtimeHours = (rxCount * 0.062) / 3600.0;
  const idleHours = Math.max(0, durationHours - airtimeHours - rxAirtimeHours);

  const consumedMah = (airtimeHours * LORA_RADIO_CONSTANTS.txCurrentMa) +
                      (rxAirtimeHours * LORA_RADIO_CONSTANTS.rxCurrentMa) +
                      (idleHours * LORA_RADIO_CONSTANTS.idleCurrentMa);

  const avgCurrentMa = consumedMah / durationHours;
  const remainingCapacityMah = (currentBatteryPct / 100.0) * nominalCapacityMah;
  const projectedHours = avgCurrentMa > 0 ? Math.round((remainingCapacityMah / avgCurrentMa) * 10) / 10 : null;

  return {
    projectedHours,
    activeCurrentMa: Math.round(avgCurrentMa * 100) / 100,
    consumedMah: Math.round(consumedMah * 1000) / 1000
  };
}
