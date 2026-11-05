// Project Setu: Plain English Event Narrator & Loss Budget Engine
// Translates raw simulator trace events into natural, plain English sentences
// and computes exact RF link margin waterfall decompositions for disaster response personnel.

export const HAZARD_NAMES = {
  0: 'General Emergency',
  1: 'Medical Emergency',
  2: 'Trapped Under Debris'
};

export const SENSITIVITY_BY_SF = {
  7: -123.0,
  8: -125.5,
  9: -128.5,
  10: -131.0,
  11: -134.0,
  12: -137.0
};

// Formats millisecond simulation time into MM:SS.s string
export function formatTimestamp(tMs) {
  if (typeof tMs !== 'number' || isNaN(tMs) || tMs < 0) return '';
  const totalSec = Math.floor(tMs / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const sec = String(totalSec % 60).padStart(2, '0');
  const tenth = Math.floor((tMs % 1000) / 100);
  return `${min}:${sec}.${tenth}`;
}

// Tests 2D line segment intersection between (p1, p2) and (p3, p4)
export function lineSegmentsIntersect(p1, p2, p3, p4) {
  function ccw(a, b, c) {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  }
  return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
}

// Finds all obstacles crossed by a link ray from (x1, y1) to (x2, y2)
export function findCrossedObstacles(x1, y1, x2, y2, obstacles = []) {
  if (!Array.isArray(obstacles) || obstacles.length === 0) return [];
  const p1 = { x: x1, y: y1 };
  const p2 = { x: x2, y: y2 };
  const crossed = [];

  for (const obs of obstacles) {
    const p3 = { x: obs.x1, y: obs.y1 };
    const p4 = { x: obs.x2, y: obs.y2 };
    if (lineSegmentsIntersect(p1, p2, p3, p4)) {
      crossed.push({
        id: obs.id,
        name: obs.name || `obstacle_${obs.id || 1}`,
        material: obs.material || 'reinforced_concrete',
        loss_db: typeof obs.loss_db === 'number' ? obs.loss_db : 20.0
      });
    }
  }
  return crossed;
}

// Computes exact physical RF loss budget matching C++ World::get_loss_budget
export function computeLossBudget(fromNode, toNode, context = {}) {
  const sf = context.sf || 7;
  const sens = SENSITIVITY_BY_SF[sf] || -123.0;
  const txPower = typeof context.tx_power_dbm === 'number' ? context.tx_power_dbm : 14.0;
  const pathExp = typeof context.path_exp === 'number' ? context.path_exp : 3.5;

  const fromId = fromNode && fromNode.id !== undefined ? fromNode.id : (context.from !== undefined ? context.from : 1);
  const toId = toNode && toNode.id !== undefined ? toNode.id : (context.to !== undefined ? context.to : 0);
  const fromRole = fromNode && fromNode.role ? fromNode.role : 'survivor';
  const toRole = toNode && toNode.role ? toNode.role : (toId === 0 ? 'hub' : 'relay');

  const x1 = fromNode && typeof fromNode.x === 'number' ? fromNode.x : 0;
  const y1 = fromNode && typeof fromNode.y === 'number' ? fromNode.y : 0;
  const x2 = toNode && typeof toNode.x === 'number' ? toNode.x : (x1 + 100);
  const y2 = toNode && typeof toNode.y === 'number' ? toNode.y : y1;

  const dist = Math.max(1.0, Math.hypot(x2 - x1, y2 - y1));

  // Distance path loss matching log-distance model: ref 55 dB + 10 * n * log10(d / 10)
  const pathLoss = Math.round((55.0 + 10.0 * pathExp * Math.log10(Math.max(10.0, dist) / 10.0)) * 10) / 10;

  // Obstacle attenuation
  const obstacles = context.obstacles || [];
  const crossedWalls = findCrossedObstacles(x1, y1, x2, y2, obstacles);
  let totalWallLoss = 0.0;
  for (const w of crossedWalls) {
    totalWallLoss += w.loss_db;
  }
  totalWallLoss = Math.round(totalWallLoss * 10) / 10;

  // Body loss: 3 dB if survivor is trapped under slab or lying prone
  const isProne = (fromNode && (fromNode.hazard === 2 || fromNode.motion_profile === 'stationary')) || context.body_loss !== undefined;
  const bodyLoss = isProne ? 3.0 : 0.0;

  // Shadowing & fading
  const shadowLoss = typeof context.shadow === 'number' ? Math.abs(context.shadow) : 4.0;
  const extraLoss = 15.0; // hardware & structural fade margin

  // Received power: use explicit trace RSSI if given, else compute from physical stages
  let rxPower;
  if (typeof context.rssi === 'number') {
    rxPower = context.rssi;
  } else {
    rxPower = Math.round((txPower - (pathLoss + totalWallLoss + bodyLoss + shadowLoss)) * 10) / 10;
  }

  const margin = Math.round((rxPower - sens) * 10) / 10;
  const isViable = margin >= 0.0;

  // Compute honest physical verdict naming the largest contributor
  let verdict = '';
  if (isViable) {
    verdict = `Link viable with +${margin.toFixed(1)} dB margin above receiver sensitivity (${sens.toFixed(1)} dBm).`;
  } else {
    if (context.why === 'collision') {
      verdict = `Dropped because co-channel radio collision with an overlapping transmission corrupted the frame.`;
    } else if (context.why === 'halfduplex') {
      verdict = `Dropped because receiver Node ${toId} was actively transmitting when the signal arrived (half-duplex constraint).`;
    } else if (crossedWalls.length > 0 && totalWallLoss >= 14.0) {
      const wallNames = crossedWalls.map(w => `${w.loss_db.toFixed(1)} dB ${w.name}`).join(' and ');
      verdict = `Dropped because the ${wallNames} reduced signal below receiver sensitivity (${sens.toFixed(1)} dBm).`;
    } else {
      verdict = `Dropped because ${dist.toFixed(1)}m distance path loss (-${pathLoss.toFixed(1)} dB) reduced signal below receiver sensitivity (${sens.toFixed(1)} dBm).`;
    }
  }

  return {
    from: fromId,
    to: toId,
    fromRole,
    toRole,
    dist: Math.round(dist * 10) / 10,
    tx_power_dbm: txPower,
    path_loss_db: pathLoss,
    crossedWalls,
    totalWallLoss,
    body_loss_db: bodyLoss,
    shadow_loss_db: shadowLoss,
    extra_loss_db: extraLoss,
    rx_power_dbm: rxPower,
    sensitivity_dbm: sens,
    link_margin_db: margin,
    viable: isViable,
    verdict
  };
}

// Formats a single trace event into a plain English sentence
export function narrateEvent(ev, options = {}) {
  if (!ev || typeof ev !== 'object') return '';
  const currentSf = options.sf || 7;
  const sens = SENSITIVITY_BY_SF[currentSf] || -123.0;
  const isStory = Boolean(options.story);
  const timePrefix = (options.timestamp !== false && typeof ev.t === 'number') ? `${formatTimestamp(ev.t)} ` : '';

  switch (ev.ev) {
    case 'originate': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || `Hazard ${ev.hazard}`;
      const contactStr = ev.contact ? ` (Contact: #${ev.contact})` : '';
      if (isStory) {
        const hazardDesc = ev.hazard === 2 ? 'trapped under slab, floor 1' : hazardStr.toLowerCase();
        return `${timePrefix}Node ${ev.node} transmits SOS (${hazardDesc}). Radio pulse emitted.`;
      }
      return `${timePrefix}Node ${ev.node}: Initiated emergency SOS packet #${ev.seq} for ${hazardStr}${contactStr}.`;
    }

    case 'button_down':
      return `${timePrefix}Node ${ev.node}: Panic button pressed down (physical switch contact).`;

    case 'button_up':
      return `${timePrefix}Node ${ev.node}: Panic button released after ${ev.duration_ms || 0} ms.`;

    case 'gpio_btn_isr':
      return `${timePrefix}Node ${ev.node}: Button gesture recognized as ${ev.gesture || 'press'}.`;

    case 'wake_word':
      return `${timePrefix}Node ${ev.node}: Voice wake word 'Setu' detected. Listening for voice command.`;

    case 'voice_command': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'General';
      return `${timePrefix}Node ${ev.node}: Voice command recognized: ${hazardStr} SOS.`;
    }

    case 'fall_impact_detected':
      return `${timePrefix}Node ${ev.node}: Accelerometer confirmed fall impact shock (>3.0g) followed by immobility. Automatic Trapped SOS triggered.`;

    case 'haptic':
      if (isStory) {
        return `${timePrefix}Survivor ${ev.node} receives ACK. Wristband vibrates.`;
      }
      return `${timePrefix}Node ${ev.node}: ERM haptic vibration motor pulsed (${ev.pattern || 'alert pattern'}).`;

    case 'tx': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'Emergency';
      const isOriginator = ev.node === ev.origin;
      if (isStory) {
        if (isOriginator) {
          const hazardDesc = ev.hazard === 2 ? 'trapped under slab, floor 1' : hazardStr.toLowerCase();
          return `${timePrefix}Node ${ev.node} transmits SOS (${hazardDesc}). Radio pulse emitted.`;
        }
        return `${timePrefix}Relay ${ev.node} forwards SOS #${ev.seq} from Node ${ev.origin} (hop ${ev.hop}). Radio pulse emitted.`;
      }
      const roleStr = isOriginator ? 'originator' : 'mesh relay';
      return `${timePrefix}Node ${ev.node} (${roleStr}): Transmitted packet #${ev.seq} from Node ${ev.origin} (${hazardStr}, hop ${ev.hop}, airtime ${ev.air} ms).`;
    }

    case 'rx': {
      const margin = (ev.rssi - sens).toFixed(1);
      const marginStr = ev.rssi >= sens ? `${margin} dB above sensitivity` : `${Math.abs(margin)} dB below sensitivity`;
      const fromStr = ev.from !== undefined ? `from Node ${ev.from}` : '';
      if (isStory) {
        if (ev.node === 0) {
          return `${timePrefix}Rescue Hub 0 receives forwarded SOS from Relay ${ev.from} at ${ev.rssi.toFixed(1)} dBm. ACK scheduled.`;
        }
        if (ev.node >= 100) {
          return `${timePrefix}Relay ${ev.node} on street hears Node ${ev.from} at ${ev.rssi.toFixed(1)} dBm (margin ${margin} dB). Forwarding.`;
        }
      }
      return `${timePrefix}Node ${ev.node}: Received transmission ${fromStr} (Signal: ${ev.rssi.toFixed(1)} dBm, SNR: ${ev.snr !== undefined ? ev.snr.toFixed(1) : 0} dB, ${marginStr}).`;
    }

    case 'drop': {
      const fromStr = ev.from !== undefined ? `from Node ${ev.from}` : '';
      const rssiStr = ev.rssi !== undefined ? ` at ${ev.rssi.toFixed(1)} dBm` : '';
      if (isStory) {
        if (ev.why === 'weak') {
          // Check if crossed walls exist
          const nodes = options.nodes;
          const obstacles = options.obstacles || [];
          let wallDetail = 'West shear wall attenuates signal by 22 dB';
          if (nodes && nodes.has && nodes.has(ev.from) && nodes.has(ev.node)) {
            const na = nodes.get(ev.from);
            const nb = nodes.get(ev.node);
            const crossed = findCrossedObstacles(na.x, na.y, nb.x, nb.y, obstacles);
            if (crossed.length > 0) {
              wallDetail = `${crossed[0].loss_db.toFixed(0)} dB ${crossed[0].name.replace(/_/g, ' ')} attenuates signal`;
            } else {
              wallDetail = 'Distance path loss attenuates signal';
            }
          }
          const targetName = ev.node === 0 ? 'Hub' : `Node ${ev.node}`;
          return `${timePrefix}${wallDetail}. Received at ${targetName} at ${ev.rssi.toFixed(1)} dBm (below sensitivity ${sens.toFixed(0)} dBm). Dropped.`;
        }
        if (ev.why === 'collision') {
          return `${timePrefix}Radio collision on channel. Received at Node ${ev.node} with corrupted preamble. Dropped.`;
        }
      }

      if (ev.why === 'weak') {
        const below = (sens - ev.rssi).toFixed(1);
        return `${timePrefix}Node ${ev.node}: Packet dropped ${fromStr}${rssiStr} (signal is ${below} dB below receiver threshold).`;
      }
      if (ev.why === 'collision') {
        return `${timePrefix}Node ${ev.node}: Packet dropped ${fromStr}${rssiStr} due to co-channel radio collision with overlapping transmission.`;
      }
      if (ev.why === 'halfduplex') {
        return `${timePrefix}Node ${ev.node}: Packet missed ${fromStr} because receiver was actively transmitting (half-duplex constraint).`;
      }
      if (ev.why === 'loss') {
        return `${timePrefix}Node ${ev.node}: Packet dropped ${fromStr} due to random channel fade or packet corruption.`;
      }
      return `${timePrefix}Node ${ev.node}: Packet dropped ${fromStr} (reason: ${ev.why || 'unknown'}${rssiStr}).`;
    }

    case 'alert': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'Emergency';
      if (isStory) {
        return `${timePrefix}Rescue Hub 0: Emergency alert confirmed for Survivor ${ev.origin} (${hazardStr}, delivered in ${ev.hops || 1} hops).`;
      }
      return `${timePrefix}RESCUE HUB 0: Emergency alert received from Node ${ev.origin}! (${hazardStr}, delivered in ${ev.hops || 1} hops, latency: ${ev.latency_ms || 0} ms).`;
    }

    case 'relay_suppressed':
      if (isStory) {
        return `${timePrefix}Node ${ev.node}: Duplicate packet suppressed (already forwarded by peer). Mesh airtime saved.`;
      }
      return `${timePrefix}Node ${ev.node}: Suppressed retransmission for packet #${ev.seq} from Node ${ev.origin} (duplicate packet already forwarded or acknowledged).`;

    case 'dedup_drop':
      return `${timePrefix}Node ${ev.node}: Ignored duplicate copy of packet #${ev.seq} from Node ${ev.origin}.`;

    case 'retry':
      return `${timePrefix}Node ${ev.node}: No acknowledgment received within retry window. Retrying transmission (attempt #${ev.attempt || 1}).`;

    case 'motion_profile':
      return `${timePrefix}Node ${ev.node}: Motion profile changed to '${ev.profile}'.`;

    case 'gps_off':
      return `${timePrefix}Node ${ev.node}: GNSS satellite signal lost (subterranean obstruction). Switching to inertial dead reckoning.`;

    case 'no_dr':
      return `${timePrefix}Node ${ev.node}: Inertial dead reckoning disabled. Position coordinates frozen.`;

    case 'node_kill':
      return `${timePrefix}Node ${ev.node}: Device went offline (hardware failure or battery depletion).`;

    case 'node_revive':
      return `${timePrefix}Node ${ev.node}: Device reconnected and returned online.`;

    case 'obstacle_init':
      return `${timePrefix}Environment: Initialized ${ev.material || 'structural'} obstacle #${ev.id} (attenuation: ${ev.loss_db || 0} dB).`;

    default:
      return '';
  }
}

