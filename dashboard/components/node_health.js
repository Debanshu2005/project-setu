// Project Setu - Fleet Node Health & Hardware Telemetry Component
// Displays authoritative node states, battery dissipation, hardware faults, and RF link statuses.

export class NodeHealthComponent {
  constructor(containerElement, simulationEngine, onSelectNodeCallback = null) {
    this.container = containerElement;
    this.sim = simulationEngine;
    this.onSelectNode = onSelectNodeCallback; // (nodeId) => void

    this.searchQuery = '';
    this.roleFilter = 'all';

    this.sim.subscribe((engine, type) => {
      this.render();
    });
  }

  render() {
    const nodes = Array.from(this.sim.nodes.values());
    const links = this.sim.links || [];
    const metrics = this.sim.getMetrics();

    // Map links per node
    const nodeLinks = new Map();
    for (const l of links) {
      if (!nodeLinks.has(l.a)) nodeLinks.set(l.a, []);
      if (!nodeLinks.has(l.b)) nodeLinks.set(l.b, []);
      nodeLinks.get(l.a).push(l);
      nodeLinks.get(l.b).push(l);
    }

    // Filter nodes
    const filtered = nodes.filter(n => {
      if (this.roleFilter !== 'all' && n.role !== this.roleFilter) return false;
      if (this.searchQuery) {
        const q = this.searchQuery;
        const matchesId = String(n.id).includes(q);
        const matchesRole = (n.role || '').toLowerCase().includes(q);
        if (!matchesId && !matchesRole) return false;
      }
      return true;
    });

    this.container.innerHTML = `
      <div class="node-health-panel" style="display:flex; flex-direction:column; gap:10px;">
        <!-- Header & Summary Stats -->
        <div style="background:rgba(0,0,0,0.25); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:8px 10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:700; color:#fff;">Fleet Hardware & Energy Status</span>
            <span class="badge" style="background:rgba(16,185,129,0.15); border:1px solid #10b981; color:#34d399;">
              ${metrics.fleet.onlineNodes} / ${metrics.fleet.totalNodes} Online
            </span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; font-size:10px; font-family:var(--font-mono);">
            <div style="background:rgba(255,255,255,0.02); padding:4px 6px; border-radius:4px;">
              <span style="color:var(--text-dim);">Avg Battery:</span>
              <strong style="color:#38bdf8; margin-left:4px;">${metrics.fleet.avgBatteryPct !== null ? metrics.fleet.avgBatteryPct + '%' : 'N/A'}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.02); padding:4px 6px; border-radius:4px;">
              <span style="color:var(--text-dim);">Depleted:</span>
              <strong style="color:${metrics.fleet.depletedNodes > 0 ? '#ef4444' : '#10b981'}; margin-left:4px;">${metrics.fleet.depletedNodes}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.02); padding:4px 6px; border-radius:4px;">
              <span style="color:var(--text-dim);">Energy Dis.:</span>
              <strong style="color:#f59e0b; margin-left:4px;">${metrics.fleet.totalEnergyConsumedMah} mAh</strong>
            </div>
          </div>
        </div>

        <!-- Filter & Search Controls -->
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="text" id="txtNodeHealthSearch" class="search-input" placeholder="Search node ID or role..." value="${this.searchQuery}" style="flex:1;" />
          <select id="selNodeHealthRole" class="select-input" style="width:110px;">
            <option value="all" ${this.roleFilter === 'all' ? 'selected' : ''}>All Roles</option>
            <option value="survivor" ${this.roleFilter === 'survivor' ? 'selected' : ''}>Survivors</option>
            <option value="relay" ${this.roleFilter === 'relay' ? 'selected' : ''}>Relays</option>
            <option value="hub" ${this.roleFilter === 'hub' ? 'selected' : ''}>Rescue Hub</option>
          </select>
        </div>

        <!-- Node List Table / Cards -->
        <div class="node-health-list" style="display:flex; flex-direction:column; gap:6px; max-height:480px; overflow-y:auto; padding-right:2px;">
          ${filtered.length === 0 ? '<div style="padding:20px; text-align:center; color:var(--text-dim); font-size:11px;">No nodes match filter.</div>' : ''}
          ${filtered.map(n => this.renderNodeCard(n, nodeLinks.get(n.id) || [])).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderNodeCard(node, connectedLinks) {
    const isOnline = node.online && node.battery > 0;
    const isDepleted = node.battery === 0;

    const statusBadge = isDepleted
      ? '<span class="badge" style="background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#f87171;">DEPLETED</span>'
      : (isOnline
        ? '<span class="badge" style="background:rgba(16,185,129,0.15); border:1px solid #10b981; color:#34d399;">ONLINE</span>'
        : '<span class="badge" style="background:rgba(239,68,68,0.15); border:1px solid #ef4444; color:#f87171;">OFFLINE</span>');

    const roleStr = (node.role ? String(node.role) : (node.id === 0 ? 'hub' : 'unknown')).toLowerCase();
    const roleColor = roleStr === 'hub' ? '#38bdf8' : (roleStr === 'relay' ? '#f59e0b' : roleStr === 'survivor' ? '#10b981' : '#94a3b8');
    const roleName = roleStr.toUpperCase();

    const battPct = typeof node.battery === 'number' ? node.battery : 100;
    const initBattPct = typeof node.initial_battery === 'number' ? node.initial_battery : 100;
    const energyMah = typeof node.energy_consumed_mah === 'number' ? node.energy_consumed_mah.toFixed(3) : '0.000';

    const battBarColor = battPct > 50 ? '#10b981' : (battPct > 20 ? '#f59e0b' : '#ef4444');

    const blockedLinks = connectedLinks.filter(l => l.blocked).length;
    const activeLinks = connectedLinks.length - blockedLinks;

    const tx = (node.stats && node.stats.tx) || 0;
    const rx = (node.stats && node.stats.rx) || 0;
    const retries = (node.stats && node.stats.retries) || 0;
    const drop = (node.stats && node.stats.drop) || 0;

    return `
      <div class="node-health-card" data-id="${node.id}" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:8px 10px; cursor:pointer; transition:border-color 0.15s ease;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <strong style="font-size:12px; color:#fff;">Node ${node.id}</strong>
            <span class="badge" style="background:rgba(255,255,255,0.05); border:1px solid ${roleColor}; color:${roleColor}; font-size:9px;">
              ${roleName}
            </span>
          </div>
          <div>${statusBadge}</div>
        </div>

        <!-- Battery Bar Row -->
        <div style="margin-bottom:6px;">
          <div style="display:flex; justify-content:space-between; font-size:10px; font-family:var(--font-mono); margin-bottom:2px;">
            <span style="color:var(--text-dim);">Battery: <strong style="color:${battBarColor};">${battPct}%</strong> (Init: ${initBattPct}%)</span>
            <span style="color:var(--text-dim);">Used: <strong style="color:#f59e0b;">${energyMah} mAh</strong></span>
          </div>
          <div style="height:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
            <div style="width:${battPct}%; height:100%; background:${battBarColor};"></div>
          </div>
        </div>

        <!-- Hardware & Sensor Telemetry Badges -->
        <div style="display:flex; gap:6px; flex-wrap:wrap; font-size:9px; font-family:var(--font-mono); margin-bottom:6px;">
          <span style="background:rgba(255,255,255,0.03); padding:2px 5px; border-radius:3px; border:1px solid var(--border-subtle);">
            🛰️ GNSS: <strong style="color:${node.gnss_on ? '#10b981' : '#ef4444'};">${node.gnss_on ? 'FIX' : 'LOST'}</strong>
          </span>
          <span style="background:rgba(255,255,255,0.03); padding:2px 5px; border-radius:3px; border:1px solid var(--border-subtle);">
            🧭 IMU: <strong style="color:${node.dr_on ? '#38bdf8' : '#64748b'};">${node.dr_on ? 'ACTIVE' : 'OFF'}</strong>
          </span>
          <span style="background:rgba(255,255,255,0.03); padding:2px 5px; border-radius:3px; border:1px solid var(--border-subtle);">
            📡 Links: <strong style="color:#fff;">${activeLinks}</strong>${blockedLinks > 0 ? ` (<span style="color:#ef4444;">${blockedLinks} blocked</span>)` : ''}
          </span>
        </div>

        <!-- Radio Activity Counter Row -->
        <div style="display:flex; justify-content:space-between; font-size:10px; font-family:var(--font-mono); color:var(--text-dim); background:rgba(0,0,0,0.2); padding:4px 6px; border-radius:4px;">
          <span>TX: <strong style="color:#38bdf8;">${tx}</strong></span>
          <span>Retries: <strong style="color:#f59e0b;">${retries}</strong></span>
          <span>RX: <strong style="color:#34d399;">${rx}</strong></span>
          <span>Drops: <strong style="color:#f87171;">${drop}</strong></span>
          ${node.active_sos ? '<span style="color:#ef4444; font-weight:700;">🚨 SOS ACTIVE</span>' : ''}
          ${node.acked ? '<span style="color:#10b981; font-weight:700;">✓ ACKED</span>' : ''}
        </div>
      </div>
    `;
  }

  bindEvents() {
    const searchInput = this.container.querySelector('#txtNodeHealthSearch');
    const roleSelect = this.container.querySelector('#selNodeHealthRole');

    if (searchInput) {
      searchInput.addEventListener('input', e => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.render();
      });
    }

    if (roleSelect) {
      roleSelect.addEventListener('change', e => {
        this.roleFilter = e.target.value;
        this.render();
      });
    }

    this.container.querySelectorAll('.node-health-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id, 10);
        if (!isNaN(id) && this.onSelectNode) {
          this.onSelectNode(id);
        }
      });
    });
  }
}
