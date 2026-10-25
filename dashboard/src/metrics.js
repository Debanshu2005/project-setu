// Project Setu - Authoritative Simulation Metrics Contract & Pure Analytics Engine
// Centralized, verifiable analytics calculation for both Live Digital Twin and Scenario Replay.

/**
 * Metric Contract: Formal definitions, counting rules, formulas, and limitations.
 */
export const METRIC_CONTRACT = Object.freeze({
  uniqueSosOriginated: {
    name: 'Unique SOS Originated',
    category: 'lifecycle',
    description: 'Count of distinct emergency messages created by survivor devices.',
    source: 'Authoritative C++ trace "originate" events or distinct survivor SOS initial transmissions.',
    formula: 'Count of unique (origin_node_id, sequence_number) tuples.',
    units: 'messages',
    countingRule: 'Retransmissions and duplicate forwards do NOT increment this count.',
    limitations: 'If sequence numbers are omitted in legacy traces, falls back to episode-based deduplication.'
  },
  initialTransmissions: {
    name: 'Initial Transmissions',
    category: 'transmission',
    description: 'First physical airtime transmission attempt for each unique originated message.',
    source: 'Trace "tx" events corresponding to retry attempt 0 from origin node.',
    formula: 'Count of first "tx" per unique (origin_node_id, sequence_number).',
    units: 'packets',
    countingRule: 'Excludes relay forwarding and retransmission attempts.'
  },
  retransmissions: {
    name: 'Retransmissions',
    category: 'transmission',
    description: 'Repeated transmission attempts triggered by backoff timeout before ACK.',
    source: 'Trace "retry" events and subsequent "tx" attempts from originator.',
    formula: 'Sum of all retransmission attempts across all survivors.',
    units: 'packets',
    countingRule: 'Counts physical airtime retries. Does NOT create new logical messages.'
  },
  relayForwards: {
    name: 'Relay Forwarding Attempts',
    category: 'transmission',
    description: 'Transmissions executed by intermediate relay towers or mesh peers to extend range.',
    source: 'Trace "tx" events where transmitting node is not the origin node (e.g. Node ID >= 100).',
    formula: 'Count of "tx" events where tx.node !== tx.origin or role === "relay".',
    units: 'packets',
    countingRule: 'Only counts actual transmissions. Canceled backoffs are counted separately as relay suppressed.'
  },
  relaySuppressed: {
    name: 'Relay Suppressed Backoffs',
    category: 'protocol',
    description: 'Relay transmissions aborted because a peer relay was overheard forwarding the same packet.',
    source: 'Trace "relay_suppressed" or "suppress" events.',
    formula: 'Count of duplicate overhear suppressions.',
    units: 'events',
    countingRule: 'Measures channel contention mitigation; not a lost packet or transmission.'
  },
  physicalRadioReceptions: {
    name: 'Physical Radio Receptions',
    category: 'radio',
    description: 'Total number of successful physical packet demodulations across all receiving nodes.',
    source: 'Trace "rx" events.',
    formula: 'Count of all successful "rx" events across the network.',
    units: 'receptions',
    countingRule: 'Physical layer over-the-air receptions. Must NOT be confused with end-to-end delivered messages.'
  },
  physicalRadioDrops: {
    name: 'Physical Radio Drops',
    category: 'radio',
    description: 'Attempted packet receptions that failed during demodulation or propagation.',
    source: 'Trace "drop" events categorized by "why" field.',
    formula: 'Count of "drop" events (weak, collision, halfduplex, loss, blocked, duty, ttl, depleted).',
    units: 'drops',
    countingRule: 'Counts failed radio link attempts. An attempt drop does NOT imply permanent message failure if retried.'
  },
  uniqueAlertsDelivered: {
    name: 'Unique Alerts Delivered to Hub',
    category: 'lifecycle',
    description: 'Distinct survivor SOS alerts that successfully reached Node 0 (Rescue Hub).',
    source: 'Authoritative C++ Sink "alert" events.',
    formula: 'Count of unique (origin, seq) alerts received at Sink.',
    units: 'messages',
    countingRule: 'Intermediate radio hops are NOT counted as separate deliveries. Only final Hub delivery counts.'
  },
  uniqueAlertsAcked: {
    name: 'Unique Alerts Confirmed (ACK)',
    category: 'lifecycle',
    description: 'Unique survivor SOS alerts where the originating node received an ACK packet or haptic confirmation.',
    source: 'Trace "ack_rx" events or "haptic" pattern 3 (AckReceived).',
    formula: 'Count of unique survivor alerts that received an ACK confirmation.',
    units: 'messages',
    countingRule: 'Requires two-way loop (Survivor -> Hub -> Survivor).'
  },
  inFlightMessages: {
    name: 'Messages In Flight',
    category: 'lifecycle',
    description: 'Originated messages that have not yet reached the Hub and have not exhausted retries.',
    source: 'Derived state: originated at t <= currentTime, not delivered, not gave_up.',
    formula: 'Count of active SOS alerts currently traversing the mesh.',
    units: 'messages',
    countingRule: 'Active during simulation execution; resolves to 0 when simulation completes.'
  },
  failedMessages: {
    name: 'Failed / Expired Messages',
    category: 'lifecycle',
    description: 'Originated messages that permanently failed to reach the Hub (max retries exhausted or node died).',
    source: 'Trace "gave_up" events or expired retries without delivery.',
    formula: 'Count of unrecovered messages where delivery never occurred.',
    units: 'messages',
    countingRule: 'Distinguishes individual failed packet attempts from permanent end-to-end failure.'
  },
  pdr: {
    name: 'Packet Delivery Ratio (PDR)',
    category: 'kpi',
    description: 'True end-to-end delivery success ratio for unique logical SOS messages.',
    source: 'Ratio of unique delivered alerts to unique originated alerts.',
    formula: '(Unique SOS Delivered to Hub / Unique SOS Originated) * 100%',
    units: '%',
    countingRule: 'If 0 SOS messages originated, returns null (displayed as "N/A"). If in-flight messages exist, marked provisional.',
    limitations: 'Does not divide physical RX by physical RX + Drop. Measures end-to-end mission delivery.'
  },
  deliveryLatency: {
    name: 'End-to-End Delivery Latency',
    category: 'kpi',
    description: 'Simulation elapsed time from survivor button trigger/origination to Rescue Hub receipt.',
    source: 'Simulation clock: t_alert - t_originate (or measured latency_ms from C++ engine).',
    formula: 'Distribution of (t_sink_delivery - t_survivor_originate) in milliseconds.',
    units: 'ms',
    countingRule: 'Derived purely from simulation timestamps. Returns null (N/A) if no deliveries recorded. Never fabricated.',
    limitations: 'Excludes wall-clock rendering delays.'
  },
  hopCount: {
    name: 'End-to-End Hop Count',
    category: 'kpi',
    description: 'Number of radio hops traversed by delivered SOS packets (1 = direct to Hub, 2+ = via relays).',
    source: 'Authoritative "alert" trace events (hops field).',
    formula: 'Distribution: 1, 2, 3, 4, 5+ hops.',
    units: 'hops',
    countingRule: 'Calculated strictly from completed deliveries; no fabricated route lengths.'
  }
});

