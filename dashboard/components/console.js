// Project Setu - Unified Operator Command & SOS Injection Console

export class SosConsoleComponent {
  constructor(containerElement, simulationEngine, onCommandCallback) {
    this.container = containerElement;
    this.sim = simulationEngine;
    this.onCommand = onCommandCallback; // (cmdObj) => Promise<any>

    this.selectedNodeId = 1;
    this.isDispatching = false;
    this.lastFeedback = null; // { cmd, node, status, message, t, ok }

    this.init();

    this.sim.subscribe((engine, type) => {
      if (type === 'load' || type === 'sync') {
        this.populateNodes();
      }
      this.renderAlerts();
      this.updateNodeInfoDisplay();
    });
  }

  init() {
    this.container.innerHTML = `
      <div class="panel-title" style="display:flex; justify-content:space-between; align-items:center;">
        <span>Operator Command Console</span>
        <span class="badge" id="sosCountBadge">0 Alerts</span>
      </div>

      <div class="sos-console-panel" style="display:flex; flex-direction:column; gap:10px;">
        <!-- Target Node Selector -->
        <div class="node-select-row" style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:11px; color:var(--text-dim); min-width:76px; font-weight:600;">Target Node:</label>
          <select class="select-input" id="sosTargetSelect" style="flex:1;">
            <option value="1">Node 1 (Survivor)</option>
          </select>
        </div>

        <!-- Target Summary Pill -->
        <div id="targetSummaryPill" style="font-size:10px; font-family:var(--font-mono); color:var(--text-muted); background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:4px 8px; display:flex; justify-content:space-between;">
          <span>Status: <strong id="lblTargetStatus" style="color:#10b981;">ONLINE</strong></span>
          <span>Batt: <strong id="lblTargetBatt" style="color:#38bdf8;">100%</strong></span>
          <span>Role: <strong id="lblTargetRole" style="color:#f59e0b;">SURVIVOR</strong></span>
        </div>

        <!-- Section 1: Emergency & Voice Triggers -->
        <div>
          <div style="font-size:10px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">
            🚨 Emergency & Voice SOS Triggers
          </div>
          <div class="sos-trigger-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="sos-trigger-btn general" id="btnShortPress" title="Trigger button short press: General SOS">
              <span class="trigger-title">🚨 Short Press</span>
              <span class="trigger-desc">General SOS Alert</span>
            </button>
            <button class="sos-trigger-btn medical" id="btnDoublePress" title="Trigger button double press: Medical Emergency">
              <span class="trigger-title">🩺 Double Press</span>
              <span class="trigger-desc">Medical Emergency</span>
            </button>
            <button class="sos-trigger-btn trapped" id="btnLongPress" title="Trigger button long press: Trapped / Structural">
              <span class="trigger-title">🏚️ Long Press</span>
              <span class="trigger-desc">Trapped Survivor</span>
            </button>
            <button class="sos-trigger-btn voice" id="btnWakeWord" title="Simulate ESP-SR wake-word detection: 'Setu'">
              <span class="trigger-title">🎙️ Wake "Setu"</span>
              <span class="trigger-desc">Wake-Word Detection</span>
            </button>
            <button class="sos-trigger-btn voice" id="btnVoiceMedical" style="border-color:#10b981; background:rgba(16,185,129,0.12);" title="Simulate voice command: 'Setu, I need a doctor'">
              <span class="trigger-title" style="color:#34d399;">🗣️ Voice: Medical</span>
              <span class="trigger-desc">Intent: Medical</span>
            </button>
            <button class="sos-trigger-btn voice" id="btnVoiceTrapped" style="border-color:#ec4899; background:rgba(236,72,153,0.12);" title="Simulate voice command: 'Setu, trapped under debris'">
              <span class="trigger-title" style="color:#f472b6;">🗣️ Voice: Trapped</span>
              <span class="trigger-desc">Intent: Structural</span>
            </button>
          </div>
        </div>

        <!-- Section 2: Hardware Telemetry & Fault Injections -->
        <div>
          <div style="font-size:10px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">
            ⚡ Hardware & Fault Injection
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
            <button class="btn" id="btnTogglePower" style="font-size:10px; padding:5px 6px; background:rgba(239,68,68,0.15); border:1px solid #ef4444; color:#fca5a5;">
              ⚡ Kill / Revive Node
            </button>
            <button class="btn" id="btnToggleGnss" style="font-size:10px; padding:5px 6px; background:rgba(245,158,11,0.15); border:1px solid #f59e0b; color:#fcd34d;">
              🛰️ Toggle GNSS Fix
            </button>
            <button class="btn" id="btnToggleDr" style="font-size:10px; padding:5px 6px; background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc;">
              🧭 Toggle IMU (DR)
            </button>
            <button class="btn" id="btnTriggerAllSurv" style="font-size:10px; padding:5px 6px; background:rgba(168,85,247,0.15); border:1px solid #a855f7; color:#d8b4fe;">
              🌊 Broadcast Wave
            </button>
          </div>

          <!-- Battery Configuration Row -->
          <div style="display:flex; align-items:center; gap:6px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:5px 8px;">
            <span style="font-size:10px; color:var(--text-muted); min-width:55px;">Battery:</span>
            <input type="range" id="consoleBattSlider" min="0" max="100" value="100" style="flex:1; cursor:pointer;" />
            <span id="lblConsoleBattVal" style="font-size:11px; font-family:var(--font-mono); font-weight:700; color:#38bdf8; min-width:32px;">100%</span>
            <button class="btn btn-primary" id="btnApplyBatt" style="font-size:10px; padding:3px 8px;">Apply</button>
          </div>
        </div>

        <!-- Section 3: RF Link Impairments -->
        <div>
          <div style="font-size:10px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px;">
            📡 RF Link Impairment
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <select class="select-input" id="selPeerNode" style="flex:1; font-size:10px;">
              <option value="">Select Peer Node...</option>
            </select>
            <button class="btn" id="btnBlockPeerLink" style="font-size:10px; padding:4px 8px; background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fca5a5;">
              Block Link
            </button>
            <button class="btn" id="btnRestorePeerLink" style="font-size:10px; padding:4px 8px; background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#34d399;">
              Restore
            </button>
          </div>
        </div>

        <!-- Command Execution Feedback Card -->
        <div id="commandFeedbackCard" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:8px; font-size:11px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-weight:700; color:#94a3b8; font-size:10px;">LAST COMMAND FEEDBACK</span>
            <span class="badge" id="feedbackBadge" style="background:rgba(148,163,184,0.15); border:1px solid #64748b; color:#94a3b8;">IDLE</span>
          </div>
          <div id="feedbackDetail" style="color:var(--text-dim); font-size:10px; font-family:var(--font-mono);">
            Select a target node and command to execute.
          </div>
        </div>
      </div>

      <!-- Active SOS Feed -->
      <div style="margin-top:14px;">
        <div class="panel-title">
          <span>Authoritative SOS Delivery Feed</span>
        </div>
        <div id="sosAlertsList" style="display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto;">
          <div style="padding:10px; text-align:center; color:var(--text-dim); font-size:11px;">No active alerts recorded yet.</div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.populateNodes();
  }

  bindEvents() {
    const select = this.container.querySelector('#sosTargetSelect');
    select.addEventListener('change', e => {
      this.selectedNodeId = parseInt(e.target.value, 10);
      this.updateNodeInfoDisplay();
      this.populatePeerNodes();
    });

    // Triggers
    this.container.querySelector('#btnShortPress').addEventListener('click', () => this.dispatchTrigger('short'));
    this.container.querySelector('#btnDoublePress').addEventListener('click', () => this.dispatchTrigger('double'));
    this.container.querySelector('#btnLongPress').addEventListener('click', () => this.dispatchTrigger('long'));
    this.container.querySelector('#btnWakeWord').addEventListener('click', () => this.dispatchTrigger('voice'));
    this.container.querySelector('#btnVoiceMedical').addEventListener('click', () => this.dispatchTrigger('voice-medical'));
    this.container.querySelector('#btnVoiceTrapped').addEventListener('click', () => this.dispatchTrigger('voice-trapped'));

    // Hardware Controls
    this.container.querySelector('#btnTogglePower').addEventListener('click', () => this.togglePower());
    this.container.querySelector('#btnToggleGnss').addEventListener('click', () => this.toggleGnss());
    this.container.querySelector('#btnToggleDr').addEventListener('click', () => this.toggleDr());
    this.container.querySelector('#btnTriggerAllSurv').addEventListener('click', () => {
      const btnAll = document.getElementById('btnOpenTriggerAllModal');
      if (btnAll) btnAll.click();
    });

    // Battery Controls
    const slider = this.container.querySelector('#consoleBattSlider');
    const lblVal = this.container.querySelector('#lblConsoleBattVal');
    const btnApply = this.container.querySelector('#btnApplyBatt');

    slider.addEventListener('input', e => {
      lblVal.textContent = `${e.target.value}%`;
    });

    btnApply.addEventListener('click', () => {
      const val = parseInt(slider.value, 10);
      this.applyBattery(val);
    });

    // Link Impairment
    this.container.querySelector('#btnBlockPeerLink').addEventListener('click', () => this.setLinkBlock(true));
    this.container.querySelector('#btnRestorePeerLink').addEventListener('click', () => this.setLinkBlock(false));
  }

  setDispatching(busy) {
    this.isDispatching = busy;
    const buttons = this.container.querySelectorAll('button:not(#btnApplyBatt)');
    buttons.forEach(b => {
      if (busy) {
        b.style.pointerEvents = 'none';
        b.style.opacity = '0.6';
      } else {
        b.style.pointerEvents = 'auto';
        b.style.opacity = '1.0';
      }
    });
  }

  showFeedback(status, message, ok = true) {
    const badge = this.container.querySelector('#feedbackBadge');
    const detail = this.container.querySelector('#feedbackDetail');
    if (!badge || !detail) return;

    badge.textContent = status.toUpperCase();
    if (status === 'executing' || status === 'pending') {
      badge.style.background = 'rgba(56,189,248,0.2)';
      badge.style.border = '1px solid #38bdf8';
      badge.style.color = '#38bdf8';
    } else if (ok) {
      badge.style.background = 'rgba(16,185,129,0.2)';
      badge.style.border = '1px solid #10b981';
      badge.style.color = '#34d399';
    } else {
      badge.style.background = 'rgba(239,68,68,0.2)';
      badge.style.border = '1px solid #ef4444';
      badge.style.color = '#f87171';
    }
    detail.textContent = message;
  }

  async dispatchTrigger(kind) {
    if (this.isDispatching) return;
    const node = this.sim.nodes.get(this.selectedNodeId);
    if (!node) {
      this.showFeedback('rejected', `Node ${this.selectedNodeId} does not exist in simulation`, false);
      return;
    }
    if (!node.online) {
      this.showFeedback('rejected', `Node ${this.selectedNodeId} is OFFLINE / Depleted (cannot transmit)`, false);
      return;
    }

    this.setDispatching(true);
    this.showFeedback('pending', `Dispatching ${kind.toUpperCase()} to Node ${this.selectedNodeId}...`);

    try {
      if (this.onCommand) {
        await this.onCommand({
          type: 'trigger',
          nodeId: this.selectedNodeId,
          kind
        });
      }
      this.showFeedback('executed', `Trigger ${kind.toUpperCase()} accepted for Node ${this.selectedNodeId}. RF transmission sequenced.`);
    } catch (err) {
      this.showFeedback('failed', `Execution error: ${err.message}`, false);
    } finally {
      this.setDispatching(false);
      this.updateNodeInfoDisplay();
    }
  }

  async togglePower() {
    if (this.isDispatching) return;
    const node = this.sim.nodes.get(this.selectedNodeId);
    if (!node) return;
    const newOnline = !node.online;

    this.setDispatching(true);
    this.showFeedback('pending', `${newOnline ? 'Restoring' : 'Killing'} Node ${this.selectedNodeId}...`);

    try {
      if (this.onCommand) {
        await this.onCommand({
          type: 'state',
          nodeId: this.selectedNodeId,
          update: { online: newOnline }
        });
      }
      this.showFeedback('executed', `Node ${this.selectedNodeId} is now ${newOnline ? 'ONLINE' : 'OFFLINE (SEVERED)'}.`);
    } catch (err) {
      this.showFeedback('failed', `Power change error: ${err.message}`, false);
    } finally {
      this.setDispatching(false);
      this.updateNodeInfoDisplay();
    }
  }

  async toggleGnss() {
    if (this.isDispatching) return;
    const node = this.sim.nodes.get(this.selectedNodeId);
    if (!node) return;
    const newGnss = !(node.gnss_on !== undefined ? node.gnss_on : true);

    this.setDispatching(true);
    this.showFeedback('pending', `${newGnss ? 'Enabling' : 'Disabling'} GNSS on Node ${this.selectedNodeId}...`);

    try {
      if (this.onCommand) {
        await this.onCommand({
          type: 'state',
          nodeId: this.selectedNodeId,
          update: { gnss_on: newGnss }
        });
      }
      this.showFeedback('executed', `Node ${this.selectedNodeId} GNSS receiver is now ${newGnss ? 'ACTIVE' : 'DISABLED (FALLBACK TO IMU)'}.`);
    } catch (err) {
      this.showFeedback('failed', `GNSS change error: ${err.message}`, false);
    } finally {
      this.setDispatching(false);
      this.updateNodeInfoDisplay();
    }
  }

  async toggleDr() {
    if (this.isDispatching) return;
    const node = this.sim.nodes.get(this.selectedNodeId);
    if (!node) return;
    const newDr = !(node.dr_on !== undefined ? node.dr_on : true);

    this.setDispatching(true);
    this.showFeedback('pending', `${newDr ? 'Enabling' : 'Disabling'} Dead-Reckoning on Node ${this.selectedNodeId}...`);

    try {
      if (this.onCommand) {
        await this.onCommand({
          type: 'state',
          nodeId: this.selectedNodeId,
          update: { dr_on: newDr }
        });
      }
      this.showFeedback('executed', `Node ${this.selectedNodeId} Dead-Reckoning is now ${newDr ? 'ACTIVE' : 'DISABLED'}.`);
    } catch (err) {
      this.showFeedback('failed', `DR change error: ${err.message}`, false);
    } finally {
      this.setDispatching(false);
      this.updateNodeInfoDisplay();
    }
  }

  async applyBattery(pct) {
    if (this.isDispatching) return;
    if (isNaN(pct) || pct < 0 || pct > 100) {
      this.showFeedback('rejected', `Battery value ${pct}% is invalid (must be 0-100)`, false);
      return;
    }

    this.setDispatching(true);
    this.showFeedback('pending', `Setting Node ${this.selectedNodeId} battery to ${pct}%...`);

    try {
      if (this.onCommand) {
        await this.onCommand({
          type: 'state',
          nodeId: this.selectedNodeId,
          update: { battery: pct }
        });
      }
      this.showFeedback('executed', `Node ${this.selectedNodeId} battery configured to ${pct}%. Authoritative C++ state updated.`);
    } catch (err) {
      this.showFeedback('failed', `Battery set error: ${err.message}`, false);
    } finally {
      this.setDispatching(false);
      this.updateNodeInfoDisplay();
    }
  }

  async setLinkBlock(blocked) {
    if (this.isDispatching) return;
    const selPeer = this.container.querySelector('#selPeerNode');
    const peerId = parseInt(selPeer.value, 10);
    if (isNaN(peerId)) {
      this.showFeedback('rejected', 'Select a peer node to block/restore link', false);
      return;
    }

    this.setDispatching(true);
    this.showFeedback('pending', `${blocked ? 'Blocking' : 'Restoring'} link between Node ${this.selectedNodeId} and Node ${peerId}...`);

    try {
      if (this.onCommand) {
        await this.onCommand({
          type: 'link',
          a: this.selectedNodeId,
          b: peerId,
          blocked
        });
      }
      this.showFeedback('executed', `Link between Node ${this.selectedNodeId} and Node ${peerId} is now ${blocked ? 'BLOCKED (DISCONNECTED)' : 'RESTORED'}.`);
    } catch (err) {
      this.showFeedback('failed', `Link operation error: ${err.message}`, false);
    } finally {
      this.setDispatching(false);
      this.populatePeerNodes();
    }
  }

  populateNodes() {
    const select = this.container.querySelector('#sosTargetSelect');
    if (!select) return;

    if (this.sim.nodes.size === 0) {
      select.innerHTML = `<option value="1">Node 1 (Default)</option>`;
      return;
    }

    const survivors = [];
    const relays = [];
    const hubs = [];

    for (const [, n] of this.sim.nodes) {
      if (n.role === 'hub') hubs.push(n);
      else if (n.role === 'relay') relays.push(n);
      else survivors.push(n);
    }

    let html = '';
    if (survivors.length > 0) {
      html += `<optgroup label="Survivors">` +
        survivors.map(n => `<option value="${n.id}">Node ${n.id} (Survivor - ${n.battery !== undefined ? n.battery : 100}% batt)</option>`).join('') +
        `</optgroup>`;
    }
    if (relays.length > 0) {
      html += `<optgroup label="Relay Towers">` +
        relays.map(n => `<option value="${n.id}">Node ${n.id} (Relay Tower - ${n.battery !== undefined ? n.battery : 100}% batt)</option>`).join('') +
        `</optgroup>`;
    }
    if (hubs.length > 0) {
      html += `<optgroup label="Rescue Hubs">` +
        hubs.map(n => `<option value="${n.id}">Node ${n.id} (Hub Command Center)</option>`).join('') +
        `</optgroup>`;
    }

    select.innerHTML = html;
    if (this.sim.nodes.has(this.selectedNodeId)) {
      select.value = String(this.selectedNodeId);
    } else if (survivors.length > 0) {
      this.selectedNodeId = survivors[0].id;
      select.value = String(this.selectedNodeId);
    }

    this.updateNodeInfoDisplay();
    this.populatePeerNodes();
  }

  populatePeerNodes() {
    const selPeer = this.container.querySelector('#selPeerNode');
    if (!selPeer) return;

    const peers = [];
    for (const [, n] of this.sim.nodes) {
      if (n.id !== this.selectedNodeId) {
        peers.push(n);
      }
    }

    if (peers.length === 0) {
      selPeer.innerHTML = `<option value="">No peer nodes</option>`;
      return;
    }

    // Check link status
    selPeer.innerHTML = peers.map(p => {
      const link = (this.sim.links || []).find(l => (l.a === this.selectedNodeId && l.b === p.id) || (l.b === this.selectedNodeId && l.a === p.id));
      const status = link ? (link.blocked ? ' [BLOCKED]' : ' [ACTIVE]') : '';
      return `<option value="${p.id}">Node ${p.id} (${p.role.toUpperCase()})${status}</option>`;
    }).join('');
  }

  updateNodeInfoDisplay() {
    const node = this.sim.nodes.get(this.selectedNodeId);
    if (!node) return;

    const lblStatus = this.container.querySelector('#lblTargetStatus');
    const lblBatt = this.container.querySelector('#lblTargetBatt');
    const lblRole = this.container.querySelector('#lblTargetRole');
    const slider = this.container.querySelector('#consoleBattSlider');
    const lblSlider = this.container.querySelector('#lblConsoleBattVal');

    if (lblStatus) {
      lblStatus.textContent = !node.online ? 'OFFLINE (FAILED)' : node.active_sos ? 'SOS ACTIVE' : 'ONLINE';
      lblStatus.style.color = !node.online ? '#ef4444' : node.active_sos ? '#f59e0b' : '#10b981';
    }
    if (lblBatt) {
      lblBatt.textContent = `${node.battery !== undefined ? node.battery : 100}%`;
    }
    if (lblRole) {
      lblRole.textContent = (node.role || 'survivor').toUpperCase();
    }
    if (slider && !this.isDispatching) {
      slider.value = node.battery !== undefined ? node.battery : 100;
      if (lblSlider) lblSlider.textContent = `${slider.value}%`;
    }
  }

  renderAlerts() {
    const badge = this.container.querySelector('#sosCountBadge');
    const list = this.container.querySelector('#sosAlertsList');
    if (!badge || !list) return;

    badge.textContent = `${this.sim.alerts.length} Delivered`;

    if (this.sim.alerts.length === 0) {
      list.innerHTML = `<div style="padding:10px; text-align:center; color:var(--text-dim); font-size:11px;">No active alerts recorded yet.</div>`;
      return;
    }

    list.innerHTML = this.sim.alerts.map(a => {
      const hazardNames = ['General SOS', 'Medical Emergency', 'Trapped / Structural'];
      const hazardName = hazardNames[a.hazard] || 'Emergency Alert';
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
            <span>Hops: ${a.hops || 1}</span>
            <span style="color:#10b981; font-weight:700;">HUB ACK CONFIRMED</span>
          </div>
        </div>
      `;
    }).join('');
  }
}
