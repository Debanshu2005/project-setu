// Project Setu - Simulation State Engine & Playback Controller
import { calculateMetrics } from './metrics.js';

/**
 * Canonical node roles in Project Setu: 'hub', 'relay', 'survivor', 'unknown'.
 * Normalizes any input value into a canonical lowercase string.
 * Never returns undefined or null.
 * Does not arbitrarily reassign an unknown role to 'survivor' or 'hub' unless id === 0.
 * @param {any} role - Raw role value
 * @param {number|string} [nodeId] - Optional node ID
 * @returns {string} Normalized lowercase role string
 */
export function normalizeRole(role, nodeId = null) {
  if (role === null || role === undefined) {
    if (nodeId === 0 || nodeId === '0') return 'hub';
    return 'unknown';
  }
  const str = String(role).trim().toLowerCase();
  if (!str) {
    if (nodeId === 0 || nodeId === '0') return 'hub';
    return 'unknown';
  }
  if (str === 'hub' || str === 'rescue_hub' || str === 'command_center') return 'hub';
  if (str === 'relay' || str === 'lora_relay' || str === 'tower') return 'relay';
  if (str === 'survivor' || str === 'victim' || str === 'wristband') return 'survivor';
  return str;
}

export const ORIGIN_LAT = 22.5726;
export const ORIGIN_LON = 88.4338;
export const M_PER_DEG_LAT = 111320.0;
export const M_PER_DEG_LON = 111320.0 * Math.cos(ORIGIN_LAT * Math.PI / 180.0); // ~102793.479 m/deg

/**
 * Converts Cartesian simulation coordinates (in meters relative to origin) to geographic microdegrees (e6).
 * +X is East, +Y is North.
 * @param {number} x - Cartesian Easting in meters
 * @param {number} y - Cartesian Northing in meters
 * @returns {{ lat_e6: number, lon_e6: number, lat: number, lon: number }}
 */
export function xyToE6(x, y) {
  const lat_deg = ORIGIN_LAT + (y / M_PER_DEG_LAT);
  const lon_deg = ORIGIN_LON + (x / M_PER_DEG_LON);
  const lat_e6 = Math.round(lat_deg * 1e6);
  const lon_e6 = Math.round(lon_deg * 1e6);
  return { lat_e6, lon_e6, lat: lat_deg, lon: lon_deg };
}

/**
 * Converts geographic microdegrees (e6) to Cartesian simulation coordinates (in meters relative to origin).
 * @param {number} lat_e6 - Latitude in microdegrees
 * @param {number} lon_e6 - Longitude in microdegrees
 * @returns {{ x: number, y: number }}
 */
