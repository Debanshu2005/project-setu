// Project Setu - Operations Dashboard Main Application Orchestrator

import { SetuApi } from './api.js';
import { SimulationEngine } from './simulation.js';
import { Exporter } from './exporter.js';
import { TopologyVisualizer } from '../components/topology.js';
import { TimelineComponent } from '../components/timeline.js';
import { InspectorComponent } from '../components/inspector.js';
import { SosConsoleComponent } from '../components/console.js';
import { ChartsComponent } from '../components/charts.js';

class SetuDashboardApp {
  constructor() {
    this.sim = new SimulationEngine();
    this.currentScenario = null;
    this.scenarios = [];
    this.mode = 'live'; // 'live' (Interactive Digital Twin) or 'replay' (Trace Scrubber)
    this.isEngineRunning = false;
    this.eventSource = null;

    this.initElements();
    this.initComponents();
    this.initEvents();
    this.loadInitialData();
  }

  initElements() {
    // Header & status
    this.elStatusDot = document.getElementById('statusDot');
    this.elStatusText = document.getElementById('statusText');
    this.elScenarioSelect = document.getElementById('scenarioSelect');
    this.btnRunModal = document.getElementById('btnOpenRunModal');
    this.btnExportJson = document.getElementById('btnExportJson');
    this.btnExportCsv = document.getElementById('btnExportCsv');
    this.fileTraceUpload = document.getElementById('fileTraceUpload');

    // Live Mode & Trigger All Header Actions
    this.btnToggleMode = document.getElementById('btnToggleMode');
    this.btnOpenTriggerAllModal = document.getElementById('btnOpenTriggerAllModal');

    // Controls
    this.btnPlay = document.getElementById('btnPlay');
    this.btnStepBack = document.getElementById('btnStepBack');
    this.btnStepForward = document.getElementById('btnStepForward');
    this.btnReset = document.getElementById('btnReset');
    this.scrubberTrack = document.getElementById('scrubberTrack');
    this.scrubberProgress = document.getElementById('scrubberProgress');
    this.timeCurrentEl = document.getElementById('timeCurrent');
    this.timeDurationEl = document.getElementById('timeDuration');

    // Left Overview Metrics
    this.metricSimState = document.getElementById('metricSimState');
    this.metricClock = document.getElementById('metricClock');
    this.metricNodes = document.getElementById('metricNodes');
    this.metricOnline = document.getElementById('metricOnline');
    this.metricAlertsDelivered = document.getElementById('metricAlertsDelivered');
    this.metricAlertsPending = document.getElementById('metricAlertsPending');
    this.metricPdr = document.getElementById('metricPdr');
    this.metricLatency = document.getElementById('metricLatency');
    this.metricTx = document.getElementById('metricTx');
    this.metricRx = document.getElementById('metricRx');
    this.metricDrops = document.getElementById('metricDrops');
    this.metricRelaySuppressed = document.getElementById('metricRelaySuppressed');

    // Run Simulation Modal
    this.modalRunSim = document.getElementById('modalRunSim');
    this.btnCloseModal = document.getElementById('btnCloseModal');
    this.btnCancelModal = document.getElementById('btnCancelModal');
    this.btnExecuteSim = document.getElementById('btnExecuteSim');

    // Trigger All Modal
    this.modalTriggerAll = document.getElementById('modalTriggerAll');
    this.btnCloseTriggerAllModal = document.getElementById('btnCloseTriggerAllModal');
    this.btnCancelTriggerAll = document.getElementById('btnCancelTriggerAll');
    this.btnConfirmTriggerAll = document.getElementById('btnConfirmTriggerAll');
    this.selTriggerAllKind = document.getElementById('selTriggerAllKind');
    this.selTriggerAllJitter = document.getElementById('selTriggerAllJitter');
  }

