// Project Setu - Metrics & Trace Exporter (CSV & JSON)

export class Exporter {
  static exportJson(sim) {
    const metrics = sim.getMetrics();
    const data = {
      project: 'Project Setu Disaster Response Simulation',
      version: '1.0.0-verified',
      timestamp: new Date().toISOString(),
      meta: sim.meta,
      metrics,
      nodes: Array.from(sim.nodes.values()).map(n => ({
        id: n.id,
        role: n.role,
        online: n.online,
        battery: n.battery,
        active_sos: n.active_sos,
        acked: n.acked,
        stats: n.stats
      })),
      alerts: sim.alerts
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.downloadBlob(blob, `setu_sim_report_${sim.meta.seed}_${Date.now()}.json`);
  }

  static exportCsv(sim) {
    const nodes = Array.from(sim.nodes.values());
    const headers = [
      'NodeID',
      'Role',
      'Online',
      'BatteryPct',
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
      n.battery,
      n.active_sos ? '1' : '0',
      n.acked ? '1' : '0',
      n.stats.tx,
      n.stats.rx,
      n.stats.drop,
      n.stats.dedup,
      n.stats.suppressed,
      n.stats.retries
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, `setu_nodes_metrics_${sim.meta.seed}_${Date.now()}.csv`);
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