export function e6ToXy(lat_e6, lon_e6) {
  const y = (lat_e6 * 1e-6 - ORIGIN_LAT) * M_PER_DEG_LAT;
  const x = (lon_e6 * 1e-6 - ORIGIN_LON) * M_PER_DEG_LON;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/**
 * Calculates horizontal Euclidean distance in meters between estimated coordinates and ground truth.
 * Returns null if either coordinate pair is missing or invalid.
 * @param {number} est_lat_e6 - Estimated latitude in microdegrees
 * @param {number} est_lon_e6 - Estimated longitude in microdegrees
 * @param {number} gt_lat_e6 - Ground truth latitude in microdegrees
 * @param {number} gt_lon_e6 - Ground truth longitude in microdegrees
 * @returns {number|null} Position error in meters, or null if unmeasured
 */
export function computePositionErrorM(est_lat_e6, est_lon_e6, gt_lat_e6, gt_lon_e6) {
  if (
    !Number.isFinite(est_lat_e6) || !Number.isFinite(est_lon_e6) ||
    !Number.isFinite(gt_lat_e6) || !Number.isFinite(gt_lon_e6)
  ) {
    return null;
  }
  const dy = (est_lat_e6 - gt_lat_e6) * 1e-6 * M_PER_DEG_LAT;
  const dx = (est_lon_e6 - gt_lon_e6) * 1e-6 * (M_PER_DEG_LAT * Math.cos((gt_lat_e6 * 1e-6) * Math.PI / 180.0));
  return Math.hypot(dx, dy);
}

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
    this.initialLinkDistances = new Map(); // "minId_maxId" -> initial link distance in meters
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
    // Preserve existing configured initial states across trace reloads
    const preservedConfigs = new Map();
    for (const [id, n] of this.nodes) {
      preservedConfigs.set(id, {
        initial_motion_profile: n.initial_motion_profile || n.motion_profile,
        initial_battery: n.initial_battery !== undefined ? n.initial_battery : n.battery,
        initial_online: n.initial_online !== undefined ? n.initial_online : n.online,
        initial_gnss_on: n.initial_gnss_on !== undefined ? n.initial_gnss_on : n.gnss_on,
        initial_dr_on: n.initial_dr_on !== undefined ? n.initial_dr_on : n.dr_on
      });
    }

    this.currentTime = 0;
    this.nodes.clear();
    this.links = [];
    this.initialLinkDistances = new Map();
    this.alerts = [];
    this.activePackets = [];

    // Extract meta, node_init, link_init
    let maxTime = 0;
    for (const ev of this.events) {
      if (ev.t > maxTime) maxTime = ev.t;
      if (ev.ev === 'meta') {
        this.meta = { ...this.meta, ...ev };
      } else if (ev.ev === 'node_init') {
        const id = parseInt(ev.id !== undefined ? ev.id : ev.node, 10);
        if (isNaN(id)) continue;
        const normRole = normalizeRole(ev.role, id);
        const prev = preservedConfigs.get(id);
        const initMotion = ev.motion_profile || (prev && prev.initial_motion_profile) || 'stationary';
        const initBatt = typeof ev.initial_battery === 'number' ? ev.initial_battery
          : (typeof ev.battery === 'number' ? ev.battery : (prev && prev.initial_battery !== undefined ? prev.initial_battery : 100));
        const initOnline = ev.online !== undefined ? (ev.online !== false)
          : (prev && prev.initial_online !== undefined ? prev.initial_online : true);
        const initGnss = ev.gnss_on !== undefined ? ev.gnss_on
          : (prev && prev.initial_gnss_on !== undefined ? prev.initial_gnss_on : true);
        const initDr = ev.dr_on !== undefined ? ev.dr_on
          : (prev && prev.initial_dr_on !== undefined ? prev.initial_dr_on : true);

        this.nodes.set(id, {
          id: id,
          role: normRole,
          x: typeof ev.x === 'number' ? ev.x : 0,
          y: typeof ev.y === 'number' ? ev.y : 0,
          lat_e6: typeof ev.lat_e6 === 'number' ? ev.lat_e6 : 0,
          lon_e6: typeof ev.lon_e6 === 'number' ? ev.lon_e6 : 0,
          battery: initBatt,
          initial_battery: initBatt,
          energy_consumed_mah: typeof ev.energy_consumed_mah === 'number' ? ev.energy_consumed_mah : (typeof ev.energy_mah === 'number' ? ev.energy_mah : 0.0),
          online: initOnline,
          initial_online: initOnline,
          gnss_on: initGnss,
          initial_gnss_on: initGnss,
          dr_on: initDr,
          initial_dr_on: initDr,
          motion_profile: initMotion,
          initial_motion_profile: initMotion,
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
        if (typeof ev.dist === 'number') {
          const lk = `${Math.min(ev.a, ev.b)}_${Math.max(ev.a, ev.b)}`;
          this.initialLinkDistances.set(lk, ev.dist);
        }
      }
    }

    // Ensure any node referenced in events has a record even if node_init was absent
    for (const ev of this.events) {
      const candidateIds = [ev.node, ev.target, ev.to, ev.from].filter(x => typeof x === 'number' && !isNaN(x));
      for (const cid of candidateIds) {
        if (!this.nodes.has(cid)) {
          const prev = preservedConfigs.get(cid);
          const initMotion = (prev && prev.initial_motion_profile) || 'stationary';
          const initBatt = prev && prev.initial_battery !== undefined ? prev.initial_battery : 100;
          const initOnline = prev && prev.initial_online !== undefined ? prev.initial_online : true;
          const initGnss = prev && prev.initial_gnss_on !== undefined ? prev.initial_gnss_on : true;
          const initDr = prev && prev.initial_dr_on !== undefined ? prev.initial_dr_on : true;
          this.nodes.set(cid, {
            id: cid,
            role: normalizeRole(null, cid),
            x: 0,
            y: 0,
            lat_e6: 0,
            lon_e6: 0,
            battery: initBatt,
            initial_battery: initBatt,
            energy_consumed_mah: 0.0,
            online: initOnline,
            initial_online: initOnline,
            gnss_on: initGnss,
            initial_gnss_on: initGnss,
            dr_on: initDr,
            initial_dr_on: initDr,
            motion_profile: initMotion,
            initial_motion_profile: initMotion,
            active_sos: false,
            acked: false,
            gave_up: false,
            hazard: 0,
            stats: { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 }
          });
        }
      }
    }

    // Validation pass: guarantee every node has a valid non-empty role string
    for (const [id, node] of this.nodes) {
      node.role = normalizeRole(node.role, id);
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

    // Reset all nodes to configured base state
    for (const [, node] of this.nodes) {
      node.online = typeof node.initial_online === 'boolean' ? node.initial_online : true;
      node.battery = typeof node.initial_battery === 'number' ? node.initial_battery : 100;
      node.energy_consumed_mah = 0.0;
      node.gnss_on = typeof node.initial_gnss_on === 'boolean' ? node.initial_gnss_on : true;
      node.dr_on = typeof node.initial_dr_on === 'boolean' ? node.initial_dr_on : true;
      node.motion_profile = node.initial_motion_profile || 'stationary';
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
        case 'motion_profile':
          if (n && ev.profile) {
            n.motion_profile = ev.profile;
          }
          break;
        case 'battery':
          if (n && typeof ev.battery === 'number') {
            n.battery = ev.battery;
            if (n.battery === 0) n.online = false;
          }
          break;
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
            }
            if (typeof ev.battery === 'number') {
              n.battery = ev.battery;
              if (n.battery === 0) n.online = false;
            }
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
            }
            if (typeof ev.battery === 'number') {
              rxNode.battery = ev.battery;
              if (rxNode.battery === 0) rxNode.online = false;
            }
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
        case 'reposition':
          if (n) {
            n.x = typeof ev.x === 'number' ? ev.x : n.x;
            n.y = typeof ev.y === 'number' ? ev.y : n.y;
            if (typeof ev.lat_e6 === 'number') {
              n.lat_e6 = ev.lat_e6;
              n.gt_lat_e6 = ev.lat_e6;
            } else {
              const geo = xyToE6(n.x, n.y);
              n.lat_e6 = geo.lat_e6;
              n.gt_lat_e6 = geo.lat_e6;
            }
            if (typeof ev.lon_e6 === 'number') {
              n.lon_e6 = ev.lon_e6;
              n.gt_lon_e6 = ev.lon_e6;
            } else {
              const geo = xyToE6(n.x, n.y);
              n.lon_e6 = geo.lon_e6;
              n.gt_lon_e6 = geo.lon_e6;
            }
            if (Number.isFinite(n.est_lat_e6) && Number.isFinite(n.est_lon_e6)) {
              n.pos_error_m = computePositionErrorM(n.est_lat_e6, n.est_lon_e6, n.gt_lat_e6, n.gt_lon_e6);
            }
          }
          break;
        case 'estimator_reset':
          if (n) {
            n.est_lat_e6 = n.gt_lat_e6 ?? n.lat_e6;
            n.est_lon_e6 = n.gt_lon_e6 ?? n.lon_e6;
            n.pos_error_m = 0.0;
            n.pos_mae_m = null;
            n.pos_rmse_m = null;
          }
          break;
        case 'link_update': {
          const lk = this.links.find(l => (l.a === ev.a && l.b === ev.b) || (l.a === ev.b && l.b === ev.a));
          if (lk) {
            if (typeof ev.rssi === 'number') lk.rssi = ev.rssi;
            if (typeof ev.dist === 'number') lk.dist = ev.dist;
            if (ev.in_range !== undefined) lk.blocked = !ev.in_range;
          }
          break;
        }
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
