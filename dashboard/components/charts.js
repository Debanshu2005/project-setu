// Project Setu - Interactive Analytics & Authoritative Metric Visualizations Component (Pure SVG)

export class ChartsComponent {
  constructor(containerElement, simulationEngine, onCategorySelect = null) {
    this.container = containerElement;
    this.sim = simulationEngine;
    this.onCategorySelect = onCategorySelect; // (category, label, events) => void

    this.showContractModal = false;

    this.sim.subscribe((engine, type) => {
      this.render();
    });
  }

  render() {
    const metrics = this.sim.getMetrics();
    const eventIndices = metrics.eventIndices || new Map();

    const getEvents = cat => eventIndices.get(cat) || [];

    // Chart 1: Lifecycle Items (Pure Logical Survivor Emergency Populations)
    const lifecycleItems = [
      { key: 'originate', label: 'Originated', value: metrics.lifecycle.uniqueOriginated, color: '#06b6d4', desc: 'Distinct survivor SOS alerts' },
      { key: 'alert', label: 'Delivered', value: metrics.lifecycle.uniqueDelivered, color: '#10b981', desc: 'Alerts received at Rescue Hub' },
      { key: 'ack', label: 'Confirmed', value: metrics.lifecycle.uniqueAcked, color: '#8b5cf6', desc: 'Alerts with confirmed ACK' },
      { key: 'in_flight', label: 'In Flight', value: metrics.lifecycle.inFlight, color: '#38bdf8', desc: 'Active alerts traversing network' },
      { key: 'gave_up', label: 'Failed', value: metrics.lifecycle.failed, color: '#ef4444', desc: 'Unreachable / retries exhausted' }
    ];
    if (metrics.lifecycle.unresolved > 0) {
      lifecycleItems.push({ key: 'unresolved', label: 'Unresolved', value: metrics.lifecycle.unresolved, color: '#f59e0b', desc: 'In flight at session completion' });
    }

    // Chart 2: Drop Causes Items
    const drops = metrics.radio.dropCauses;
    const dropItems = [
      { key: 'drop_weak', label: 'Weak RSSI', value: drops.weak, color: '#f87171', desc: 'Signal below receiver sensitivity' },
      { key: 'drop_collision', label: 'Collisions', value: drops.collision, color: '#ef4444', desc: 'Co-channel overlapping airtime' },
      { key: 'drop_halfduplex', label: 'Half-Duplex', value: drops.halfduplex, color: '#eab308', desc: 'Packet arrived while transmitting' },
      { key: 'drop_loss', label: 'Shadow Loss', value: drops.loss, color: '#fb923c', desc: 'Obstacle / channel path fading' },
      { key: 'drop_blocked', label: 'Blocked Link', value: drops.blocked, color: '#dc2626', desc: 'Manually blocked RF propagation' },
      { key: 'drop_depleted', label: 'Duty/Dead', value: drops.duty_blocked + drops.depleted, color: '#a855f7', desc: 'Duty cycle full or battery dead' }
    ];

    // Chart 3: Hop Distribution Items
    const hopItems = (metrics.hopDistribution || []).map(h => ({
      key: `hop_${h.hop}`,
      label: h.label,
      value: h.count,
      color: h.hop === 1 ? '#38bdf8' : (h.hop === 2 ? '#60a5fa' : (h.hop === 3 ? '#818cf8' : (h.hop === 4 ? '#a78bfa' : '#c084fc'))),
      desc: `Completed deliveries traversing ${h.hop} hop(s)`
    }));

    const pdrBadgeColor = metrics.lifecycle.pdr !== null
      ? (metrics.lifecycle.pdr >= 80 ? '#10b981' : (metrics.lifecycle.pdr >= 50 ? '#f59e0b' : '#ef4444'))
      : '#94a3b8';

    const pdrBadgeText = metrics.lifecycle.pdr !== null
      ? `${metrics.lifecycle.pdrDisplay} PDR${metrics.lifecycle.isProvisional ? ' (PROVISIONAL)' : (metrics.session && metrics.session.status === 'completed' ? ' (FINAL)' : '')}`
      : 'PDR: N/A';

    this.container.innerHTML = `
      <div class="charts-grid" style="display:flex; flex-direction:column; gap:12px;">
        <!-- Header Info Row -->
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:8px 10px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700; color:var(--text-dim);">Analytics Session:</span>
            <span class="badge" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc; font-weight:700;">
              ${String((metrics && metrics.session && metrics.session.mode) || 'replay').toUpperCase()}: ${(metrics && metrics.session && (metrics.session.name || metrics.session.id)) || 'default'}
            </span>
          </div>
          <button id="btnOpenMetricContract" class="btn" style="font-size:10px; padding:3px 8px; background:rgba(255,255,255,0.05); border:1px solid var(--border-subtle); color:var(--text-muted);">
            📘 Metric Contract
          </button>
        </div>

        <!-- Chart 1: SOS Message Lifecycle & Delivery Ratios -->
        <div class="chart-card" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:10px;">
          <div class="chart-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
              <span style="font-weight:700; font-size:12px;">SOS Message Lifecycle & Delivery</span>
              <div style="font-size:10px; color:var(--text-dim);">Logical Survivor Emergency Episodes (Click bar to filter timeline)</div>
            </div>
            <span class="badge" style="background:rgba(16,185,129,0.15); border:1px solid ${pdrBadgeColor}; color:${pdrBadgeColor}; font-weight:700;">
              ${pdrBadgeText}
            </span>
          </div>
          ${this.renderInteractiveBarChart(lifecycleItems, 'lifecycle')}

          <!-- Mesh Physical Radio Airtime Telemetry -->
          <div style="margin-top:8px; padding:6px 10px; background:rgba(0,0,0,0.3); border-radius:4px; font-size:10px; font-family:var(--font-mono); color:var(--text-dim); display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
            <span>Relay Forwards: <strong style="color:#f59e0b;">${metrics.lifecycle.relayForwards} pkts</strong></span>
            <span>Retransmissions: <strong style="color:#38bdf8;">${metrics.lifecycle.retries}</strong></span>
            <span>Suppressed: <strong style="color:#a78bfa;">${metrics.radio.relaySuppressedTotal}</strong></span>
            <span>Channel TX: <strong style="color:#fff;">${metrics.radio.txTotal}</strong></span>
            <span>Demod RX: <strong style="color:#fff;">${metrics.radio.rxTotal}</strong></span>
          </div>
        </div>

        <!-- Chart 2: Drop Causes Analysis -->
        <div class="chart-card" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:10px;">
          <div class="chart-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
              <span style="font-weight:700; font-size:12px;">Drop Causes & Channel Impairments</span>
              <div style="font-size:10px; color:var(--text-dim);">Physical layer radio reception drops (Click bar to isolate drops)</div>
            </div>
            <span class="badge" style="background:rgba(239,68,68,0.15); border:1px solid #ef4444; color:#f87171; font-weight:700;">
              ${metrics.dropTotal} Total Drops
            </span>
          </div>
          ${this.renderInteractiveBarChart(dropItems, 'drops')}
        </div>

        <!-- Chart 3: Hop Count Distribution -->
        <div class="chart-card" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:10px;">
          <div class="chart-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div>
              <span style="font-weight:700; font-size:12px;">End-to-End Hop Count Traversed</span>
              <div style="font-size:10px; color:var(--text-dim);">Route length for successfully delivered alerts</div>
            </div>
            <span class="badge" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc; font-weight:700;">
              Latency: ${metrics.latencyDisplay}
            </span>
          </div>
          ${this.renderInteractiveBarChart(hopItems, 'hops')}

          <!-- Latency Distribution Detail Card -->
          <div style="margin-top:8px; padding:6px 8px; background:rgba(0,0,0,0.3); border-radius:4px; font-size:10px; font-family:var(--font-mono); color:var(--text-dim); display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px;">
            <span>Avg: <strong style="color:#fff;">${metrics.latency.avgMs !== null ? metrics.latency.avgMs + 'ms' : 'N/A'}</strong></span>
            <span>Med: <strong style="color:#fff;">${metrics.latency.medianMs !== null ? metrics.latency.medianMs + 'ms' : 'N/A'}</strong></span>
            <span>P95: <strong style="color:#fff;">${metrics.latency.p95Ms !== null ? metrics.latency.p95Ms + 'ms' : 'N/A'}</strong></span>
            <span>Min: <strong style="color:#fff;">${metrics.latency.minMs !== null ? metrics.latency.minMs + 'ms' : 'N/A'}</strong></span>
            <span>Max: <strong style="color:#fff;">${metrics.latency.maxMs !== null ? metrics.latency.maxMs + 'ms' : 'N/A'}</strong></span>
          </div>
        </div>
      </div>

      <!-- Metric Contract Modal Drawer -->
      <div id="modalMetricContract" style="display:${this.showContractModal ? 'flex' : 'none'}; position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.75); backdrop-filter:blur(4px); align-items:center; justify-content:center; padding:16px;">
        <div style="background:#0f172a; border:1px solid var(--border-subtle); border-radius:8px; width:100%; max-width:680px; max-height:85vh; display:flex; flex-direction:column; overflow:hidden;">
          <div style="padding:12px 16px; border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:700; font-size:14px; color:#fff;">📘 Centralized Metric Contract & Counting Rules</div>
            <button id="btnCloseMetricContract" class="btn" style="padding:2px 8px; font-size:14px;">&times;</button>
          </div>
          <div style="padding:16px; overflow-y:auto; font-size:11px; display:flex; flex-direction:column; gap:12px;">
            ${this.renderContractDetails(metrics.contract)}
          </div>
        </div>
      </div>
    `;

    this.bindChartEvents(metrics);
  }