  initComponents() {
    // 1. Topology
    const canvas = document.getElementById('topologyCanvas');
    this.topo = new TopologyVisualizer(canvas, this.sim);

    // Dynamic node repositioning in topology
    this.topo.onNodeReposition = async (id, x, y) => {
      if (this.mode === 'live') {
        try {
          await SetuApi.repositionNode(id, x, y);
          this.elStatusText.textContent = `REPOSITIONED NODE ${id} TO (${x}, ${y}) - LINKS RECALCULATED`;
          // Recalculate radio connectivity dynamically for new geometry
          const links = [];
          const nodeList = Array.from(this.sim.nodes.values());
          for (let i = 0; i < nodeList.length; ++i) {
            for (let j = i + 1; j < nodeList.length; ++j) {
              const na = nodeList[i];
              const nb = nodeList[j];
              const dist = Math.hypot(na.x - nb.x, na.y - nb.y);
              const rssi = 14.0 - (55.0 + 35.0 * Math.log10(Math.max(10.0, dist) / 10.0));
              if (rssi >= -120.0) {
                links.push({ a: na.id, b: nb.id, rssi: Math.round(rssi * 10) / 10, dist: Math.round(dist * 10) / 10, blocked: false });
              }
            }
          }
          this.sim.links = links;
          this.topo.render();
        } catch (e) {
          console.warn('Reposition failed:', e);
        }
      }
    };

    // 2. Right Panels: Inspector, Timeline, Charts
    const nodeInspectorEl = document.getElementById('nodeInspectorContent');
    const packetInspectorEl = document.getElementById('packetInspectorContent');
    this.inspector = new InspectorComponent(nodeInspectorEl, packetInspectorEl, this.sim);

    this.topo.onNodeSelect = node => {
      this.inspector.inspectNode(node);
      this.switchTab('tab-inspector');
    };

    // Inspector node trigger handler (C++ IPC)
    this.inspector.onTrigger = async (nodeId, kind) => {
      if (this.mode === 'live') {
        try {
          this.elStatusText.textContent = `TRIGGERING NODE ${nodeId} (${kind.toUpperCase()})...`;
          await SetuApi.triggerNode(nodeId, kind);
          this.elStatusText.textContent = `NODE ${nodeId} SOS DISPATCHED (${kind.toUpperCase()})`;
        } catch (err) {
          alert(`Trigger failed: ${err.message}`);
        }
      } else {
        alert(`Node ${nodeId} trigger requested in replay mode. Switch to LIVE DIGITAL TWIN to execute native triggers.`);
      }
    };

    // Inspector hardware fault toggle handler
    this.inspector.onStateChange = async (nodeId, stateUpdate) => {
      if (this.mode === 'live') {
        try {
          await SetuApi.setNodeState(nodeId, stateUpdate);
          this.elStatusText.textContent = `UPDATED NODE ${nodeId} STATE: ${JSON.stringify(stateUpdate)}`;
        } catch (err) {
          console.warn('Set node state failed:', err);
        }
      }
    };

    // 3. Timeline
    const timelineEl = document.getElementById('timelineContainer');
    this.timeline = new TimelineComponent(timelineEl, this.sim, this.topo);

    // 4. Charts
    const chartsEl = document.getElementById('chartsContainer');
    this.charts = new ChartsComponent(chartsEl, this.sim);

    // 5. Left Panel: SOS Console
    const sosConsoleEl = document.getElementById('sosConsoleContainer');
    this.console = new SosConsoleComponent(sosConsoleEl, this.sim, trigger => {
      this.handleInjectTrigger(trigger);
    });
  }

