// Project Setu - Chronological Event Timeline Component

export class TimelineComponent {
  constructor(containerElement, simulationEngine, topologyVisualizer) {
    this.container = containerElement;
    this.sim = simulationEngine;
    this.topo = topologyVisualizer;

    this.filterType = 'all';
    this.searchQuery = '';
    this.activeEntryIndex = -1;

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
        <input type="text" class="search-input" id="timelineSearch" placeholder="Search events, nodes, origins..." />
        <select class="select-input" id="timelineFilter" style="width: 100px;">
          <option value="all">All Events</option>
          <option value="alert">Alerts</option>
          <option value="tx">Transmissions</option>
          <option value="rx">Deliveries</option>
          <option value="drop">Drops</option>
          <option value="haptic">Haptics</option>
          <option value="protocol">Protocol</option>
          <option value="fault">Faults</option>
        </select>
      </div>
      <div class="timeline-list" id="timelineList"></div>
    `;

    const searchInput = this.container.querySelector('#timelineSearch');
    const filterSelect = this.container.querySelector('#timelineFilter');

    searchInput.addEventListener('input', e => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    filterSelect.addEventListener('change', e => {
      this.filterType = e.target.value;
      this.render();
    });
  }

  setEvents() {
    this.render();
  }

  render() {
    const listEl = this.container.querySelector('#timelineList');
    if (!listEl) return;

    const filtered = this.sim.events.filter(ev => {
      if (['meta', 'node_init', 'link_init'].includes(ev.ev)) return false;

      // Filter by category
      if (this.filterType === 'alert' && ev.ev !== 'alert') return false;
      if (this.filterType === 'tx' && ev.ev !== 'tx') return false;
      if (this.filterType === 'rx' && ev.ev !== 'rx') return false;
      if (this.filterType === 'drop' && ev.ev !== 'drop') return false;
      if (this.filterType === 'haptic' && ev.ev !== 'haptic') return false;
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

      return `
        <div class="timeline-entry ${isPast ? 'past' : ''}" data-t="${ev.t}" data-node="${ev.node || ''}">
          <span class="timeline-time">${(ev.t / 1000).toFixed(2)}s</span>
          <span class="timeline-tag ${tagClass}">${tagName}</span>
          <span class="timeline-info">${detail}</span>
        </div>
      `;
    }).join('');

    // Attach click listeners to seek and highlight
    listEl.querySelectorAll('.timeline-entry').forEach(entry => {
      entry.addEventListener('click', () => {
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
        entry.classList.remove('active');
      }
    });

    if (lastActive) {
      entries.forEach(e => e.classList.remove('active'));
      lastActive.classList.add('active');
    }
  }

  getTagClass(ev) {
    switch (ev) {
      case 'tx': return 'tag-tx';
      case 'rx': return 'tag-rx';
      case 'drop': return 'tag-drop';
      case 'alert': return 'tag-alert';
      case 'haptic': return 'tag-haptic';
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
      case 'haptic':
        return `Node ${ev.node} haptic pattern ${ev.pattern}`;
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