  renderInteractiveBarChart(items, groupName) {
    const maxVal = Math.max(1, ...items.map(d => d.value));
    const h = 105;
    const barWidth = 36;
    const gap = 12;
    const totalW = items.length * (barWidth + gap);

    const bars = items.map((item, idx) => {
      const bh = Math.max(item.value > 0 ? 6 : 2, Math.round((item.value / maxVal) * (h - 32)));
      const x = idx * (barWidth + gap) + 10;
      const y = h - 20 - bh;

      return `
        <g class="interactive-chart-bar" data-group="${groupName}" data-key="${item.key}" data-label="${item.label}" data-val="${item.value}" style="cursor:pointer;">
          <title>${item.label}: ${item.value} (${item.desc || ''})\nClick to inspect events in timeline</title>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${bh}" rx="3" fill="${item.color}" opacity="${item.value > 0 ? '0.9' : '0.2'}" class="bar-rect" />
          <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" class="chart-label" fill="#fff" font-weight="700" font-size="10">${item.value}</text>
          <text x="${x + barWidth / 2}" y="${h - 4}" text-anchor="middle" class="chart-label" fill="#94a3b8" font-size="9">${item.label}</text>
        </g>
      `;
    }).join('');

    return `
      <svg class="chart-svg" viewBox="0 0 ${Math.max(280, totalW + 20)} ${h}" style="width:100%; height:auto; overflow:visible;">
        <line x1="0" y1="${h - 20}" x2="100%" y2="${h - 20}" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
        ${bars}
      </svg>
    `;
  }

