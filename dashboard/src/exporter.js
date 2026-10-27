// Project Setu - Metrics & Trace Exporter (CSV & JSON)
// Exports raw observations, experiment configurations, run summaries,
// and chart datasets for research reproducibility and external analysis.

export class Exporter {
  /**
   * Exports full run summary and aggregated metrics as structured JSON.
   */
  static exportJson(sim) {
    const metrics = sim.getMetrics();
    const data = {
      project: 'Project Setu Disaster Response Simulation',
      version: '2.0.0-research',
      timestamp: new Date().toISOString(),
      session: sim.session || { mode: 'unknown', name: 'default' },
      meta: {
        ...sim.meta,
        durationMs: sim.meta.duration,
        seed: sim.meta.seed,
        pathLossExponent: sim.meta.path_exp || 3.5,
        spreadingFactor: sim.meta.sf || 7,
        bandwidthHz: sim.meta.bw_hz || 125000,
        txPowerDbm: sim.meta.tx_dbm || 14.0
      },
      metrics: {
        clockMs: metrics.clockMs,
        durationMs: metrics.durationMs,
        pdr: metrics.lifecycle.pdr,
        pdrDisplay: metrics.lifecycle.pdrDisplay,
        latency: metrics.latency,
        lifecycle: metrics.lifecycle,
        radio: metrics.radio,
        fleet: metrics.fleet,
        hopDistribution: metrics.hopDistribution
      },
      nodes: Array.from(sim.nodes.values()).map(n => ({
        id: n.id,
        role: n.role,
        x: n.x,
        y: n.y,
        lat_e6: n.lat_e6,
        lon_e6: n.lon_e6,
        gt_lat_e6: n.gt_lat_e6,
        gt_lon_e6: n.gt_lon_e6,
        est_lat_e6: n.est_lat_e6,
        est_lon_e6: n.est_lon_e6,
        pos_error_m: n.pos_error_m,
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

  /**
   * Exports node fleet telemetry snapshot as CSV.
   */
  static exportCsv(sim) {
    const nodes = Array.from(sim.nodes.values());
    const headers = [
      'NodeID',
      'Role',
      'Online',
      'X_Meters',
      'Y_Meters',
      'Lat_E6',
      'Lon_E6',
      'PosError_M',
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
      n.x !== undefined ? n.x.toFixed(1) : '0.0',
      n.y !== undefined ? n.y.toFixed(1) : '0.0',
      n.lat_e6 !== undefined ? n.lat_e6 : '0',
      n.lon_e6 !== undefined ? n.lon_e6 : '0',
      n.pos_error_m !== null && n.pos_error_m !== undefined ? n.pos_error_m.toFixed(2) : '',
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

  /**
   * Exports raw physical radio transmission & demodulation observations as CSV.
   * Excludes fabricated values and preserves authentic simulation events.
   */
  static exportRawObservationsCsv(sim) {
    const headers = [
      'Timestamp_Ms',
      'Event_Type',
      'Node_ID',
      'From_Node',
      'Target_Node',
      'Origin_Node',
      'Seq_Num',
      'Is_Ack',
      'Hops',
      'RSSI_dBm',
      'Drop_Why',
      'Airtime_Ms',
      'Energy_Consumed_Mah',
      'Battery_Pct'
    ];

    const rows = [];
    for (const ev of sim.events || []) {
      if (!['tx', 'rx', 'drop', 'alert', 'ack_rx', 'originate'].includes(ev.ev)) continue;

      rows.push([
        ev.t,
        ev.ev,
        ev.node !== undefined ? ev.node : '',
        ev.from !== undefined ? ev.from : '',
        ev.target !== undefined ? ev.target : (ev.to !== undefined ? ev.to : ''),
        ev.origin !== undefined ? ev.origin : '',
        ev.seq !== undefined ? ev.seq : (ev.ref_seq !== undefined ? ev.ref_seq : ''),
        ev.ack ? '1' : '0',
        ev.hops !== undefined ? ev.hops : (ev.hop !== undefined ? ev.hop : ''),
        typeof ev.rssi === 'number' ? ev.rssi.toFixed(1) : '',
        ev.why || '',
        ev.air || '',
        typeof ev.energy_mah === 'number' ? ev.energy_mah.toFixed(3) : (typeof ev.mah === 'number' ? ev.mah.toFixed(3) : ''),
        typeof ev.battery === 'number' ? ev.battery : ''
      ]);
    }

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, `setu_raw_observations_${sim.session?.id || sim.meta.seed}_${Date.now()}.csv`);
  }

  /**
   * Exports an individual chart dataset as CSV.
   */
  static exportChartDatasetCsv(chartTitle, headers, rows) {
    const cleanTitle = (chartTitle || 'dataset').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, `setu_chart_${cleanTitle}_${Date.now()}.csv`);
  }

  /**
   * Helper to download blob file in browser
   */
  static downloadBlob(blob, filename) {
    if (typeof window === 'undefined' || !document) return;
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
