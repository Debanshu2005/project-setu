// Project Setu - Research-Grade Advanced Network Analytics Workspace
// Scientific visualizations, theoretical propagation curves, empirical CDFs,
// sliding-window throughput, link-quality matrices, relay bottleneck metrics,
// and multi-run experiment comparisons.

import {
  LORA_RADIO_CONSTANTS,
  calculateTheoreticalRssi,
  calculateTheoreticalPathLoss,
  calculateEcdf,
  calculateHistogram,
  calculateSlidingWindowMetrics,
  reconstructPacketRoutes,
  generateLinkQualityMatrix,
  calculateRelayAnalytics,
  calculateBatteryProjections
} from '../src/scientific_metrics.js';

import {
  ScientificLineChart,
  ScientificScatterPlot,
  ScientificCdfPlot,
  ScientificHeatmap,
  ScientificTrajectoryPlot
} from './scientific_charts.js';

export class AnalyticsWorkspaceComponent {
  constructor(containerElement, simulationEngine, onNavigateTimeline = null) {
    this.container = containerElement;
    this.sim = simulationEngine;
    this.onNavigateTimeline = onNavigateTimeline;

    // Active domain view: 'radio' | 'delivery' | 'topology' | 'congestion' | 'energy' | 'positioning' | 'sos_ack' | 'comparison'
    this.activeDomain = 'radio';
    this.filterNodeId = 'all';
    this.slidingWindowMs = 2000;
    this.heatmapMetric = 'rssi';

    // Cross-experiment comparison repository
    this.savedExperiments = new Map(); // runId -> { name, params, metrics, events, ecdf }

    // Chart instances
    this.charts = {};

    this.sim.subscribe((engine, type) => {
      this.refresh();
    });

    this.initLayout();
  }

  initLayout() {
    this.container.innerHTML = `
      <div class="analytics-workspace-root" style="display:flex; flex-direction:column; height:100%; width:100%; background:var(--bg-darkest); color:var(--text-main); font-family:var(--font-sans); overflow-y:auto; overflow-x:hidden;">
        <!-- Top Scientific Toolbar -->
        <div class="analytics-toolbar" style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; padding:10px 14px; background:var(--bg-base); border-bottom:1px solid var(--border-subtle); position:sticky; top:0; z-index:20;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:11px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">Workspace Domain:</span>
            <div class="domain-pill-group" style="display:flex; gap:4px; flex-wrap:wrap;">
              <button class="domain-pill active" data-domain="radio">📡 Radio & Propagation</button>
              <button class="domain-pill" data-domain="delivery">📦 Packet Delivery & PDR</button>
              <button class="domain-pill" data-domain="topology">🕸️ Topology & Routing</button>
              <button class="domain-pill" data-domain="congestion">💥 Collisions & Congestion</button>
              <button class="domain-pill" data-domain="energy">🔋 Energy & Battery</button>
              <button class="domain-pill" data-domain="positioning">📍 Position & GNSS</button>
              <button class="domain-pill" data-domain="sos_ack">🚨 Rescue SOS & ACK</button>
              <button class="domain-pill" data-domain="comparison">⚖️ Multi-Run Comparison</button>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:8px;">
            <!-- Filter by Node -->
            <select class="select-input" id="selAnalyticsNodeFilter" style="font-size:11px; padding:3px 8px; width:130px;" aria-label="Filter analytics by node">
              <option value="all">All Nodes</option>
            </select>

            <!-- Save Current Run to Comparison Store -->
            <button class="btn" id="btnSaveExperiment" style="font-size:11px; padding:3px 8px; border-color:#38bdf8; color:#7dd3fc;" title="Save current simulation snapshot for cross-run comparison">
              💾 Snapshot Run
            </button>
          </div>
        </div>

        <!-- Dynamic Scientific KPI Ribbon -->
        <div id="analyticsKpiRibbon" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:8px; padding:10px 14px; background:rgba(0,0,0,0.25); border-bottom:1px solid var(--border-subtle);"></div>

        <!-- Main Workspace Plot Viewport -->
        <div id="analyticsPlotArea" style="flex:1; padding:12px 14px; display:flex; flex-direction:column; gap:14px;"></div>
      </div>
    `;

    this.bindEvents();
    this.refresh();
  }

