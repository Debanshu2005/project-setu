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
    this.onLinkToggle = null;   // (a, b, blocked) => void
    this.onMotionChange = null; // (nodeId, profile) => void
    this.onGnssOutage = null;   // (nodeId, startMs, durationMs) => void
    this.onResetEstimator = null; // (nodeId) => void

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
    const rawRole = (n && n.role !== undefined && n.role !== null) ? String(n.role).trim().toLowerCase() : (n && n.id === 0 ? 'hub' : 'unknown');
    const role = (rawRole === 'hub' || rawRole === 'relay' || rawRole === 'survivor') ? rawRole : (rawRole || 'unknown');
    const roleBadge = role === 'hub' ? 'badge-hub' : role === 'relay' ? 'badge-relay' : role === 'survivor' ? 'badge-survivor' : 'badge-relay';
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

    const posX = typeof n.x === 'number' ? n.x.toFixed(1) : '0.0';
    const posY = typeof n.y === 'number' ? n.y.toFixed(1) : '0.0';
    const gtLatE6 = typeof n.gt_lat_e6 === 'number' ? n.gt_lat_e6 : (typeof n.lat_e6 === 'number' ? n.lat_e6 : null);
    const gtLonE6 = typeof n.gt_lon_e6 === 'number' ? n.gt_lon_e6 : (typeof n.lon_e6 === 'number' ? n.lon_e6 : null);
    const estLatE6 = typeof n.est_lat_e6 === 'number' ? n.est_lat_e6 : null;
    const estLonE6 = typeof n.est_lon_e6 === 'number' ? n.est_lon_e6 : null;
    const hasEstimate = (estLatE6 !== null && estLonE6 !== null && estLatE6 !== 0 && estLonE6 !== 0);

    let posProv = 'No Fix / Sensor Uninitialized';
    if (n.gnss_on) {
      if (hasEstimate && (n.gnss_status === 'valid_fix' || n.gnss_status === 'FIX_3D' || !n.gnss_status)) {
        posProv = 'GNSS 3D Satellite Fix (Active)';
      } else if (n.gnss_status === 'acquiring') {
        posProv = 'Searching for Satellites (Acquiring Fix)';
      } else if (n.gnss_status === 'temporary_outage') {
        posProv = 'GNSS Outage / Degraded (No Satellites)';
      } else {
        posProv = 'GNSS Enabled (Awaiting Verified Measurement)';
      }
    } else if (n.dr_on) {
      posProv = hasEstimate ? 'Dead-Reckoning (MPU-6050 IMU)' : 'Dead-Reckoning (Awaiting Movement)';
    } else {
      posProv = 'All Positioning Sensors Disabled';
    }

    const curBatt = n.battery !== undefined ? n.battery : 100;
    const initBatt = n.initial_battery !== undefined ? n.initial_battery : curBatt;
    const consumedMah = typeof n.energy_consumed_mah === 'number' ? n.energy_consumed_mah.toFixed(2) : '0.00';

    let controlsHtml = '';
    if (role === 'survivor') {
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
                ${n.online ? 'Kill Node (Offline)' : 'Restore Node (Online)'}
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
              <span>Battery:</span>
              <input type="range" id="sliderBattery" min="0" max="100" value="${curBatt}" style="flex: 1; cursor: pointer;" />
              <input type="number" id="numBattery" min="0" max="100" value="${curBatt}" style="width: 48px; font-size: 11px; padding: 2px 4px; background: var(--bg-surface); border: 1px solid var(--border-subtle); color: #fff; border-radius: var(--radius-sm);" />
              <button id="btnApplyBattery" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px;">Set</button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>GNSS Satellite Receiver:</span>
              <button id="btnToggleGnss" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.gnss_on ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}; border: 1px solid ${n.gnss_on ? '#10b981' : '#ef4444'}; color: ${n.gnss_on ? '#34d399' : '#f87171'};">
                ${n.gnss_on ? 'GNSS Active' : 'GNSS Denied (Lost)'}
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>MPU-6050 Dead-Reckoning:</span>
              <button id="btnToggleDr" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.dr_on ? 'rgba(56, 189, 248, 0.25)' : 'rgba(148, 163, 184, 0.25)'}; border: 1px solid ${n.dr_on ? '#38bdf8' : '#64748b'}; color: ${n.dr_on ? '#38bdf8' : '#94a3b8'};">
                ${n.dr_on ? 'IMU DR Active' : 'IMU DR Disabled'}
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Motion Profile (Inertial):</span>
              <select id="selMotionProfile" style="font-size: 10px; padding: 3px 6px; background: var(--bg-surface); border: 1px solid var(--border-subtle); color: #38bdf8; border-radius: var(--radius-sm); cursor: pointer;">
                <option value="stationary" ${n.motion_profile === 'stationary' ? 'selected' : ''}>🚶‍♂️ Stationary</option>
                <option value="walking" ${n.motion_profile === 'walking' ? 'selected' : ''}>🚶 Walking (1.8 Hz)</option>
                <option value="running" ${n.motion_profile === 'running' ? 'selected' : ''}>🏃 Running (2.8 Hz)</option>
                <option value="sudden_movement" ${n.motion_profile === 'sudden_movement' ? 'selected' : ''}>⚡ Sudden Movement</option>
                <option value="fall_impact" ${n.motion_profile === 'fall_impact' ? 'selected' : ''}>💥 Fall & Impact</option>
                <option value="irregular" ${n.motion_profile === 'irregular' ? 'selected' : ''}>〰️ Irregular / Entrapped</option>
              </select>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Simulate GNSS Outage:</span>
              <button id="btnScheduleGnssOutage" class="btn" style="padding: 3px 8px; font-size: 10px; background: rgba(245, 158, 11, 0.25); border: 1px solid #f59e0b; color: #fcd34d;">
                📡 Trigger 5s Outage
              </button>
            </div>
          </div>
        </div>
      `;
    } else if (role === 'hub' || role === 'relay') {
      // Relay or Hub controls
      controlsHtml = `
        <div class="wire-breakdown-card" style="border: 1px solid rgba(56, 189, 248, 0.35); background: rgba(15, 23, 42, 0.7);">
          <div class="wire-header" style="color: var(--cyan-main); font-weight: 700;">
            <span>${role.toUpperCase()} Node Controls (ID ${n.id})</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Radio Tower Status:</span>
              <button id="btnToggleOnline" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.online ? '#ef4444' : '#10b981'}; color: #fff;">
                ${n.online ? 'Disable Tower (Offline)' : 'Enable Tower (Online)'}
              </button>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
              <span>Backup Battery:</span>
              <input type="range" id="sliderBattery" min="0" max="100" value="${curBatt}" style="flex: 1; cursor: pointer;" />
              <input type="number" id="numBattery" min="0" max="100" value="${curBatt}" style="width: 48px; font-size: 11px; padding: 2px 4px; background: var(--bg-surface); border: 1px solid var(--border-subtle); color: #fff; border-radius: var(--radius-sm);" />
              <button id="btnApplyBattery" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px;">Set</button>
            </div>
          </div>
        </div>
      `;
    } else {
      // Unknown or custom role fallback controls
      controlsHtml = `
        <div class="wire-breakdown-card" style="border: 1px solid rgba(148, 163, 184, 0.35); background: rgba(15, 23, 42, 0.7);">
          <div class="wire-header" style="color: #94a3b8; font-weight: 700;">
            <span>${role.toUpperCase()} Node Diagnostic Controls (ID ${n.id})</span>
          </div>
          <div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px;">
            Node role is unclassified in trace. Diagnostic controls available:
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Node Power State:</span>
              <button id="btnToggleOnline" class="btn" style="padding: 3px 8px; font-size: 10px; background: ${n.online ? '#ef4444' : '#10b981'}; color: #fff;">
                ${n.online ? 'Kill Node (Offline)' : 'Restore Node (Online)'}
              </button>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
              <span>Battery:</span>
              <input type="range" id="sliderBattery" min="0" max="100" value="${curBatt}" style="flex: 1; cursor: pointer;" />
              <input type="number" id="numBattery" min="0" max="100" value="${curBatt}" style="width: 48px; font-size: 11px; padding: 2px 4px; background: var(--bg-surface); border: 1px solid var(--border-subtle); color: #fff; border-radius: var(--radius-sm);" />
              <button id="btnApplyBattery" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px;">Set</button>
            </div>
          </div>
        </div>
      `;
    }

    // Connected RF Links Table
    const nodeLinks = (this.sim.links || []).filter(l => l.a === n.id || l.b === n.id);
    let linksHtml = '';
    if (nodeLinks.length > 0) {
      linksHtml = `
        <div class="wire-breakdown-card">
          <div class="wire-header" style="color: #38bdf8;">
            <span>Connected RF Links & Obstructions (${nodeLinks.length})</span>
          </div>
          <table class="field-table" style="font-size: 10px;">
            <thead>
              <tr style="color: var(--text-dim); text-align: left;">
                <th>Peer</th>
                <th>Dist</th>
                <th>RSSI</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${nodeLinks.map(l => {
                const peerId = l.a === n.id ? l.b : l.a;
                const isBlocked = Boolean(l.blocked);
                return `
                  <tr>
                    <td class="field-name">Node ${peerId}</td>
                    <td class="field-val">${l.dist}m</td>
                    <td class="field-val" style="color: ${l.rssi >= -90 ? '#10b981' : l.rssi >= -110 ? '#f59e0b' : '#ef4444'}">${l.rssi} dBm</td>
                    <td class="field-val" style="color: ${isBlocked ? '#ef4444' : '#10b981'}; font-weight: 700;">${isBlocked ? 'BLOCKED' : 'ACTIVE'}</td>
                    <td>
                      <button class="btn btn-toggle-link" data-peer="${peerId}" data-blocked="${isBlocked}" style="padding: 2px 6px; font-size: 9px; background: ${isBlocked ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}; border: 1px solid ${isBlocked ? '#10b981' : '#ef4444'}; color: ${isBlocked ? '#34d399' : '#fca5a5'};">
                        ${isBlocked ? 'Restore' : 'Block'}
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
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

      <div class="metrics-grid" style="margin-top: 8px; margin-bottom: 12px; grid-template-columns: repeat(2, 1fr);">
        <div class="metric-card">
          <div class="metric-label">Current Battery</div>
          <div class="metric-value" style="color: ${curBatt > 50 ? '#10b981' : curBatt > 20 ? '#f59e0b' : '#ef4444'}">${curBatt}<span class="metric-unit">%</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Initial Configured</div>
          <div class="metric-value" style="color: #38bdf8;">${initBatt}<span class="metric-unit">%</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Energy Consumed</div>
          <div class="metric-value" style="color: #f59e0b;">${consumedMah}<span class="metric-unit">mAh</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Airtime Used</div>
          <div class="metric-value">${(stats.tx || 0) * 62}<span class="metric-unit">ms</span></div>
        </div>
      </div>

      ${linksHtml}

      <div class="wire-breakdown-card">
        <div class="wire-header" style="color: #38bdf8; font-weight: 700; display: flex; justify-content: space-between; align-items: center;">
          <span>Geographic Location & Provenance</span>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button id="btnResetEstimator" class="btn" style="padding: 2px 6px; font-size: 9px; background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #38bdf8;" title="Reset estimator coordinates to match current ground truth">
              🔄 Reset Estimator
            </button>
            <span class="badge" style="background: ${n.gnss_on && hasEstimate ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}; border: 1px solid ${n.gnss_on && hasEstimate ? '#10b981' : '#ef4444'}; color: ${n.gnss_on && hasEstimate ? '#34d399' : '#f87171'}; font-size: 9px;">${n.gnss_status || (n.gnss_on ? 'ACQUIRING' : 'NO_FIX')}</span>
          </div>
        </div>
        <table class="field-table">
          <tr><td class="field-name">Cartesian Ground-Truth:</td><td class="field-val"><strong style="color: #fff;">X: ${posX} m, Y: ${posY} m</strong></td></tr>
          <tr><td class="field-name">Geographic Ground-Truth:</td><td class="field-val"><strong style="color: #fff;">${gtLatE6 !== null && gtLonE6 !== null ? `${(gtLatE6 / 1e6).toFixed(6)}°, ${(gtLonE6 / 1e6).toFixed(6)}°` : 'Not set'}</strong></td></tr>
          <tr><td class="field-name">Firmware-Estimated Coords:</td><td class="field-val" style="color: #38bdf8;">${hasEstimate ? `${(estLatE6 / 1e6).toFixed(6)}°, ${(estLonE6 / 1e6).toFixed(6)}°` : '<span style="color: #94a3b8; font-style: italic;">Not measured (No fix acquired)</span>'}</td></tr>
          <tr><td class="field-name">Position Estimation Error:</td><td class="field-val" style="font-weight: 700; color: ${typeof n.pos_error_m === 'number' && n.pos_error_m >= 0 ? (n.pos_error_m > 10.0 ? '#ef4444' : n.pos_error_m > 4.0 ? '#f59e0b' : '#10b981') : '#94a3b8'};">${typeof n.pos_error_m === 'number' && n.pos_error_m >= 0 ? `${n.pos_error_m.toFixed(2)} m` : '<span style="color: #94a3b8; font-style: italic;">Not measured</span>'}</td></tr>
          <tr><td class="field-name">Position Error (MAE / RMSE):</td><td class="field-val">${typeof n.pos_mae_m === 'number' && n.pos_mae_m >= 0 && typeof n.pos_rmse_m === 'number' && n.pos_rmse_m >= 0 ? `${n.pos_mae_m.toFixed(2)} m / ${n.pos_rmse_m.toFixed(2)} m` : '<span style="color: #94a3b8; font-style: italic;">Not measured</span>'}</td></tr>
          <tr><td class="field-name">Max Outage Drift:</td><td class="field-val">${typeof n.pos_max_err_m === 'number' && n.pos_max_err_m >= 0 ? `${n.pos_max_err_m.toFixed(2)} m` : '<span style="color: #94a3b8; font-style: italic;">None</span>'}</td></tr>
          <tr><td class="field-name">Fix Provenance:</td><td class="field-val" style="color:${n.gnss_on && hasEstimate ? '#10b981' : n.dr_on && hasEstimate ? '#f59e0b' : '#94a3b8'}">${posProv}</td></tr>
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

    // 3. Battery Slider & Direct Set
    const sliderBattery = this.nodeContainer.querySelector('#sliderBattery');
    const numBattery = this.nodeContainer.querySelector('#numBattery');
    const btnApplyBattery = this.nodeContainer.querySelector('#btnApplyBattery');

    if (sliderBattery && numBattery) {
      sliderBattery.addEventListener('input', e => {
        numBattery.value = e.target.value;
      });
      numBattery.addEventListener('input', e => {
        sliderBattery.value = e.target.value;
      });
    }

    if (btnApplyBattery && numBattery) {
      btnApplyBattery.addEventListener('click', () => {
        const val = parseInt(numBattery.value, 10);
        if (isNaN(val) || val < 0 || val > 100) {
          alert('Battery must be an integer between 0 and 100');
          return;
        }
        n.battery = val;
        n.initial_battery = val;
        if (this.onStateChange) {
          this.onStateChange(n.id, { battery: val });
        }
        this.renderNode();
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

    // 6. Link Toggle Buttons
    this.nodeContainer.querySelectorAll('.btn-toggle-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const peer = parseInt(btn.dataset.peer, 10);
        const currentBlocked = btn.dataset.blocked === 'true';
        const newBlocked = !currentBlocked;
        if (this.onLinkToggle) {
          this.onLinkToggle(n.id, peer, newBlocked);
        }
      });
    });

    // 7. Motion Profile Selector
    const selMotion = this.nodeContainer.querySelector('#selMotionProfile');
    if (selMotion) {
      selMotion.addEventListener('change', e => {
        const profile = e.target.value;
        n.motion_profile = profile;
        if (this.onMotionChange) {
          this.onMotionChange(n.id, profile);
        }
      });
    }

    // 8. Schedule GNSS Outage Button
    const btnOutage = this.nodeContainer.querySelector('#btnScheduleGnssOutage');
    if (btnOutage) {
      btnOutage.addEventListener('click', () => {
        if (this.onGnssOutage) {
          this.onGnssOutage(n.id, 0, 5000);
        }
      });
    }

    // 9. Reset Estimator Button
    const btnReset = this.nodeContainer.querySelector('#btnResetEstimator');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (this.onResetEstimator) {
          this.onResetEstimator(n.id);
        }
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
