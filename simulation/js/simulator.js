// Project Setu - Portable JavaScript Channel & Node Simulation Engine
// Equivalent to simulation/native/world.cpp and shared/src/node.cpp for Vercel Serverless & Browser execution.

export function loraAirtimeMs(payloadBytes = 25, sf = 7, bwHz = 125000, preambleSymbols = 8) {
  const ts = (1 << sf) / (bwHz / 1000.0); // ms per symbol
  const tPreamble = (preambleSymbols + 4.25) * ts;
  const de = sf >= 11 ? 1 : 0;
  const cr = 1; // 4/5
  const num = 8 * payloadBytes - 4 * sf + 28 + 16;
  const den = 4 * (sf - 2 * de);
  const payloadSymbols = 8 + Math.max(0, Math.ceil(num / den)) * (cr + 4);
  const tPayload = payloadSymbols * ts;
  return Math.max(1, Math.round(tPreamble + tPayload));
}

export function loraSensitivityDbm(sf = 7) {
  const sens = {
    7: -123.0,
    8: -126.0,
    9: -129.0,
    10: -132.0,
    11: -134.5,
    12: -137.0
  };
  return sens[sf] || -123.0;
}

// Simple seeded PRNG (Mulberry32) for deterministic simulations
export function makePrng(seed = 42) {
  let s = Math.floor(seed) >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeGaussian(prng) {
  return function (mean = 0, std = 1) {
    let u1 = prng();
    let u2 = prng();
    while (u1 <= 1e-15) u1 = prng();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * std;
  };
}

const ORIGIN_LAT = 22.5726;
const ORIGIN_LON = 88.4338;
const M_PER_DEG_LAT = 111320.0;

function xyToE6(x, y) {
  const lat = Math.round((ORIGIN_LAT + y / M_PER_DEG_LAT) * 1e6);
  const lon = Math.round((ORIGIN_LON + x / (M_PER_DEG_LAT * Math.cos(ORIGIN_LAT * Math.PI / 180.0))) * 1e6);
  return { lat, lon };
}

export class SetuSimulator {
  constructor(params = {}) {
    this.survivors = Math.min(100, Math.max(1, parseInt(params.survivors, 10) || 20));
    this.relays = Math.min(30, Math.max(1, parseInt(params.relays, 10) || 5));
    this.zone = Math.min(5000, Math.max(200, parseFloat(params.zone) || 1200));
    this.seed = Math.max(0, parseInt(params.seed, 10) || 7);
    this.duration = Math.min(120000, Math.max(1000, parseInt(params.duration, 10) || 30000));
    this.sf = Math.min(12, Math.max(7, parseInt(params.sf, 10) || 7));
    this.loss = Math.min(0.9, Math.max(0.0, parseFloat(params.loss) || 0.0));
    this.pathExp = Math.min(6.0, Math.max(2.0, parseFloat(params.path_exp) || 3.5));

    this.bwHz = 125000;
    this.txDbm = 14.0;
    this.refLossDb = 31.2;
    this.extraLossDb = 15.0;
    this.shadowSigmaDb = 4.0;
    this.fadingSigmaDb = 1.5;
    this.captureDb = 6.0;
    this.sens = loraSensitivityDbm(this.sf);

    this.prng = makePrng(this.seed);
    this.gauss = makeGaussian(this.prng);

    this.nodes = new Map();
    this.links = [];
    this.blockedLinks = new Set();
    this.scheduledActions = [];
    this.activeTxs = [];
    this.traceEvents = [];
    this.alerts = [];
    this.acks = [];
    this.counters = {
      tx: 0,
      delivered: 0,
      collisions: 0,
      weak: 0,
      lost: 0,
      halfduplex: 0,
      suppressed: 0,
      retries: 0
    };

    this.initTopology();
  }

  initTopology() {
    // Node 0: Rescue Hub
    this.nodes.set(0, {
      id: 0,
      role: 'hub',
      x: 60,
      y: 60,
      online: true,
      gnss: true,
      dr: true,
      battery: 100,
      seq: 0,
      dedup: new Map(),
      queue: []
    });

    // Relays (100+)
    const cols = 3;
    const rows = Math.max(1, Math.ceil(this.relays / cols));
    for (let i = 0; i < this.relays; i++) {
      const id = 100 + i;
      const jx = (this.prng() - 0.5) * 120;
      const jy = (this.prng() - 0.5) * 120;
      const x = ((i % cols) + 1) * this.zone / (cols + 1) + jx;
      const y = (Math.floor(i / cols) + 1) * this.zone / (rows + 1) + jy;

      this.nodes.set(id, {
        id,
        role: 'relay',
        x,
        y,
        online: true,
        gnss: true,
        dr: true,
        battery: 100,
        seq: 0,
        dedup: new Map(),
        queue: []
      });
    }

    // Survivors (1..N)
    for (let i = 0; i < this.survivors; i++) {
      const id = i + 1;
      const x = 100 + this.prng() * (this.zone - 150);
      const y = 100 + this.prng() * (this.zone - 150);

      this.nodes.set(id, {
        id,
        role: 'survivor',
        x,
        y,
        online: true,
        gnss: true,
        dr: true,
        battery: 100,
        seq: 0,
        activeSos: false,
        acked: false,
        gaveUp: false,
        retriesLeft: 3,
        attempt: 0,
        retryAt: 0,
        hazard: 0,
        contact: 0,
        dedup: new Map(),
        queue: []
      });
    }

    // Precalculate links
    const nodeIds = Array.from(this.nodes.keys());
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i];
        const b = nodeIds[j];
        const r = this.calculateMeanRssi(a, b);
        if (r >= this.sens) {
          const na = this.nodes.get(a);
          const nb = this.nodes.get(b);
          this.links.push({
            a,
            b,
            rssi: parseFloat(r.toFixed(1)),
            dist: parseFloat(Math.hypot(na.x - nb.x, na.y - nb.y).toFixed(1))
          });
        }
      }
    }
  }

  calculateMeanRssi(a, b) {
    if (a === b) return -Infinity;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (this.blockedLinks.has(k)) return -Infinity;

    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) return -Infinity;

    const d = Math.max(1.0, Math.hypot(na.x - nb.x, na.y - nb.y));
    const prngLink = makePrng(this.seed ^ (Math.min(a, b) * 65537 + Math.max(a, b) * 2246822));
    const gaussLink = makeGaussian(prngLink);
    const pl = this.refLossDb + 10.0 * this.pathExp * Math.log10(d) + this.extraLossDb + gaussLink(0, this.shadowSigmaDb);
    return this.txDbm - pl;
  }

  addTrigger(nodeId, kind, atMs) {
    this.scheduledActions.push({
      t: atMs,
      run: (now) => {
        const n = this.nodes.get(nodeId);
        if (!n || !n.online) return;

        let hazard = 0;
        let contact = 0;
        if (kind === 'double') hazard = 1;
        else if (kind === 'long') hazard = 2;
        else if (kind === 'voice-medical') { hazard = 1; contact = 1; }
        else if (kind === 'voice-trapped') { hazard = 2; contact = 1; }

        this.traceEvents.push({ t: now, ev: 'button_down', node: nodeId });
        this.traceEvents.push({ t: now, ev: 'haptic', node: nodeId, pattern: 0 });

        const holdMs = kind === 'long' ? 1700 : 150;
        this.scheduledActions.push({
          t: now + holdMs,
          run: (tUp) => {
            this.traceEvents.push({ t: tUp, ev: 'button_up', node: nodeId, hold_ms: holdMs });
            this.startSos(nodeId, hazard, contact, tUp);
          }
        });
      }
    });
  }

  startSos(nodeId, hazard, contact, now) {
    const n = this.nodes.get(nodeId);
    if (!n) return;

    n.activeSos = true;
    n.acked = false;
    n.gaveUp = false;
    n.hazard = hazard;
    n.contact = contact;
    n.retriesLeft = 3;
    n.attempt = 0;
    n.seq++;

    const flags = n.gnss ? 1 : n.dr ? 4 : 0;
    const { lat, lon } = xyToE6(n.x, n.y);

    this.traceEvents.push({
      t: now,
      ev: 'originate',
      node: nodeId,
      seq: n.seq,
      hazard,
      contact,
      flags
    });

    const packet = {
      node_id: nodeId,
      seq: n.seq,
      target: 65535,
      ref_seq: 0,
      hazard,
      flags,
      lat_e6: lat,
      lon_e6: lon,
      battery: n.battery,
      hop: 0,
      contact,
      is_ack: false
    };

    n.dedup.set(`${nodeId}-${n.seq}-0`, 1);
    this.enqueueTx(nodeId, packet, 0, now);
    n.retryAt = now + 4000;
  }

  enqueueTx(fromId, packet, delayMs, now) {
    const n = this.nodes.get(fromId);
    if (!n) return;
    n.queue.push({
      packet,
      dueMs: now + delayMs
    });
  }

  run() {
    // 1. Emit Manifest
    this.traceEvents.push({
      t: 0,
      ev: 'meta',
      sf: this.sf,
      bw_hz: this.bwHz,
      tx_dbm: this.txDbm,
      sens: this.sens,
      path_exp: this.pathExp,
      seed: this.seed
    });

    for (const [, n] of this.nodes) {
      const { lat, lon } = xyToE6(n.x, n.y);
      this.traceEvents.push({
        t: 0,
        ev: 'node_init',
        id: n.id,
        role: n.role,
        x: parseFloat(n.x.toFixed(3)),
        y: parseFloat(n.y.toFixed(3)),
        lat_e6: lat,
        lon_e6: lon,
        battery: n.battery,
        online: n.online
      });
    }

    for (const link of this.links) {
      this.traceEvents.push({
        t: 0,
        ev: 'link_init',
        a: link.a,
        b: link.b,
        rssi: link.rssi,
        dist: link.dist
      });
    }

    const airtimeMs = loraAirtimeMs(25, this.sf, this.bwHz);

    // Discrete ms loop
    for (let now = 0; now <= this.duration; now++) {
      // 1. Run scheduled actions
      while (this.scheduledActions.length > 0 && this.scheduledActions[0].t <= now) {
        const action = this.scheduledActions.shift();
        action.run(now);
      }

      // 2. Service transmit queues for all nodes
      for (const [, n] of this.nodes) {
        if (!n.online) continue;

        // Check retries for survivor
        if (n.role === 'survivor' && n.activeSos && now >= n.retryAt) {
          if (n.retriesLeft > 0) {
            n.retriesLeft--;
            n.attempt++;
            this.counters.retries++;
            this.traceEvents.push({ t: now, ev: 'retry', node: n.id, attempt: n.attempt });
            n.seq++;
            const flags = n.gnss ? 1 : n.dr ? 4 : 0;
            const { lat, lon } = xyToE6(n.x, n.y);
            const p = {
              node_id: n.id,
              seq: n.seq,
              target: 65535,
              ref_seq: 0,
              hazard: n.hazard,
              flags,
              lat_e6: lat,
              lon_e6: lon,
              battery: n.battery,
              hop: 0,
              contact: n.contact,
              is_ack: false
            };
            n.dedup.set(`${n.id}-${n.seq}-0`, 1);
            this.enqueueTx(n.id, p, 0, now);
            n.retryAt = now + 4000 * (n.attempt + 1);
          } else {
            n.activeSos = false;
            n.gaveUp = true;
            this.traceEvents.push({ t: now, ev: 'gave_up', node: n.id });
          }
        }

        // Process queue
        for (let qIdx = 0; qIdx < n.queue.length; qIdx++) {
          const item = n.queue[qIdx];
          if (now >= item.dueMs) {
            n.queue.splice(qIdx, 1);
            qIdx--;

            // Dedup check for relay
            const key = `${item.packet.node_id}-${item.packet.seq}-${item.packet.is_ack ? 1 : 0}`;
            const count = n.dedup.get(key) || 0;
            if (n.role === 'relay' && count >= 3) {
              this.counters.suppressed++;
              this.traceEvents.push({ t: now, ev: 'relay_suppressed', node: n.id, origin: item.packet.node_id, seq: item.packet.seq });
              continue;
            }

            // Skip if node is already transmitting
            if (this.activeTxs.some(t => t.from === n.id && now < t.end)) {
              continue;
            }

            // Start transmission
            this.counters.tx++;
            this.traceEvents.push({
              t: now,
              ev: 'tx',
              node: n.id,
              origin: item.packet.node_id,
              seq: item.packet.seq,
              ack: item.packet.is_ack ? 1 : 0,
              target: item.packet.target,
              ref_seq: item.packet.ref_seq,
              hazard: item.packet.hazard,
              flags: item.packet.flags,
              lat_e6: item.packet.lat_e6,
              lon_e6: item.packet.lon_e6,
              battery: item.packet.battery,
              hop: item.packet.hop,
              contact: item.packet.contact,
              air: airtimeMs
            });

            this.activeTxs.push({
              from: n.id,
              start: now,
              end: now + airtimeMs,
              packet: item.packet
            });
          }
        }
      }

      // 3. Complete transmissions that end at 'now'
      const endingTxs = [];
      for (const tx of this.activeTxs) {
        if (tx.end === now) {
          endingTxs.push(tx);
        }
      }

      for (const tx of endingTxs) {
        // Deliver to all other online nodes
        for (const [, rxNode] of this.nodes) {
          if (rxNode.id === tx.from || !rxNode.online) continue;

          const meanRssi = this.calculateMeanRssi(tx.from, rxNode.id);
          if (meanRssi < this.sens - 6.0) continue;

          const rssi = parseFloat((meanRssi + this.gauss(0, this.fadingSigmaDb)).toFixed(1));
          if (rssi < this.sens) {
            this.counters.weak++;
            this.traceEvents.push({ t: now, ev: 'drop', node: rxNode.id, from: tx.from, rssi, why: 'weak' });
            continue;
          }

          // Check half-duplex and collision with other overlapping transmissions
          let dropped = false;
          let why = '';
          for (const other of this.activeTxs) {
            if (other === tx || (other.from === tx.from && other.start === tx.start)) continue;
            // Overlap condition: other started before tx ended, and ended after tx started
            if (!(other.start < tx.end && other.end > tx.start)) continue;

            if (other.from === rxNode.id) {
              dropped = true;
              why = 'halfduplex';
              this.counters.halfduplex++;
              break;
            }
          }

          // Cumulative co-channel interference power sum (SINR model)
          if (!dropped) {
            let totalInterfMw = 0;
            for (const other of this.activeTxs) {
              if (other === tx || (other.from === tx.from && other.start === tx.start)) continue;
              if (!(other.start < tx.end && other.end > tx.start)) continue;
              if (other.from === rxNode.id) continue;

              const otherRssi = this.calculateMeanRssi(other.from, rxNode.id);
              if (otherRssi >= this.sens - 10.0) {
                totalInterfMw += Math.pow(10, otherRssi / 10);
              }
            }

            if (totalInterfMw > 0) {
              const totalInterfDbm = 10 * Math.log10(totalInterfMw);
              if (totalInterfDbm >= this.sens && (rssi - totalInterfDbm < this.captureDb)) {
                dropped = true;
                why = 'collision';
                this.counters.collisions++;
              }
            }
          }

          if (!dropped && this.loss > 0 && this.prng() < this.loss) {
            dropped = true;
            why = 'loss';
            this.counters.lost++;
          }

          if (dropped) {
            this.traceEvents.push({ t: now, ev: 'drop', node: rxNode.id, from: tx.from, rssi, why });
            continue;
          }

          // Successful Delivery
          this.counters.delivered++;
          const noiseFloor = -174.0 + 10.0 * Math.log10(this.bwHz) + 6.0;
          const snr = Math.min(15.0, Math.max(-20.0, parseFloat((rssi - noiseFloor).toFixed(1))));
          this.traceEvents.push({ t: now, ev: 'rx', node: rxNode.id, from: tx.from, rssi, snr });

            // Handle packet in receiving node
            const p = tx.packet;
            const key = `${p.node_id}-${p.seq}-${p.is_ack ? 1 : 0}`;
            const seenCount = (rxNode.dedup.get(key) || 0) + 1;
            rxNode.dedup.set(key, seenCount);

            if (seenCount > 1) {
              this.traceEvents.push({ t: now, ev: 'dedup_drop', node: rxNode.id, origin: p.node_id, seq: p.seq });
              continue;
            }

            // Handle ACK
            if (p.is_ack) {
              if (p.target === rxNode.id) {
                rxNode.activeSos = false;
                rxNode.acked = true;
                this.acks.push({ id: rxNode.id, t: now });
                this.traceEvents.push({ t: now, ev: 'ack_rx', node: rxNode.id, ref_seq: p.ref_seq });
                this.traceEvents.push({ t: now, ev: 'haptic', node: rxNode.id, pattern: 6 }); // AckReceived
              } else if (rxNode.role !== 'hub' && p.hop < 8) {
                // Relay ACK
                const nextP = { ...p, hop: p.hop + 1 };
                this.enqueueTx(rxNode.id, nextP, Math.floor(this.prng() * 250), now);
              }
              continue;
            }

            // Handle SOS
            if (rxNode.role === 'hub') {
              this.alerts.push({
                origin: p.node_id,
                hazard: p.hazard,
                hops: p.hop,
                seq: p.seq,
                t: now
              });
              this.traceEvents.push({
                t: now,
                ev: 'alert',
                node: rxNode.id,
                origin: p.node_id,
                hazard: p.hazard,
                hops: p.hop,
                seq: p.seq,
                lat_e6: p.lat_e6,
                lon_e6: p.lon_e6,
                battery: p.battery,
                flags: p.flags,
                contact: p.contact
              });

              // Send ACK back
              rxNode.seq++;
              const ackPacket = {
                node_id: rxNode.id,
                seq: rxNode.seq,
                target: p.node_id,
                ref_seq: p.seq,
                hazard: p.hazard,
                flags: 2, // ACK
                lat_e6: p.lat_e6,
                lon_e6: p.lon_e6,
                battery: 100,
                hop: 0,
                contact: p.contact,
                is_ack: true
              };
              rxNode.dedup.set(`${rxNode.id}-${rxNode.seq}-1`, 1);
              this.enqueueTx(rxNode.id, ackPacket, Math.floor(this.prng() * 30), now);
            } else if (p.hop < 8) {
              // Rebroadcast SOS
              const nextP = { ...p, hop: p.hop + 1 };
              this.enqueueTx(rxNode.id, nextP, Math.floor(this.prng() * 250), now);
            }
          }
        }

        // Prune transmissions older than overlap window (6000ms, matching C++ world.cpp)
        this.activeTxs = this.activeTxs.filter(tx => tx.end + 6000 >= now);
      }

    return {
      traceEvents: this.traceEvents,
      summary: {
        seed: this.seed,
        nodes: this.nodes.size,
        sf: this.sf,
        duration_ms: this.duration,
        events: this.alerts,
        totals: {
          tx: this.counters.tx,
          deliveries: this.counters.delivered,
          collisions: this.counters.collisions,
          weak: this.counters.weak,
          lost: this.counters.lost,
          relays_suppressed: this.counters.suppressed,
          retries: this.counters.retries
        }
      }
    };
  }
}
