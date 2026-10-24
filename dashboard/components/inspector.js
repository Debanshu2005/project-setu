// Project Setu - Deep Node & Packet Inspector Component

import { PacketParser } from '../src/packet_parser.js';

export class InspectorComponent {
  constructor(nodeInspectorContainer, packetInspectorContainer, simulationEngine) {
    this.nodeContainer = nodeInspectorContainer;
    this.packetContainer = packetInspectorContainer;
    this.sim = simulationEngine;
    this.currentNode = null;
    this.currentPacket = null;
    this.onTrigger = null;      // (nodeId, kind) => void
    this.onStateChange = null;  // (nodeId, stateUpdate) => void

    this.sim.subscribe((engine, type) => {
      if (this.currentNode) {
        const fresh = this.sim.nodes.get(this.currentNode.id);
        if (fresh) {
          this.currentNode = fresh;
          this.renderNode();
        }
      } else if (this.sim.nodes.size > 0) {
        const first = this.sim.nodes.get(1) || this.sim.nodes.values().next().value;
        if (first) {
          this.inspectNode(first);
        }
      }
    });

    this.renderNode();
  }

  get selectedNode() {
    return this.currentNode;
  }

  set selectedNode(node) {
    this.inspectNode(node);
  }

  inspectNode(node) {
    this.currentNode = node;
    this.renderNode();
  }

  inspectPacket(packet) {
    this.currentPacket = packet;
    this.renderPacket();
  }