  initEvents() {
    // Mode Switch Button
    if (this.btnToggleMode) {
      this.btnToggleMode.addEventListener('click', () => {
        this.toggleOperatingMode();
      });
    }

    // Trigger All Modal Open
    if (this.btnOpenTriggerAllModal) {
      this.btnOpenTriggerAllModal.addEventListener('click', () => {
        if (this.modalTriggerAll) this.modalTriggerAll.classList.add('active');
      });
    }

    // Trigger All Modal Close
    const closeTriggerAll = () => {
      if (this.modalTriggerAll) this.modalTriggerAll.classList.remove('active');
    };
    if (this.btnCloseTriggerAllModal) this.btnCloseTriggerAllModal.addEventListener('click', closeTriggerAll);
    if (this.btnCancelTriggerAll) this.btnCancelTriggerAll.addEventListener('click', closeTriggerAll);

    // Trigger All Modal Confirm Action
    if (this.btnConfirmTriggerAll) {
      this.btnConfirmTriggerAll.addEventListener('click', async () => {
        const kind = this.selTriggerAllKind.value;
        const jitter = parseInt(this.selTriggerAllJitter.value, 10);
        closeTriggerAll();
        await this.executeTriggerAllSurvivors(kind, jitter);
      });
    }

    // Playback Controls
    this.btnPlay.addEventListener('click', async () => {
      if (this.mode === 'live') {
        if (this.isEngineRunning) {
          await SetuApi.pauseControl();
          this.isEngineRunning = false;
        } else {
          await SetuApi.startControl();
          this.isEngineRunning = true;
        }
        this.updatePlayButton();
      } else {
        this.sim.togglePlay();
        this.updatePlayButton();
      }
    });

    this.btnStepBack.addEventListener('click', () => {
      if (this.mode === 'live') {
        // In live mode, clock is monotonic in C++ engine
        this.sim.seek(Math.max(0, this.sim.currentTime - 1000));
      } else {
        this.sim.step(-1000);
      }
    });

    this.btnStepForward.addEventListener('click', async () => {
      if (this.mode === 'live') {
        await SetuApi.stepControl(1000);
      } else {
        this.sim.step(1000);
      }
    });

    this.btnReset.addEventListener('click', async () => {
      if (this.mode === 'live') {
        await SetuApi.resetControl();
        await this.syncLiveEngineState();
      } else {
        this.sim.seek(0);
      }
    });

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.sim.setSpeed(parseFloat(btn.dataset.speed));
      });
    });

    // Scrubber seek
    this.scrubberTrack.addEventListener('click', e => {
      const rect = this.scrubberTrack.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.sim.seek(pct * this.sim.meta.duration);
    });

    // Simulation updates
    this.sim.subscribe((engine, type) => {
      this.updateMetrics();
      this.updateScrubber();
      if (type === 'play' || type === 'pause' || type === 'complete') {
        this.updatePlayButton();
      }
    });

    // Topology filter buttons
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.topo.activeFilter = pill.dataset.filter;
        this.topo.render();
      });
    });

    // Zoom buttons
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      this.topo.scale *= 1.25;
      this.topo.render();
    });

    document.getElementById('btnZoomOut').addEventListener('click', () => {
      this.topo.scale *= 0.8;
      this.topo.render();
    });

    document.getElementById('btnZoomFit').addEventListener('click', () => {
      this.topo.fitToScreen();
    });

    // Tabs switching (Right sidebar)
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Scenario Select
    this.elScenarioSelect.addEventListener('change', async e => {
      const selectedId = e.target.value;
      if (selectedId) {
        await this.loadScenario(selectedId);
      }
    });

    // Run Modal
    this.btnRunModal.addEventListener('click', () => {
      this.modalRunSim.classList.add('active');
    });

    const closeModal = () => this.modalRunSim.classList.remove('active');
    this.btnCloseModal.addEventListener('click', closeModal);
    this.btnCancelModal.addEventListener('click', closeModal);

    // Modal Execute
    this.btnExecuteSim.addEventListener('click', async () => {
      await this.executeCustomSimulation();
    });

    // Export buttons
    this.btnExportJson.addEventListener('click', () => {
      Exporter.exportJson(this.sim);
    });

    this.btnExportCsv.addEventListener('click', () => {
      Exporter.exportCsv(this.sim);
    });

    // Upload custom trace
    this.fileTraceUpload.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        const events = SetuApi.parseJsonl(text);
        this.sim.loadTrace(events);
        this.timeline.setEvents();
      }
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === tabId);
    });
  }

  updatePlayButton() {
    this.btnPlay.textContent = this.sim.isPlaying ? '❚❚' : '▶';
    this.btnPlay.title = this.sim.isPlaying ? 'Pause Simulation' : 'Play Simulation';
  }

  updateScrubber() {
    const cur = this.sim.currentTime;
    const dur = this.sim.meta.duration || 30000;
    const pct = ((cur / dur) * 100).toFixed(2);
    this.scrubberProgress.style.width = `${pct}%`;

    this.timeCurrentEl.textContent = `${(cur / 1000).toFixed(2)}s`;
    this.timeDurationEl.textContent = `${(dur / 1000).toFixed(2)}s`;
  }

  updateMetrics() {
    const m = this.sim.getMetrics();
    this.metricSimState.textContent = this.sim.isPlaying ? 'RUNNING' : (m.clockMs >= m.durationMs ? 'COMPLETED' : 'PAUSED');
    this.metricClock.textContent = `${(m.clockMs / 1000).toFixed(1)}s`;
    this.metricNodes.textContent = m.totalNodes;
    this.metricOnline.textContent = `${m.onlineNodes} / ${m.totalNodes}`;
    this.metricAlertsDelivered.textContent = m.alertsTotal;
    this.metricAlertsPending.textContent = m.alertsPending;
    this.metricPdr.textContent = m.pdr;
    this.metricLatency.textContent = `${m.avgLatencyMs}ms`;
    this.metricTx.textContent = m.txTotal;
    this.metricRx.textContent = m.rxTotal;
    this.metricDrops.textContent = m.dropTotal;
    this.metricRelaySuppressed.textContent = m.relaySuppressedTotal;
  }

  toggleOperatingMode() {
    if (this.mode === 'live') {
      this.mode = 'replay';
      this.btnToggleMode.textContent = '📽️ SCENARIO REPLAY';
      this.btnToggleMode.style.color = '#f59e0b';
      this.btnToggleMode.style.borderColor = '#f59e0b';
      this.elStatusText.textContent = 'MODE: SCENARIO REPLAY (SCRUBBER ACTIVE)';
    } else {
      this.mode = 'live';
      this.btnToggleMode.textContent = '⚡ LIVE DIGITAL TWIN';
      this.btnToggleMode.style.color = 'var(--cyan-main)';
      this.btnToggleMode.style.borderColor = 'var(--cyan-main)';
      this.elStatusText.textContent = 'MODE: LIVE DIGITAL TWIN (INTERACTIVE C++ ENGINE)';
      this.syncLiveEngineState();
    }
  }

  initLiveEventStream() {
    this.eventSource = SetuApi.connectEvents(
      eventData => {
        if (this.mode !== 'live') return;
        this.handleLiveEngineEvent(eventData);
      },
      err => {
        console.warn('SSE stream error:', err);
      }
    );
  }

  handleLiveEngineEvent(ev) {
    if (!ev || !ev.ev) return;

    if (ev.ev === 'status') {
      this.isEngineRunning = !!ev.running;
      this.sim.currentTime = ev.time_ms || 0;
      this.updatePlayButton();
      this.updateScrubber();
      return;
    }

    if (ev.ev === 'state') {
      this.sim.currentTime = ev.time_ms || 0;
      if (Array.isArray(ev.nodes)) {
        for (const n of ev.nodes) {
          const existing = this.sim.nodes.get(n.id);
          if (existing) {
            existing.battery = n.battery;
            existing.online = n.online;
            existing.active_sos = n.active_sos;
            existing.gnss_on = n.gnss_on;
            existing.dr_on = n.dr_on;
            existing.stats = n.stats;
          }
        }
      }
      this.updateMetrics();
      this.topo.render();
      return;
    }

    if (ev.ev === 'summary') {
      this.updateMetrics();
      return;
    }

    // Trace events: tx, rx, drop, dedup, ack, suppress, sos, retry
    this.sim.events.push(ev);
    this.sim.currentTime = ev.t || this.sim.currentTime;

    if (ev.ev === 'tx') {
      this.sim.activePackets.push(ev);
      const na = this.sim.nodes.get(ev.node);
      if (na) {
        na.stats.tx++;
        if (!ev.ack) na.active_sos = true;
      }
    } else if (ev.ev === 'rx') {
      const nb = this.sim.nodes.get(ev.to);
      if (nb) nb.stats.rx++;
      if (ev.ack) {
        const orig = this.sim.nodes.get(ev.orig);
        if (orig) {
          orig.ack_received = true;
          orig.active_sos = false;
        }
      }
    } else if (ev.ev === 'drop') {
      const nb = this.sim.nodes.get(ev.to);
      if (nb) nb.stats.drop++;
    } else if (ev.ev === 'dedup') {
      const nn = this.sim.nodes.get(ev.node);
      if (nn) nn.stats.dedup++;
    } else if (ev.ev === 'suppress') {
      const nn = this.sim.nodes.get(ev.node);
      if (nn) nn.stats.suppressed++;
    } else if (ev.ev === 'retry') {
      const nn = this.sim.nodes.get(ev.node);
      if (nn) nn.stats.retries++;
    }

    // Clean up finished packet rings
    const curT = this.sim.currentTime;
    this.sim.activePackets = this.sim.activePackets.filter(p => (curT - p.t) < (p.air || 65) + 300);

    // Update timeline and metrics
    this.timeline.setEvents();
    this.updateMetrics();
    this.updateScrubber();
    this.topo.render();
  }

  async syncLiveEngineState() {
    try {
      const cState = await SetuApi.getControlState();
      if (cState && cState.nodes) {
        this.sim.loadTrace([]);
        // Re-populate nodes from native engine
        this.sim.nodes.clear();
        for (const n of cState.nodes) {
          this.sim.nodes.set(n.id, {
            id: n.id,
            role: n.role,
            x: n.x,
            y: n.y,
            battery: n.battery,
            online: n.online,
            active_sos: n.active_sos,
            ack_received: false,
            gnss_on: n.gnss_on,
            dr_on: n.dr_on,
            lat_e6: n.lat_e6,
            lon_e6: n.lon_e6,
            stats: n.stats || { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 }
          });
        }
        if (cState.links && cState.links.length > 0) {
          this.sim.links = cState.links;
        } else {
          // Radio link computation based on node positions and log-distance model
          const links = [];
          const nodeList = Array.from(this.sim.nodes.values());
          for (let i = 0; i < nodeList.length; ++i) {
            for (let j = i + 1; j < nodeList.length; ++j) {
              const na = nodeList[i];
              const nb = nodeList[j];
              const dist = Math.hypot(na.x - nb.x, na.y - nb.y);
              const rssi = 14.0 - (55.0 + 35.0 * Math.log10(Math.max(10.0, dist) / 10.0));
              if (rssi >= -120.0) {
                links.push({ a: na.id, b: nb.id, rssi: Math.round(rssi * 10) / 10, dist: Math.round(dist * 10) / 10, blocked: false });
              }
            }
          }
          this.sim.links = links;
        }
        this.sim.meta.duration = 60000;
        this.topo.fitToScreen();
        this.topo.render();
        this.updateMetrics();
      }
    } catch (err) {
      console.warn('Could not sync live engine state:', err);
    }
  }

  async executeTriggerAllSurvivors(kind, jitter) {
    if (this.mode === 'live') {
      try {
        this.elStatusDot.classList.add('simulating');
        this.elStatusText.textContent = `TRIGGERING ALL SURVIVOR NODES (${kind.toUpperCase()}, JITTER ±${jitter}ms)...`;
        const res = await SetuApi.triggerAll(kind, jitter);
        this.elStatusDot.classList.remove('simulating');
        this.elStatusText.textContent = `BROADCAST COMPLETED: ${res.triggered_count || 'ALL'} SURVIVOR NODES TRIGGERED`;
      } catch (err) {
        alert(`Trigger All failed: ${err.message}`);
        this.elStatusDot.classList.remove('simulating');
      }
    } else {
      alert(`Trigger All requested in Replay Mode. Switch to LIVE DIGITAL TWIN to trigger C++ engine.`);
    }
  }

  async loadInitialData() {
    // 1. Fetch server status
    const status = await SetuApi.getStatus();
    if (status.status === 'online') {
      this.elStatusDot.style.background = '#10b981';
      this.elStatusText.textContent = `CORE C++ ENGINE ONLINE (${status.simulatorPath || 'BUILD READY'})`;
    } else {
      this.elStatusDot.style.background = '#ef4444';
      this.elStatusText.textContent = `SIMULATOR OFFLINE`;
    }

    // 2. Connect SSE live event stream
    this.initLiveEventStream();

    // 3. Sync live engine state
    await this.syncLiveEngineState();

    // 4. Fetch scenarios for selector
    this.scenarios = await SetuApi.getScenarios();
    this.elScenarioSelect.innerHTML = this.scenarios.map(sc => `
      <option value="${sc.id}">${sc.name}</option>
    `).join('');
  }

  async loadScenario(scenarioId) {
    try {
      this.mode = 'replay';
      if (this.btnToggleMode) {
        this.btnToggleMode.textContent = '📽️ SCENARIO REPLAY';
        this.btnToggleMode.style.color = '#f59e0b';
        this.btnToggleMode.style.borderColor = '#f59e0b';
      }
      this.elStatusDot.classList.add('simulating');
      this.elStatusText.textContent = `LOADING SCENARIO TRACE: ${scenarioId}...`;

      const traceFilename = `${scenarioId}.jsonl`;
      const events = await SetuApi.fetchTrace(traceFilename);
      this.sim.loadTrace(events);
      this.timeline.setEvents();

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `TRACE LOADED: ${events.length} EVENTS (${scenarioId})`;
    } catch (err) {
      console.warn(`Could not load pre-generated trace for ${scenarioId}, attempting live simulation:`, err);
      const sc = this.scenarios.find(s => s.id === scenarioId);
      if (sc) {
        await this.runScenarioLive(sc);
      }
    }
  }

  async runScenarioLive(sc) {
    try {
      this.elStatusDot.classList.add('simulating');
      this.elStatusText.textContent = `RUNNING SIMULATOR: ${sc.name}...`;

      const result = await SetuApi.runSimulation(sc);
      let events = [];
      if (result.traceEvents && Array.isArray(result.traceEvents)) {
        events = result.traceEvents;
      } else if (result.traceFilename) {
        events = await SetuApi.fetchTrace(result.traceFilename);
      }
      this.sim.loadTrace(events, result.summary);
      this.timeline.setEvents();

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `SIMULATION COMPLETE: ${events.length} EVENTS RECORDED`;
    } catch (err) {
      alert(`Simulation failed: ${err.message}`);
      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `SIMULATION ERROR: ${err.message}`;
    }
  }

  async executeCustomSimulation() {
    const survivors = parseInt(document.getElementById('simSurvivors').value, 10);
    const relays = parseInt(document.getElementById('simRelays').value, 10);
    const duration = parseInt(document.getElementById('simDuration').value, 10);
    const seed = parseInt(document.getElementById('simSeed').value, 10);
    const sf = parseInt(document.getElementById('simSf').value, 10);
    const loss = parseFloat(document.getElementById('simLoss').value);
    const pathExp = parseFloat(document.getElementById('simPathExp').value);

    const payload = {
      params: {
        survivors,
        relays,
        duration: duration * 1000,
        seed,
        sf,
        loss,
        path_exp: pathExp,
        zone: 1200
      },
      triggers: [
        { node: 1, kind: 'short', t: 1000 },
        { node: 2, kind: 'double', t: 3000 }
      ],
      faults: []
    };

    this.modalRunSim.classList.remove('active');
    this.elStatusDot.classList.add('simulating');
    this.elStatusText.textContent = `RUNNING CUSTOM SIMULATION (SEED ${seed})...`;

    try {
      const result = await SetuApi.runSimulation(payload);
      let events = [];
      if (result.traceEvents && Array.isArray(result.traceEvents)) {
        events = result.traceEvents;
      } else if (result.traceFilename) {
        events = await SetuApi.fetchTrace(result.traceFilename);
      }
      this.sim.loadTrace(events, result.summary);
      this.timeline.setEvents();

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `CUSTOM SIMULATION READY (${events.length} EVENTS)`;
      this.sim.play();
    } catch (err) {
      alert(`Custom simulation failed: ${err.message}`);
      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `SIMULATION ERROR: ${err.message}`;
    }
  }

  handleInjectTrigger(tr) {
    if (this.mode === 'live') {
      SetuApi.triggerNode(tr.node, tr.kind);
    } else {
      alert(`SOS Trigger Injected on Survivor Node ${tr.node} (${tr.kind.toUpperCase()}). In replay mode, seek or configure this in scenario settings.`);
    }
  }
}

// Instantiate on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  window.setuApp = new SetuDashboardApp();
});
