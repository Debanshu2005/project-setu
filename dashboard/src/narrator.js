// Project Setu: Plain English Event Narrator
// Pure functions that translate raw simulator trace events into natural, plain English sentences
// for non-technical emergency coordinators and disaster response personnel.

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

// Formats a single trace event into a plain English sentence
export function narrateEvent(ev, options = {}) {
  if (!ev || typeof ev !== 'object') return '';
  const currentSf = options.sf || 7;
  const sens = SENSITIVITY_BY_SF[currentSf] || -123.0;

  switch (ev.ev) {
    case 'originate': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || `Hazard ${ev.hazard}`;
      const contactStr = ev.contact ? ` (Contact: #${ev.contact})` : '';
      return `Node ${ev.node}: Initiated emergency SOS packet #${ev.seq} for ${hazardStr}${contactStr}.`;
    }

    case 'button_down':
      return `Node ${ev.node}: Panic button pressed down (physical switch contact).`;

    case 'button_up':
      return `Node ${ev.node}: Panic button released after ${ev.duration_ms || 0} ms.`;

    case 'gpio_btn_isr':
      return `Node ${ev.node}: Button gesture recognized as ${ev.gesture || 'press'}.`;

    case 'wake_word':
      return `Node ${ev.node}: Voice wake word 'Setu' detected. Listening for voice command.`;

    case 'voice_command': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'General';
      return `Node ${ev.node}: Voice command recognized: ${hazardStr} SOS.`;
    }

    case 'fall_impact_detected':
      return `Node ${ev.node}: Accelerometer confirmed fall impact shock (>3.0g) followed by immobility. Automatic Trapped SOS triggered.`;

    case 'haptic':
      return `Node ${ev.node}: ERM haptic vibration motor pulsed (${ev.pattern || 'alert pattern'}).`;

    case 'tx': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'Emergency';
      const roleStr = ev.node === ev.origin ? 'originator' : 'mesh relay';
      return `Node ${ev.node} (${roleStr}): Transmitted packet #${ev.seq} from Node ${ev.origin} (${hazardStr}, hop ${ev.hop}, airtime ${ev.air} ms).`;
    }

    case 'rx': {
      const margin = (ev.rssi - sens).toFixed(1);
      const marginStr = ev.rssi >= sens ? `${margin} dB above sensitivity` : `${Math.abs(margin)} dB below sensitivity`;
      const fromStr = ev.from !== undefined ? `from Node ${ev.from}` : '';
      return `Node ${ev.node}: Received transmission ${fromStr} (Signal: ${ev.rssi.toFixed(1)} dBm, SNR: ${ev.snr !== undefined ? ev.snr.toFixed(1) : 0} dB, ${marginStr}).`;
    }

    case 'drop': {
      const fromStr = ev.from !== undefined ? `from Node ${ev.from}` : '';
      const rssiStr = ev.rssi !== undefined ? ` at ${ev.rssi.toFixed(1)} dBm` : '';
      if (ev.why === 'weak') {
        const below = (sens - ev.rssi).toFixed(1);
        return `Node ${ev.node}: Packet dropped ${fromStr}${rssiStr} (signal is ${below} dB below receiver threshold).`;
      }
      if (ev.why === 'collision') {
        return `Node ${ev.node}: Packet dropped ${fromStr}${rssiStr} due to co-channel radio collision with overlapping transmission.`;
      }
      if (ev.why === 'halfduplex') {
        return `Node ${ev.node}: Packet missed ${fromStr} because receiver was actively transmitting (half-duplex constraint).`;
      }
      if (ev.why === 'loss') {
        return `Node ${ev.node}: Packet dropped ${fromStr} due to random channel fade or packet corruption.`;
      }
      return `Node ${ev.node}: Packet dropped ${fromStr} (reason: ${ev.why || 'unknown'}${rssiStr}).`;
    }

    case 'alert': {
      const hazardStr = HAZARD_NAMES[ev.hazard] || 'Emergency';
      return `RESCUE HUB 0: Emergency alert received from Node ${ev.origin}! (${hazardStr}, delivered in ${ev.hops || 1} hops, latency: ${ev.latency_ms || 0} ms).`;
    }

    case 'relay_suppressed':
      return `Node ${ev.node}: Suppressed retransmission for packet #${ev.seq} from Node ${ev.origin} (duplicate packet already forwarded or acknowledged).`;

    case 'dedup_drop':
      return `Node ${ev.node}: Ignored duplicate copy of packet #${ev.seq} from Node ${ev.origin}.`;

    case 'retry':
      return `Node ${ev.node}: No acknowledgment received within retry window. Retrying transmission (attempt #${ev.attempt || 1}).`;

    case 'motion_profile':
      return `Node ${ev.node}: Motion profile changed to '${ev.profile}'.`;

    case 'gps_off':
      return `Node ${ev.node}: GNSS satellite signal lost (subterranean obstruction). Switching to inertial dead reckoning.`;

    case 'no_dr':
      return `Node ${ev.node}: Inertial dead reckoning disabled. Position coordinates frozen.`;

    case 'node_kill':
      return `Node ${ev.node}: Device went offline (hardware failure or battery depletion).`;

    case 'node_revive':
      return `Node ${ev.node}: Device reconnected and returned online.`;

    case 'obstacle_init':
      return `Environment: Initialized ${ev.material || 'structural'} obstacle #${ev.id} (attenuation: ${ev.loss_db || 0} dB).`;

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
    text: narrateEvent(e, { sf }),
    event: e
  })).filter(item => item.text.length > 0);
}

// Explains failure root causes in plain English without raw hex or jargon
export function explainFailure(ev, context = {}) {
  if (!ev) return 'No event data available.';
  const sens = context.sens || -123.0;

  if (ev.ev === 'drop') {
    if (ev.why === 'weak') {
      const below = (sens - (ev.rssi || sens)).toFixed(1);
      return `Packet from Node ${ev.from} dropped at Node ${ev.node} because signal (${(ev.rssi || -130).toFixed(1)} dBm) was ${below} dB below the receiver sensitivity threshold (${sens} dBm). Physical cause: Distance path loss or concrete structural attenuation extinguished the link margin.`;
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

