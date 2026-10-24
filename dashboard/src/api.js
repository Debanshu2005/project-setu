// Project Setu - Local Simulation Bridge API Client

export class SetuApi {
  static baseUrl = '';

  static getBaseUrl() {
    if (this.baseUrl) return this.baseUrl;
    if (typeof window !== 'undefined' && window.location) {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (window.localStorage) {
        const custom = window.localStorage.getItem('setu_backend_url');
        if (custom) {
          const cleanCustom = custom.replace(/\/+$/, '');
          const isCustomLocal = cleanCustom.includes('localhost') || cleanCustom.includes('127.0.0.1');
          if (isLocal || !isCustomLocal) {
            return cleanCustom;
          }
        }
      }
      if (window.__SETU_BACKEND_URL__) {
        return window.__SETU_BACKEND_URL__.replace(/\/+$/, '');
      }
      if (isLocal) {
        const port = window.location.port;
        return (port === '3000' || port === '') ? window.location.origin.replace(/\/+$/, '') : 'http://localhost:3000';
      }
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

  static async resolveBaseUrl() {
    const isBrowser = typeof window !== 'undefined' && Boolean(window.location);
    const host = isBrowser ? window.location.hostname : '';
    const isLocal = host === 'localhost' || host === '127.0.0.1';

    // 1. Check URL query parameters: ?backend=https://...
    if (isBrowser) {
      const params = new URLSearchParams(window.location.search);
      const paramBackend = params.get('backend');
      if (paramBackend && /^https?:\/\//i.test(paramBackend)) {
        this.setBaseUrl(paramBackend);
        return this.getBaseUrl();
      }
    }

    // 2. Check injected runtime config
    if (isBrowser && window.__SETU_BACKEND_URL__) {
      this.baseUrl = window.__SETU_BACKEND_URL__.replace(/\/+$/, '');
      return this.baseUrl;
    }

    // 3. If deployed on remote host (e.g. Vercel), fetch /api/config first to avoid stale localStorage hijacking
    if (isBrowser && !isLocal) {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          if (data && data.backendUrl && /^https?:\/\//i.test(data.backendUrl)) {
            this.baseUrl = data.backendUrl.replace(/\/+$/, '');
            return this.baseUrl;
          }
        }
      } catch {
        // Fall through to manual overrides
      }

      // 4. Check localStorage on remote hosts only if NOT pointing to stale localhost
      if (window.localStorage) {
        const custom = window.localStorage.getItem('setu_backend_url');
        if (custom) {
          const cleanCustom = custom.replace(/\/+$/, '');
          if (!cleanCustom.includes('localhost') && !cleanCustom.includes('127.0.0.1') && /^https?:\/\//i.test(cleanCustom)) {
            this.baseUrl = cleanCustom;
            return this.baseUrl;
          } else {
            // Clear stale local dev URL from remote domain storage
            window.localStorage.removeItem('setu_backend_url');
          }
        }
      }
    }

    // 5. If running locally (localhost or 127.0.0.1)
    if (isBrowser && isLocal) {
      if (window.localStorage) {
        const custom = window.localStorage.getItem('setu_backend_url');
        if (custom) {
          this.baseUrl = custom.replace(/\/+$/, '');
          return this.baseUrl;
        }
      }
      const port = window.location.port;
      if (port === '3000' || port === '') {
        this.baseUrl = window.location.origin.replace(/\/+$/, '');
      } else {
        this.baseUrl = 'http://localhost:3000';
      }
      return this.baseUrl;
    }

    return this.baseUrl || '';
  }

  static async pingBackend(url = null, timeoutMs = 8000) {
    const target = (url || this.getBaseUrl()).replace(/\/+$/, '');
    if (!target) return { ok: false, error: 'No backend URL configured' };
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${target}/health`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, data };
      }
      return { ok: false, status: res.status };
    } catch (err) {
      clearTimeout(id);
      return { ok: false, error: err.name === 'AbortError' ? 'Timeout (Service may be waking up)' : err.message };
    }
  }

  static async getStatus() {
    try {
      const base = this.getBaseUrl();
      if (!base && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        return { status: 'unconfigured', error: 'Backend URL not configured. Click ⚡ Backend to connect.' };
      }
      const res = await fetch(`${base}/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('API Status error:', err);
      return { status: 'offline', error: err.message };
    }
  }

  static async getScenarios() {
    const base = this.getBaseUrl();
    const primaryUrl = `${base}/api/scenarios`;
    let primaryErr = null;

    try {
      const res = await fetch(primaryUrl);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      } else {
        primaryErr = new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err) {
      primaryErr = err;
    }

    // Secondary fallback: if primary was a remote cross-origin backend, try local relative /api/scenarios (e.g. Vercel Lambda)
    if (base && typeof window !== 'undefined' && window.location) {
      try {
        const fallbackRes = await fetch('/api/scenarios');
        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          if (Array.isArray(data) && data.length > 0) return data;
        }
      } catch {
        // Fall through to error reporting
      }
    }

    if (primaryErr) {
      console.error('Failed to load scenarios:', primaryErr);
      throw new Error(`Failed to load scenarios from ${base || 'server'}: ${primaryErr.message}`);
    }
    return [];
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
    const base = this.getBaseUrl();
    let res = null;
    let fetchError = null;

    try {
      res = await fetch(`${base}/api/trace/${encodeURIComponent(filename)}`);
    } catch (err) {
      fetchError = err;
    }

    // Fallback: try relative path (e.g. Vercel serverless trace route)
    if ((!res || !res.ok) && base && typeof window !== 'undefined' && window.location) {
      try {
        const fallbackRes = await fetch(`/api/trace/${encodeURIComponent(filename)}`);
        if (fallbackRes.ok) {
          res = fallbackRes;
          fetchError = null;
        }
      } catch (err) {
        if (!fetchError) fetchError = err;
      }
    }

    if (!res || !res.ok) {
      const statusMsg = res ? `HTTP ${res.status}` : (fetchError ? fetchError.message : 'Network error');
      throw new Error(`Failed to fetch trace "${filename}": ${statusMsg}`);
    }

    const text = await res.text();
    const events = this.parseJsonl(text);
    if (!events || events.length === 0) {
      throw new Error(`Trace file "${filename}" is empty or contains no valid events`);
    }
    return events;
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
    const cleanKind = String(kind || 'short').replace('_', '-');
    const res = await fetch(`${this.getBaseUrl()}/api/control/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: nodeId, kind: cleanKind })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to trigger node`);
    return await res.json();
  }

  static async triggerAll(payload = {}, jitter = 0) {
    const delay = typeof payload === 'string'
      ? (typeof jitter === 'number' ? jitter : parseInt(jitter, 10) || 0)
      : (typeof payload.delay_ms !== 'undefined' ? (parseInt(payload.delay_ms, 10) || 0) : (parseInt(jitter, 10) || 0));
    const kind = typeof payload === 'string'
      ? payload.replace('_', '-')
      : String(payload.kind || 'short').replace('_', '-');
    const mode = delay > 0 ? 'staggered' : 'immediate';

    const body = { kind, mode, delay_ms: delay };
    const res = await fetch(`${this.getBaseUrl()}/api/control/trigger-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
    if (!text || typeof text !== 'string') return [];
    const lines = text.split('\n');
    const events = [];
    const errors = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch (err) {
        errors.push({ line: i + 1, error: err.message, snippet: line.slice(0, 80) });
      }
    }
    if (errors.length > 0) {
      console.warn(`[Setu API] Encountered ${errors.length} malformed JSONL line(s):`, errors);
    }
    return events;
  }
}
