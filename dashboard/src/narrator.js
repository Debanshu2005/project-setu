// Project Setu: Plain English Event Narrator
// Translates raw simulator trace events into natural, plain English sentences
// and provides failure explanations from C++ RF engine loss budget telemetry.
// Ground Rules:
// 1. Single source of physics is C++ RF engine. No physics re-implementation in JS.
// 2. Writing rule: No em dashes, no double dashes. Plain, direct sentences.

export const HAZARD_NAMES = {
  0: 'General Emergency',
  1: 'Medical Emergency',
  2: 'Trapped Under Debris'
};

export const SENSITIVITY_BY_SF = {
  7: -123.0,
  8: -126.0,
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

// Formats plain English failure verdict directly from engine loss budget telemetry
export function formatFailureVerdict(lb) {
  if (!lb || typeof lb !== 'object') return 'No loss budget data available.';

  const isViable = Boolean(lb.viable);
  const margin = typeof lb.link_margin_db === 'number' ? lb.link_margin_db : 0.0;
  const sens = typeof lb.sensitivity_dbm === 'number' ? lb.sensitivity_dbm : -123.0;
  const dist = typeof lb.distance_m === 'number'
    ? lb.distance_m
    : (typeof lb.dist === 'number' ? lb.dist : 0.0);
  const distStr = `${dist.toFixed(1)} m`;

  if (isViable) {
    return `Link is viable with +${margin.toFixed(1)} dB margin above receiver sensitivity (${sens.toFixed(1)} dBm).`;
  }

  // Non-RF physical drop causes
  if (lb.why === 'collision') {
    return 'Dropped because co-channel radio collision with an overlapping transmission corrupted the frame.';
  }
  if (lb.why === 'halfduplex') {
    const toStr = lb.to !== undefined ? `Node ${lb.to}` : 'receiver';
    return `Dropped because ${toStr} was actively transmitting when the signal arrived (half-duplex constraint).`;
  }
  if (lb.why === 'loss') {
    return 'Packet was corrupted by random environmental channel fading.';
  }
  if (lb.why === 'duty') {
    return 'Retransmission was rejected by regional duty-cycle limits (maximum 1 percent channel airtime).';
  }
  if (lb.obstacle_loss === 'blocked link') {
    return `Dropped because link between Node ${lb.from} and Node ${lb.to} is administratively blocked.`;
  }

  const pathLoss = typeof lb.path_loss_db === 'number' ? Math.abs(lb.path_loss_db) : 0.0;
  const extraLoss = typeof lb.extra_loss_db === 'number' ? Math.abs(lb.extra_loss_db) : 15.0;
  const crossedObstacles = Array.isArray(lb.crossed_obstacles)
    ? lb.crossed_obstacles
    : (Array.isArray(lb.crossedWalls) ? lb.crossedWalls : []);

  let totalObstacleLoss = 0.0;
  if (crossedObstacles.length > 0) {
    for (const obs of crossedObstacles) {
      totalObstacleLoss += obs.loss_db;
    }
  } else if (typeof lb.obstacle_loss_db === 'number') {
    totalObstacleLoss = lb.obstacle_loss_db;
  }

  const deficit = margin <= 0 ? margin.toFixed(1) : '-' + margin.toFixed(1);

  if (totalObstacleLoss > pathLoss && totalObstacleLoss > extraLoss && crossedObstacles.length > 0) {
    const wallSummary = crossedObstacles.map(w => `${w.loss_db.toFixed(1)} dB ${w.name}`).join(' and ');
    return `Dropped with a ${deficit} dB margin deficit below receiver sensitivity (${sens.toFixed(1)} dBm). The largest loss contributor is obstacle attenuation (-${totalObstacleLoss.toFixed(1)} dB across ${wallSummary}), with distance path loss (-${pathLoss.toFixed(1)} dB at ${distStr}).`;
  }

  if (crossedObstacles.length > 0) {
    const wallSummary = crossedObstacles.map(w => `${w.loss_db.toFixed(1)} dB ${w.name}`).join(' and ');
    return `Dropped with a ${deficit} dB margin deficit below receiver sensitivity (${sens.toFixed(1)} dBm). The largest loss contributor is distance path loss (-${pathLoss.toFixed(1)} dB at ${distStr}), with obstacle attenuation (-${totalObstacleLoss.toFixed(1)} dB from ${wallSummary}) and fixed extra loss (-${extraLoss.toFixed(1)} dB).`;
  }

  return `Dropped with a ${deficit} dB margin deficit below receiver sensitivity (${sens.toFixed(1)} dBm). The largest loss contributor is distance path loss (-${pathLoss.toFixed(1)} dB at ${distStr}), with fixed extra loss (-${extraLoss.toFixed(1)} dB).`;
}

// Formats a single trace event into a plain English sentence
export function narrateEvent(ev, options = {}) {
  if (!ev || typeof ev !== 'object') return '';

  const showTimestamp = options.timestamp !== false;
  const timePrefix = showTimestamp && ev.t !== undefined ? `${formatTimestamp(ev.t)} ` : '';
  const isStory = options.story === true;
  const sf = options.sf || 7;
  const sens = SENSITIVITY_BY_SF[sf] || -123.0;

  switch (ev.ev) {
    case 'originate': {
      const hz = ev.hazard !== undefined ? ev.hazard : 0;
      const hzName = HAZARD_NAMES[hz] || 'Emergency';
      if (isStory) {
        if (hz === 2) {
          return `${timePrefix}Node ${ev.node} transmits SOS (trapped under debris, seq #${ev.seq || 1}). Radio pulse emitted.`;
        }
        if (hz === 1) {
          return `${timePrefix}Node ${ev.node} transmits SOS (medical emergency, seq #${ev.seq || 1}). Radio pulse emitted.`;
        }
        return `${timePrefix}Node ${ev.node} transmits SOS (general alert, seq #${ev.seq || 1}). Radio pulse emitted.`;
      }
      const contactStr = ev.contact ? ` (Contact: #${ev.contact})` : '';
      return `${timePrefix}Node ${ev.node}: Initiated emergency SOS packet #${ev.seq || 1} for ${hzName}${contactStr}.`;
    }

    case 'button_down':
      return `${timePrefix}Node ${ev.node}: Panic button pressed down (physical switch contact).`;

    case 'button_up':
      return `${timePrefix}Node ${ev.node}: Panic button released after ${ev.duration_ms || 0} ms.`;

    case 'wake_word':
      return `${timePrefix}Node ${ev.node}: Voice wake word 'Setu' detected. Listening for voice command.`;

    case 'voice_command': {
      const hzName = HAZARD_NAMES[ev.hazard] || ev.hazard_name || 'Medical Emergency';
      return `${timePrefix}Node ${ev.node}: Voice command recognized: ${hzName} SOS.`;
    }

    case 'fall_impact_detected':
      return `${timePrefix}Node ${ev.node}: Accelerometer confirmed fall impact shock (>3.0g) followed by immobility. Automatic Trapped SOS triggered.`;

    case 'motion': {
      const prof = (ev.profile || 'motion').replace(/_/g, ' ');
      if (prof.includes('fall') || ev.profile === 'fall_impact') {
        return `${timePrefix}Node ${ev.node}: Accelerometer confirmed fall impact shock (>3.0g) followed by immobility. Automatic Trapped SOS triggered.`;
      }
      return `${timePrefix}Node ${ev.node}: Motion profile changed to ${prof}.`;
    }

    case 'tx': {
      const isOriginator = ev.origin === ev.node;
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'Alert';
      if (isStory) {
        if (isOriginator) {
          return `${timePrefix}Node ${ev.node} broadcasts SOS #${ev.seq}. Radio pulse propagating across disaster site.`;
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
          return `${timePrefix}Rescue Hub 0 receives forwarded SOS from Node ${ev.from} at ${ev.rssi.toFixed(1)} dBm. ACK scheduled.`;
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
      const targetName = ev.node === 0 ? 'Hub 0' : `Node ${ev.node}`;

      if (isStory) {
        if (ev.why === 'weak') {
          return `${timePrefix}West shear wall attenuates signal. Dropped at ${targetName}${rssiStr} (signal below sensitivity).`;
        }
        if (ev.why === 'collision') {
          return `${timePrefix}Radio collision on channel. Received at Node ${ev.node} with corrupted preamble. Dropped.`;
        }
        if (ev.why === 'halfduplex') {
          return `${timePrefix}Receiver ${targetName} was actively transmitting when signal arrived. Dropped.`;
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
      if (ev.why === 'duty') {
        return `${timePrefix}Node ${ev.node}: Packet dropped ${fromStr} due to regional duty cycle restriction.`;
      }
      return `${timePrefix}Node ${ev.node}: Packet dropped ${fromStr} (cause: ${ev.why || 'unknown'}).`;
    }

    case 'alert': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'Emergency';
      const hops = ev.hops !== undefined ? ev.hops : 1;
      const latMs = ev.latency_ms !== undefined ? `${ev.latency_ms} ms` : 'unknown latency';
      if (isStory) {
        return `${timePrefix}Incident Command Hub alerted! Survivor ${ev.origin} SOS successfully confirmed in ${hops} hops (${latMs}). Rescuers dispatched.`;
      }
      return `${timePrefix}RESCUE HUB 0: Emergency alert received from Node ${ev.origin}! (${hazardStr}, delivered in ${hops} hops, latency: ${latMs}).`;
    }

    case 'ack': {
      if (isStory) {
        return `${timePrefix}Survivor Node ${ev.node} received ACK confirmation from Hub. Wristband haptic buzzer activated. Survivor knows help is coming.`;
      }
      return `${timePrefix}Node ${ev.node}: Two-way ACK confirmed delivery of emergency message #${ev.seq || 1} to Incident Command Hub.`;
    }

    case 'haptic': {
      if (isStory) {
        return `${timePrefix}Survivor ${ev.node} receives ACK. Wristband vibrates.`;
      }
      const patterns = ['short pulse (150ms)', 'success double buzz (two-way ACK)', 'continuous SOS vibration'];
      const pat = patterns[ev.pattern] || 'haptic buzz';
      return `${timePrefix}Node ${ev.node}: Wristband ERM haptic motor activated (${pat}).`;
    }

    case 'relay_suppressed':
      return `${timePrefix}Relay ${ev.node}: Transmission suppressed (message #${ev.seq} from Node ${ev.origin} already covered by nearby nodes). Mesh airtime saved.`;

    case 'dead_battery':
      return `${timePrefix}Node ${ev.node}: Battery depleted to 0 percent. Operating lifetime: ${(ev.lifetime_s || 0).toFixed(1)} seconds.`;

    case 'node_kill':
      return `${timePrefix}Node ${ev.node}: Offline (fault injection or hardware failure).`;

    case 'node_revive':
      return `${timePrefix}Node ${ev.node}: Reconnected to network.`;

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

// Explains failure root causes in plain English using engine telemetry
export function explainFailure(ev, context = {}) {
  if (!ev) return 'No event data available.';

  if (context.lossBudget) {
    return formatFailureVerdict(context.lossBudget);
  }
  if (ev.loss_budget) {
    return formatFailureVerdict(ev.loss_budget);
  }

  const sens = typeof context.sens === 'number' ? context.sens : -123.0;

  if (ev.ev === 'drop') {
    if (ev.why === 'weak') {
      const below = (sens - (ev.rssi || sens)).toFixed(1);
      return `Packet from Node ${ev.from} dropped at Node ${ev.node} because signal (${(ev.rssi || -130).toFixed(1)} dBm) was ${below} dB below the receiver sensitivity threshold (${sens.toFixed(1)} dBm).`;
    }
    if (ev.why === 'collision') {
      return `Packet from Node ${ev.from} collided at Node ${ev.node} with a concurrent transmission on Spreading Factor ${context.sf || 7}. The co-channel signal-to-interference ratio was below the SX1262 capture threshold.`;
    }
    if (ev.why === 'halfduplex') {
      return `Node ${ev.node} was actively transmitting when the incoming packet arrived. LoRa transceivers are half-duplex and cannot receive while transmitting.`;
    }
    if (ev.why === 'loss') {
      return 'Packet was corrupted by random environmental channel fading.';
    }
    if (ev.why === 'duty') {
      return 'Retransmission was rejected by regional duty-cycle limits (maximum 1 percent channel airtime).';
    }
  }

  if (ev.ev === 'dead_battery') {
    return `Node ${ev.node} battery depleted to 0 percent. Total operating time: ${(ev.lifetime_s || 0).toFixed(1)} seconds. Continuous voice DSP is the primary energy drain.`;
  }

  return `Event ${ev.ev} on Node ${ev.node}.`;
}
