// Project Setu - Simulation State Engine & Playback Controller

export class SimulationEngine {
  constructor() {
    this.events = [];
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

  loadTrace(events, summary = null) {
    this.pause();
    this.events = events || [];
    this.summary = summary;
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
          if (n) n.stats.tx++;
          // If this transmission is currently underway at targetTime
          if (targetTime >= ev.t && targetTime < ev.t + (ev.air || 62)) {
            this.activePackets.push(ev);
          }
          break;
        case 'rx':
          if (n) n.stats.rx++;
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
    let totalNodes = this.nodes.size;
    let onlineNodes = 0;
    let failedNodes = 0;
    let totalTx = 0;
    let totalRx = 0;
    let totalDrop = 0;
    let totalDedup = 0;
    let totalSuppressed = 0;
    let totalRetries = 0;
    let activeSosCount = 0;
    let ackedCount = 0;

    for (const [, n] of this.nodes) {
      if (n.online) onlineNodes++;
      else failedNodes++;
      totalTx += n.stats.tx;
      totalRx += n.stats.rx;
      totalDrop += n.stats.drop;
      totalDedup += n.stats.dedup;
      totalSuppressed += n.stats.suppressed;
      totalRetries += n.stats.retries;
      if (n.active_sos) activeSosCount++;
      if (n.acked) ackedCount++;
    }

    const totalPackets = totalRx + totalDrop;
    const pdr = totalPackets > 0 ? ((totalRx / totalPackets) * 100).toFixed(1) : '100.0';

    // Latency from alerts
    let avgLatency = 0;
    if (this.alerts.length > 0) {
      const sum = this.alerts.reduce((acc, a) => acc + (a.latency_ms || 1500), 0);
      avgLatency = Math.round(sum / this.alerts.length);
    }

    return {
      clockMs: Math.round(this.currentTime),
      durationMs: this.meta.duration,
      totalNodes,
      onlineNodes,
      failedNodes,
      alertsTotal: this.alerts.length,
      alertsPending: activeSosCount,
      alertsAcked: ackedCount,
      txTotal: totalTx,
      rxTotal: totalRx,
      dropTotal: totalDrop,
      dedupTotal: totalDedup,
      relaySuppressedTotal: totalSuppressed,
      retriesTotal: totalRetries,
      pdr: `${pdr}%`,
      avgLatencyMs: avgLatency
    };
  }
}
