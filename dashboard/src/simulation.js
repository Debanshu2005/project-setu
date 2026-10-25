// Project Setu - Simulation State Engine & Playback Controller
import { calculateMetrics } from './metrics.js';

export class SimulationEngine {
  constructor() {
    this.events = [];
    this.session = {
      id: `ses_${Date.now()}`,
      name: 'Live Digital Twin',
      mode: 'live',
      status: 'idle',
      scenarioId: null,
      isProvisional: false
    };
    this.meta = {
      duration: 30000,
      seed: 7,
      sf: 7,
      bw_hz: 125000,
      sens: -123,
      tx_dbm: 14
    };

    this.nodes = new Map(); // id -> node state
    this.links = []; // array of { a, b, rssi, dist, blocked }
    this.alerts = []; // array of alerts
    this.activePackets = []; // currently transmitting packets
    this.summary = null;
    this.isLiveEngine = false;
    this.isFallbackDemo = false;

    // Playback state
    this.currentTime = 0;
    this.isPlaying = false;
    this.speed = 1.0;
    this.lastFrameTime = 0;
    this.animationId = null;

    // Listeners
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(changeType = 'tick') {
    for (const fn of this.listeners) {
      try {
        fn(this, changeType);
      } catch (err) {
        console.error('Simulation listener error:', err);
      }
    }
  }

  loadTrace(events, summary = null, sessionInfo = null) {
    this.pause();
    this.events = events || [];
    this.summary = summary;
    if (sessionInfo) {
      this.session = { ...this.session, ...sessionInfo };
    }
    this.currentTime = 0;
    this.nodes.clear();
    this.links = [];
    this.alerts = [];
    this.activePackets = [];

    // Extract meta, node_init, link_init
    let maxTime = 0;
    for (const ev of this.events) {
      if (ev.t > maxTime) maxTime = ev.t;
      if (ev.ev === 'meta') {
        this.meta = { ...this.meta, ...ev };
      } else if (ev.ev === 'node_init') {
        this.nodes.set(ev.id, {
          id: ev.id,
          role: ev.role || 'survivor',
          x: ev.x || 0,
          y: ev.y || 0,
          lat_e6: ev.lat_e6 || 0,
          lon_e6: ev.lon_e6 || 0,
          battery: ev.battery !== undefined ? ev.battery : 100,
          initial_battery: ev.initial_battery !== undefined ? ev.initial_battery : (ev.battery !== undefined ? ev.battery : 100),
          energy_consumed_mah: typeof ev.energy_consumed_mah === 'number' ? ev.energy_consumed_mah : (typeof ev.energy_mah === 'number' ? ev.energy_mah : 0.0),
          online: ev.online !== false,
          gnss_on: true,
          dr_on: true,
          active_sos: false,
          acked: false,
          gave_up: false,
          hazard: 0,
          stats: { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 }
        });
      } else if (ev.ev === 'link_init') {
        this.links.push({
          a: ev.a,
          b: ev.b,
          rssi: ev.rssi,
          dist: ev.dist,
          blocked: false
        });
      }
    }

    if (!this.meta.duration || this.meta.duration < maxTime) {
      this.meta.duration = maxTime || 30000;
    }

    this.recalculateState(0);
    this.notify('load');
  }

  recalculateState(targetTime) {
    targetTime = Math.max(0, Math.min(this.meta.duration, targetTime));
    this.currentTime = targetTime;

    // Reset all nodes to base state
    for (const [, node] of this.nodes) {
      node.online = true;
      node.battery = typeof node.initial_battery === 'number' ? node.initial_battery : 100;
      node.energy_consumed_mah = 0.0;
      node.gnss_on = true;
      node.dr_on = true;
      node.active_sos = false;
      node.acked = false;
      node.gave_up = false;
      node.hazard = 0;
      node.stats = { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 };
    }

    for (const link of this.links) {
      link.blocked = false;
    }

    this.alerts = [];
    this.activePackets = [];

    // Replay events up to currentTime
    for (const ev of this.events) {
      if (ev.t > targetTime) break;
      const n = this.nodes.get(ev.node);

      switch (ev.ev) {
        case 'node_kill':
          if (n) n.online = false;
          break;
        case 'node_revive':
          if (n) n.online = true;
          break;
        case 'gps_off':
          if (n) n.gnss_on = false;
          break;
        case 'gps_on':
          if (n) n.gnss_on = true;
          break;
        case 'dr_off':
          if (n) n.dr_on = false;
          break;
        case 'dr_on':
          if (n) n.dr_on = true;
          break;
        case 'link_block': {
          const l = this.links.find(lk => (lk.a === ev.node && lk.b === ev.to) || (lk.a === ev.to && lk.b === ev.node));
          if (l) l.blocked = true;
          break;
        }
        case 'link_unblock': {
          const l = this.links.find(lk => (lk.a === ev.node && lk.b === ev.to) || (lk.a === ev.to && lk.b === ev.node));
          if (l) l.blocked = false;
          break;
        }
        case 'originate':
          if (n) {
            n.active_sos = true;
            n.acked = false;
            n.gave_up = false;
            n.hazard = ev.hazard;
          }
          break;
        case 'ack_rx':
          if (n) {
            n.active_sos = false;
            n.acked = true;
            n.gave_up = false;
          }
          break;
        case 'gave_up':
          if (n) {
            n.active_sos = false;
            n.gave_up = true;
          }
          break;
        case 'retry':
          if (n) n.stats.retries++;
          break;
        case 'tx':
          if (n) {
            n.stats.tx++;
            if (typeof ev.energy_mah === 'number') {
              n.energy_consumed_mah = ev.energy_mah;
            } else if (typeof ev.mah === 'number') {
              n.energy_consumed_mah = ev.mah;
            } else {
              n.energy_consumed_mah = Math.round(((n.energy_consumed_mah || 0) + 1.5) * 1000) / 1000;
            }
            if (typeof ev.battery === 'number') {
              n.battery = ev.battery;
            } else {
              n.battery = Math.max(0, Math.round(100 - (n.energy_consumed_mah / 300) * 100));
            }
            if (n.battery === 0) n.online = false;
          }
          // If this transmission is currently underway at targetTime
          if (targetTime >= ev.t && targetTime < ev.t + (ev.air || 62)) {
            this.activePackets.push(ev);
          }
          break;
        case 'rx': {
          const rxId = ev.node !== undefined ? ev.node : ev.to;
          const rxNode = this.nodes.get(rxId);
          if (rxNode) {
            rxNode.stats.rx++;
            if (typeof ev.energy_mah === 'number') {
              rxNode.energy_consumed_mah = ev.energy_mah;
            } else if (typeof ev.mah === 'number') {
              rxNode.energy_consumed_mah = ev.mah;
            } else {
              rxNode.energy_consumed_mah = Math.round(((rxNode.energy_consumed_mah || 0) + 0.3) * 1000) / 1000;
            }
            if (typeof ev.battery === 'number') {
              rxNode.battery = ev.battery;
            } else {
              rxNode.battery = Math.max(0, Math.round(100 - (rxNode.energy_consumed_mah / 300) * 100));
            }
            if (rxNode.battery === 0) rxNode.online = false;
          }
          break;
        }
        case 'battery':
          if (n) {
            if (typeof ev.battery === 'number') n.battery = ev.battery;
            if (typeof ev.mah === 'number') n.energy_consumed_mah = ev.mah;
            if (n.battery === 0) n.online = false;
          }
          break;
        case 'battery_depleted':
          if (n) {
            n.battery = 0;
            n.online = false;
          }
          break;
        case 'drop':
          if (n) n.stats.drop++;
          break;
        case 'dedup_drop':
          if (n) n.stats.dedup++;
          break;
        case 'relay_suppressed':
          if (n) n.stats.suppressed++;
          break;
        case 'alert':
          this.alerts.push(ev);
          break;
      }
    }
  }

  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.loop();
    this.notify('play');
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.notify('pause');
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seek(targetTime) {
    this.recalculateState(targetTime);
    this.notify('seek');
  }

  step(deltaMs) {
    this.seek(this.currentTime + deltaMs);
  }

  setSpeed(s) {
    this.speed = Math.max(0.1, Math.min(20.0, s));
    this.notify('speed');
  }

  loop() {
    if (!this.isPlaying) return;
    const now = performance.now();
    const dt = (now - this.lastFrameTime) * this.speed;
    this.lastFrameTime = now;

    const nextTime = this.currentTime + dt;
    if (nextTime >= this.meta.duration) {
      this.recalculateState(this.meta.duration);
      this.pause();
      this.notify('complete');
      return;
    }

    this.recalculateState(nextTime);
    this.notify('tick');
    this.animationId = requestAnimationFrame(() => this.loop());
  }

  getMetrics() {
    const calculated = calculateMetrics(this.events, this.nodes, this.currentTime, this.session);

    return {
      clockMs: Math.round(this.currentTime),
      durationMs: this.meta.duration,
      totalNodes: calculated.fleet.totalNodes,
      onlineNodes: calculated.fleet.onlineNodes,
      failedNodes: calculated.fleet.failedNodes,
      depletedNodes: calculated.fleet.depletedNodes,
      alertsTotal: calculated.lifecycle.uniqueDelivered,
      alertsPending: calculated.lifecycle.inFlight,
      alertsAcked: calculated.lifecycle.uniqueAcked,
      txTotal: calculated.radio.txTotal,
      rxTotal: calculated.radio.rxTotal,
      dropTotal: calculated.radio.dropTotal,
      dedupTotal: calculated.radio.dedupTotal,
      relaySuppressedTotal: calculated.radio.relaySuppressedTotal,
      retriesTotal: calculated.radio.retriesTotal,
      pdr: calculated.lifecycle.pdrDisplay,
      avgLatencyMs: calculated.latency.avgMs !== null ? calculated.latency.avgMs : 0,
      latencyDisplay: calculated.latency.display,
      lifecycle: calculated.lifecycle,
      fleet: calculated.fleet,
      radio: calculated.radio,
      latency: calculated.latency,
      hopDistribution: calculated.hopDistribution,
      eventIndices: calculated.eventIndices,
      session: calculated.session,
      contract: calculated.contract
    };
  }
}
