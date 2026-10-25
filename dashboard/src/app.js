// Project Setu - Operations Dashboard Main Application Orchestrator

import { SetuApi } from './api.js';
import { SimulationEngine } from './simulation.js';
import { Exporter } from './exporter.js';
import { TopologyVisualizer } from '../components/topology.js';
import { TimelineComponent } from '../components/timeline.js';
import { InspectorComponent } from '../components/inspector.js';
import { SosConsoleComponent } from '../components/console.js';
import { ChartsComponent } from '../components/charts.js';
import { NodeHealthComponent } from '../components/node_health.js';

class SetuDashboardApp {
  constructor() {
    this.sim = new SimulationEngine();
    this.currentScenario = null;
    this.scenarios = [];
    this.mode = 'live'; // 'live' (Interactive Digital Twin) or 'replay' (Trace Scrubber)
    this.isEngineRunning = false;
    this.eventSource = null;

    this.backendModalInitialized = false;

    this.initElements();
    this.initBackendModal(); // Bound immediately so backend settings modal is always usable even if subsequent initializations throw
    this.initComponents();
    this.initEvents();
    this.loadInitialData().catch(err => {
      console.warn('Initial data load notice:', err);
    });
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
      await this.executeNodeTrigger(nodeId, kind);
    };

    // Inspector hardware fault toggle handler
    this.inspector.onStateChange = async (nodeId, stateUpdate) => {
      await this.executeNodeStateChange(nodeId, stateUpdate);
    };

    // Inspector link blocking toggle handler
    this.inspector.onLinkToggle = async (a, b, blocked) => {
      await this.executeLinkToggle(a, b, blocked);
    };

    // 3. Timeline
    const timelineEl = document.getElementById('timelineContainer');
    this.timeline = new TimelineComponent(timelineEl, this.sim, this.topo);

    // 4. Charts with interactive click-to-timeline navigation
    const chartsEl = document.getElementById('chartsContainer');
    this.charts = new ChartsComponent(chartsEl, this.sim, (category, label, events) => {
      this.switchTab('tab-timeline');
      if (this.timeline && typeof this.timeline.filterByCustomEvents === 'function') {
        this.timeline.filterByCustomEvents(events, label);
      }
    });

    // 5. Fleet Node Health Component
    const nodeHealthEl = document.getElementById('nodeHealthContainer');
    if (nodeHealthEl) {
      this.nodeHealth = new NodeHealthComponent(nodeHealthEl, this.sim, nodeId => {
        const node = this.sim.nodes.get(nodeId);
        if (node) {
          this.topo.selectedNodeId = nodeId;
          this.inspector.inspectNode(node);
          this.switchTab('tab-inspector');
          this.topo.render();
        }
      });
    }

