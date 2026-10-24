// Project Setu - Local Simulation Bridge API Client

export class SetuApi {
  static baseUrl = '';

  static getBaseUrl() {
    if (typeof window !== 'undefined' && window.localStorage) {
      const custom = window.localStorage.getItem('setu_backend_url');
      if (custom) return custom.replace(/\/+$/, '');
    }
    return this.baseUrl || '';
  }

  static setBaseUrl(url) {
    const clean = (url || '').trim().replace(/\/+$/, '');
    if (typeof window !== 'undefined' && window.localStorage) {
      if (clean) window.localStorage.setItem('setu_backend_url', clean);
      else window.localStorage.removeItem('setu_backend_url');
    }
    this.baseUrl = clean;
  }

  static async getStatus() {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('API Status error:', err);
      return { status: 'offline', error: err.message };
    }
  }

  static async getScenarios() {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/scenarios`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Get Scenarios error:', err);
      return [];
    }
  }

  static async getTraces() {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/traces`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Get Traces error:', err);
      return [];
    }
  }

  static async fetchTrace(filename) {
    const res = await fetch(`${this.getBaseUrl()}/api/trace/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch trace`);
    const text = await res.text();
    return this.parseJsonl(text);
  }

  static async runSimulation(payload) {
    const res = await fetch(`${this.getBaseUrl()}/api/simulate`, {
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
    const res = await fetch(`${this.getBaseUrl()}/api/simulate/stop`, { method: 'POST' });
    return await res.json();
  }

  static async uploadTrace(content) {
    const res = await fetch(`${this.getBaseUrl()}/api/upload-trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  }

  static async startControl(options = {}) {
    const res = await fetch(`${this.getBaseUrl()}/api/control/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to start simulation`);
    return await res.json();
  }

  static async pauseControl() {
    const res = await fetch(`${this.getBaseUrl()}/api/control/pause`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to pause simulation`);
    return await res.json();
  }

  static async stepControl(ms = 100) {
    const res = await fetch(`${this.getBaseUrl()}/api/control/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ms })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to step simulation`);
    return await res.json();
  }

  static async resetControl() {
    const res = await fetch(`${this.getBaseUrl()}/api/control/reset`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to reset simulation`);
    return await res.json();
  }

  static async triggerNode(nodeId, kind = 'short') {
    const res = await fetch(`${this.getBaseUrl()}/api/control/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: nodeId, kind })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to trigger node`);
    return await res.json();
  }

  static async triggerAll(payload = {}) {
    const res = await fetch(`${this.getBaseUrl()}/api/control/trigger-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to trigger all nodes`);
    return await res.json();
  }

  static async setNodeState(payload) {
    const res = await fetch(`${this.getBaseUrl()}/api/control/node-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to update node state`);
    return await res.json();
  }

  static async repositionNode(nodeId, x, y) {
    const res = await fetch(`${this.getBaseUrl()}/api/control/reposition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: nodeId, x, y })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to reposition node`);
    return await res.json();
  }

  static async blockLink(a, b, blocked = true) {
    const res = await fetch(`${this.getBaseUrl()}/api/control/block-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a, b, blocked })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to toggle link block`);
    return await res.json();
  }

  static async getControlState() {
    const res = await fetch(`${this.getBaseUrl()}/api/control/state`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to get node state`);
    return await res.json();
  }

  static async getControlSummary() {
    const res = await fetch(`${this.getBaseUrl()}/api/control/summary`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to get summary`);
    return await res.json();
  }

  static async getControlStatus() {
    const res = await fetch(`${this.getBaseUrl()}/api/control/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to get control status`);
    return await res.json();
  }

  static connectEvents(onEvent, onStatus, onError) {
    const source = new EventSource(`${this.getBaseUrl()}/api/events`);
    source.addEventListener('event', e => {
      try {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent(data);
      } catch (err) {
        console.error('SSE event parse error:', err);
      }
    });
    source.addEventListener('status', e => {
      try {
        const data = JSON.parse(e.data);
        if (onStatus) onStatus(data);
      } catch (err) {
        console.error('SSE status parse error:', err);
      }
    });
    source.addEventListener('error', err => {
      if (onError) onError(err);
    });
    return source;
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
