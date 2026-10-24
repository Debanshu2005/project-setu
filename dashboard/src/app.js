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

    // Modal
    this.modalRunSim = document.getElementById('modalRunSim');
    this.btnCloseModal = document.getElementById('btnCloseModal');
    this.btnCancelModal = document.getElementById('btnCancelModal');
    this.btnExecuteSim = document.getElementById('btnExecuteSim');
  }

  initComponents() {
    // 1. Topology
    const canvas = document.getElementById('topologyCanvas');
    this.topo = new TopologyVisualizer(canvas, this.sim);

    // 2. Right Panels: Inspector, Timeline, Charts
    const nodeInspectorEl = document.getElementById('nodeInspectorContent');
    const packetInspectorEl = document.getElementById('packetInspectorContent');
    this.inspector = new InspectorComponent(nodeInspectorEl, packetInspectorEl, this.sim);

    this.topo.onNodeSelect = node => {
      this.inspector.inspectNode(node);
      // Switch right sidebar to Inspector tab
      this.switchTab('tab-inspector');
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
    // Playback
    this.btnPlay.addEventListener('click', () => {
      this.sim.togglePlay();
      this.updatePlayButton();
    });

    this.btnStepBack.addEventListener('click', () => {
      this.sim.step(-1000);
    });

    this.btnStepForward.addEventListener('click', () => {
      this.sim.step(1000);
    });

    this.btnReset.addEventListener('click', () => {
      this.sim.seek(0);
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

    // 2. Fetch scenarios
    this.scenarios = await SetuApi.getScenarios();
    this.elScenarioSelect.innerHTML = this.scenarios.map(sc => `
      <option value="${sc.id}">${sc.name}</option>
    `).join('');

    // Load first scenario (e.g. urban_earthquake)
    if (this.scenarios.length > 0) {
      await this.loadScenario(this.scenarios[0].id);
    }
  }

  async loadScenario(scenarioId) {
    try {
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
      // Run live simulation as fallback
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
    alert(`SOS Trigger Injected on Survivor Node ${tr.node} (${tr.kind.toUpperCase()}). In replay mode, seek or configure this in scenario settings.`);
  }
}

// Instantiate on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  window.setuApp = new SetuDashboardApp();
});
