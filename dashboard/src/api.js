// Project Setu - Local Simulation Bridge API Client

export class SetuApi {
  static baseUrl = '';

  static async getStatus() {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('API Status error:', err);
      return { status: 'offline', error: err.message };
    }
  }

  static async getScenarios() {
    try {
      const res = await fetch(`${this.baseUrl}/api/scenarios`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Get Scenarios error:', err);
      return [];
    }
  }

  static async getTraces() {
    try {
      const res = await fetch(`${this.baseUrl}/api/traces`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Get Traces error:', err);
      return [];
    }
  }

  static async fetchTrace(filename) {
    const res = await fetch(`${this.baseUrl}/api/trace/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch trace`);
    const text = await res.text();
    return this.parseJsonl(text);
  }

  static async runSimulation(payload) {
    const res = await fetch(`${this.baseUrl}/api/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  static async stopSimulation() {
    const res = await fetch(`${this.baseUrl}/api/simulate/stop`, { method: 'POST' });
    return await res.json();
  }

  static async uploadTrace(content) {
    const res = await fetch(`${this.baseUrl}/api/upload-trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  }

  static parseJsonl(text) {
    const lines = text.split('\n');
    const events = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch (err) {
        console.warn(`Malformed JSONL line ${i + 1}:`, line);
      }
    }
    return events;
  }
}
