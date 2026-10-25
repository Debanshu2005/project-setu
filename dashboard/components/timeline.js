// Project Setu - Chronological Event Timeline & Explainability Inspector Component

export class TimelineComponent {
  constructor(containerElement, simulationEngine, topologyVisualizer) {
    this.container = containerElement;
    this.sim = simulationEngine;
    this.topo = topologyVisualizer;

    this.filterType = 'all';
    this.searchQuery = '';
    this.selectedEvent = null;
    this.customEventSet = null;
    this.customFilterLabel = null;

    this.init();
    this.sim.subscribe((engine, type) => {
      if (type === 'load' || type === 'seek' || type === 'tick') {
        this.updateActiveEntry();
      }
    });
  }

  init() {
    this.container.innerHTML = `
      <div class="timeline-search-row">
        <input type="text" class="search-input" id="timelineSearch" placeholder="Search events, nodes, drops, voice..." />
        <select class="select-input" id="timelineFilter" style="width: 110px;">
          <option value="all">All Events</option>
          <option value="alert">Alerts</option>
          <option value="tx">Transmissions</option>
          <option value="rx">Deliveries</option>
          <option value="drop">Drops & Loss</option>
          <option value="voice">Voice & Wake</option>
          <option value="battery">Battery</option>
          <option value="protocol">Protocol</option>
          <option value="fault">Faults</option>
        </select>
      </div>

      <!-- Custom Analytics Filter Banner -->
      <div id="customFilterBanner" style="display:none; margin-bottom:8px; padding:6px 10px; background:rgba(56,189,248,0.12); border:1px solid #38bdf8; border-radius:var(--radius-sm); font-size:11px; justify-content:space-between; align-items:center;">
        <span>Filter: <strong id="lblCustomFilter" style="color:#38bdf8;"></strong></span>
        <button id="btnClearCustomFilter" class="btn" style="padding:2px 8px; font-size:10px; background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fca5a5;">Clear</button>
      </div>

      <!-- Event Explainability Inspector Card -->
      <div id="eventDetailsCard" style="display:none; margin-bottom:10px; background:var(--bg-surface); border:1px solid var(--cyan-main); border-radius:var(--radius-sm); padding:10px; font-size:11px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="badge" id="eventDetailBadge" style="background:rgba(56,189,248,0.2); border:1px solid #38bdf8; color:#7dd3fc; font-weight:700;">EVENT</span>
            <span style="font-weight:700; color:#fff;" id="eventDetailTitle">Event Explainability</span>
          </div>
          <button id="btnCloseEventDetail" class="btn" style="padding:2px 6px; font-size:10px;">&times; Close</button>
        </div>
        <div id="eventDetailExplanation" style="color:#e2e8f0; font-size:11px; margin-bottom:8px; line-height:1.4;"></div>
        <div id="eventDetailMeta" style="font-family:var(--font-mono); font-size:10px; color:var(--text-dim); background:rgba(0,0,0,0.25); padding:6px; border-radius:4px;"></div>
      </div>

      <div class="timeline-list" id="timelineList"></div>
    `;

    const searchInput = this.container.querySelector('#timelineSearch');
    const filterSelect = this.container.querySelector('#timelineFilter');
    const btnCloseDetail = this.container.querySelector('#btnCloseEventDetail');
    const btnClearFilter = this.container.querySelector('#btnClearCustomFilter');

    searchInput.addEventListener('input', e => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    filterSelect.addEventListener('change', e => {
      this.filterType = e.target.value;
      this.render();
    });

    if (btnCloseDetail) {
      btnCloseDetail.addEventListener('click', () => {
        this.selectedEvent = null;
        const card = this.container.querySelector('#eventDetailsCard');
        if (card) card.style.display = 'none';
      });
    }

    if (btnClearFilter) {
      btnClearFilter.addEventListener('click', () => {
        this.clearCustomFilter();
      });
    }
  }

  filterByCustomEvents(events, label) {
    this.customEventSet = new Set(events);
    this.customFilterLabel = label;
    const banner = this.container.querySelector('#customFilterBanner');
    const lbl = this.container.querySelector('#lblCustomFilter');
    if (banner && lbl) {
      lbl.textContent = `${label} (${events.length} event${events.length === 1 ? '' : 's'})`;
      banner.style.display = 'flex';
    }
    this.render();

    // Select and explain first matching event
    if (events && events.length > 0) {
      this.selectedEvent = events[0];
      this.renderEventDetailCard(events[0]);
    }
  }

  clearCustomFilter() {
    this.customEventSet = null;
    this.customFilterLabel = null;
    const banner = this.container.querySelector('#customFilterBanner');
    if (banner) banner.style.display = 'none';
    this.render();
  }

  setEvents() {
    this.render();
  }

  render() {
    const listEl = this.container.querySelector('#timelineList');
    if (!listEl) return;

    const filtered = this.sim.events.filter(ev => {
      if (['meta', 'node_init', 'link_init'].includes(ev.ev)) return false;

      // Custom event filter from charts or node inspection
      if (this.customEventSet && !this.customEventSet.has(ev)) return false;

      // Filter by category
      if (this.filterType === 'alert' && ev.ev !== 'alert') return false;
      if (this.filterType === 'tx' && ev.ev !== 'tx') return false;
      if (this.filterType === 'rx' && ev.ev !== 'rx') return false;
      if (this.filterType === 'drop' && ev.ev !== 'drop') return false;
      if (this.filterType === 'voice' && !['wake_word', 'voice_command'].includes(ev.ev)) return false;
      if (this.filterType === 'battery' && !['battery', 'battery_depleted'].includes(ev.ev)) return false;
      if (this.filterType === 'protocol' && !['dedup_drop', 'relay_suppressed', 'duty_blocked', 'ttl_drop', 'retry', 'gave_up', 'originate', 'ack_rx'].includes(ev.ev)) return false;
      if (this.filterType === 'fault' && !['node_kill', 'node_revive', 'gps_off', 'gps_on', 'dr_off', 'dr_on', 'link_block', 'link_unblock'].includes(ev.ev)) return false;

      // Text search
      if (this.searchQuery) {
        const str = JSON.stringify(ev).toLowerCase();
        if (!str.includes(this.searchQuery)) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 11px;">No events match filter.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((ev, idx) => {
      const tagClass = this.getTagClass(ev.ev);
      const tagName = this.getTagName(ev.ev);
      const detail = this.formatEventDetail(ev);
      const isPast = ev.t <= this.sim.currentTime;
      const isSelected = this.selectedEvent === ev;

      return `
        <div class="timeline-entry ${isPast ? 'past' : ''} ${isSelected ? 'active' : ''}" data-idx="${idx}" data-t="${ev.t}" data-node="${ev.node || ''}">
          <span class="timeline-time">${(ev.t / 1000).toFixed(2)}s</span>
          <span class="timeline-tag ${tagClass}">${tagName}</span>
          <span class="timeline-info">${detail}</span>
        </div>
      `;
    }).join('');

    // Attach click listeners to explain and seek
    listEl.querySelectorAll('.timeline-entry').forEach((entry, idx) => {
      entry.addEventListener('click', () => {
        const ev = filtered[idx];
        if (!ev) return;

        this.selectedEvent = ev;
        this.renderEventDetailCard(ev);

        const t = parseFloat(entry.dataset.t);
        const node = parseInt(entry.dataset.node, 10);
        this.sim.seek(t);
        if (!isNaN(node)) {
          this.topo.selectedNodeId = node;
          const targetNode = this.sim.nodes.get(node);
          if (targetNode && this.topo.onNodeSelect) {
            this.topo.onNodeSelect(targetNode);
          }
        }
      });
    });

    this.updateActiveEntry();
  }

  renderEventDetailCard(ev) {
    const card = this.container.querySelector('#eventDetailsCard');
    const badge = this.container.querySelector('#eventDetailBadge');
    const title = this.container.querySelector('#eventDetailTitle');
    const explanation = this.container.querySelector('#eventDetailExplanation');
    const meta = this.container.querySelector('#eventDetailMeta');

    if (!card || !badge || !title || !explanation || !meta) return;

    card.style.display = 'block';
    badge.textContent = this.getTagName(ev.ev);
    badge.className = `badge ${this.getTagClass(ev.ev)}`;
    title.textContent = `Event at ${(ev.t / 1000).toFixed(3)}s (t=${ev.t}ms)`;

    const causal = this.generateCausalExplanation(ev);
    explanation.innerHTML = causal;

    const copyObj = { ...ev };
    meta.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span><strong>Type:</strong> ${ev.ev}</span>
        <span><strong>Node:</strong> ${ev.node !== undefined ? ev.node : 'N/A'}</span>
      </div>
      <pre style="margin:0; white-space:pre-wrap; max-height:100px; overflow-y:auto;">${JSON.stringify(copyObj, null, 2)}</pre>
    `;
  }

  generateCausalExplanation(ev) {
    switch (ev.ev) {
      case 'tx':
        return `
          <strong>Transmission Initiated:</strong> Node <strong>${ev.node}</strong> transmitted a 25-byte ${ev.ack ? '<span style="color:#10b981;">HUB ACK</span>' : '<span style="color:#ef4444;">SURVIVOR SOS</span>'} packet (Seq #${ev.seq || 0}, hop ${ev.hop || 0}) over LoRa RF.<br/>
          <span style="color:var(--text-muted);">Airtime: ${ev.air || 62}ms. Battery consumed: 0.5%. Transceiver drew 120mA during TX.</span>
        `;
      case 'rx':
        return `
          <strong>Packet Successfully Delivered:</strong> Node <strong>${ev.node}</strong> received RF transmission from Node <strong>${ev.from}</strong>.<br/>
          <span style="color:#10b981;">Signal strength: ${ev.rssi} dBm (RSSI exceeds -120 dBm sensitivity threshold). Payload CRC valid.</span>
        `;
      case 'drop': {
        let reasonDesc = `Loss reason: ${ev.why}`;
        if (ev.why === 'weak') {
          reasonDesc = `<span style="color:#ef4444;">Weak Signal:</span> Received RSSI dropped below SX1262 sensitivity limit (-120 dBm) due to log-distance RF attenuation.`;
        } else if (ev.why === 'collision') {
          reasonDesc = `<span style="color:#ef4444;">RF Collision:</span> Packet collided in the air with another concurrent LoRa transmission on the same spreading factor (SF7).`;
        } else if (ev.why === 'halfduplex') {
          reasonDesc = `<span style="color:#ef4444;">Half-Duplex Conflict:</span> Receiver node was actively transmitting its own packet when this RF wavefront arrived.`;
        } else if (ev.why === 'blocked') {
          reasonDesc = `<span style="color:#ef4444;">Link Impairment:</span> Operator manually blocked the RF channel between these nodes.`;
        } else if (ev.why === 'battery' || ev.why === 'depleted') {
          reasonDesc = `<span style="color:#ef4444;">Battery Depleted:</span> Node ran out of energy and could not power its radio receiver.`;
        }
        return `
          <strong>Packet Dropped:</strong> Packet from Node <strong>${ev.from}</strong> could not be received by Node <strong>${ev.node || ev.to}</strong>.<br/>
          ${reasonDesc}
        `;
      }
      case 'alert':
        return `
          <strong>Rescue Alert Confirmed:</strong> Rescue Command Hub accepted emergency message originating from Survivor Node <strong>${ev.origin}</strong>.<br/>
          <span style="color:#10b981;">Hops traversed: ${ev.hops || 1}. Emergency classification: ${ev.hazard === 1 ? 'Medical' : ev.hazard === 2 ? 'Trapped' : 'General SOS'}. Hub transmitted immediate confirmation ACK.</span>
        `;
      case 'wake_word':
        return `
          <strong>Simulated Wake-Word Detected:</strong> ESP-SR speech recognition frontend detected wake phrase <strong>"${ev.phrase || 'Setu'}"</strong> on Survivor Node <strong>${ev.node}</strong>.<br/>
          <span style="color:#38bdf8;">Device transitioned from sleep to listening state. Ready for spoken command.</span>
        `;
      case 'voice_command':
        return `
          <strong>Spoken Intent Recognized:</strong> ESP-SR MultiNet grammar engine parsed phrase <strong>"${ev.phrase || 'Emergency'}"</strong> on Survivor Node <strong>${ev.node}</strong>.<br/>
          <span style="color:#ec4899;">Mapped hazard: ${ev.hazard_name || 'Emergency'}. Queued to FreeRTOS ISR queue for immediate LoRa RF transmission.</span>
        `;
      case 'battery':
        return `
          <strong>Battery Level Changed:</strong> Node <strong>${ev.node}</strong> battery level updated to <strong>${ev.battery}%</strong>.<br/>
          <span style="color:#f59e0b;">Reason: ${ev.reason || 'Simulation update / energy consumption'}.</span>
        `;
      case 'battery_depleted':
        return `
          <strong>Battery Depleted (0%):</strong> Node <strong>${ev.node}</strong> battery exhausted.<br/>
          <span style="color:#ef4444;">Transceiver and microcontroller powered down. Node will no longer transmit or relay packets until recharged.</span>
        `;
      case 'dedup_drop':
        return `
          <strong>Duplicate Suppressed:</strong> Node <strong>${ev.node}</strong> received duplicate SOS from Node <strong>${ev.origin}</strong> (Seq #${ev.seq}).<br/>
          <span style="color:#f59e0b;">Suppressed by dedup filter to prevent broadcast storms.</span>
        `;
      case 'relay_suppressed':
        return `
          <strong>Relay Rebroadcast Suppressed:</strong> Node <strong>${ev.node}</strong> cancelled forwarding.<br/>
          <span style="color:#f59e0b;">Heuristic observed neighbor relay already forwarded packet with sufficient SNR. Conserves channel airtime.</span>
        `;
      case 'node_kill':
        return `
          <strong>Hardware Failure Simulated:</strong> Node <strong>${ev.node}</strong> powered off by operator command. Node is offline.
        `;
      case 'node_revive':
        return `
          <strong>Hardware Restored:</strong> Node <strong>${ev.node}</strong> powered back online. Radio transceiver re-initialized.
        `;
      case 'link_block':
        return `
          <strong>RF Link Blocked:</strong> Communication link between Node <strong>${ev.node}</strong> and Node <strong>${ev.to}</strong> severed by operator.
        `;
      default:
        return `<strong>${ev.ev.toUpperCase()}:</strong> Node ${ev.node || ''} ${JSON.stringify(ev)}`;
    }
  }

  updateActiveEntry() {
    const listEl = this.container.querySelector('#timelineList');
    if (!listEl) return;

    const entries = listEl.querySelectorAll('.timeline-entry');
    let lastActive = null;

    entries.forEach(entry => {
      const t = parseFloat(entry.dataset.t);
      if (t <= this.sim.currentTime) {
        entry.classList.add('past');
        lastActive = entry;
      } else {
        entry.classList.remove('past');
      }
    });
  }

  getTagClass(ev) {
    switch (ev) {
      case 'tx': return 'tag-tx';
      case 'rx': return 'tag-rx';
      case 'drop': return 'tag-drop';
      case 'alert': return 'tag-alert';
      case 'haptic': return 'tag-haptic';
      case 'wake_word':
      case 'voice_command': return 'tag-voice';
      case 'battery':
      case 'battery_depleted': return 'tag-battery';
      case 'node_kill':
      case 'node_revive':
      case 'gps_off':
      case 'link_block': return 'tag-fault';
      default: return 'tag-protocol';
    }
  }

  getTagName(ev) {
    switch (ev) {
      case 'tx': return 'TX';
      case 'rx': return 'RX';
      case 'drop': return 'DROP';
      case 'alert': return 'ALERT';
      case 'haptic': return 'HAPTIC';
      case 'dedup_drop': return 'DEDUP';
      case 'relay_suppressed': return 'SUPPR';
      case 'ttl_drop': return 'TTL';
      case 'duty_blocked': return 'DUTY';
      case 'retry': return 'RETRY';
      case 'gave_up': return 'EXHAUST';
      case 'node_kill': return 'KILL';
      case 'node_revive': return 'REVIVE';
      case 'gps_off': return 'NO-GPS';
      case 'link_block': return 'BLOCK';
      case 'button_down': return 'BTN-DN';
      case 'button_up': return 'BTN-UP';
      case 'wake_word': return 'WAKE';
      case 'voice_command': return 'VOICE';
      case 'battery': return 'BATT';
      case 'battery_depleted': return 'EMPTY';
      default: return ev.toUpperCase();
    }
  }

  formatEventDetail(ev) {
    switch (ev.ev) {
      case 'tx':
        return `Node ${ev.node} TX #${ev.seq} [${ev.ack ? 'ACK' : 'SOS'}] hop=${ev.hop} air=${ev.air}ms`;
      case 'rx':
        return `Node ${ev.node} received from ${ev.from} (RSSI: ${ev.rssi} dBm)`;
      case 'drop':
        return `Node ${ev.node} dropped packet from ${ev.from} (Reason: ${ev.why})`;
      case 'alert':
        return `Rescue Hub accepted SOS from ${ev.origin} (hops: ${ev.hops}, hazard: ${ev.hazard})`;
      case 'wake_word':
        return `Node ${ev.node} wake-word "${ev.phrase || 'Setu'}" recognized`;
      case 'voice_command':
        return `Node ${ev.node} voice cmd "${ev.phrase || 'emergency'}" -> ${ev.hazard_name || 'Emergency'}`;
      case 'battery':
        return `Node ${ev.node} battery ${ev.battery}% (${ev.reason || 'drain'})`;
      case 'battery_depleted':
        return `Node ${ev.node} battery depleted (0%) - Radio offline`;
      case 'haptic':
        return `Node ${ev.node} haptic confirmation pattern ${ev.pattern}`;
      case 'dedup_drop':
        return `Node ${ev.node} suppressed duplicate SOS from ${ev.origin} #${ev.seq}`;
      case 'relay_suppressed':
        return `Node ${ev.node} skipped rebroadcast (neighbour density covered)`;
      case 'duty_blocked':
        return `Node ${ev.node} duty-cycle budget exhausted (1% limit)`;
      case 'ttl_drop':
        return `Node ${ev.node} dropped packet: hop limit exceeded (${ev.hop})`;
      case 'retry':
        return `Node ${ev.node} retry attempt #${ev.attempt}`;
      case 'node_kill':
        return `Node ${ev.node} power severed / destroyed`;
      case 'node_revive':
        return `Node ${ev.node} brought back online`;
      case 'gps_off':
        return `Node ${ev.node} GNSS lost: switching to IMU dead-reckoning`;
      case 'link_block':
        return `Radio link blocked between ${ev.node} and ${ev.to}`;
      default:
        return `Node ${ev.node || ''} ${JSON.stringify(ev)}`;
    }
  }
}