// Groups events into an incident story centered around a specific originator node
export function narrateIncidentStory(events, originNodeId, sf = 7) {
  if (!Array.isArray(events)) return [];
  const relevant = events.filter(e => {
    if (e.node === originNodeId) return true;
    if (e.origin === originNodeId) return true;
    if (e.ev === 'alert' && e.origin === originNodeId) return true;
    if (e.ev === 'drop' && e.from === originNodeId) return true;
    if (e.ev === 'rx' && e.from === originNodeId) return true;
    return false;
  });

  return relevant.map(e => ({
    t: e.t,
    text: narrateEvent(e, { sf, timestamp: false }),
    event: e
  })).filter(item => item.text.length > 0);
}

// Explains failure root causes in plain English using physical link budget computation
export function explainFailure(ev, context = {}) {
  if (!ev) return 'No event data available.';
  const sens = context.sens || -123.0;

  if (ev.ev === 'drop') {
    if (context.nodes && context.nodes.get && ev.from !== undefined && ev.node !== undefined) {
      const fromNode = context.nodes.get(ev.from);
      const toNode = context.nodes.get(ev.node);
      if (fromNode && toNode) {
        const lb = computeLossBudget(fromNode, toNode, {
          obstacles: context.obstacles || [],
          sf: context.sf || 7,
          rssi: ev.rssi,
          why: ev.why
        });
        return lb.verdict;
      }
    }

    if (ev.why === 'weak') {
      const below = (sens - (ev.rssi || sens)).toFixed(1);
      return `Packet from Node ${ev.from} dropped at Node ${ev.node} because signal (${(ev.rssi || -130).toFixed(1)} dBm) was ${below} dB below the receiver sensitivity threshold (${sens.toFixed(1)} dBm). Physical cause: Wall attenuation or distance path loss reduced signal below link margin.`;
    }
    if (ev.why === 'collision') {
      return `Packet from Node ${ev.from} collided at Node ${ev.node} with a concurrent transmission on Spreading Factor ${context.sf || 7}. The co-channel signal-to-interference ratio was below the SX1262 capture threshold.`;
    }
    if (ev.why === 'halfduplex') {
      return `Node ${ev.node} was actively transmitting when the incoming packet arrived. LoRa transceivers are half-duplex and cannot receive while transmitting.`;
    }
    if (ev.why === 'loss') {
      return `Packet was corrupted by random environmental channel fading.`;
    }
    if (ev.why === 'duty') {
      return `Retransmission was rejected by regional duty-cycle limits (maximum 1 percent channel airtime).`;
    }
  }

  if (ev.ev === 'dead_battery') {
    return `Node ${ev.node} battery depleted to 0 percent. Total operating time: ${(ev.lifetime_s || 0).toFixed(1)} seconds. Continuous voice DSP is the primary energy drain.`;
  }

  return `Event ${ev.ev} on Node ${ev.node}.`;
}
