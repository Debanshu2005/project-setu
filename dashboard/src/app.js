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
      // 1. If currently in replay mode, auto-switch to live digital twin mode
      if (this.mode !== 'live') {
        this.toggleOperatingMode();
      }

      try {
        // 2. Immediately mark local node state for instant visual feedback on canvas
        const tn = this.sim.nodes.get(nodeId);
        if (tn) {
          tn.active_sos = true;
          tn.active = true;
          tn.acked = false;
          tn.gave_up = false;
          if (this.inspector.selectedNode && this.inspector.selectedNode.id === nodeId) {
            this.inspector.inspectNode(tn);
          }
        }
        this.topo.render();
        this.updateMetrics();

        this.elStatusText.textContent = `TRIGGERING NODE ${nodeId} (${kind.toUpperCase()})...`;
        await SetuApi.triggerNode(nodeId, kind);

        // 3. Ensure engine is running continuous simulation or step clock so FreeRTOS queues drain
        if (!this.isEngineRunning) {
          await SetuApi.startControl();
          this.isEngineRunning = true;
          this.updatePlayButton();
        }

        // 4. Step clock forward by 1000ms so the 150ms press + 600ms double-click debounce window elapses and LoRa RF packets transmit
        await SetuApi.stepControl(1000);

        this.elStatusText.textContent = `NODE ${nodeId} SOS ACTIVE (${kind.toUpperCase()}) — LORA PACKETS PROPAGATING`;
        await this.syncLiveEngineState();
        const updated = this.sim.nodes.get(nodeId);
        if (updated && this.inspector.selectedNode && this.inspector.selectedNode.id === nodeId) {
          this.inspector.inspectNode(updated);
        }
      } catch (err) {
        alert(`Trigger failed: ${err.message}`);
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

    // Backend Settings Modal
    const modalBackend = document.getElementById('modalBackendSettings');
    const btnOpenBackend = document.getElementById('btnOpenBackendModal');
    const btnCloseBackend = document.getElementById('btnCloseBackendModal');
    const txtBackendUrl = document.getElementById('txtBackendUrl');
    const btnTestBackend = document.getElementById('btnTestBackendConnection');
    const btnSaveBackend = document.getElementById('btnSaveBackendUrl');
    const lblEngineStatus = document.getElementById('lblBackendEngineStatus');

    if (btnOpenBackend && modalBackend) {
      btnOpenBackend.addEventListener('click', () => {
        if (txtBackendUrl) txtBackendUrl.value = SetuApi.getBaseUrl();
        modalBackend.classList.add('active');
        modalBackend.style.display = 'flex';
      });

      const closeBackendModal = () => {
        modalBackend.classList.remove('active');
        modalBackend.style.display = 'none';
      };

      if (btnCloseBackend) btnCloseBackend.addEventListener('click', closeBackendModal);

      if (btnTestBackend) {
        btnTestBackend.addEventListener('click', async () => {
          lblEngineStatus.textContent = 'Testing connection...';
          lblEngineStatus.style.color = '#38bdf8';
          const prev = SetuApi.getBaseUrl();
          if (txtBackendUrl) SetuApi.setBaseUrl(txtBackendUrl.value);
          const st = await SetuApi.getStatus();
          if (st.status === 'online') {
            lblEngineStatus.textContent = `● Online: ${st.platform || 'Native Bridge'} (${st.version || 'FITL'})`;
            lblEngineStatus.style.color = '#10b981';
          } else {
            lblEngineStatus.textContent = `× Error: ${st.error || 'Connection Failed'}`;
            lblEngineStatus.style.color = '#ef4444';
          }
          SetuApi.setBaseUrl(prev);
        });
      }

      if (btnSaveBackend) {
        btnSaveBackend.addEventListener('click', async () => {
          if (txtBackendUrl) SetuApi.setBaseUrl(txtBackendUrl.value);
          closeBackendModal();
          await this.loadInitialData();
        });
      }
    }

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
      statusData => {
        if (this.mode !== 'live') return;
        if (statusData && typeof statusData.running === 'boolean') {
          this.isEngineRunning = statusData.running;
          this.updatePlayButton();
        }
      },
      err => {
        console.warn('SSE stream notice:', err);
      }
    );
  }

  handleLiveEngineEvent(ev) {
    if (!ev || !ev.ev) return;

    if (ev.ev === 'status') {
      this.isEngineRunning = !!ev.running;
      this.sim.currentTime = ev.time_ms || ev.t || 0;
      this.updatePlayButton();
      this.updateScrubber();
      return;
    }

    if (ev.ev === 'state') {
      this.sim.currentTime = ev.time_ms || ev.t || 0;
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

    // Trace events: tx, rx, drop, dedup, ack, suppress, sos, retry, alert, haptic, button_down
    this.sim.events.push(ev);
    this.sim.currentTime = ev.t || this.sim.currentTime;

    if (ev.ev === 'tx') {
      this.sim.activePackets.push(ev);
      const na = this.sim.nodes.get(ev.node);
      if (na) {
        na.stats.tx++;
        if (ev.ack) {
          // ACK transmission from Hub or Relay
          const target = this.sim.nodes.get(ev.target);
          if (target) {
            target.ack_received = true;
            target.acked = true;
            target.active_sos = false;
            target.active = false;
          }
        } else {
          na.active_sos = true;
          na.active = true;
          na.acked = false;
        }
        if (typeof ev.seq === 'number') na.seq = ev.seq;
        if (typeof ev.battery === 'number') na.battery = ev.battery;
      }
    } else if (ev.ev === 'rx') {
      const rxId = ev.node !== undefined ? ev.node : ev.to;
      const nb = this.sim.nodes.get(rxId);
      if (nb) nb.stats.rx++;
    } else if (ev.ev === 'alert') {
      // Hub sink alert delivery
      this.sim.alerts.push(ev);
      if (this.console && typeof this.console.renderAlerts === 'function') {
        this.console.renderAlerts();
      }
    } else if (ev.ev === 'haptic') {
      // Haptic confirmation (pattern 3 = AckReceived)
      if (ev.pattern === 3) {
        const survivor = this.sim.nodes.get(ev.node);
        if (survivor) {
          survivor.ack_received = true;
          survivor.acked = true;
          survivor.active_sos = false;
          survivor.active = false;
        }
      }
    } else if (ev.ev === 'button_down') {
      const survivor = this.sim.nodes.get(ev.node);
      if (survivor) {
        survivor.active_sos = true;
        survivor.active = true;
        survivor.acked = false;
      }
    } else if (ev.ev === 'drop') {
      const dropId = ev.node !== undefined ? ev.node : ev.to;
      const nb = this.sim.nodes.get(dropId);
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

    // Update inspector if inspecting affected node
    if (this.inspector && this.inspector.selectedNode &&
        (this.inspector.selectedNode.id === ev.node || this.inspector.selectedNode.id === ev.origin || this.inspector.selectedNode.id === ev.target)) {
      this.inspector.renderNode();
    }

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
            active_sos: n.active,
            ack_received: n.acked,
            active: n.active,
            acked: n.acked,
            gave_up: n.gave_up,
            seq: n.seq,
            duty_used_ms: n.duty_used_ms,
            button_q: n.button_q !== undefined ? n.button_q : 0,
            radio_q: n.radio_q !== undefined ? n.radio_q : 0,
            button_q_ovf: n.button_q_ovf !== undefined ? n.button_q_ovf : 0,
            radio_q_ovf: n.radio_q_ovf !== undefined ? n.radio_q_ovf : 0,
            gnss_on: n.gnss !== undefined ? n.gnss : true,
            dr_on: n.dr !== undefined ? n.dr : true,
            lat_e6: n.lat_e6,
            lon_e6: n.lon_e6,
            stats: {
              tx: (n.tx_sos || 0) + (n.tx_relay || 0) + (n.tx_ack || 0),
              rx: n.rx_total || 0,
              drop: 0,
              dedup: n.rx_dup || 0,
              suppressed: n.relay_suppressed || 0,
              retries: n.retries || 0
            }
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
        if (this.console && typeof this.console.populateSurvivors === 'function') {
          this.console.populateSurvivors();
        }
      }
    } catch (err) {
      console.warn('Could not sync live engine state:', err);
    }
  }

  async executeTriggerAllSurvivors(kind, jitter) {
    // 1. Auto-switch to live digital twin mode if in replay mode
    if (this.mode !== 'live') {
      this.toggleOperatingMode();
    }

    try {
      this.elStatusDot.classList.add('simulating');
      this.elStatusText.textContent = `BROADCASTING EMERGENCY WAVE (${kind.toUpperCase()}, JITTER ±${jitter}ms)...`;

      // 2. Immediately mark all survivor nodes as active SOS for instant visual feedback on canvas
      let survivorCount = 0;
      for (const [, n] of this.sim.nodes) {
        if (n.role === 'survivor' && n.online) {
          n.active_sos = true;
          n.active = true;
          n.acked = false;
          n.gave_up = false;
          survivorCount++;
        }
      }
      this.topo.render();
      this.updateMetrics();

      // 3. Dispatch broadcast trigger to C++ engine
      const res = await SetuApi.triggerAll(kind, jitter);

      // 4. Ensure engine is running continuous simulation so packets ripple across the mesh
      if (!this.isEngineRunning) {
        await SetuApi.startControl();
        this.isEngineRunning = true;
        this.updatePlayButton();
      }

      // Step forward by at least 1000ms (or jitter + 1000ms) so button release and double-gap elapse
      await SetuApi.stepControl(Math.max(1000, jitter + 1000));

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `BROADCAST COMPLETE: ${survivorCount} SURVIVORS ACTIVE — PROPAGATING LORA MESH WAVE`;
      await this.syncLiveEngineState();
    } catch (err) {
      alert(`Trigger All failed: ${err.message}`);
      this.elStatusDot.classList.remove('simulating');
    }
  }

  async loadInitialData() {
    // 0. Resolve backend URL first
    await SetuApi.resolveBaseUrl();

    // 1. Fetch server status with wake-up handling for Render Free sleep
    const base = SetuApi.getBaseUrl();
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!base && !isLocal) {
      this.elStatusDot.style.background = '#f59e0b';
      this.elStatusText.textContent = 'BACKEND URL REQUIRED (Click ⚡ Backend above to connect)';
      return;
    }

    let status = await SetuApi.getStatus();
    if (status.status === 'offline' && base && (base.includes('onrender.com') || base.includes('render'))) {
      this.elStatusDot.style.background = '#f59e0b';
      this.elStatusText.textContent = 'WAKING UP RENDER ENGINE... (Cold start may take ~30s)';
      const ping = await SetuApi.pingBackend(base, 15000);
      if (ping.ok) {
        status = await SetuApi.getStatus();
      }
    }

    if (status.status === 'online') {
      this.elStatusDot.style.background = '#10b981';
      this.elStatusText.textContent = `CORE C++ ENGINE ONLINE (${status.simulatorPath || 'BUILD READY'})`;
    } else {
      this.elStatusDot.style.background = '#ef4444';
      this.elStatusText.textContent = status.status === 'unconfigured'
        ? 'CONFIGURE BACKEND URL (Click ⚡ Backend)'
        : `SIMULATOR OFFLINE (${status.error || 'Connection Failed'})`;
    }

    // 2. Connect SSE live event stream
    this.initLiveEventStream();

    // 3. Sync live engine state
    await this.syncLiveEngineState();

    // 4. Fetch scenarios for selector
    this.scenarios = await SetuApi.getScenarios();
    if (this.scenarios && this.scenarios.length > 0) {
      this.elScenarioSelect.innerHTML = this.scenarios.map(sc => `
        <option value="${sc.id}">${sc.name}</option>
      `).join('');
    }

    // 5. If engine state has no nodes (e.g. offline or starting), initialize default topology so the canvas and inspector are immediately populated
    if (this.sim.nodes.size === 0) {
      this.initDefaultTopology();
    }

    // Auto-inspect Node 1 by default so the right-side Inspector panel is immediately populated
    const defaultNode = this.sim.nodes.get(1) || (this.sim.nodes.size > 0 ? this.sim.nodes.values().next().value : null);
    if (defaultNode) {
      this.inspector.inspectNode(defaultNode);
    }
  }

  initDefaultTopology() {
    this.sim.nodes.clear();
    this.sim.links = [];
    // 1 Hub at (150, 150)
    this.sim.nodes.set(0, {
      id: 0, role: 'hub', x: 150, y: 150, lat_e6: 28613900, lon_e6: 77209000,
      battery: 100, online: true, gnss_on: true, dr_on: true, active_sos: false, acked: false, gave_up: false,
      stats: { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 }
    });
    // 5 Relays on a loose grid
    const relayCoords = [[380, 200], [680, 240], [350, 480], [650, 520], [920, 380]];
    relayCoords.forEach((c, idx) => {
      const rid = 100 + idx;
      this.sim.nodes.set(rid, {
        id: rid, role: 'relay', x: c[0], y: c[1], lat_e6: 28613900 + c[0] * 10, lon_e6: 77209000 + c[1] * 10,
        battery: 100, online: true, gnss_on: true, dr_on: true, active_sos: false, acked: false, gave_up: false,
        stats: { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 }
      });
    });
    // 20 Survivors scattered
    for (let i = 1; i <= 20; i++) {
      const angle = (i / 20) * 2 * Math.PI;
      const dist = 220 + (i % 5) * 110;
      const sx = Math.round(520 + dist * Math.cos(angle));
      const sy = Math.round(380 + dist * Math.sin(angle));
      this.sim.nodes.set(i, {
        id: i, role: 'survivor', x: sx, y: sy, lat_e6: 28613900 + sx * 10, lon_e6: 77209000 + sy * 10,
        battery: 85 + (i % 16), online: true, gnss_on: true, dr_on: true, active_sos: false, acked: false, gave_up: false,
        stats: { tx: 0, rx: 0, drop: 0, dedup: 0, suppressed: 0, retries: 0 }
      });
    }
    // Calculate radio links based on log-distance model
    const nodeList = Array.from(this.sim.nodes.values());
    for (let i = 0; i < nodeList.length; ++i) {
      for (let j = i + 1; j < nodeList.length; ++j) {
        const na = nodeList[i];
        const nb = nodeList[j];
        const d = Math.hypot(na.x - nb.x, na.y - nb.y);
        const rssi = 14.0 - (55.0 + 35.0 * Math.log10(Math.max(10.0, d) / 10.0));
        if (rssi >= -120.0) {
          this.sim.links.push({ a: na.id, b: nb.id, rssi: Math.round(rssi * 10) / 10, dist: Math.round(d * 10) / 10, blocked: false });
        }
      }
    }
    this.topo.fitToScreen();
    this.topo.render();
    this.updateMetrics();
    if (this.console && typeof this.console.populateSurvivors === 'function') {
      this.console.populateSurvivors();
    }
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
    const nodeId = parseInt(tr.node || tr.id, 10);
    const kind = String(tr.kind || 'short');
    if (this.inspector && typeof this.inspector.onTrigger === 'function') {
      this.inspector.onTrigger(nodeId, kind);
    } else {
      SetuApi.triggerNode(nodeId, kind);
    }
  }
}

// Instantiate on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  window.setuApp = new SetuDashboardApp();
});