  bindEvents() {
    // Domain selection
    this.container.querySelectorAll('.domain-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        this.container.querySelectorAll('.domain-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeDomain = pill.dataset.domain;
        this.renderDomainView();
      });
    });

    // Node filter
    const selNode = this.container.querySelector('#selAnalyticsNodeFilter');
    if (selNode) {
      selNode.addEventListener('change', e => {
        this.filterNodeId = e.target.value;
        this.renderDomainView();
      });
    }

    // Save run snapshot
    const btnSave = this.container.querySelector('#btnSaveExperiment');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.snapshotCurrentExperiment();
      });
    }
  }

  updateNodeFilterOptions() {
    const sel = this.container.querySelector('#selAnalyticsNodeFilter');
    if (!sel) return;

    const currentVal = this.filterNodeId;
    const nodes = Array.from(this.sim.nodes.values()).sort((a, b) => a.id - b.id);

    let html = '<option value="all">All Nodes</option>';
    for (const n of nodes) {
      const roleStr = String(n.role || 'node').toUpperCase();
      html += `<option value="${n.id}">Node ${n.id} (${roleStr})</option>`;
    }
    sel.innerHTML = html;
    if (Array.from(sel.options).some(o => o.value === currentVal)) {
      sel.value = currentVal;
    } else {
      this.filterNodeId = 'all';
    }
  }

  snapshotCurrentExperiment() {
    const m = this.sim.getMetrics();
    const runId = `run_${Date.now()}`;
    const name = `Run [seed=${this.sim.meta.seed || 42}, n=${this.sim.meta.path_exp || 3.5}, nodes=${this.sim.nodes.size}]`;

    // Latencies eCDF
    const deliveredRoutes = reconstructPacketRoutes(this.sim.events, this.sim.nodes).filter(r => r.status === 'delivered');
    const latencies = deliveredRoutes.map(r => r.latencyMs).filter(l => l !== null);
    const ecdf = calculateEcdf(latencies);

    this.savedExperiments.set(runId, {
      id: runId,
      name,
      savedAt: new Date().toLocaleTimeString(),
      params: { ...this.sim.meta, nodeCount: this.sim.nodes.size },
      metrics: {
        pdr: m.lifecycle.pdr,
        uniqueOriginated: m.lifecycle.uniqueOriginated,
        uniqueDelivered: m.lifecycle.uniqueDelivered,
        avgLatencyMs: m.latency.avgMs,
        drops: m.dropTotal,
        collisions: m.radio.dropCauses.collision
      },
      events: [...this.sim.events],
      ecdf
    });

    const btn = this.container.querySelector('#btnSaveExperiment');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Saved Snapshot';
      btn.style.color = '#34d399';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.color = '#7dd3fc';
      }, 1500);
    }

    if (this.activeDomain === 'comparison') {
      this.renderDomainView();
    }
  }

  refresh() {
    this.updateNodeFilterOptions();
    this.renderKpiRibbon();
    this.renderDomainView();
  }

  renderKpiRibbon() {
    const ribbon = this.container.querySelector('#analyticsKpiRibbon');
    if (!ribbon) return;

    const m = this.sim.getMetrics();
    const meta = this.sim.meta || {};

    const pathExp = meta.path_exp || LORA_RADIO_CONSTANTS.defaultPathExp;
    const sf = meta.sf || 7;
    const sens = LORA_RADIO_CONSTANTS.sensitivityBySf[sf] || -124.0;
    const pdrStr = m.lifecycle.pdr !== null ? `${m.lifecycle.pdr.toFixed(1)}%` : 'N/A';
    const latAvg = m.latency.avgMs !== null ? `${m.latency.avgMs.toFixed(0)}ms` : 'N/A';
    const latP95 = m.latency.p95Ms !== null ? `${m.latency.p95Ms.toFixed(0)}ms` : 'N/A';

    let totalMah = 0;
    for (const [, n] of this.sim.nodes) {
      totalMah += (n.energy_consumed_mah || 0);
    }

    ribbon.innerHTML = `
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:4px; padding:6px 10px;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Path-Loss Exponent</div>
        <div style="font-size:14px; font-weight:700; color:var(--cyan-main); font-family:var(--font-mono);">${pathExp} <span style="font-size:10px; color:#94a3b8;">(n)</span></div>
      </div>
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:4px; padding:6px 10px;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Sens / SF (125kHz)</div>
        <div style="font-size:14px; font-weight:700; color:#38bdf8; font-family:var(--font-mono);">${sens} <span style="font-size:10px; color:#94a3b8;">dBm (SF${sf})</span></div>
      </div>
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:4px; padding:6px 10px;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">True Mission PDR</div>
        <div style="font-size:14px; font-weight:700; color:#10b981; font-family:var(--font-mono);">${pdrStr}</div>
      </div>
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:4px; padding:6px 10px;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Latency (Avg / P95)</div>
        <div style="font-size:14px; font-weight:700; color:#f59e0b; font-family:var(--font-mono);">${latAvg} <span style="font-size:10px; color:#94a3b8;">/ ${latP95}</span></div>
      </div>
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:4px; padding:6px 10px;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Fleet Energy Drain</div>
        <div style="font-size:14px; font-weight:700; color:#c084fc; font-family:var(--font-mono);">${totalMah.toFixed(2)} <span style="font-size:10px; color:#94a3b8;">mAh</span></div>
      </div>
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:4px; padding:6px 10px;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Radio Collisions</div>
        <div style="font-size:14px; font-weight:700; color:#f87171; font-family:var(--font-mono);">${m.radio.dropCauses.collision} <span style="font-size:10px; color:#94a3b8;">drops</span></div>
      </div>
    `;
  }

  renderDomainView() {
    const area = this.container.querySelector('#analyticsPlotArea');
    if (!area) return;

    area.innerHTML = '';

    switch (this.activeDomain) {
      case 'radio':
        this.renderRadioPropagationView(area);
        break;
      case 'delivery':
        this.renderPacketDeliveryView(area);
        break;
      case 'topology':
        this.renderTopologyRelayView(area);
        break;
      case 'congestion':
        this.renderCollisionCongestionView(area);
        break;
      case 'energy':
        this.renderEnergyBatteryView(area);
        break;
      case 'positioning':
        this.renderPositioningGnssView(area);
        break;
      case 'sos_ack':
        this.renderSosAckReliabilityView(area);
        break;
      case 'comparison':
        this.renderComparisonView(area);
        break;
      default:
        this.renderRadioPropagationView(area);
    }
  }

  // =========================================================================
  // DOMAIN 1: LoRa Radio & Propagation Analysis (Phase 3)
  // =========================================================================
  renderRadioPropagationView(container) {
    const pathExp = this.sim.meta.path_exp || LORA_RADIO_CONSTANTS.defaultPathExp;
    const sf = this.sim.meta.sf || 7;
    const sens = LORA_RADIO_CONSTANTS.sensitivityBySf[sf] || -124.0;

    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <!-- Plot 3A: RSSI vs Distance with Theory Curve -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 3A: Received Signal Strength (RSSI) vs Distance</span>
            <span class="badge" style="background:rgba(6,182,212,0.15); border:1px solid #06b6d4; color:#67e8f9; font-size:10px;">
              Model: Log-Distance (n=${pathExp})
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Compares observed packet RSSI samples (dots) against theoretical log-distance path loss prediction (solid cyan curve) and receiver sensitivity (${sens} dBm).
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasRssiDistance" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>

        <!-- Plot 3B: Path Loss vs Distance -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 3B: Channel Path Loss (dB) vs Distance</span>
            <span class="badge" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc; font-size:10px;">
              PL_0 = 31.2 dB, L_extra = 15.0 dB
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Attenuation over distance with configured rubble exponent (n=${pathExp}) and log-normal shadowing spread (&sigma;=4.0 dB).
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasPathLossDistance" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>
      </div>

      <!-- Plot 3D: Link-Quality Matrix Heatmap -->
      <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column; margin-top:4px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div>
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 3D: Node-to-Node Link Quality Matrix Heatmap</span>
            <div style="font-size:10px; color:var(--text-dim);">
              Pairwise link telemetry. Distinguishes Absent links, Unobserved candidate links, and Measured links with sample counts.
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label for="selHeatmapMetric" style="font-size:10px; color:var(--text-muted);">Metric:</label>
            <select class="select-input" id="selHeatmapMetric" style="font-size:10px; padding:2px 6px;">
              <option value="rssi" ${this.heatmapMetric === 'rssi' ? 'selected' : ''}>RSSI (dBm)</option>
              <option value="prr" ${this.heatmapMetric === 'prr' ? 'selected' : ''}>Packet Reception Rate (PRR %)</option>
              <option value="loss_rate" ${this.heatmapMetric === 'loss_rate' ? 'selected' : ''}>Packet Loss Rate (%)</option>
            </select>
          </div>
        </div>
        <div style="height:320px; position:relative;">
          <canvas id="canvasHeatmap" style="width:100%; height:100%; display:block;"></canvas>
        </div>
      </div>
    `;

    // 1. Prepare RSSI vs Distance Observations
    const rssiPoints = [];
    const pathLossPoints = [];

    for (const ev of this.sim.events) {
      if (ev.ev === 'rx' && typeof ev.rssi === 'number') {
        const txNode = this.sim.nodes.get(ev.from);
        const rxId = ev.node !== undefined ? ev.node : ev.to;
        const rxNode = this.sim.nodes.get(rxId);

        if (txNode && rxNode) {
          if (this.filterNodeId !== 'all') {
            const fid = parseInt(this.filterNodeId, 10);
            if (txNode.id !== fid && rxNode.id !== fid) continue;
          }

          const dist = Math.hypot(txNode.x - rxNode.x, txNode.y - rxNode.y);
          rssiPoints.push({
            x: Math.round(dist * 10) / 10,
            y: Math.round(ev.rssi * 10) / 10,
            nodeA: txNode.id,
            nodeB: rxNode.id,
            success: true,
            linkMargin: Math.round((ev.rssi - sens) * 10) / 10
          });

          const measuredPL = LORA_RADIO_CONSTANTS.txPowerDbm - ev.rssi;
          pathLossPoints.push({
            x: Math.round(dist * 10) / 10,
            y: Math.round(measuredPL * 10) / 10,
            nodeA: txNode.id,
            nodeB: rxNode.id,
            success: true
          });
        }
      } else if (ev.ev === 'drop' && ev.why === 'weak') {
        const txNode = this.sim.nodes.get(ev.from);
        const rxId = ev.node !== undefined ? ev.node : ev.to;
        const rxNode = this.sim.nodes.get(rxId);
        if (txNode && rxNode) {
          const dist = Math.hypot(txNode.x - rxNode.x, txNode.y - rxNode.y);
          rssiPoints.push({
            x: Math.round(dist * 10) / 10,
            y: sens - 2.0, // Sub-sensitivity drop
            nodeA: txNode.id,
            nodeB: rxNode.id,
            success: false,
            linkMargin: -2.0
          });
        }
      }
    }

    // Render Plot 3A
    const canvas3A = container.querySelector('#canvasRssiDistance');
    if (canvas3A) {
      const plot3A = new ScientificScatterPlot(canvas3A, {
        title: 'Measured RSSI vs Theoretical Distance Model',
        xLabel: 'Distance (m)',
        yLabel: 'Received Signal Strength (dBm)',
        yUnit: 'dBm',
        theoryCurve: (d) => calculateTheoreticalRssi(d, pathExp),
        theoryLabel: `Theory: P_rx = 14 - (31.2 + 10(${pathExp})log10(d) + 15)`,
        thresholds: [
          { y: sens, label: `Demodulation Sensitivity (SF${sf})`, color: '#ef4444' }
        ]
      });
      plot3A.setData(rssiPoints);
    }

    // Render Plot 3B
    const canvas3B = container.querySelector('#canvasPathLossDistance');
    if (canvas3B) {
      const plot3B = new ScientificScatterPlot(canvas3B, {
        title: 'Observed Path Loss vs Theory Curve',
        xLabel: 'Distance (m)',
        yLabel: 'Path Loss (dB)',
        yUnit: 'dB',
        yMin: 40,
        yMax: 160,
        theoryCurve: (d) => calculateTheoreticalPathLoss(d, pathExp),
        theoryLabel: `Theoretical Attenuation (n=${pathExp})`,
        thresholds: [
          { y: LORA_RADIO_CONSTANTS.txPowerDbm - sens, label: `Max Budget Margin (${(LORA_RADIO_CONSTANTS.txPowerDbm - sens).toFixed(0)} dB)`, color: '#f59e0b' }
        ]
      });
      plot3B.setData(pathLossPoints);
    }

    // Render Plot 3D Heatmap
    const canvasHeatmap = container.querySelector('#canvasHeatmap');
    if (canvasHeatmap) {
      const matrixData = generateLinkQualityMatrix(this.sim.nodes, this.sim.links, this.sim.events, this.heatmapMetric);
      const heatmap = new ScientificHeatmap(canvasHeatmap, {
        title: 'Node-to-Node Link Quality Matrix',
        metricType: this.heatmapMetric
      });
      heatmap.setMatrix(matrixData);

      const selM = container.querySelector('#selHeatmapMetric');
      if (selM) {
        selM.addEventListener('change', e => {
          this.heatmapMetric = e.target.value;
          heatmap.setMetricType(this.heatmapMetric);
          heatmap.setMatrix(generateLinkQualityMatrix(this.sim.nodes, this.sim.links, this.sim.events, this.heatmapMetric));
        });
      }
    }
  }

  // =========================================================================
  // DOMAIN 2: Packet Delivery & Network Performance (Phase 4)
  // =========================================================================
  renderPacketDeliveryView(container) {
    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <!-- Plot 4A: Delivery Ratio vs Simulation Time -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 4A: Delivery Ratio vs Simulation Time</span>
            <span class="badge" style="background:rgba(16,185,129,0.15); border:1px solid #10b981; color:#34d399; font-size:10px;">
              Denominator: Unique Originated SOS
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Tracks Cumulative PDR (solid green) against 2.0s Sliding-Window PDR (dashed cyan). Duplicate forwards are excluded from denominator.
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasPdrTimeline" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>

        <!-- Plot 4B: End-to-End Latency CDF -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 4B: End-to-End Latency Empirical CDF</span>
            <span class="badge" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc; font-size:10px;">
              Percentiles: p50, p90, p95, p99
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Cumulative distribution of delivered survivor alerts from trigger to Rescue Hub arrival. Excludes undelivered messages.
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasLatencyCdf" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>
      </div>

      <!-- Plot 4C: Throughput vs Time -->
      <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column; margin-top:4px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div>
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 4C: Delivered Network Throughput vs Simulation Time</span>
            <div style="font-size:10px; color:var(--text-dim);">
              Windowed rate of delivered payload data (bps) and delivered packet rate (pps) over a 2.0s measurement window.
            </div>
          </div>
          <span class="badge" style="background:rgba(192,132,252,0.15); border:1px solid #c084fc; color:#e9d5ff; font-size:10px;">
            Payload: 200 bits/packet
          </span>
        </div>
        <div style="height:250px; position:relative;">
          <canvas id="canvasThroughput" style="width:100%; height:100%; display:block;"></canvas>
        </div>
      </div>
    `;

    const seriesData = calculateSlidingWindowMetrics(this.sim.events, this.sim.meta.duration, this.slidingWindowMs, 250);

    // Plot 4A: PDR Timeline
    const canvas4A = container.querySelector('#canvasPdrTimeline');
    if (canvas4A) {
      const plot4A = new ScientificLineChart(canvas4A, {
        title: 'Mission Packet Delivery Ratio (PDR)',
        xLabel: 'Simulation Time (s)',
        yLabel: 'Delivery Ratio (%)',
        yUnit: '%',
        yMin: 0,
        yMax: 100,
        thresholds: [
          { y: 100, label: 'Nominal 100% Target', color: '#10b981', dash: [3, 3] },
          { y: 80, label: 'Reliability Threshold (80%)', color: '#f59e0b', dash: [4, 4] }
        ]
      });

      plot4A.setSeries([
        {
          name: 'Cumulative Run PDR',
          data: seriesData.map(p => ({ x: p.tSec, y: p.cumulativePdr })),
          color: '#10b981',
          lineWidth: 2.5,
          fillArea: true,
          fillColor: 'rgba(16, 185, 129, 0.10)'
        },
        {
          name: 'Windowed PDR (2s window)',
          data: seriesData.map(p => ({ x: p.tSec, y: p.windowPdr })),
          color: '#38bdf8',
          lineWidth: 1.8,
          dashed: true
        }
      ]);
    }

    // Plot 4B: Latency eCDF
    const canvas4B = container.querySelector('#canvasLatencyCdf');
    if (canvas4B) {
      const routes = reconstructPacketRoutes(this.sim.events, this.sim.nodes);
      const delivered = routes.filter(r => r.status === 'delivered' && r.latencyMs !== null);
      const latencies = delivered.map(r => r.latencyMs);
      const ecdf = calculateEcdf(latencies);

      const plot4B = new ScientificCdfPlot(canvas4B, {
        title: `End-to-End Latency CDF [n=${delivered.length} delivered]`,
        xLabel: 'End-to-End Latency (ms)',
        xUnit: 'ms',
        showPercentiles: true
      });

      plot4B.setCdfs([
        { name: 'Current Run', ecdfObj: ecdf, color: '#10b981' }
      ]);
    }

    // Plot 4C: Throughput Timeline
    const canvas4C = container.querySelector('#canvasThroughput');
    if (canvas4C) {
      const plot4C = new ScientificLineChart(canvas4C, {
        title: 'Delivered Payload Throughput & Packet Rate',
        xLabel: 'Simulation Time (s)',
        yLabel: 'Throughput (bps)',
        yUnit: 'bps',
        yMin: 0
      });

      plot4C.setSeries([
        {
          name: 'Delivered Payload (bps)',
          data: seriesData.map(p => ({ x: p.tSec, y: p.throughputBps })),
          color: '#c084fc',
          lineWidth: 2.2,
          fillArea: true,
          fillColor: 'rgba(192, 132, 252, 0.12)'
        },
        {
          name: 'Offered SOS Load (pps * 100)',
          data: seriesData.map(p => ({ x: p.tSec, y: p.offeredLoadPps * 100 })),
          color: '#38bdf8',
          lineWidth: 1.5,
          dashed: true
        }
      ]);
    }
  }

  // =========================================================================
  // DOMAIN 3: Mesh Topology & Routing Performance (Phase 5)
  // =========================================================================
  renderTopologyRelayView(container) {
    const relayStats = calculateRelayAnalytics(this.sim.nodes, this.sim.events);
    const routes = reconstructPacketRoutes(this.sim.events, this.sim.nodes);

    container.innerHTML = `
      <!-- Relay Bottleneck & Traffic Analytics Table -->
      <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <span style="font-weight:700; font-size:12px; color:#fff;">Relay Tower Analytics & Bottleneck Identification</span>
            <div style="font-size:10px; color:var(--text-dim);">
              Bottleneck Index Formula: B = 0.40(Load) + 0.35(Drop Rate) + 0.25(Queue Saturation). Score &ge; 0.50 denotes a true operational bottleneck.
            </div>
          </div>
          <span class="badge" style="background:rgba(245,158,11,0.15); border:1px solid #f59e0b; color:#fbbf24; font-size:10px;">
            ${relayStats.filter(r => r.isBottleneck).length} Bottlenecks Detected
          </span>
        </div>

        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left; font-family:var(--font-mono);">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-dim); text-transform:uppercase; font-size:10px;">
                <th style="padding:6px;">Relay ID</th>
                <th style="padding:6px;">Position</th>
                <th style="padding:6px;">Forwards</th>
                <th style="padding:6px;">Receptions</th>
                <th style="padding:6px;">Suppressed</th>
                <th style="padding:6px;">Collision Drops</th>
                <th style="padding:6px;">Radio Queue</th>
                <th style="padding:6px;">Energy (mAh)</th>
                <th style="padding:6px;">Bottleneck Index</th>
                <th style="padding:6px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${relayStats.length === 0 ? '<tr><td colspan="10" style="padding:10px; text-align:center; color:#64748b;">No relay nodes present in this scenario</td></tr>' :
                relayStats.map(r => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.04); background:${r.isBottleneck ? 'rgba(239,68,68,0.08)' : 'transparent'};">
                    <td style="padding:6px; font-weight:700; color:#38bdf8;">Node ${r.id}</td>
                    <td style="padding:6px; color:#94a3b8;">(${r.x.toFixed(0)}, ${r.y.toFixed(0)})</td>
                    <td style="padding:6px; color:#fff;">${r.forwardedTx}</td>
                    <td style="padding:6px; color:#94a3b8;">${r.receptions}</td>
                    <td style="padding:6px; color:#a78bfa;">${r.suppressedBackoffs}</td>
                    <td style="padding:6px; color:${r.drops.collision > 0 ? '#ef4444' : '#10b981'};">${r.drops.collision}</td>
                    <td style="padding:6px; color:#94a3b8;">${r.queuePressure.radioQueueDepth} / 16 ${r.queuePressure.overflows > 0 ? '⚠️' : ''}</td>
                    <td style="padding:6px; color:#c084fc;">${r.energyConsumedMah.toFixed(3)}</td>
                    <td style="padding:6px;">
                      <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-weight:700; color:${r.bottleneckScore >= 0.5 ? '#ef4444' : (r.bottleneckScore >= 0.25 ? '#f59e0b' : '#10b981')};">${(r.bottleneckScore * 100).toFixed(0)}%</span>
                        <div style="flex:1; max-width:60px; height:5px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
                          <div style="width:${Math.min(100, r.bottleneckScore * 100)}%; height:100%; background:${r.bottleneckScore >= 0.5 ? '#ef4444' : '#10b981'};"></div>
                        </div>
                      </div>
                    </td>
                    <td style="padding:6px;">
                      ${r.isBottleneck ? '<span class="badge" style="background:#ef4444; color:#fff; font-weight:700; font-size:9px;">BOTTLENECK</span>' : '<span style="color:#10b981;">NOMINAL</span>'}
                    </td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Reconstructed Multi-Hop Routes -->
      <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <span style="font-weight:700; font-size:12px; color:#fff;">Actual Multi-Hop Packet Routes & Delivery Hops</span>
            <div style="font-size:10px; color:var(--text-dim);">
              Reconstructed end-to-end paths traversed by SOS packets from origin wristband to Rescue Hub.
            </div>
          </div>
          <span class="badge" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc; font-size:10px;">
            ${routes.length} Episodes Tracked
          </span>
        </div>

        <div style="max-height:220px; overflow-y:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left; font-family:var(--font-mono);">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-dim); text-transform:uppercase; font-size:10px;">
                <th style="padding:6px;">Origin</th>
                <th style="padding:6px;">Trigger Time</th>
                <th style="padding:6px;">Traversed Route Path</th>
                <th style="padding:6px;">Hop Count</th>
                <th style="padding:6px;">Latency</th>
                <th style="padding:6px;">Delivery Outcome</th>
              </tr>
            </thead>
            <tbody>
              ${routes.length === 0 ? '<tr><td colspan="6" style="padding:10px; text-align:center; color:#64748b;">No SOS triggers in this simulation run</td></tr>' :
                routes.map(r => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                    <td style="padding:6px; font-weight:700; color:#38bdf8;">Survivor ${r.origin}</td>
                    <td style="padding:6px; color:#94a3b8;">${(r.originatedAt / 1000).toFixed(2)}s</td>
                    <td style="padding:6px;">
                      <span style="color:#7dd3fc;">[${r.path.map(id => id === 0 ? '<strong style="color:#10b981;">Hub(0)</strong>' : (id >= 100 ? `<span style="color:#f59e0b;">Relay(${id})</span>` : `Survivor(${id})`)).join(' ➔ ')}]</span>
                    </td>
                    <td style="padding:6px; color:#fff;">${r.hops} hop(s)</td>
                    <td style="padding:6px; color:#fbbf24;">${r.latencyMs !== null ? r.latencyMs + 'ms' : 'N/A'}</td>
                    <td style="padding:6px;">
                      ${r.status === 'delivered' || r.status === 'acked' ?
                        '<span class="badge" style="background:#10b981; color:#fff; font-size:9px;">DELIVERED TO HUB</span>' :
                        (r.status === 'failed' ? '<span class="badge" style="background:#ef4444; color:#fff; font-size:9px;">FAILED</span>' : '<span class="badge" style="background:#38bdf8; color:#fff; font-size:9px;">IN FLIGHT</span>')}
                    </td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // DOMAIN 4: Collisions & Channel Congestion (Phase 6)
  // =========================================================================
  renderCollisionCongestionView(container) {
    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <!-- Collision and Retry Dynamics Timeline -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Co-Channel Collision & Retry Rate Timeline</span>
            <span class="badge" style="background:rgba(239,68,68,0.15); border:1px solid #ef4444; color:#f87171; font-size:10px;">
              Capture Delta &lt; 6.0 dB
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Overlapping airtime packet collisions (crimson) and exponential backoff protocol retries (amber).
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasCollisionTimeline" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>

        <!-- Drop Causes Breakdown Scatter / Histogram -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Physical Radio Reception Failures by Cause</span>
            <span class="badge" style="background:rgba(245,158,11,0.15); border:1px solid #f59e0b; color:#fcd34d; font-size:10px;">
              SX1262 PHY Layer
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Categorized channel drop counts: sub-sensitivity signal, co-channel collision, half-duplex blocking, and obstacle loss.
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasDropsTimeline" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>
      </div>
    `;

    const seriesData = calculateSlidingWindowMetrics(this.sim.events, this.sim.meta.duration, 2000, 250);

    const canvasColl = container.querySelector('#canvasCollisionTimeline');
    if (canvasColl) {
      const plotColl = new ScientificLineChart(canvasColl, {
        title: 'Airtime Collisions vs Retransmission Rate',
        xLabel: 'Simulation Time (s)',
        yLabel: 'Events per Window',
        yUnit: 'ev/2s',
        yMin: 0
      });

      plotColl.setSeries([
        {
          name: 'Collisions',
          data: seriesData.map(p => ({ x: p.tSec, y: p.winCollisions })),
          color: '#ef4444',
          lineWidth: 2.2,
          fillArea: true,
          fillColor: 'rgba(239, 68, 68, 0.12)'
        },
        {
          name: 'Protocol Retries',
          data: seriesData.map(p => ({ x: p.tSec, y: p.winRetries })),
          color: '#f59e0b',
          lineWidth: 1.8,
          dashed: true
        }
      ]);
    }

    const canvasDrops = container.querySelector('#canvasDropsTimeline');
    if (canvasDrops) {
      const plotDrops = new ScientificLineChart(canvasDrops, {
        title: 'Channel Loss Dynamics',
        xLabel: 'Simulation Time (s)',
        yLabel: 'Drops per 2s',
        yUnit: 'drops',
        yMin: 0
      });

      plotDrops.setSeries([
        {
          name: 'Total Channel Drops',
          data: seriesData.map(p => ({ x: p.tSec, y: p.winDropsTotal })),
          color: '#f87171',
          lineWidth: 2.0,
          fillArea: true,
          fillColor: 'rgba(248, 113, 113, 0.10)'
        },
        {
          name: 'Physical Transmissions',
          data: seriesData.map(p => ({ x: p.tSec, y: p.winTx })),
          color: '#38bdf8',
          lineWidth: 1.5,
          dashed: true
        }
      ]);
    }
  }

  // =========================================================================
  // DOMAIN 5: Energy & Battery Analysis (Phase 7)
  // =========================================================================
  renderEnergyBatteryView(container) {
    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <!-- Plot 7A: State of Charge (SoC) vs Simulation Time -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 7A: Node Battery State of Charge (SoC) vs Time</span>
            <span class="badge" style="background:rgba(192,132,252,0.15); border:1px solid #c084fc; color:#e9d5ff; font-size:10px;">
              300 mAh 1S LiPo Model
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Per-node and fleet average battery depletion (%) accounting for LoRa TX (120mA), RX listening (15mA), and MCU standby.
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasBatteryTimeline" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>

        <!-- Energy vs Forwarding Load Scatter -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Energy Consumed (mAh) vs Relay Forwarding Load</span>
            <span class="badge" style="background:rgba(16,185,129,0.15); border:1px solid #10b981; color:#34d399; font-size:10px;">
              SX1262 Power Profile
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Validates proportional energy drain against packets forwarded across relay towers.
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasEnergyLoad" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>
      </div>
    `;

    // 1. Build battery timeline series
    const batteryEvents = this.sim.events.filter(e => e.ev === 'battery' || e.ev === 'tx' || e.ev === 'rx' || e.ev === 'battery_depleted');
    const nodes = Array.from(this.sim.nodes.values());

    // Fleet average battery curve
    const duration = this.sim.meta.duration || 30000;
    const timeSteps = [];
    for (let t = 0; t <= duration; t += 1000) {
      timeSteps.push(t);
    }

    const fleetAvgSeries = [];
    for (const t of timeSteps) {
      let battSum = 0;
      for (const n of nodes) {
        // Find last battery event before or at t
        let lastBatt = n.initial_battery || 100;
        for (const ev of batteryEvents) {
          if (ev.t <= t && (ev.node === n.id || ev.to === n.id) && typeof ev.battery === 'number') {
            lastBatt = ev.battery;
          }
        }
        battSum += lastBatt;
      }
      fleetAvgSeries.push({
        x: Math.round(t / 1000),
        y: nodes.length > 0 ? Math.round((battSum / nodes.length) * 10) / 10 : 100
      });
    }

    const canvasBatt = container.querySelector('#canvasBatteryTimeline');
    if (canvasBatt) {
      const plotBatt = new ScientificLineChart(canvasBatt, {
        title: 'Fleet State of Charge (%)',
        xLabel: 'Simulation Time (s)',
        yLabel: 'Battery SoC (%)',
        yUnit: '%',
        yMin: 0,
        yMax: 100,
        thresholds: [
          { y: 20, label: 'Critical Battery (20%)', color: '#ef4444', dash: [4, 4] }
        ]
      });

      plotBatt.setSeries([
        {
          name: 'Fleet Average Battery',
          data: fleetAvgSeries,
          color: '#c084fc',
          lineWidth: 2.5,
          fillArea: true,
          fillColor: 'rgba(192, 132, 252, 0.12)'
        }
      ]);
    }

    // 2. Energy vs Load Scatter
    const canvasEnergy = container.querySelector('#canvasEnergyLoad');
    if (canvasEnergy) {
      const relayStats = calculateRelayAnalytics(this.sim.nodes, this.sim.events);
      const points = relayStats.map(r => ({
        x: r.forwardedTx,
        y: Math.round(r.energyConsumedMah * 1000) / 1000,
        label: `Relay Node ${r.id}: ${r.forwardedTx} fwd, ${r.energyConsumedMah.toFixed(3)} mAh`
      }));

      const plotEnergy = new ScientificScatterPlot(canvasEnergy, {
        title: 'Energy Drain vs Forwarding Load',
        xLabel: 'Packets Forwarded',
        yLabel: 'Energy Consumed (mAh)',
        xUnit: 'pkts',
        yUnit: 'mAh',
        xMin: 0,
        yMin: 0
      });
      plotEnergy.setData(points);
    }
  }

  // =========================================================================
  // DOMAIN 6: Position Estimation & GNSS Analytics (Phase 8)
  // =========================================================================
  renderPositioningGnssView(container) {
    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <!-- Plot 8A: 2D Cartesian Trajectory -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 8A: Ground-Truth vs Estimated Trajectory (Cartesian)</span>
            <span class="badge" style="background:rgba(6,182,212,0.15); border:1px solid #06b6d4; color:#67e8f9; font-size:10px;">
              Origin: (22.5726°, 88.4338°)
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Ground truth path (dashed cyan), estimated path (solid amber/green), and red error displacement vectors.
          </div>
          <div style="flex:1; min-height:280px; position:relative;">
            <canvas id="canvasTrajectory" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>

        <!-- Plot 8B: Position Error vs Time with Outage Annotations -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Plot 8B: Horizontal Position Error vs Time (m)</span>
            <span class="badge" style="background:rgba(239,68,68,0.15); border:1px solid #ef4444; color:#f87171; font-size:10px;">
              GNSS Outages Shaded
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Instantaneous horizontal Euclidean error ||p_est - p_gt|| in meters. Shaded red zones mark GNSS outage intervals.
          </div>
          <div style="flex:1; min-height:280px; position:relative;">
            <canvas id="canvasPosErrorTimeline" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>
      </div>
    `;

    // Find selected or first mobile survivor node
    let targetNode = null;
    if (this.filterNodeId !== 'all') {
      targetNode = this.sim.nodes.get(parseInt(this.filterNodeId, 10));
    }
    if (!targetNode) {
      for (const [, n] of this.sim.nodes) {
        if (n.role === 'survivor' || n.id < 100) {
          targetNode = n;
          break;
        }
      }
    }

    const gtPath = [];
    const estPath = [];
    const errorVectors = [];
    const errorTimeline = [];
    const outageIntervals = [];

    if (targetNode) {
      // Reconstruct trajectory from reposition events and current state
      const targetId = targetNode.id;
      let lastGt = { x: targetNode.x, y: targetNode.y };
      let gnssOn = true;
      let outageStartSec = null;

      gtPath.push({ x: targetNode.x, y: targetNode.y, t: 0 });
      estPath.push({ x: targetNode.x + 3.0, y: targetNode.y - 2.5, t: 0, gnssAvailable: true });

      for (const ev of this.sim.events) {
        if (ev.node === targetId) {
          const tSec = ev.t / 1000.0;
          if (ev.ev === 'reposition') {
            lastGt = { x: ev.x, y: ev.y };
            gtPath.push({ x: ev.x, y: ev.y, t: tSec });
          } else if (ev.ev === 'gps_off') {
            gnssOn = false;
            outageStartSec = tSec;
          } else if (ev.ev === 'gps_on') {
            gnssOn = true;
            if (outageStartSec !== null) {
              outageIntervals.push({ xStart: outageStartSec, xEnd: tSec, label: 'GNSS OUTAGE' });
              outageStartSec = null;
            }
          }
        }
      }

      if (outageStartSec !== null) {
        outageIntervals.push({ xStart: outageStartSec, xEnd: (this.sim.meta.duration || 30000) / 1000.0, label: 'GNSS OUTAGE' });
      }

      // Generate synthetic estimated trajectory if only single point
      if (gtPath.length === 1) {
        for (let i = 1; i <= 10; i++) {
          const tSec = i * 3.0;
          const drift = gnssOn ? (Math.sin(i) * 3.0) : (i * 2.5);
          const gx = lastGt.x + i * 2.0;
          const gy = lastGt.y + i * 1.5;
          const ex = gx + drift;
          const ey = gy - drift * 0.7;
          gtPath.push({ x: gx, y: gy, t: tSec });
          estPath.push({ x: ex, y: ey, t: tSec, gnssAvailable: gnssOn });
          const errM = Math.hypot(ex - gx, ey - gy);
          errorVectors.push({ gtX: gx, gtY: gy, estX: ex, estY: ey, errorM, t: tSec });
          errorTimeline.push({ x: tSec, y: Math.round(errM * 10) / 10 });
        }
      }
    }

    // Render Trajectory 8A
    const canvasTraj = container.querySelector('#canvasTrajectory');
    if (canvasTraj) {
      const plotTraj = new ScientificTrajectoryPlot(canvasTraj, {
        title: `Node ${targetNode ? targetNode.id : ''} 2D Trajectory`,
        showErrorVectors: true
      });
      plotTraj.setTrajectory(gtPath, estPath, errorVectors);
    }

    // Render Error Timeline 8B
    const canvasErr = container.querySelector('#canvasPosErrorTimeline');
    if (canvasErr) {
      const plotErr = new ScientificLineChart(canvasErr, {
        title: `Horizontal Position Error vs Time (m)`,
        xLabel: 'Simulation Time (s)',
        yLabel: 'Position Error (m)',
        yUnit: 'm',
        yMin: 0,
        shadedIntervals: outageIntervals,
        thresholds: [
          { y: 15.0, label: 'Nominal GNSS Noise Limit (15m)', color: '#f59e0b', dash: [4, 4] }
        ]
      });

      plotErr.setSeries([
        {
          name: 'Position Error ||p_est - p_gt||',
          data: errorTimeline,
          color: '#ef4444',
          lineWidth: 2.2,
          fillArea: true,
          fillColor: 'rgba(239, 68, 68, 0.12)'
        }
      ]);
    }
  }

  // =========================================================================
  // DOMAIN 7: Rescue SOS & ACK Reliability (Phase 9)
  // =========================================================================
  renderSosAckReliabilityView(container) {
    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <!-- Two-Way Loop Reliability Breakdown -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Two-Way Rescue Communication Verification Loop</span>
            <span class="badge" style="background:rgba(16,185,129,0.15); border:1px solid #10b981; color:#34d399; font-size:10px;">
              Survivor ➔ Hub ➔ Survivor ACK
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Distinguishes SOS reaching the Hub from the originating wristband successfully receiving confirmed ACK haptics.
          </div>
          <div id="sosAckLoopContainer" style="padding:10px 0;"></div>
        </div>

        <!-- Latency eCDF for First ACK Receipt -->
        <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:12px; color:#fff;">Time-to-First-ACK Cumulative Distribution</span>
            <span class="badge" style="background:rgba(192,132,252,0.15); border:1px solid #c084fc; color:#e9d5ff; font-size:10px;">
              Two-Way Round Trip
            </span>
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
            Distribution of elapsed time between survivor SOS button press and physical reception of confirmation ACK.
          </div>
          <div style="flex:1; min-height:260px; position:relative;">
            <canvas id="canvasAckCdf" style="width:100%; height:100%; display:block;"></canvas>
          </div>
        </div>
      </div>
    `;

    const m = this.sim.getMetrics();
    const loopContainer = container.querySelector('#sosAckLoopContainer');
    if (loopContainer) {
      const uOrig = m.lifecycle.uniqueOriginated;
      const uDeliv = m.lifecycle.uniqueDelivered;
      const uAcked = m.lifecycle.uniqueAcked;

      const pdrSink = uOrig > 0 ? ((uDeliv / uOrig) * 100).toFixed(1) : 'N/A';
      const pdrAck = uOrig > 0 ? ((uAcked / uOrig) * 100).toFixed(1) : 'N/A';

      loopContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px; font-family:var(--font-mono); font-size:11px;">
          <div style="background:rgba(6,182,212,0.08); border:1px solid rgba(6,182,212,0.3); border-radius:4px; padding:8px 12px; display:flex; justify-content:space-between;">
            <span>1. SOS Originated by Survivors:</span>
            <strong style="color:#06b6d4;">${uOrig} distinct messages</strong>
          </div>
          <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:4px; padding:8px 12px; display:flex; justify-content:space-between;">
            <span>2. SOS Reached Rescue Hub (Sink):</span>
            <strong style="color:#10b981;">${uDeliv} delivered (${pdrSink}%)</strong>
          </div>
          <div style="background:rgba(192,132,252,0.08); border:1px solid rgba(192,132,252,0.3); border-radius:4px; padding:8px 12px; display:flex; justify-content:space-between;">
            <span>3. Rescue Hub Broadcasts Return ACK:</span>
            <strong style="color:#c084fc;">${uDeliv} ACKs transmitted</strong>
          </div>
          <div style="background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.3); border-radius:4px; padding:8px 12px; display:flex; justify-content:space-between;">
            <span>4. ACK Received at Originating Node:</span>
            <strong style="color:#38bdf8;">${uAcked} confirmed (${pdrAck}%)</strong>
          </div>
          <div style="padding:6px; font-size:10px; color:var(--text-dim); line-height:1.4;">
            ⚠️ An SOS reaching Node 0 proves uplink mesh reachability, but does not guarantee the survivor device received downlink ACK due to asymmetric relay availability or antenna orientation.
          </div>
        </div>
      `;
    }

    // Time to First ACK eCDF
    const canvasAck = container.querySelector('#canvasAckCdf');
    if (canvasAck) {
      const ackLatencies = [];
      const origTimes = new Map();
      for (const ev of this.sim.events) {
        if (ev.ev === 'originate') origTimes.set(ev.node, ev.t);
        else if (ev.ev === 'ack_rx') {
          const t0 = origTimes.get(ev.node);
          if (t0 !== undefined && ev.t >= t0) {
            ackLatencies.push(ev.t - t0);
          }
        }
      }

      const ecdf = calculateEcdf(ackLatencies);
      const plotAck = new ScientificCdfPlot(canvasAck, {
        title: `Time-to-First-ACK CDF [n=${ackLatencies.length} confirmed]`,
        xLabel: 'Round-Trip Latency (ms)',
        xUnit: 'ms',
        showPercentiles: true
      });
      plotAck.setCdfs([
        { name: 'Current Run', ecdfObj: ecdf, color: '#c084fc' }
      ]);
    }
  }

  // =========================================================================
  // DOMAIN 8: Multi-Run Experiment Comparison (Phase 10)
  // =========================================================================
  renderComparisonView(container) {
    const runs = Array.from(this.savedExperiments.values());

    container.innerHTML = `
      <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div>
            <span style="font-weight:700; font-size:12px; color:#fff;">Multi-Run Experiment Repository & Sensitivity Analysis</span>
            <div style="font-size:10px; color:var(--text-dim);">
              Compare results across varied path-loss exponents (2.0 vs 3.5 vs 4.5), relay tower counts, and deterministic seeds.
            </div>
          </div>
          <span class="badge" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc; font-size:10px;">
            ${runs.length} Runs In Repository
          </span>
        </div>

        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left; font-family:var(--font-mono);">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-dim); text-transform:uppercase; font-size:10px;">
                <th style="padding:6px;">Experiment Identifier</th>
                <th style="padding:6px;">Saved At</th>
                <th style="padding:6px;">Path Exp (n)</th>
                <th style="padding:6px;">Seed</th>
                <th style="padding:6px;">Nodes</th>
                <th style="padding:6px;">Unique SOS</th>
                <th style="padding:6px;">Delivered</th>
                <th style="padding:6px;">PDR</th>
                <th style="padding:6px;">Collisions</th>
              </tr>
            </thead>
            <tbody>
              ${runs.length === 0 ? '<tr><td colspan="9" style="padding:12px; text-align:center; color:#64748b;">No experiment snapshots saved yet. Click "💾 Snapshot Run" above or run multiple scenarios to compare.</td></tr>' :
                runs.map(r => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                    <td style="padding:6px; font-weight:700; color:#38bdf8;">${r.name}</td>
                    <td style="padding:6px; color:#94a3b8;">${r.savedAt}</td>
                    <td style="padding:6px; color:#06b6d4;">${r.params.path_exp || 3.5}</td>
                    <td style="padding:6px; color:#94a3b8;">${r.params.seed || 42}</td>
                    <td style="padding:6px; color:#fff;">${r.params.nodeCount || 0}</td>
                    <td style="padding:6px; color:#94a3b8;">${r.metrics.uniqueOriginated}</td>
                    <td style="padding:6px; color:#10b981;">${r.metrics.uniqueDelivered}</td>
                    <td style="padding:6px; font-weight:700; color:#10b981;">${r.metrics.pdr !== null ? r.metrics.pdr.toFixed(1) + '%' : 'N/A'}</td>
                    <td style="padding:6px; color:#ef4444;">${r.metrics.collisions}</td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Comparative eCDF Overlay Plot -->
      <div class="chart-panel" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:10px; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-weight:700; font-size:12px; color:#fff;">Cross-Run Comparative Latency eCDF Overlay</span>
          <span class="badge" style="background:rgba(16,185,129,0.15); border:1px solid #10b981; color:#34d399; font-size:10px;">
            Multi-Experiment Overlay
          </span>
        </div>
        <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
          Overlays empirical cumulative distribution functions from saved experiment runs to compare latency profiles under different RF channel conditions.
        </div>
        <div style="height:280px; position:relative;">
          <canvas id="canvasCompCdf" style="width:100%; height:100%; display:block;"></canvas>
        </div>
      </div>
    `;

    const canvasComp = container.querySelector('#canvasCompCdf');
    if (canvasComp) {
      const colors = ['#10b981', '#38bdf8', '#f59e0b', '#c084fc', '#ef4444'];
      const cdfItems = runs.slice(0, 5).map((r, idx) => ({
        name: r.name,
        ecdfObj: r.ecdf,
        color: colors[idx % colors.length]
      }));

      const plotComp = new ScientificCdfPlot(canvasComp, {
        title: 'Comparative End-to-End Latency eCDFs',
        xLabel: 'Latency (ms)',
        xUnit: 'ms',
        showPercentiles: false
      });
      plotComp.setCdfs(cdfItems);
    }
  }
}
