// Project Setu - 25-Byte Binary Wire Format Encoder & Decoder
// Matches shared/include/setu/packet.hpp and packet.cpp exactly.

export const PACKET_SIZE = 25;
export const NO_TARGET = 0xFFFF;
export const MAX_HOPS = 32;

export const Hazard = {
  0: 'General SOS',
  1: 'Medical Emergency',
  2: 'Trapped / Structural',
  General: 0,
  Medical: 1,
  Trapped: 2
};

export const Flags = {
  GPS: 0x01,
  ACK: 0x02,
  DR: 0x04
};

export class PacketParser {
  /**
   * Decodes an ArrayBuffer or Uint8Array of 25 bytes.
   */
  static decode(bytes) {
    if (!bytes || bytes.length !== PACKET_SIZE) {
      throw new Error(`Invalid packet size: ${bytes ? bytes.length : 0} bytes (expected 25)`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const node_id = view.getUint16(0, true);
    const seq = view.getUint16(2, true);
    const target = view.getUint16(4, true);
    const ref_seq = view.getUint16(6, true);
    const hazard = view.getUint8(8);
    const flags = view.getUint8(9);
    const lat_e6 = view.getInt32(10, true);
    const lon_e6 = view.getInt32(14, true);
    const ts = view.getUint32(18, true);
    const battery = view.getUint8(22);
    const hop = view.getUint8(23);
    const contact = view.getUint8(24);

    return {
      node_id,
      seq,
      target,
      ref_seq,
      hazard,
      hazardName: Hazard[hazard] || `Unknown (${hazard})`,
      flags,
      is_ack: (flags & Flags.ACK) !== 0,
      has_gps: (flags & Flags.GPS) !== 0,
      has_dr: (flags & Flags.DR) !== 0,
      lat_e6,
      lon_e6,
      lat: (lat_e6 / 1e6).toFixed(6),
      lon: (lon_e6 / 1e6).toFixed(6),
      positionSource: (flags & Flags.GPS) ? 'GNSS 3D Fix' : (flags & Flags.DR) ? 'Dead-Reckoning IMU' : 'Unknown',
      ts,
      timestamp: new Date(ts * 1000).toISOString(),
      battery,
      hop,
      contact,
      bytes: Array.from(bytes)
    };
  }

  /**
   * Encodes a logical packet object into a 25-byte Uint8Array.
   */
  static encode(pkt) {
    const buf = new Uint8Array(PACKET_SIZE);
    const view = new DataView(buf.buffer);

    view.setUint16(0, pkt.node_id || 0, true);
    view.setUint16(2, pkt.seq || 0, true);
    view.setUint16(4, pkt.target !== undefined ? pkt.target : NO_TARGET, true);
    view.setUint16(6, pkt.ref_seq || 0, true);
    view.setUint8(8, pkt.hazard || 0);
    view.setUint8(9, pkt.flags || 0);
    view.setInt32(10, pkt.lat_e6 || 0, true);
    view.setInt32(14, pkt.lon_e6 || 0, true);
    view.setUint32(18, pkt.ts || Math.floor(Date.now() / 1000), true);
    view.setUint8(22, pkt.battery !== undefined ? pkt.battery : 100);
    view.setUint8(23, pkt.hop || 0);
    view.setUint8(24, pkt.contact || 0);

    return buf;
  }

  /**
   * Synthesize raw bytes from a structured trace TX event.
   */
  static fromTraceEvent(ev) {
    return this.encode({
      node_id: ev.origin !== undefined ? ev.origin : ev.node,
      seq: ev.seq || 0,
      target: ev.target !== undefined ? ev.target : (ev.ack ? 0 : NO_TARGET),
      ref_seq: ev.ref_seq || 0,
      hazard: ev.hazard || 0,
      flags: ev.flags !== undefined ? ev.flags : ((ev.ack ? Flags.ACK : 0) | Flags.GPS),
      lat_e6: ev.lat_e6 || 22572600,
      lon_e6: ev.lon_e6 || 88433800,
      ts: 1700000000 + Math.floor((ev.t || 0) / 1000),
      battery: ev.battery !== undefined ? ev.battery : 100,
      hop: ev.hop || 0,
      contact: ev.contact || 0
    });
  }

  /**
   * Formats raw bytes to styled hex representation with field coloring metadata.
   */
  static getHexTokens(buf) {
    const bytes = Array.from(buf);
    return bytes.map((b, idx) => {
      const hex = b.toString(16).padStart(2, '0').toUpperCase();
      let fieldClass = '';
      let fieldName = '';

      if (idx >= 0 && idx <= 1) { fieldClass = 'b-node'; fieldName = 'Origin Node ID'; }
      else if (idx >= 2 && idx <= 3) { fieldClass = 'b-seq'; fieldName = 'Sequence ID'; }
      else if (idx >= 4 && idx <= 5) { fieldClass = 'b-target'; fieldName = 'Target Node ID (ACK)'; }
      else if (idx >= 6 && idx <= 7) { fieldClass = 'b-ref'; fieldName = 'Ref Sequence ID'; }
      else if (idx === 8) { fieldClass = 'b-hazard'; fieldName = 'Hazard Code'; }
      else if (idx === 9) { fieldClass = 'b-flags'; fieldName = 'Protocol Flags (GPS/ACK/DR)'; }
      else if (idx >= 10 && idx <= 17) { fieldClass = 'b-pos'; fieldName = 'Geographic Position'; }
      else if (idx >= 18 && idx <= 21) { fieldClass = 'b-ts'; fieldName = 'Unix Timestamp'; }
      else if (idx === 22) { fieldClass = 'b-batt'; fieldName = 'Battery Percent'; }
      else if (idx === 23) { fieldClass = 'b-hop'; fieldName = 'Hop Count'; }
      else if (idx === 24) { fieldClass = 'b-contact'; fieldName = 'Contact ID'; }

      return { offset: idx, hex, value: b, fieldClass, fieldName };
    });
  }
}
