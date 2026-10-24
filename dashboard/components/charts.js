// Project Setu - Analytics & Telemetry Charts Component (Pure SVG)

export class ChartsComponent {
  constructor(containerElement, simulationEngine) {
    this.container = containerElement;
    this.sim = simulationEngine;

    this.sim.subscribe((engine, type) => {
      this.render();
    });
  }

  render() {
    const metrics = this.sim.getMetrics();
    const dropCauses = this.calculateDropCauses();
    const hopDistribution = this.calculateHopDistribution();

    this.container.innerHTML = `
      <div class="charts-grid">
        <!-- Chart 1: Transmission & Delivery Ratios -->
        <div class="chart-card">
          <div class="chart-title">
            <span>Transmission vs Reception Breakdown</span>
            <span class="badge">${metrics.pdr} PDR</span>
          </div>
          ${this.renderBarChart([
            { label: 'TX (Orig)', value: metrics.txTotal - metrics.alertsTotal, color: '#06b6d4' },
            { label: 'Relayed', value: metrics.relaySuppressedTotal, color: '#f59e0b' },
            { label: 'Delivered', value: metrics.rxTotal, color: '#10b981' },
            { label: 'Dropped', value: metrics.dropTotal, color: '#ef4444' }
          ])}
        </div>

        <!-- Chart 2: Drop Causes Analysis -->
        <div class="chart-card">
          <div class="chart-title">
            <span>Drop Causes & Channel Impairments</span>
            <span class="badge">${metrics.dropTotal} Total</span>
          </div>
          ${this.renderBarChart(dropCauses)}
        </div>

        <!-- Chart 3: Hop Count Distribution -->
        <div class="chart-card">
          <div class="chart-title">
            <span>End-to-End Hop Count Traversed</span>
            <span class="badge">Avg: ${metrics.avgLatencyMs}ms Latency</span>
          </div>
          ${this.renderHistogram(hopDistribution)}
        </div>
      </div>
    `;
  }

  calculateDropCauses() {
    let weak = 0, collision = 0, loss = 0, halfduplex = 0;
    for (const ev of this.sim.events) {
      if (ev.t > this.sim.currentTime) break;
      if (ev.ev === 'drop') {
        if (ev.why === 'weak') weak++;
        else if (ev.why === 'collision') collision++;
        else if (ev.why === 'loss') loss++;
        else if (ev.why === 'halfduplex') halfduplex++;
      }
    }
    return [
      { label: 'Weak RSSI', value: weak, color: '#f87171' },
      { label: 'Collisions', value: collision, color: '#ef4444' },
      { label: 'Shadow Loss', value: loss, color: '#fb923c' },
      { label: 'Half-Duplex', value: halfduplex, color: '#eab308' }
    ];
  }

  calculateHopDistribution() {
    const hops = { 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };
    for (const a of this.sim.alerts) {
      if (a.hops === 1) hops[1]++;
      else if (a.hops === 2) hops[2]++;
      else if (a.hops === 3) hops[3]++;
      else if (a.hops === 4) hops[4]++;
      else hops['5+']++;
    }
    return [
      { label: '1 Hop', count: hops[1] },
      { label: '2 Hops', count: hops[2] },
      { label: '3 Hops', count: hops[3] },
      { label: '4 Hops', count: hops[4] },
      { label: '5+ Hops', count: hops['5+'] }
    ];
  }

  renderBarChart(items) {
    const maxVal = Math.max(1, ...items.map(d => d.value));
    const h = 100;
    const barWidth = 38;
    const gap = 16;
    const totalW = items.length * (barWidth + gap);

    const bars = items.map((item, idx) => {
      const bh = Math.max(4, Math.round((item.value / maxVal) * (h - 25)));
      const x = idx * (barWidth + gap) + 10;
      const y = h - 18 - bh;

      return `
        <g class="chart-bar">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${bh}" rx="2" fill="${item.color}" />
          <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" class="chart-label" fill="#fff">${item.value}</text>
          <text x="${x + barWidth / 2}" y="${h - 4}" text-anchor="middle" class="chart-label">${item.label}</text>
        </g>
      `;
    }).join('');

    return `
      <svg class="chart-svg" viewBox="0 0 ${Math.max(260, totalW + 20)} ${h}">
        <line x1="0" y1="${h - 18}" x2="100%" y2="${h - 18}" class="chart-axis" />
        ${bars}
      </svg>
    `;
  }

  renderHistogram(items) {
    const maxVal = Math.max(1, ...items.map(d => d.count));
    const h = 100;
    const barWidth = 34;
    const gap = 14;

    const bars = items.map((item, idx) => {
      const bh = Math.max(2, Math.round((item.count / maxVal) * (h - 25)));
      const x = idx * (barWidth + gap) + 12;
      const y = h - 18 - bh;

      return `
        <g class="chart-bar">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${bh}" rx="2" fill="#38bdf8" />
          <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" class="chart-label" fill="#fff">${item.count}</text>
          <text x="${x + barWidth / 2}" y="${h - 4}" text-anchor="middle" class="chart-label">${item.label}</text>
        </g>
      `;
    }).join('');

    return `
      <svg class="chart-svg" viewBox="0 0 260 ${h}">
        <line x1="0" y1="${h - 18}" x2="100%" y2="${h - 18}" class="chart-axis" />
        ${bars}
      </svg>
    `;
  }
}