/**
 * Pure functional metrics calculation from raw trace events and node topology.
 *
 * @param {Array<Object>} events - Array of trace event objects
 * @param {Map|Object} nodesMap - Current nodes map or object
 * @param {number} currentTime - Current simulation time in milliseconds
 * @param {Object} session - Session descriptor { id, name, mode, status, scenarioId }
 * @returns {Object} Comprehensive, verified metrics payload
 */
export function calculateMetrics(events = [], nodesMap = new Map(), currentTime = Infinity, session = null) {
  // Normalize nodes
  const nodes = nodesMap instanceof Map ? nodesMap : new Map(Object.entries(nodesMap || {}));

  // Filter events up to currentTime
  const activeEvents = [];
  const eventIndices = new Map(); // category -> array of event references for timeline navigation

  const addEventRef = (cat, ev) => {
    if (!eventIndices.has(cat)) eventIndices.set(cat, []);
    eventIndices.get(cat).push(ev);
  };

  for (let i = 0; i < events.length; ++i) {
    const ev = events[i];
    if (typeof ev.t === 'number' && ev.t > currentTime) break;
    activeEvents.push(ev);
  }

  // 1. Message Lifecycle Tracking
  // Key: `${origin}_${seq}`
  const messages = new Map();

  const getOrCreateMsg = (origin, seq, t = 0) => {
    const key = `${origin}_${seq !== undefined && seq !== null ? seq : 'def'}`;
    if (!messages.has(key)) {
      messages.set(key, {
        key,
        origin,
        seq: seq !== undefined ? seq : null,
        originatedAt: t,
        delivered: false,
        deliveredAt: null,
        latencyMs: null,
        hops: null,
        acked: false,
        ackedAt: null,
        gaveUp: false,
        gaveUpAt: null,
        txAttempts: 0,
        retries: 0,
        relayForwards: 0,
        drops: []
      });
    }
    return messages.get(key);
  };

  // Drop cause counters and event collections
  const dropCauses = {
    weak: 0,
    collision: 0,
    halfduplex: 0,
    loss: 0,
    blocked: 0,
    duty_blocked: 0,
    ttl_drop: 0,
    depleted: 0,
    other: 0
  };

  let physicalTxTotal = 0;
  let physicalRxTotal = 0;
  let physicalDropTotal = 0;
  let relaySuppressedTotal = 0;
  let dedupDropTotal = 0;
  let retriesTotal = 0;

  // Process trace events
  for (const ev of activeEvents) {
    switch (ev.ev) {
      case 'originate': {
        const msg = getOrCreateMsg(ev.node, ev.seq, ev.t);
        msg.originatedAt = ev.t;
        addEventRef('originate', ev);
        addEventRef(`node_${ev.node}`, ev);
        break;
      }

      case 'tx': {
        physicalTxTotal++;
        addEventRef('tx', ev);
        addEventRef(`node_${ev.node}`, ev);

        if (ev.ack || ev.node === 0) {
          addEventRef('tx_ack', ev);
          // ACK transmission from Hub or node - NOT an SOS origination
          break;
        }

        const isRelay = ev.node >= 100 || (ev.origin !== undefined && ev.origin !== ev.node);
        if (isRelay) {
          addEventRef('tx_relay', ev);
          if (ev.origin !== undefined) {
            const msg = getOrCreateMsg(ev.origin, ev.seq, ev.t);
            msg.relayForwards++;
          }
        } else {
          addEventRef('tx_orig', ev);
          const msg = getOrCreateMsg(ev.node, ev.seq, ev.t);
          msg.txAttempts++;
          if (msg.txAttempts > 1) {
            msg.retries = Math.max(msg.retries, msg.txAttempts - 1);
            addEventRef('tx_retry', ev);
          }
        }
        break;
      }

      case 'rx': {
        physicalRxTotal++;
        addEventRef('rx', ev);
        const rxNode = ev.node !== undefined ? ev.node : ev.to;
        if (rxNode !== undefined) addEventRef(`node_${rxNode}`, ev);
        break;
      }

      case 'drop': {
        physicalDropTotal++;
        addEventRef('drop', ev);
        const why = ev.why || 'other';
        if (why === 'weak') {
          dropCauses.weak++;
          addEventRef('drop_weak', ev);
        } else if (why === 'collision') {
          dropCauses.collision++;
          addEventRef('drop_collision', ev);
        } else if (why === 'halfduplex') {
          dropCauses.halfduplex++;
          addEventRef('drop_halfduplex', ev);
        } else if (why === 'loss' || why === 'shadow') {
          dropCauses.loss++;
          addEventRef('drop_loss', ev);
        } else if (why === 'blocked' || why === 'link_block') {
          dropCauses.blocked++;
          addEventRef('drop_blocked', ev);
        } else if (why === 'duty' || why === 'duty_cycle') {
          dropCauses.duty_blocked++;
          addEventRef('drop_duty', ev);
        } else if (why === 'depleted' || why === 'battery') {
          dropCauses.depleted++;
          addEventRef('drop_depleted', ev);
        } else {
          dropCauses.other++;
          addEventRef('drop_other', ev);
        }

        const dropNode = ev.node !== undefined ? ev.node : ev.to;
        if (dropNode !== undefined) addEventRef(`node_${dropNode}`, ev);
        break;
      }

      case 'relay_suppressed':
      case 'suppress': {
        relaySuppressedTotal++;
        addEventRef('suppress', ev);
        addEventRef(`node_${ev.node}`, ev);
        break;
      }

      case 'dedup_drop':
      case 'dedup': {
        dedupDropTotal++;
        addEventRef('dedup', ev);
        addEventRef(`node_${ev.node}`, ev);
        break;
      }

      case 'retry': {
        retriesTotal++;
        addEventRef('retry', ev);
        addEventRef(`node_${ev.node}`, ev);
        const msg = getOrCreateMsg(ev.node, ev.seq, ev.t);
        if (msg.retries === 0 && msg.txAttempts <= 1) {
          msg.retries = 1;
        }
        break;
      }

      case 'alert': {
        addEventRef('alert', ev);
        addEventRef(`node_${ev.origin}`, ev);
        addEventRef('node_0', ev); // Delivered to hub

        const msg = getOrCreateMsg(ev.origin, ev.seq, ev.t);
        msg.delivered = true;
        msg.deliveredAt = ev.t;
        msg.hops = ev.hops || 1;

        // Accurate latency calculation:
        // Priority 1: native simulator measured latency_ms
        // Priority 2: difference between alert time and origination time
        if (typeof ev.latency_ms === 'number' && ev.latency_ms > 0) {
          msg.latencyMs = ev.latency_ms;
        } else if (typeof msg.originatedAt === 'number' && ev.t >= msg.originatedAt) {
          msg.latencyMs = ev.t - msg.originatedAt;
        } else {
          msg.latencyMs = null;
        }

        addEventRef(`hop_${Math.min(5, msg.hops)}`, ev);
        break;
      }

      case 'ack_rx': {
        addEventRef('ack', ev);
        addEventRef(`node_${ev.node}`, ev);
        const msg = getOrCreateMsg(ev.node, ev.seq, ev.t);
        msg.acked = true;
        msg.ackedAt = ev.t;
        break;
      }

      case 'haptic': {
        if (ev.pattern === 3) { // AckReceived
          addEventRef('ack', ev);
          addEventRef(`node_${ev.node}`, ev);
          const msg = getOrCreateMsg(ev.node, ev.seq, ev.t);
          msg.acked = true;
          msg.ackedAt = ev.t;
        }
        break;
      }

      case 'gave_up': {
        addEventRef('gave_up', ev);
        addEventRef(`node_${ev.node}`, ev);
        const msg = getOrCreateMsg(ev.node, ev.seq, ev.t);
        msg.gaveUp = true;
        msg.gaveUpAt = ev.t;
        break;
      }

      case 'battery':
      case 'battery_depleted': {
        addEventRef('battery', ev);
        addEventRef(`node_${ev.node}`, ev);
        break;
      }

      case 'wake_word':
      case 'voice_command': {
        addEventRef('voice', ev);
        addEventRef(`node_${ev.node}`, ev);
        break;
      }

      case 'node_kill':
      case 'node_revive':
      case 'gps_off':
      case 'gps_on':
      case 'dr_off':
      case 'dr_on':
      case 'link_block':
      case 'link_unblock': {
        addEventRef('fault', ev);
        if (ev.node !== undefined) addEventRef(`node_${ev.node}`, ev);
        break;
      }
    }
  }

  // Aggregate Message Populations
  let uniqueOriginated = 0;
  let uniqueDelivered = 0;
  let uniqueAcked = 0;
  let inFlightCount = 0;
  let failedCount = 0;
  let relayForwardAttempts = 0;
  let totalRetransmissions = 0;

  const latencies = [];
  const hopsDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };

  for (const [, msg] of messages) {
    uniqueOriginated++;
    relayForwardAttempts += msg.relayForwards;
    totalRetransmissions += msg.retries;

    if (msg.delivered) {
      uniqueDelivered++;
      if (typeof msg.latencyMs === 'number' && msg.latencyMs >= 0) {
        latencies.push(msg.latencyMs);
      }
      if (msg.hops === 1) hopsDistribution[1]++;
      else if (msg.hops === 2) hopsDistribution[2]++;
      else if (msg.hops === 3) hopsDistribution[3]++;
      else if (msg.hops === 4) hopsDistribution[4]++;
      else if (msg.hops >= 5) hopsDistribution['5+']++;
    } else if (msg.gaveUp) {
      failedCount++;
    } else {
      inFlightCount++;
    }

    if (msg.acked) {
      uniqueAcked++;
    }
  }

  // 2. True Packet Delivery Ratio (PDR)
  let pdr = null;
  let pdrDisplay = 'N/A';
  let isProvisional = false;

  if (uniqueOriginated > 0) {
    pdr = (uniqueDelivered / uniqueOriginated) * 100;
    pdrDisplay = `${pdr.toFixed(1)}%`;
    if (inFlightCount > 0) {
      isProvisional = true;
    }
  }

  // 3. Latency Statistics
  const latencyStats = calculateLatencyStats(latencies);

  // 4. Node Fleet Health Summary
  let totalNodes = nodes.size;
  let onlineNodes = 0;
  let depletedNodes = 0;
  let failedNodes = 0;
  let totalBatteryPct = 0;
  let totalEnergyConsumedMah = 0;

  for (const [, n] of nodes) {
    if (n.battery === 0 || n.depleted) {
      depletedNodes++;
      failedNodes++;
    } else if (n.online) {
      onlineNodes++;
    } else {
      failedNodes++;
    }
    totalBatteryPct += typeof n.battery === 'number' ? n.battery : 100;
    totalEnergyConsumedMah += typeof n.energy_consumed_mah === 'number' ? n.energy_consumed_mah : 0;
  }

  const avgBatteryPct = totalNodes > 0 ? Math.round(totalBatteryPct / totalNodes) : null;

  // Session state identity
  const sessionInfo = session ? {
    id: session.id || 'live_0',
    name: session.name || 'Active Session',
    mode: session.mode || 'live',
    status: session.status || 'running',
    scenarioId: session.scenarioId || null,
    isProvisional
  } : {
    id: 'untracked',
    name: 'Default Session',
    mode: 'live',
    status: 'idle',
    scenarioId: null,
    isProvisional
  };

  return {
    contract: METRIC_CONTRACT,
    session: sessionInfo,
    clockMs: Math.round(currentTime === Infinity ? (activeEvents.length > 0 ? activeEvents[activeEvents.length - 1].t : 0) : currentTime),
    totalEvents: activeEvents.length,

    // Fleet Summary
    fleet: {
      totalNodes,
      onlineNodes,
      failedNodes,
      depletedNodes,
      avgBatteryPct,
      totalEnergyConsumedMah: Math.round(totalEnergyConsumedMah * 100) / 100
    },

    // SOS Message Lifecycle (End-to-End)
    lifecycle: {
      uniqueOriginated,
      uniqueDelivered,
      uniqueAcked,
      inFlight: inFlightCount,
      failed: failedCount,
      relayForwards: relayForwardAttempts,
      retries: totalRetransmissions,
      pdr,
      pdrDisplay,
      isProvisional
    },

    // Physical Radio Channel Stats
    radio: {
      txTotal: physicalTxTotal,
      rxTotal: physicalRxTotal,
      dropTotal: physicalDropTotal,
      dedupTotal: dedupDropTotal,
      relaySuppressedTotal,
      retriesTotal,
      dropCauses
    },

    // Delivery Latency (ms)
    latency: latencyStats,

    // Hop Distribution
    hopDistribution: [
      { label: '1 Hop (Direct)', count: hopsDistribution[1], hop: 1 },
      { label: '2 Hops (1 Relay)', count: hopsDistribution[2], hop: 2 },
      { label: '3 Hops (2 Relays)', count: hopsDistribution[3], hop: 3 },
      { label: '4 Hops (3 Relays)', count: hopsDistribution[4], hop: 4 },
      { label: '5+ Hops (Mesh)', count: hopsDistribution['5+'], hop: 5 }
    ],

    // Event References for Click-to-Timeline Navigation
    eventIndices
  };
}

/**
 * Calculates latency distribution metrics.
 * @param {Array<number>} latencies - Array of latency values in ms
 * @returns {Object} Latency statistics
 */
export function calculateLatencyStats(latencies = []) {
  if (!latencies || latencies.length === 0) {
    return {
      count: 0,
      avgMs: null,
      medianMs: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
      display: 'N/A'
    };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / sorted.length);

  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);

  const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95 = sorted[p95Idx];

  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return {
    count: sorted.length,
    avgMs: avg,
    medianMs: median,
    p95Ms: p95,
    minMs: min,
    maxMs: max,
    display: `${avg}ms`
  };
}
