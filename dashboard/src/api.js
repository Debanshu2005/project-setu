// Project Setu - Local Simulation Bridge API Client

export class SetuApi {
  static baseUrl = '';
  static configSource = 'unconfigured'; // 'env' | 'production_default' | 'manual' | 'query' | 'runtime' | 'local' | 'unconfigured'
  static configError = null;
  static initPromise = null;
  static DEFAULT_PROD_BACKEND = 'https://project-setu-backend.onrender.com';

  static getSource() {
    return this.configSource;
  }

  static getConfigError() {
    return this.configError;
  }

  static isManualOverride() {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('setu_manual_backend_override') === 'true';
    }
    return false;
  }

  static ensureResolved() {
    if (!this.initPromise) {
      this.initPromise = this.resolveBaseUrl();
    }
    return this.initPromise;
  }

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
      // On remote hosts (e.g. Vercel), predictable default matches resolveBaseUrl
      return this.DEFAULT_PROD_BACKEND;
    }
    return this.baseUrl || this.DEFAULT_PROD_BACKEND;
  }

  static requireBaseUrl() {
    const url = this.getBaseUrl();
    if (!url) {
      const detail = this.configError ? ` (${this.configError})` : '';
      throw new Error(`Project Setu backend URL is not configured${detail}. Interactive simulation requires an active connection to the Render backend.`);
    }
    return url;
  }

  static setBaseUrl(url) {
    this.setManualOverride(url);
  }

  static setManualOverride(url) {
    const clean = (url || '').trim().replace(/\/+$/, '');
    if (!clean) {
      this.clearManualOverride();
      return;
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('setu_backend_url', clean);
      window.localStorage.setItem('setu_manual_backend_override', 'true');
    }
    this.baseUrl = clean;
    this.configSource = 'manual';
    this.configError = null;
    this.initPromise = Promise.resolve(clean);
  }

  static async clearManualOverride() {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('setu_backend_url');
      window.localStorage.removeItem('setu_manual_backend_override');
    }
    this.baseUrl = '';
    this.configSource = 'unconfigured';
    this.configError = null;
    this.initPromise = null;
    return await this.ensureResolved();
  }

  static async resolveBaseUrl() {
    const isBrowser = typeof window !== 'undefined' && Boolean(window.location);
    const host = isBrowser ? window.location.hostname : '';
    const isLocal = host === 'localhost' || host === '127.0.0.1';

    // 1. Explicit user manual override takes precedence if set
    if (isBrowser && window.localStorage && window.localStorage.getItem('setu_manual_backend_override') === 'true') {
      const custom = (window.localStorage.getItem('setu_backend_url') || '').trim().replace(/\/+$/, '');
      if (custom && /^https?:\/\//i.test(custom)) {
        this.baseUrl = custom;
        this.configSource = 'manual';
        this.configError = null;
        return this.baseUrl;
      }
    }

    // 2. Check URL query parameters: ?backend=https://...
    if (isBrowser) {
      const params = new URLSearchParams(window.location.search);
      const paramBackend = params.get('backend');
      if (paramBackend && /^https?:\/\//i.test(paramBackend)) {
        this.baseUrl = paramBackend.trim().replace(/\/+$/, '');
        this.configSource = 'query';
        this.configError = null;
        return this.baseUrl;
      }
    }

    // 3. Check injected runtime config (e.g. Docker / SSR injection)
    if (isBrowser && window.__SETU_BACKEND_URL__) {
      this.baseUrl = window.__SETU_BACKEND_URL__.trim().replace(/\/+$/, '');
      this.configSource = 'runtime';
      this.configError = null;
      return this.baseUrl;
    }

    // 4. Remote hosting (e.g. Vercel): fetch serverless /api/config
    if (isBrowser && !isLocal) {
      try {
        const res = await fetch('/api/config', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.backendUrl && /^https?:\/\//i.test(data.backendUrl)) {
            this.baseUrl = data.backendUrl.trim().replace(/\/+$/, '');
            this.configSource = data.isDefaultFallback ? 'production_default' : 'env';
            this.configError = null;
            // Clean up any stale localStorage dev settings on remote domain
            if (window.localStorage && !this.isManualOverride()) {
              window.localStorage.removeItem('setu_backend_url');
            }
            return this.baseUrl;
          } else if (data && data.error) {
            this.configError = data.error;
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          this.configError = errData.error || `HTTP ${res.status}`;
        }
      } catch (err) {
        this.configError = err.message;
      }

      // Check localStorage only if user had manually saved a remote HTTPS url previously
      if (window.localStorage) {
        const custom = window.localStorage.getItem('setu_backend_url');
        if (custom) {
          const cleanCustom = custom.trim().replace(/\/+$/, '');
          if (!cleanCustom.includes('localhost') && !cleanCustom.includes('127.0.0.1') && /^https?:\/\//i.test(cleanCustom)) {
            this.baseUrl = cleanCustom;
            this.configSource = 'manual';
            return this.baseUrl;
          } else {
            window.localStorage.removeItem('setu_backend_url');
          }
        }
      }

      // 5. Default verified production Render backend URL fallback
      this.baseUrl = this.DEFAULT_PROD_BACKEND;
      this.configSource = 'production_default';
      this.configError = null;
      return this.baseUrl;
    }

    // 5. Local development (localhost / 127.0.0.1)
    if (isBrowser && isLocal) {
      if (window.localStorage) {
        const custom = window.localStorage.getItem('setu_backend_url');
        if (custom) {
          this.baseUrl = custom.trim().replace(/\/+$/, '');
          this.configSource = 'manual';
          return this.baseUrl;
        }
      }
      const port = window.location.port;
      if (port === '3000' || port === '') {
        this.baseUrl = window.location.origin.replace(/\/+$/, '');
      } else {
        this.baseUrl = 'http://localhost:3000';
      }
      this.configSource = 'local';
      this.configError = null;
      return this.baseUrl;
    }

    this.baseUrl = this.DEFAULT_PROD_BACKEND;
    this.configSource = 'production_default';
    return this.baseUrl;
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
    await this.ensureResolved();
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
    await this.ensureResolved();
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
    const res = await fetch(`${this.requireBaseUrl()}/api/simulate`, {
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
    const res = await fetch(`${this.requireBaseUrl()}/api/simulate/stop`, { method: 'POST' });
    return await res.json();
  }

  static async uploadTrace(content) {
    const res = await fetch(`${this.requireBaseUrl()}/api/upload-trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  }

  static async startControl(options = {}) {
    const res = await fetch(`${this.requireBaseUrl()}/api/control/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to start simulation`);
    }
    return await res.json();
  }

  static async pauseControl() {
    const res = await fetch(`${this.requireBaseUrl()}/api/control/pause`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to pause simulation`);
    }
    return await res.json();
  }

  static async stepControl(ms = 100) {
    const res = await fetch(`${this.requireBaseUrl()}/api/control/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ms })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to step simulation`);
    }
    return await res.json();
  }

  static async resetControl() {
    const res = await fetch(`${this.requireBaseUrl()}/api/control/reset`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to reset simulation`);
    }
    return await res.json();
  }

  static async initControl(params = {}) {
    const res = await fetch(`${this.requireBaseUrl()}/api/control/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to initialize simulation`);
    }
    return await res.json();
  }

  static async triggerNode(nodeId, kind = 'short') {
    const cleanKind = String(kind || 'short').replace('_', '-');
    const res = await fetch(`${this.requireBaseUrl()}/api/control/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: parseInt(nodeId, 10), kind: cleanKind })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to trigger node`);
    }
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
    const res = await fetch(`${this.requireBaseUrl()}/api/control/trigger-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to trigger all nodes`);
    }
    return await res.json();
  }

  static async setNodeState(payloadOrNodeId, maybeUpdate) {
    let body = payloadOrNodeId;
    if (typeof payloadOrNodeId === 'number' || typeof payloadOrNodeId === 'string') {
      body = { node: parseInt(payloadOrNodeId, 10), ...(maybeUpdate || {}) };
    }
    const res = await fetch(`${this.requireBaseUrl()}/api/control/node-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to update node state`);
    }
    return await res.json();
  }

  static async repositionNode(nodeId, x, y) {
    const res = await fetch(`${this.requireBaseUrl()}/api/control/reposition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: parseInt(nodeId, 10), x: parseFloat(x), y: parseFloat(y) })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to reposition node`);
    }
    return await res.json();
  }

  static async blockLink(a, b, blocked = true) {
    const res = await fetch(`${this.requireBaseUrl()}/api/control/block-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: parseInt(a, 10), b: parseInt(b, 10), blocked: Boolean(blocked) })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: Failed to toggle link block`);
    }
    return await res.json();
  }

  static async getControlState() {
    await this.ensureResolved();
    const res = await fetch(`${this.requireBaseUrl()}/api/control/state`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to get node state`);
    return await res.json();
  }

  static async getControlSummary() {
    await this.ensureResolved();
    const res = await fetch(`${this.requireBaseUrl()}/api/control/summary`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to get summary`);
    return await res.json();
  }

  static async getControlStatus() {
    await this.ensureResolved();
    const res = await fetch(`${this.requireBaseUrl()}/api/control/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to get control status`);
    return await res.json();
  }

  static connectEvents(onEvent, onStatus, onError) {
    const url = `${this.requireBaseUrl()}/api/events`;
    const source = new EventSource(url, { withCredentials: true });
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
