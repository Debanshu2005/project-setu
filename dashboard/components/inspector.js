// Project Setu - Deep Node & Packet Inspector Component

import { PacketParser } from '../src/packet_parser.js';

export class InspectorComponent {
  constructor(nodeInspectorContainer, packetInspectorContainer, simulationEngine) {
    this.nodeContainer = nodeInspectorContainer;
    this.packetContainer = packetInspectorContainer;
    this.sim = simulationEngine;
    this.currentNode = null;
    this.currentPacket = null;

    this.sim.subscribe((engine, type) => {
      if (this.currentNode) {
        const fresh = this.sim.nodes.get(this.currentNode.id);
        if (fresh) {
          this.currentNode = fresh;
          this.renderNode();
        }
      }
    });
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
    const roleBadge = n.role === 'hub' ? 'badge-hub' : n.role === 'relay' ? 'badge-relay' : 'badge-survivor';
    const statusText = n.online ? (n.active_sos ? 'EMERGENCY ACTIVE' : 'ONLINE') : 'OFFLINE (FAILED)';
    const statusClass = !n.online ? 'badge-sos' : n.active_sos ? 'badge-sos' : 'badge-hub';

    const lat = (n.lat_e6 / 1e6).toFixed(6);
    const lon = (n.lon_e6 / 1e6).toFixed(6);
    const posProv = n.gnss_on ? 'GNSS 3D Satellite Fix' : n.dr_on ? 'Dead-Reckoning (MPU-6050 IMU)' : 'Unknown / Signal Lost';

    this.nodeContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
        <div style="font-size: 14px; font-weight: 700; color: #fff;">Node ${n.id}</div>
        <div style="display:flex; gap: 6px;">
          <span class="badge ${roleBadge}">${n.role.toUpperCase()}</span>
          <span class="badge ${statusClass}">${statusText}</span>
        </div>
      </div>

      <div class="metrics-grid" style="margin-bottom: 12px;">
        <div class="metric-card">
          <div class="metric-label">Battery Level</div>
          <div class="metric-value">${n.battery}<span class="metric-unit">%</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Airtime Used</div>
          <div class="metric-value">${n.stats.tx * 62}<span class="metric-unit">ms</span></div>
        </div>
      </div>

      <div class="wire-breakdown-card">
        <div class="wire-header">
          <span>Geographic Location & Provenance</span>
        </div>
        <table class="field-table">
          <tr><td class="field-name">Coordinates:</td><td class="field-val">${lat}°, ${lon}°</td></tr>
          <tr><td class="field-name">Cartesian:</td><td class="field-val">X: ${n.x.toFixed(1)}m, Y: ${n.y.toFixed(1)}m</td></tr>
          <tr><td class="field-name">Fix Provenance:</td><td class="field-val" style="color:${n.gnss_on ? '#10b981' : '#f59e0b'}">${posProv}</td></tr>
        </table>
      </div>

      <div class="wire-breakdown-card">
        <div class="wire-header">
          <span>Radio & Protocol Telemetry</span>
        </div>
        <table class="field-table">
          <tr><td class="field-name">Originated / Relayed TX:</td><td class="field-val">${n.stats.tx}</td></tr>
          <tr><td class="field-name">Receptions Delivered:</td><td class="field-val">${n.stats.rx}</td></tr>
          <tr><td class="field-name">Drops (Loss/Collision):</td><td class="field-val">${n.stats.drop}</td></tr>
          <tr><td class="field-name">Duplicates Suppressed:</td><td class="field-val">${n.stats.dedup}</td></tr>
          <tr><td class="field-name">Relay Backoffs Saved:</td><td class="field-val">${n.stats.suppressed}</td></tr>
          <tr><td class="field-name">Retries Attempted:</td><td class="field-val">${n.stats.retries}</td></tr>
        </table>
      </div>
    `;
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