    // 6. Left Panel: Operator Command & SOS Injection Console
    const sosConsoleEl = document.getElementById('sosConsoleContainer');
    this.console = new SosConsoleComponent(sosConsoleEl, this.sim, async cmdObj => {
      return await this.executeOperatorCommand(cmdObj);
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
    if (this.btnPlay) {
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
    }

    if (this.btnStepBack) {
      this.btnStepBack.addEventListener('click', () => {
        if (this.mode === 'live') {
          // In live mode, clock is monotonic in C++ engine
          this.sim.seek(Math.max(0, this.sim.currentTime - 1000));
        } else {
          this.sim.step(-1000);
        }
      });
    }

    if (this.btnStepForward) {
      this.btnStepForward.addEventListener('click', async () => {
        if (this.mode === 'live') {
          await SetuApi.stepControl(1000);
        } else {
          this.sim.step(1000);
        }
      });
    }

    if (this.btnReset) {
      this.btnReset.addEventListener('click', async () => {
        if (this.mode === 'live') {
          await SetuApi.resetControl();
          await this.syncLiveEngineState(true);
          this.timeline.setEvents();
          this.elStatusText.textContent = 'SIMULATION RESET TO INITIAL STATE (CONFIGURED BATTERY LEVELS PRESERVED)';
        } else {
          this.sim.seek(0);
        }
      });
    }

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.sim.setSpeed(parseFloat(btn.dataset.speed));
      });
    });

    // Scrubber seek
    if (this.scrubberTrack) {
      this.scrubberTrack.addEventListener('click', e => {
        const rect = this.scrubberTrack.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.sim.seek(pct * this.sim.meta.duration);
      });
    }

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
    const btnZoomIn = document.getElementById('btnZoomIn');
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        this.topo.scale *= 1.25;
        this.topo.render();
      });
    }

    const btnZoomOut = document.getElementById('btnZoomOut');
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        this.topo.scale *= 0.8;
        this.topo.render();
      });
    }

    const btnZoomFit = document.getElementById('btnZoomFit');
    if (btnZoomFit) {
      btnZoomFit.addEventListener('click', () => {
        this.topo.fitToScreen();
      });
    }

    // Tabs switching (Right sidebar)
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Scenario Select
    if (this.elScenarioSelect) {
      this.elScenarioSelect.addEventListener('change', async e => {
        const selectedId = e.target.value;
        if (selectedId) {
          await this.loadScenario(selectedId);
        }
      });
    }

    // Run Modal
    if (this.btnRunModal && this.modalRunSim) {
      this.btnRunModal.addEventListener('click', () => {
        this.modalRunSim.classList.add('active');
      });

      const closeModal = () => this.modalRunSim.classList.remove('active');
      if (this.btnCloseModal) this.btnCloseModal.addEventListener('click', closeModal);
      if (this.btnCancelModal) this.btnCancelModal.addEventListener('click', closeModal);

      if (this.btnExecuteSim) {
        this.btnExecuteSim.addEventListener('click', async () => {
          await this.executeCustomSimulation();
        });
      }
    }

    // Ensure Backend Modal registration
    this.initBackendModal();

    // Export buttons
    if (this.btnExportJson) {
      this.btnExportJson.addEventListener('click', () => {
        Exporter.exportJson(this.sim);
      });
    }

    if (this.btnExportCsv) {
      this.btnExportCsv.addEventListener('click', () => {
        Exporter.exportCsv(this.sim);
      });
    }

    // Upload custom trace
    if (this.fileTraceUpload) {
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
  }

  initBackendModal() {
    if (this.backendModalInitialized) return;
    this.backendModalInitialized = true;

    const modalBackend = document.getElementById('modalBackendSettings');
    const btnOpenBackend = document.getElementById('btnOpenBackendModal');
    const btnCloseBackend = document.getElementById('btnCloseBackendModal');
    const txtBackendUrl = document.getElementById('txtBackendUrl');
    const btnTestBackend = document.getElementById('btnTestBackendConnection');
    const btnSaveBackend = document.getElementById('btnSaveBackendUrl');
    const btnResetBackend = document.getElementById('btnResetBackendUrl');
    const lblEngineStatus = document.getElementById('lblBackendEngineStatus');
    const lblBackendSource = document.getElementById('lblBackendSource');

    if (!modalBackend || !btnOpenBackend) {
      console.warn('Backend modal elements not found in DOM');
      return;
    }

    const openBackendModal = () => {
      if (txtBackendUrl) txtBackendUrl.value = SetuApi.getBaseUrl();
      if (lblBackendSource) {
        const src = SetuApi.getSource();
        const isOverride = SetuApi.isManualOverride();
        lblBackendSource.textContent = `Source: ${src.toUpperCase()}${isOverride ? ' (Manual override active)' : ''}`;
      }
      if (lblEngineStatus) {
        const base = SetuApi.getBaseUrl();
        lblEngineStatus.textContent = base ? `Active Target: ${base}` : 'No backend URL configured';
        lblEngineStatus.style.color = '#94a3b8';
      }
      modalBackend.classList.add('active');
      modalBackend.style.display = 'flex';
    };

    const closeBackendModal = () => {
      modalBackend.classList.remove('active');
      modalBackend.style.display = 'none';
    };

    // 1. Open Button
    btnOpenBackend.addEventListener('click', openBackendModal);

    // 2. Close Button (×)
    if (btnCloseBackend) {
      btnCloseBackend.addEventListener('click', closeBackendModal);
    }

    // 3. Click Backdrop Overlay to Close
    modalBackend.addEventListener('click', e => {
      if (e.target === modalBackend) {
        closeBackendModal();
      }
    });

    // 4. Escape Key to Close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modalBackend.classList.contains('active')) {
        closeBackendModal();
      }
    });

    // 5. Test Connection Button
    if (btnTestBackend) {
      btnTestBackend.addEventListener('click', async () => {
        const candidate = (txtBackendUrl?.value || '').trim();
        if (lblEngineStatus) {
          lblEngineStatus.textContent = `Testing /health at ${candidate || 'configured backend'}...`;
          lblEngineStatus.style.color = '#38bdf8';
        }
        const result = await SetuApi.pingBackend(candidate);
        if (lblEngineStatus) {
          if (result.ok) {
            const data = result.data || {};
            const service = data.service || 'Backend Service';
            const engine = data.engine || 'FITL Simulator Core';
            const uptime = data.uptimeSeconds ? ` (uptime: ${data.uptimeSeconds}s)` : '';
            lblEngineStatus.textContent = `● Online: ${service} / ${engine}${uptime} — HTTP 200`;
            lblEngineStatus.style.color = '#10b981';
          } else {
            lblEngineStatus.textContent = `× Connection failed: ${result.error || `HTTP ${result.status}`}`;
            lblEngineStatus.style.color = '#ef4444';
          }
        }
      });
    }

    // 6. Save & Reconnect Button
    if (btnSaveBackend) {
      btnSaveBackend.addEventListener('click', async () => {
        const url = (txtBackendUrl?.value || '').trim();
        if (url) {
          SetuApi.setManualOverride(url);
        } else {
          await SetuApi.clearManualOverride();
        }
        closeBackendModal();
        await this.loadInitialData();
      });
    }

    // 7. Reset to Default Button
    if (btnResetBackend) {
      btnResetBackend.addEventListener('click', async () => {
        if (lblEngineStatus) {
          lblEngineStatus.textContent = 'Clearing manual override & querying default...';
          lblEngineStatus.style.color = '#38bdf8';
        }
        const defaultUrl = await SetuApi.clearManualOverride();
        if (txtBackendUrl) txtBackendUrl.value = defaultUrl;
        if (lblBackendSource) {
          lblBackendSource.textContent = `Source: ${SetuApi.getSource().toUpperCase()} (Default restored)`;
        }
        if (lblEngineStatus) {
          lblEngineStatus.textContent = defaultUrl ? `Default restored: ${defaultUrl}` : 'No environment default configured';
          lblEngineStatus.style.color = defaultUrl ? '#10b981' : '#f59e0b';
        }
        await this.loadInitialData();
      });
    }

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
    const isPlaying = this.mode === 'live' ? this.isEngineRunning : this.sim.isPlaying;
    this.btnPlay.textContent = isPlaying ? '❚❚' : '▶';
    this.btnPlay.title = isPlaying ? 'Pause Simulation' : (this.mode === 'live' ? 'Run / Resume Live Simulation' : 'Play Replay');
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
    if (this.mode === 'live') {
      this.metricSimState.textContent = this.isEngineRunning ? 'RUNNING (LIVE)' : (m.clockMs === 0 ? 'READY' : 'PAUSED (LIVE)');
      this.metricSimState.style.background = this.isEngineRunning ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)';
      this.metricSimState.style.borderColor = this.isEngineRunning ? '#10b981' : '#38bdf8';
      this.metricSimState.style.color = this.isEngineRunning ? '#34d399' : '#7dd3fc';
    } else {
      this.metricSimState.textContent = this.sim.isPlaying ? 'REPLAYING' : (m.clockMs >= m.durationMs ? 'COMPLETED' : 'PAUSED (REPLAY)');
      this.metricSimState.style.background = 'rgba(245, 158, 11, 0.2)';
      this.metricSimState.style.borderColor = '#f59e0b';
      this.metricSimState.style.color = '#fcd34d';
    }
    this.metricClock.textContent = `${(m.clockMs / 1000).toFixed(1)}s`;
    this.metricNodes.textContent = m.totalNodes;
    this.metricOnline.textContent = `${m.onlineNodes} / ${m.totalNodes}`;
    this.metricAlertsDelivered.textContent = m.alertsTotal;
    this.metricAlertsPending.textContent = m.alertsPending;
    this.metricPdr.textContent = m.pdr;
    this.metricLatency.textContent = m.latencyDisplay;
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
            if (typeof n.battery === 'number') existing.battery = n.battery;
            if (typeof n.initial_battery === 'number') existing.initial_battery = n.initial_battery;
            if (typeof n.energy_consumed_mah === 'number') existing.energy_consumed_mah = n.energy_consumed_mah;
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
        if (typeof ev.energy_mah === 'number') na.energy_consumed_mah = ev.energy_mah;
        else if (typeof ev.mah === 'number') na.energy_consumed_mah = ev.mah;
        else na.energy_consumed_mah = Math.round(((na.energy_consumed_mah || 0) + 1.5) * 1000) / 1000;
        if (typeof ev.battery === 'number') na.battery = ev.battery;
        else na.battery = Math.max(0, Math.round(100 - (na.energy_consumed_mah / 300) * 100));
        if (na.battery === 0) na.online = false;
      }
    } else if (ev.ev === 'rx') {
      const rxId = ev.node !== undefined ? ev.node : ev.to;
      const nb = this.sim.nodes.get(rxId);
      if (nb) {
        nb.stats.rx++;
        if (typeof ev.energy_mah === 'number') nb.energy_consumed_mah = ev.energy_mah;
        else if (typeof ev.mah === 'number') nb.energy_consumed_mah = ev.mah;
        else nb.energy_consumed_mah = Math.round(((nb.energy_consumed_mah || 0) + 0.3) * 1000) / 1000;
        if (typeof ev.battery === 'number') nb.battery = ev.battery;
        else nb.battery = Math.max(0, Math.round(100 - (nb.energy_consumed_mah / 300) * 100));
        if (nb.battery === 0) nb.online = false;
      }
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
    } else if (ev.ev === 'battery') {
      const nb = this.sim.nodes.get(ev.node);
      if (nb) {
        if (typeof ev.battery === 'number') nb.battery = ev.battery;
        if (typeof ev.mah === 'number') nb.energy_consumed_mah = ev.mah;
        if (nb.initial_battery === undefined && typeof ev.battery === 'number') nb.initial_battery = ev.battery;
        if (nb.battery === 0) nb.online = false;
      }
    } else if (ev.ev === 'battery_depleted') {
      const nb = this.sim.nodes.get(ev.node);
      if (nb) {
        nb.battery = 0;
        nb.online = false;
      }
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

  async executeNodeTrigger(nodeId, kind) {
    if (this.mode !== 'live') {
      this.toggleOperatingMode();
    }

    const tn = this.sim.nodes.get(nodeId);
    if (tn) {
      tn.pending_trigger = true;
      this.topo.render();
      this.updateMetrics();
      if (this.inspector.selectedNode && this.inspector.selectedNode.id === nodeId) {
        this.inspector.renderNode();
      }
    }

    this.elStatusDot.classList.add('simulating');
    this.elStatusText.textContent = `DISPATCHING TRIGGER TO NODE ${nodeId} (${kind.toUpperCase()})...`;

    try {
      await SetuApi.triggerNode(nodeId, kind);
      // Step forward deterministically by 1000ms so button release / voice pipeline elapses and RF transmits
      await SetuApi.stepControl(1000);
      await this.syncLiveEngineState();

      const fresh = this.sim.nodes.get(nodeId);
      if (fresh) {
        fresh.pending_trigger = false;
        if (this.inspector.selectedNode && this.inspector.selectedNode.id === nodeId) {
          this.inspector.inspectNode(fresh);
        }
      }

      this.elStatusDot.classList.remove('simulating');
      const isSosConfirmed = fresh && (fresh.active_sos || fresh.active);
      this.elStatusText.textContent = isSosConfirmed
        ? `NODE ${nodeId} SOS TRANSMITTING (${kind.toUpperCase()}) — CONFIRMED BY NATIVE ENGINE`
        : `NODE ${nodeId} TRIGGER PROCESSED (${kind.toUpperCase()}) — NATIVE QUEUES DRAINED`;
      return { ok: true, node: nodeId, kind };
    } catch (err) {
      this.elStatusDot.classList.remove('simulating');
      if (tn) {
        tn.pending_trigger = false;
        this.topo.render();
      }
      this.elStatusText.textContent = `TRIGGER FAILED: ${err.message}`;
      throw err;
    }
  }

  async executeNodeStateChange(nodeId, stateUpdate) {
    if (this.mode !== 'live') {
      this.toggleOperatingMode();
    }
    try {
      await SetuApi.setNodeState(nodeId, stateUpdate);
      await this.syncLiveEngineState();
      this.elStatusText.textContent = `UPDATED NODE ${nodeId} STATE: ${JSON.stringify(stateUpdate)}`;
      return { ok: true, node: nodeId, update: stateUpdate };
    } catch (err) {
      console.warn('Set node state failed:', err);
      this.elStatusText.textContent = `NODE STATE UPDATE FAILED: ${err.message}`;
      throw err;
    }
  }

  async executeLinkToggle(a, b, blocked) {
    if (this.mode !== 'live') {
      this.toggleOperatingMode();
    }
    try {
      await SetuApi.blockLink(a, b, blocked);
      let found = false;
      for (const l of this.sim.links) {
        if ((l.a === a && l.b === b) || (l.a === b && l.b === a)) {
          l.blocked = blocked;
          found = true;
          break;
        }
      }
      if (!found && blocked) {
        this.sim.links.push({ a, b, blocked: true, rssi: -130, dist: 500 });
      }
      this.topo.render();
      if (this.inspector && this.inspector.selectedNode) {
        this.inspector.renderNode();
      }
      this.elStatusText.textContent = `LINK BETWEEN NODE ${a} AND ${b} ${blocked ? 'BLOCKED' : 'RESTORED'}`;
      return { ok: true, a, b, blocked };
    } catch (err) {
      console.warn('Toggle link failed:', err);
      this.elStatusText.textContent = `LINK TOGGLE FAILED: ${err.message}`;
      throw err;
    }
  }

  async executeOperatorCommand(cmdObj) {
    if (!cmdObj) return;
    if (cmdObj.type === 'trigger') {
      return await this.executeNodeTrigger(cmdObj.nodeId, cmdObj.kind);
    }
    if (cmdObj.type === 'state') {
      return await this.executeNodeStateChange(cmdObj.nodeId, cmdObj.update);
    }
    if (cmdObj.type === 'link') {
      return await this.executeLinkToggle(cmdObj.a, cmdObj.b, cmdObj.blocked);
    }
  }

  async syncLiveEngineState(isReset = false) {
    try {
      const selectedId = this.inspector && this.inspector.selectedNode ? this.inspector.selectedNode.id : null;
      const cState = await SetuApi.getControlState();
      if (cState && cState.nodes) {
        this.sim.isLiveEngine = true;
        this.sim.isFallbackDemo = false;

        if (isReset) {
          this.sim.session = {
            id: `live_${Date.now()}`,
            name: 'Live Digital Twin',
            mode: 'live',
            status: 'ready',
            scenarioId: null,
            isProvisional: false
          };
          this.sim.events = [];
          this.sim.alerts = [];
          this.sim.activePackets = [];
          this.sim.currentTime = 0;
          this.sim.nodes.clear();
        } else {
          this.sim.session.mode = 'live';
          this.sim.session.name = 'Live Digital Twin';
        }

        // Populate / update nodes from native engine
        for (const n of cState.nodes) {
          const existing = this.sim.nodes.get(n.id);
          if (existing && !isReset) {
            existing.role = n.role;
            existing.x = n.x;
            existing.y = n.y;
            existing.battery = n.battery;
            if (n.initial_battery !== undefined) existing.initial_battery = n.initial_battery;
            if (typeof n.energy_consumed_mah === 'number') existing.energy_consumed_mah = n.energy_consumed_mah;
            existing.online = n.online;
            existing.active_sos = n.active;
            existing.ack_received = n.acked;
            existing.active = n.active;
            existing.acked = n.acked;
            existing.gave_up = n.gave_up;
            existing.seq = n.seq;
            existing.duty_used_ms = n.duty_used_ms;
            existing.button_q = n.button_q !== undefined ? n.button_q : existing.button_q;
            existing.radio_q = n.radio_q !== undefined ? n.radio_q : existing.radio_q;
            existing.button_q_ovf = n.button_q_ovf !== undefined ? n.button_q_ovf : existing.button_q_ovf;
            existing.radio_q_ovf = n.radio_q_ovf !== undefined ? n.radio_q_ovf : existing.radio_q_ovf;
            existing.gnss_on = n.gnss !== undefined ? n.gnss : existing.gnss_on;
            existing.dr_on = n.dr !== undefined ? n.dr : existing.dr_on;
            existing.lat_e6 = n.lat_e6;
            existing.lon_e6 = n.lon_e6;
            existing.stats = {
              tx: (n.tx_sos || 0) + (n.tx_relay || 0) + (n.tx_ack || 0),
              rx: n.rx_total || 0,
              drop: existing.stats ? existing.stats.drop : 0,
              dedup: n.rx_dup || 0,
              suppressed: n.relay_suppressed || 0,
              retries: n.retries || 0
            };
          } else {
            this.sim.nodes.set(n.id, {
              id: n.id,
              role: n.role,
              x: n.x,
              y: n.y,
              battery: n.battery,
              initial_battery: n.initial_battery !== undefined ? n.initial_battery : (n.battery !== undefined ? n.battery : 100),
              energy_consumed_mah: typeof n.energy_consumed_mah === 'number' ? n.energy_consumed_mah : 0,
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
        this.sim.notify('sync');
        if (this.console) {
          if (typeof this.console.populateNodes === 'function') this.console.populateNodes();
          else if (typeof this.console.populateSurvivors === 'function') this.console.populateSurvivors();
        }

        // Re-inspect the currently selected node reference so it is never stale or orphaned
        if (this.inspector) {
          if (selectedId !== null) {
            const fresh = this.sim.nodes.get(selectedId);
            if (fresh) {
              this.inspector.inspectNode(fresh);
            }
          } else if (this.sim.nodes.size > 0 && !this.inspector.selectedNode) {
            const first = this.sim.nodes.get(1) || this.sim.nodes.values().next().value;
            if (first) {
              this.inspector.inspectNode(first);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Could not sync live engine state:', err);
      this.elStatusText.textContent = `STATE SYNC ERROR: ${err.message}`;
    }
  }

  async executeTriggerAllSurvivors(kind, jitter) {
    // 1. Auto-switch to live digital twin mode if in replay mode
    if (this.mode !== 'live') {
      this.toggleOperatingMode();
    }

    try {
      this.elStatusDot.classList.add('simulating');
      this.elStatusText.textContent = `DISPATCHING BROADCAST SOS WAVE (${kind.toUpperCase()}, JITTER ±${jitter}ms)...`;

      // 2. Mark survivor nodes as pending dispatch
      for (const [, n] of this.sim.nodes) {
        if (n.role === 'survivor' && n.online) {
          n.pending_trigger = true;
        }
      }
      this.topo.render();
      this.updateMetrics();

      // 3. Dispatch broadcast trigger to C++ engine
      await SetuApi.triggerAll(kind, jitter);

      // 4. Step forward deterministically by at least 1000ms (or jitter + 1000ms) so button release and double-gap elapse
      const stepDuration = Math.max(1000, (parseInt(jitter, 10) || 0) + 1000);
      await SetuApi.stepControl(stepDuration);

      // 5. Fetch confirmed native state
      await this.syncLiveEngineState();

      // 6. Count actually confirmed active survivors from verified native C++ state
      let confirmedActive = 0;
      for (const [, n] of this.sim.nodes) {
        n.pending_trigger = false;
        if (n.role === 'survivor' && (n.active_sos || n.active)) {
          confirmedActive++;
        }
      }

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `BROADCAST ACCEPTED: ${confirmedActive} SURVIVORS ACTIVE (NATIVE ENGINE VERIFIED)`;
    } catch (err) {
      this.elStatusDot.classList.remove('simulating');
      for (const [, n] of this.sim.nodes) {
        n.pending_trigger = false;
      }
      this.topo.render();
      this.elStatusText.textContent = `BROADCAST FAILED: ${err.message}`;
      alert(`Trigger All failed: ${err.message}`);
    }
  }

  async loadInitialData() {
    // 0. Ensure backend URL is resolved before proceeding
    await SetuApi.ensureResolved();

    // 1. Fetch server status with wake-up handling for Render Free sleep
    const base = SetuApi.getBaseUrl();
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    this.elStatusDot.style.background = '#38bdf8';
    this.elStatusText.textContent = `CONNECTING TO SIMULATOR (${base || 'AUTO'})...`;

    let status = await SetuApi.getStatus();
    if (status.status === 'offline' && base && (base.includes('onrender.com') || base.includes('render'))) {
      this.elStatusDot.style.background = '#f59e0b';
      this.elStatusText.textContent = 'WAKING UP RENDER ENGINE... (Cold start may take ~30s)';
      const ping = await SetuApi.pingBackend(base, 25000);
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
        : `SIMULATOR OFFLINE (${status.error || 'Connection Failed'}). Click ⚡ Backend to check URL.`;
    }

    // 2. Connect SSE live event stream (guarded so SSE failure never blocks state sync)
    try {
      this.initLiveEventStream();
    } catch (sseErr) {
      console.warn('SSE stream initialization notice:', sseErr);
    }

    // 3. Sync live engine state from native C++ World
    await this.syncLiveEngineState();

    // 4. Fetch scenarios for selector with clear diagnostics
    try {
      this.scenarios = await SetuApi.getScenarios();
      if (this.scenarios && this.scenarios.length > 0) {
        this.elScenarioSelect.innerHTML = this.scenarios.map(sc => `
          <option value="${sc.id}">${sc.name}</option>
        `).join('');
      } else {
        this.elScenarioSelect.innerHTML = '<option value="">No scenarios available</option>';
      }
    } catch (err) {
      console.warn('Could not load scenarios list:', err.message);
      this.elScenarioSelect.innerHTML = '<option value="">Scenarios unavailable</option>';
      this.elStatusText.textContent = `SCENARIOS ERROR: ${err.message}`;
    }

    // 5. If engine state has no nodes (e.g. offline or starting), initialize default topology so the canvas and inspector are immediately populated
    if (this.sim.nodes.size === 0) {
      this.initDefaultTopology();
    }

    // Auto-inspect Node 1 by default so the right-side Inspector panel is immediately populated
    const defaultNode = this.sim.nodes.get(1) || (this.sim.nodes.size > 0 ? this.sim.nodes.values().next().value : null);
    if (defaultNode && this.inspector) {
      this.inspector.inspectNode(defaultNode);
    }
  }

  initDefaultTopology() {
    this.sim.isLiveEngine = false;
    this.sim.isFallbackDemo = true;
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
      this.sim.isLiveEngine = false;
      this.sim.isFallbackDemo = false;
      if (this.btnToggleMode) {
        this.btnToggleMode.textContent = '📽️ SCENARIO REPLAY';
        this.btnToggleMode.style.color = '#f59e0b';
        this.btnToggleMode.style.borderColor = '#f59e0b';
      }
      this.elStatusDot.classList.add('simulating');
      this.elStatusText.textContent = `LOADING SCENARIO TRACE: ${scenarioId}...`;

      const traceFilename = `${scenarioId}.jsonl`;
      const events = await SetuApi.fetchTrace(traceFilename);
      const sessionInfo = {
        id: `replay_${scenarioId}_${Date.now()}`,
        name: `Scenario Replay: ${scenarioId}`,
        mode: 'replay',
        scenarioId: scenarioId,
        status: 'ready'
      };
      this.sim.loadTrace(events, null, sessionInfo);
      this.timeline.setEvents();

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `TRACE LOADED: ${events.length} EVENTS (${scenarioId})`;

      const def = this.sim.nodes.get(1) || (this.sim.nodes.size > 0 ? this.sim.nodes.values().next().value : null);
      if (def && this.inspector) {
        this.inspector.inspectNode(def);
      }
    } catch (err) {
      console.warn(`Could not load pre-generated trace for ${scenarioId}, attempting live simulation:`, err);
      const sc = this.scenarios ? this.scenarios.find(s => s.id === scenarioId) : null;
      if (sc) {
        await this.runScenarioLive(sc);
      } else {
        this.elStatusDot.classList.remove('simulating');
        this.elStatusText.textContent = `SCENARIO LOAD ERROR: ${err.message}`;
        alert(`Failed to load scenario: ${err.message}`);
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
      const sessionInfo = {
        id: `live_${sc.id}_${Date.now()}`,
        name: `Live Scenario: ${sc.name}`,
        mode: 'live',
        scenarioId: sc.id,
        status: 'completed'
      };
      this.sim.loadTrace(events, result.summary, sessionInfo);
      this.timeline.setEvents();

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `SIMULATION COMPLETE: ${events.length} EVENTS RECORDED (${sc.name})`;
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
      const sessionInfo = {
        id: `custom_${seed}_${Date.now()}`,
        name: `Custom Sim (Seed ${seed}, ${survivors} Surv, ${relays} Rel)`,
        mode: 'custom',
        scenarioId: 'custom',
        status: 'ready'
      };
      this.sim.loadTrace(events, result.summary, sessionInfo);
      this.timeline.setEvents();

      this.elStatusDot.classList.remove('simulating');
      this.elStatusText.textContent = `CUSTOM SIMULATION READY (${events.length} EVENTS, SEED ${seed})`;
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

export function initSetuApp() {
  if (typeof window !== 'undefined') {
    if (window.setuApp) return window.setuApp;
    window.setuApp = new SetuDashboardApp();
    return window.setuApp;
  }
  return null;
}

// Ensure the application initializes when DOM is available (handles loading, interactive, and complete states)
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSetuApp);
  } else {
    initSetuApp();
  }
}