  renderContractDetails(contract) {
    if (!contract) return '<div>No contract metadata available.</div>';
    return Object.entries(contract).map(([key, def]) => `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:6px; padding:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="color:var(--cyan-main); font-size:12px;">${def.name}</strong>
          <span class="badge" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#7dd3fc;">${String((def && def.category) || 'metric').toUpperCase()} [${(def && def.units) || ''}]</span>
        </div>
        <div style="color:#e2e8f0; margin-bottom:4px;">${def.description}</div>
        <div style="font-family:var(--font-mono); font-size:10px; color:#38bdf8; margin-bottom:4px;">Formula: ${def.formula}</div>
        <div style="font-size:10px; color:var(--text-muted);"><strong style="color:#94a3b8;">Counting Rule:</strong> ${def.countingRule}</div>
        ${def.limitations ? `<div style="font-size:10px; color:#f59e0b; margin-top:2px;">⚠️ <strong>Limitation:</strong> ${def.limitations}</div>` : ''}
      </div>
    `).join('');
  }

  bindChartEvents(metrics) {
    const btnOpen = this.container.querySelector('#btnOpenMetricContract');
    const btnClose = this.container.querySelector('#btnCloseMetricContract');
    const modal = this.container.querySelector('#modalMetricContract');

    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        this.showContractModal = true;
        if (modal) modal.style.display = 'flex';
      });
    }

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        this.showContractModal = false;
        if (modal) modal.style.display = 'none';
      });
    }

    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) {
          this.showContractModal = false;
          modal.style.display = 'none';
        }
      });
    }

    // Attach click listeners to all interactive bars
    this.container.querySelectorAll('.interactive-chart-bar').forEach(bar => {
      bar.addEventListener('click', () => {
        const key = bar.dataset.key;
        const label = bar.dataset.label;
        const val = parseInt(bar.dataset.val, 10);

        const events = (metrics.eventIndices && metrics.eventIndices.get(key)) || [];

        if (this.onCategorySelect && typeof this.onCategorySelect === 'function') {
          this.onCategorySelect(key, `${label} (${val})`, events);
        }
      });
    });
  }
}
