// Project Setu - SOS Injection & Survivor Alert Console

export class SosConsoleComponent {
  constructor(containerElement, simulationEngine, onTriggerCallback) {
    this.container = containerElement;
    this.sim = simulationEngine;
    this.onTrigger = onTriggerCallback;

    this.selectedSurvivorId = 1;
    this.init();

    this.sim.subscribe((engine, type) => {
      if (type === 'load') {
        this.populateSurvivors();
      }
      this.renderAlerts();
    });
  }

  init() {
    this.container.innerHTML = `
      <div class="panel-title">
        <span>Operator SOS Injection Console</span>
        <span class="badge" id="sosCountBadge">0 Alerts</span>
      </div>

      <div class="sos-console-panel">
        <div class="node-select-row">
          <label style="font-size: 11px; color: var(--text-dim); min-width: 80px;">Target Node:</label>
          <select class="select-input" id="sosSurvivorSelect">
            <option value="1">Node 1 (Survivor)</option>
          </select>
        </div>

        <div class="sos-trigger-grid">
          <button class="sos-trigger-btn general" id="btnShortPress">
            <span class="trigger-title">Short Press</span>
            <span class="trigger-desc">General SOS Alert</span>
          </button>
          <button class="sos-trigger-btn medical" id="btnDoublePress">
            <span class="trigger-title">Double Press</span>
            <span class="trigger-desc">Medical Emergency</span>
          </button>
          <button class="sos-trigger-btn trapped" id="btnLongPress">
            <span class="trigger-title">Long Press</span>
            <span class="trigger-desc">Trapped / Structural</span>
          </button>
          <button class="sos-trigger-btn voice" id="btnVoiceCommand">
            <span class="trigger-title">Voice "Setu"</span>
            <span class="trigger-desc">Wake-Word Command</span>
          </button>
        </div>
      </div>

      <div style="margin-top: 14px;">
        <div class="panel-title">
          <span>Active SOS Feed</span>
        </div>
        <div id="sosAlertsList" style="display:flex; flex-direction:column; gap:6px; max-height: 220px; overflow-y:auto;">
          <div style="padding: 10px; text-align:center; color: var(--text-dim); font-size:11px;">No active alerts recorded yet.</div>
        </div>
      </div>
    `;

    const select = this.container.querySelector('#sosSurvivorSelect');
    select.addEventListener('change', e => {
      this.selectedSurvivorId = parseInt(e.target.value, 10);
    });

    this.container.querySelector('#btnShortPress').addEventListener('click', () => {
      this.triggerAlert('short');
    });

    this.container.querySelector('#btnDoublePress').addEventListener('click', () => {
      this.triggerAlert('double');
    });

    this.container.querySelector('#btnLongPress').addEventListener('click', () => {
      this.triggerAlert('long');
    });

    this.container.querySelector('#btnVoiceCommand').addEventListener('click', () => {
      this.triggerAlert('voice-medical');
    });
  }

  populateSurvivors() {
    const select = this.container.querySelector('#sosSurvivorSelect');
    if (!select) return;

    const survivors = [];
    for (const [, n] of this.sim.nodes) {
      if (n.role === 'survivor') survivors.push(n);
    }

    if (survivors.length === 0) {
      select.innerHTML = `<option value="1">Node 1 (Survivor)</option>`;
      return;
    }

    select.innerHTML = survivors.map(s => `
      <option value="${s.id}">Node ${s.id} (Survivor - ${s.battery}% batt)</option>
    `).join('');

    this.selectedSurvivorId = survivors[0].id;
  }

  triggerAlert(kind) {
    if (this.onTrigger) {
      this.onTrigger({
        node: this.selectedSurvivorId,
        kind,
        t: Math.round(this.sim.currentTime)
      });
    }
  }

  renderAlerts() {
    const badge = this.container.querySelector('#sosCountBadge');
    const list = this.container.querySelector('#sosAlertsList');
    if (!badge || !list) return;

    badge.textContent = `${this.sim.alerts.length} Delivered`;

    if (this.sim.alerts.length === 0) {
      list.innerHTML = `<div style="padding: 10px; text-align:center; color: var(--text-dim); font-size:11px;">No active alerts recorded yet.</div>`;
      return;
    }

    list.innerHTML = this.sim.alerts.map(a => {
      const hazardNames = ['General SOS', 'Medical Emergency', 'Trapped / Structural'];
      const hazardName = hazardNames[a.hazard] || 'Emergency';
      const posSource = (a.flags & 1) ? 'GNSS' : (a.flags & 4) ? 'Dead-Reckoning' : 'Unknown';

      return `
        <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-left:3px solid #ef4444; border-radius:var(--radius-sm); padding:6px 8px; font-size:11px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
            <span style="font-weight:700; color:#fff;">Survivor Node ${a.origin}</span>
            <span style="color:var(--text-dim); font-family:var(--font-mono);">${(a.t / 1000).toFixed(2)}s</span>
          </div>
          <div style="color:#ef4444; font-weight:600; font-size:10px;">${hazardName}</div>
          <div style="display:flex; justify-content:space-between; color:var(--text-muted); font-size:9px; margin-top:3px; font-family:var(--font-mono);">
            <span>Pos: ${posSource}</span>
            <span>Hops: ${a.hops}</span>
            <span style="color:#10b981;">HUB ACK CONFIRMED</span>
          </div>
        </div>
      `;
    }).join('');
  }
}