  renderNode() {
    if (!this.currentNode) {
      this.nodeContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 11px;">Select any node on the topology map to inspect state and hardware telemetry.</div>`;
      return;
    }

    const n = this.currentNode;
    const stats = (n && n.stats) || { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 };
    const role = (n && n.role) || 'survivor';
    const roleBadge = role === 'hub' ? 'badge-hub' : role === 'relay' ? 'badge-relay' : 'badge-survivor';
    const statusText = !n.online
      ? 'OFFLINE (FAILED)'
      : n.pending_trigger
      ? 'DISPATCHING SOS...'
      : n.active_sos
      ? 'EMERGENCY ACTIVE'
      : 'ONLINE';
    const statusClass = !n.online ? 'badge-sos' : n.active_sos ? 'badge-sos' : n.pending_trigger ? 'badge-relay' : 'badge-hub';
    const provenanceBadge = this.sim.isLiveEngine
      ? `<span class="badge" style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #34d399; font-weight: 700;">🟢 LIVE C++ TWIN</span>`
      : this.sim.isFallbackDemo
      ? `<span class="badge" style="background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; color: #fcd34d; font-weight: 700;">🟡 OFFLINE DEMO</span>`
      : `<span class="badge" style="background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #7dd3fc; font-weight: 700;">📽️ TRACE REPLAY</span>`;

    const lat = ((n.lat_e6 || 0) / 1e6).toFixed(6);
    const lon = ((n.lon_e6 || 0) / 1e6).toFixed(6);
    const posX = typeof n.x === 'number' ? n.x.toFixed(1) : '0.0';
    const posY = typeof n.y === 'number' ? n.y.toFixed(1) : '0.0';
    const posProv = n.gnss_on ? 'GNSS 3D Satellite Fix' : n.dr_on ? 'Dead-Reckoning (MPU-6050 IMU)' : 'Unknown / Signal Lost';

    let controlsHtml = '';
    if (n.role === 'survivor') {
      controlsHtml = `
        <div class="wire-breakdown-card" style="border: 1px solid rgba(56, 189, 248, 0.35); background: rgba(15, 23, 42, 0.7);">
          <div class="wire-header" style="color: var(--cyan-main); font-weight: 700;">
            <span>Individual SOS Triggers (Node ${n.id})</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
            <button class="btn btn-sos-trigger" data-kind="short" style="font-size: 10px; padding: 6px 4px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #fca5a5;">
              🚨 Short Press (General)
            </button>
            <button class="btn btn-sos-trigger" data-kind="double" style="font-size: 10px; padding: 6px 4px; background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; color: #fcd34d;">
              🩺 Double Press (Medical)
            </button>
            <button class="btn btn-sos-trigger" data-kind="long" style="font-size: 10px; padding: 6px 4px; background: rgba(168, 85, 247, 0.2); border: 1px solid #a855f7; color: #d8b4fe;">
              🏚️ Long Press (Trapped)
            </button>
            <button class="btn btn-sos-trigger" data-kind="voice" style="font-size: 10px; padding: 6px 4px; background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #bae6fd;">
              🎙️ Wake-Word ("Setu")
            </button>
            <button class="btn btn-sos-trigger" data-kind="voice-medical" style="font-size: 10px; padding: 6px 4px; background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #a7f3d0;">
              🗣️ Voice: Medical
            </button>
            <button class="btn btn-sos-trigger" data-kind="voice-trapped" style="font-size: 10px; padding: 6px 4px; background: rgba(236, 72, 153, 0.2); border: 1px solid #ec4899; color: #fbcfe8;">
              🗣️ Voice: Trapped
            </button>
          </div>

          <div class="wire-header" style="color: #94a3b8; font-size: 10px; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">
            <span>Hardware Telemetry & Fault Controls</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Node Power State:</span>
              <button id="btnToggleOnline" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.online ? '#ef4444' : '#10b981'}; color: #fff;">
                ${n.online ? 'Simulate Node Failure (Go Offline)' : 'Restore Node (Bring Online)'}
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Battery Level: <strong id="lblBatteryVal">${n.battery}%</strong></span>
              <input type="range" id="sliderBattery" min="0" max="100" value="${n.battery}" style="width: 100px; cursor: pointer;" />
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>GNSS Satellite Receiver:</span>
              <button id="btnToggleGnss" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.gnss_on ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}; border: 1px solid ${n.gnss_on ? '#10b981' : '#ef4444'}; color: ${n.gnss_on ? '#34d399' : '#f87171'};">
                ${n.gnss_on ? 'GNSS Fix Active' : 'GNSS Denied (Lost)'}
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>MPU-6050 Dead-Reckoning:</span>
              <button id="btnToggleDr" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.dr_on ? 'rgba(56, 189, 248, 0.25)' : 'rgba(148, 163, 184, 0.25)'}; border: 1px solid ${n.dr_on ? '#38bdf8' : '#64748b'}; color: ${n.dr_on ? '#38bdf8' : '#94a3b8'};">
                ${n.dr_on ? 'IMU DR Active' : 'IMU DR Disabled'}
              </button>
            </div>
          </div>
        </div>
      `;
    } else {
      // Relay or Hub controls
      controlsHtml = `
        <div class="wire-breakdown-card" style="border: 1px solid rgba(56, 189, 248, 0.35); background: rgba(15, 23, 42, 0.7);">
          <div class="wire-header" style="color: var(--cyan-main); font-weight: 700;">
            <span>${n.role.toUpperCase()} Node Controls (ID ${n.id})</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Radio Tower Status:</span>
              <button id="btnToggleOnline" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.online ? '#ef4444' : '#10b981'}; color: #fff;">
                ${n.online ? 'Disable Tower (Offline)' : 'Enable Tower (Online)'}
              </button>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Backup Battery: <strong id="lblBatteryVal">${n.battery}%</strong></span>
              <input type="range" id="sliderBattery" min="0" max="100" value="${n.battery}" style="width: 100px; cursor: pointer;" />
            </div>
          </div>
        </div>
      `;
    }

    this.nodeContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
        <div style="font-size: 14px; font-weight: 700; color: #fff;">Node ${n.id}</div>
        <div style="display:flex; gap: 6px; align-items: center;">
          ${provenanceBadge}
          <span class="badge ${roleBadge}">${role.toUpperCase()}</span>
          <span class="badge ${statusClass}">${statusText}</span>
        </div>
      </div>

      ${controlsHtml}

      <div class="metrics-grid" style="margin-top: 8px; margin-bottom: 12px;">
        <div class="metric-card">
          <div class="metric-label">Battery Level</div>
          <div class="metric-value">${n.battery !== undefined ? n.battery : 100}<span class="metric-unit">%</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Airtime Used</div>
          <div class="metric-value">${(stats.tx || 0) * 62}<span class="metric-unit">ms</span></div>
        </div>
      </div>

      <div class="wire-breakdown-card">
        <div class="wire-header">
          <span>Geographic Location & Provenance</span>
        </div>
        <table class="field-table">
          <tr><td class="field-name">Coordinates:</td><td class="field-val">${lat}°, ${lon}°</td></tr>
          <tr><td class="field-name">Cartesian:</td><td class="field-val">X: ${posX}m, Y: ${posY}m</td></tr>
          <tr><td class="field-name">Fix Provenance:</td><td class="field-val" style="color:${n.gnss_on ? '#10b981' : '#f59e0b'}">${posProv}</td></tr>
        </table>
      </div>

      <div class="wire-breakdown-card">
        <div class="wire-header">
          <span>Radio & Protocol Telemetry</span>
        </div>
        <table class="field-table">
          <tr><td class="field-name">Originated / Relayed TX:</td><td class="field-val">${stats.tx || 0}</td></tr>
          <tr><td class="field-name">Receptions Delivered:</td><td class="field-val">${stats.rx || 0}</td></tr>
          <tr><td class="field-name">Drops (Loss/Collision):</td><td class="field-val">${stats.drop || 0}</td></tr>
          <tr><td class="field-name">Duplicates Suppressed:</td><td class="field-val">${stats.dedup || 0}</td></tr>
          <tr><td class="field-name">Relay Backoffs Saved:</td><td class="field-val">${stats.suppressed || 0}</td></tr>
          <tr><td class="field-name">Retries Attempted:</td><td class="field-val">${stats.retries || 0}</td></tr>
        </table>
      </div>

      <div class="wire-breakdown-card" style="border-color: rgba(16, 185, 129, 0.4); background: rgba(6, 78, 59, 0.15);">
        <div class="wire-header" style="color: #34d399; font-weight: 700;">
          <span>⚡ FreeRTOS Tasks & Queues (FITL)</span>
        </div>
        <table class="field-table">
          <tr><td class="field-name">Button ISR Queue (Cap 16):</td><td class="field-val"><strong style="color: #38bdf8;">${n.button_q !== undefined ? n.button_q : 0} / 16</strong> ${n.button_q_ovf > 0 ? `<span style="color: #ef4444;">(${n.button_q_ovf} dropped)</span>` : ''}</td></tr>
          <tr><td class="field-name">Radio RX Queue (Cap 8):</td><td class="field-val"><strong style="color: #38bdf8;">${n.radio_q !== undefined ? n.radio_q : 0} / 8</strong> ${n.radio_q_ovf > 0 ? `<span style="color: #ef4444;">(${n.radio_q_ovf} dropped)</span>` : ''}</td></tr>
          <tr><td class="field-name">Firmware State:</td><td class="field-val" style="color:${n.acked ? '#34d399' : n.active ? '#f59e0b' : '#94a3b8'}">${n.acked ? 'ACK_RECEIVED (Confirmed)' : n.active ? 'SOS_TRANSMITTING (Retry Loop)' : 'IDLE / STANDBY'}</td></tr>
          <tr><td class="field-name">Sequence Counter (seq):</td><td class="field-val">${n.seq !== undefined ? n.seq : 0}</td></tr>
          <tr><td class="field-name">Airtime Duty Used:</td><td class="field-val">${n.duty_used_ms !== undefined ? n.duty_used_ms : 0} ms</td></tr>
        </table>
      </div>
    `;

    // Attach Interactive Event Handlers
    this.attachNodeControlEvents(n);
  }

  attachNodeControlEvents(n) {
    // 1. SOS Trigger Buttons
    this.nodeContainer.querySelectorAll('.btn-sos-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.kind;
        if (this.onTrigger) {
          this.onTrigger(n.id, kind);
        }
      });
    });

    // 2. Online / Offline Toggle
    const btnOnline = this.nodeContainer.querySelector('#btnToggleOnline');
    if (btnOnline) {
      btnOnline.addEventListener('click', () => {
        const newOnline = !n.online;
        n.online = newOnline;
        if (this.onStateChange) {
          this.onStateChange(n.id, { online: newOnline });
        }
        this.renderNode();
      });
    }

    // 3. Battery Slider
    const sliderBattery = this.nodeContainer.querySelector('#sliderBattery');
    const lblBattery = this.nodeContainer.querySelector('#lblBatteryVal');
    if (sliderBattery) {
      sliderBattery.addEventListener('input', e => {
        const val = parseInt(e.target.value, 10);
        lblBattery.textContent = `${val}%`;
      });
      sliderBattery.addEventListener('change', e => {
        const val = parseInt(e.target.value, 10);
        n.battery = val;
        if (this.onStateChange) {
          this.onStateChange(n.id, { battery: val });
        }
      });
    }

    // 4. GNSS Toggle
    const btnGnss = this.nodeContainer.querySelector('#btnToggleGnss');
    if (btnGnss) {
      btnGnss.addEventListener('click', () => {
        const newGnss = !n.gnss_on;
        n.gnss_on = newGnss;
        if (this.onStateChange) {
          this.onStateChange(n.id, { gnss_on: newGnss });
        }
        this.renderNode();
      });
    }

    // 5. DR Toggle
    const btnDr = this.nodeContainer.querySelector('#btnToggleDr');
    if (btnDr) {
      btnDr.addEventListener('click', () => {
        const newDr = !n.dr_on;
        n.dr_on = newDr;
        if (this.onStateChange) {
          this.onStateChange(n.id, { dr_on: newDr });
        }
        this.renderNode();
      });
    }
  }

  renderPacket() {
    if (!this.currentPacket) {
      // Find latest transmission if any
      const txEvents = this.sim.events.filter(e => e.ev === 'tx' && e.t <= this.sim.currentTime);
      if (txEvents.length > 0) {
        this.currentPacket = txEvents[txEvents.length - 1];
      } else {
        this.packetContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 11px;">No packets have been transmitted yet. Run a simulation or select a packet event to inspect.</div>`;
        return;
      }
    }

    const rawBytes = PacketParser.fromTraceEvent(this.currentPacket);
    const decoded = PacketParser.decode(rawBytes);
    const hexTokens = PacketParser.getHexTokens(rawBytes);

    const hexHtml = hexTokens.map(tok => `
      <span class="hex-byte ${tok.fieldClass}" title="Offset ${tok.offset}: ${tok.fieldName} (0x${tok.hex})">${tok.hex}</span>
    `).join('');

    this.packetContainer.innerHTML = `
      <div class="wire-breakdown-card">
        <div class="wire-header">
          <span>25-Byte Little-Endian Wire Breakdown</span>
          <span style="color: var(--cyan-main); font-family: var(--font-mono);">200 bits</span>
        </div>
        <div class="hex-stream-container">
          ${hexHtml}
        </div>
        <div style="font-size: 9px; color: var(--text-dim); margin-top: 6px;">Hover over any byte to view field alignment, offset, and bit layout.</div>
      </div>

      <div class="wire-breakdown-card">
        <div class="wire-header">
          <span>Parsed Logical Protocol Fields</span>
          <span class="badge ${decoded.is_ack ? 'badge-hub' : 'badge-sos'}">${decoded.is_ack ? 'HUB ACK' : 'SURVIVOR SOS'}</span>
        </div>
        <table class="field-table">
          <tr><td class="field-name">Origin Node ID:</td><td class="field-val">Node ${decoded.node_id}</td></tr>
          <tr><td class="field-name">Sequence ID:</td><td class="field-val">#${decoded.seq}</td></tr>
          <tr><td class="field-name">Target Node ID:</td><td class="field-val">${decoded.target === 65535 ? '0xFFFF (Broadcast SOS)' : `Node ${decoded.target}`}</td></tr>
          <tr><td class="field-name">Ref Sequence ID:</td><td class="field-val">${decoded.ref_seq ? `#${decoded.ref_seq}` : '0 (N/A)'}</td></tr>
          <tr><td class="field-name">Emergency Hazard:</td><td class="field-val" style="color: #ef4444; font-weight: 700;">${decoded.hazardName}</td></tr>
          <tr><td class="field-name">Protocol Flags:</td><td class="field-val">0x${decoded.flags.toString(16).padStart(2, '0').toUpperCase()} (${[decoded.is_ack ? 'ACK' : null, decoded.has_gps ? 'GPS' : null, decoded.has_dr ? 'DR' : null].filter(Boolean).join(', ') || 'NONE'})</td></tr>
          <tr><td class="field-name">Reported Position:</td><td class="field-val">${decoded.lat}°, ${decoded.lon}°</td></tr>
          <tr><td class="field-name">Position Provenance:</td><td class="field-val">${decoded.positionSource}</td></tr>
          <tr><td class="field-name">Timestamp (UTC):</td><td class="field-val">${decoded.ts} (${decoded.timestamp.split('T')[1].replace('Z','')})</td></tr>
          <tr><td class="field-name">Battery Level:</td><td class="field-val">${decoded.battery}%</td></tr>
          <tr><td class="field-name">Hop Count:</td><td class="field-val">${decoded.hop} relays traversed</td></tr>
          <tr><td class="field-name">Contact ID:</td><td class="field-val">${decoded.contact || 'None (Default)'}</td></tr>
        </table>
      </div>
    `;
  }
}
