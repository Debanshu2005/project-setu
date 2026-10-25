// Project Setu - Metrics & Trace Exporter (CSV & JSON)

export class Exporter {
  static exportJson(sim) {
    const metrics = sim.getMetrics();
    const data = {
      project: 'Project Setu Disaster Response Simulation',
      version: '2.0.0-verified',
      timestamp: new Date().toISOString(),
      session: sim.session || { mode: 'unknown', name: 'default' },
      meta: sim.meta,
      metrics: {
        clockMs: metrics.clockMs,
        durationMs: metrics.durationMs,
        pdr: metrics.pdr,
        latency: metrics.latency,
        lifecycle: metrics.lifecycle,
        radio: metrics.radio,
        fleet: metrics.fleet,
        hopDistribution: metrics.hopDistribution
      },
      nodes: Array.from(sim.nodes.values()).map(n => ({
        id: n.id,
        role: n.role,
        online: n.online,
        initial_battery: n.initial_battery !== undefined ? n.initial_battery : 100,
        battery: n.battery,
        energy_consumed_mah: typeof n.energy_consumed_mah === 'number' ? n.energy_consumed_mah : 0,
        gnss_on: n.gnss_on !== false,
        dr_on: n.dr_on !== false,
        active_sos: n.active_sos,
        acked: n.acked,
        stats: n.stats
      })),
      alerts: sim.alerts
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.downloadBlob(blob, `setu_sim_report_${sim.session?.id || sim.meta.seed}_${Date.now()}.json`);
  }

  static exportCsv(sim) {
    const nodes = Array.from(sim.nodes.values());
    const headers = [
      'NodeID',
      'Role',
      'Online',
      'InitialBatteryPct',
      'CurrentBatteryPct',
      'EnergyConsumedMah',
      'GNSS_Fix',
      'IMU_DR',
      'ActiveSOS',
      'Acked',
      'TX_Count',
      'RX_Count',
      'Drop_Count',
      'Dedup_Count',
      'Relays_Suppressed',
      'Retries'
    ];

    const rows = nodes.map(n => [
      n.id,
      n.role,
      n.online ? '1' : '0',
      n.initial_battery !== undefined ? n.initial_battery : 100,
      n.battery,
      typeof n.energy_consumed_mah === 'number' ? n.energy_consumed_mah.toFixed(3) : '0.000',
      n.gnss_on !== false ? '1' : '0',
      n.dr_on !== false ? '1' : '0',
      n.active_sos ? '1' : '0',
      n.acked ? '1' : '0',
      (n.stats && n.stats.tx) || 0,
      (n.stats && n.stats.rx) || 0,
      (n.stats && n.stats.drop) || 0,
      (n.stats && n.stats.dedup) || 0,
      (n.stats && n.stats.suppressed) || 0,
      (n.stats && n.stats.retries) || 0
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, `setu_nodes_metrics_${sim.session?.id || sim.meta.seed}_${Date.now()}.csv`);
  }

  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
