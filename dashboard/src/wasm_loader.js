// Project Setu: WebAssembly Simulation Engine Loader
// Loads the Emscripten compiled WebAssembly module when available, with graceful fallback to server REST API.

let wasmModuleInstance = null;

export async function isWasmAvailable() {
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
    return false;
  }
  return true;
}

export async function loadWasmSimulator(wasmJsPath = '/wasm/setu_sim_wasm.js') {
  if (wasmModuleInstance) return wasmModuleInstance;

  const supported = await isWasmAvailable();
  if (!supported) {
    throw new Error('WebAssembly is not supported in this runtime environment');
  }

  const candidates = [
    wasmJsPath,
    '/wasm/setu_sim_wasm.js',
    '/dashboard/wasm/setu_sim_wasm.js',
    '../wasm/setu_sim_wasm.js',
    './wasm/setu_sim_wasm.js'
  ];

  for (const p of candidates) {
    try {
      const mod = await import(/* @vite-ignore */ p);
      const createModule = mod.default || mod;
      if (typeof createModule === 'function') {
        wasmModuleInstance = await createModule();
        console.log(`[Setu Wasm] WebAssembly simulation engine initialized successfully from ${p}`);
        return wasmModuleInstance;
      }
    } catch (_) {}
  }

  console.warn('[Setu Wasm] WebAssembly module not found or failed to initialize, using server fallback');
  return null;
}

export class WasmSimulatorClient {
  constructor(wasmModule) {
    this.module = wasmModule;
    this.session = wasmModule ? new wasmModule.WasmSimSession() : null;
  }

  isReady() {
    return this.session !== null;
  }

  init(survivors = 20, relays = 5, zone = 1200, seed = 7, profile = 'field') {
    if (!this.session) throw new Error('Wasm session not initialized');
    return this.session.init(survivors, relays, zone, seed, profile);
  }

  initWithParams(survivors = 20, relays = 5, zone = 1200, seed = 7, profile = 'field', sf = 7, pathExp = 3.5, loss = 0.0, allowDisconnected = true) {
    if (!this.session) throw new Error('Wasm session not initialized');
    return this.session.init_with_params(survivors, relays, zone, seed, profile, sf, pathExp, loss, allowDisconnected);
  }

  addTrigger(nodeId, kind, t) {
    if (!this.session) return;
    this.session.add_trigger(nodeId, kind, t);
  }

  addObstacle(id, material, x1, y1, x2, y2, customAtten = -1.0) {
    if (!this.session) return;
    this.session.add_obstacle(id, material, x1, y1, x2, y2, customAtten);
  }

  addFault(kind, target, t, arg = '') {
    if (!this.session) return;
    this.session.add_fault(kind, target, t, arg);
  }

  step(ms = 100) {
    if (!this.session) return;
    this.session.step(ms);
  }

  runUntil(tMs) {
    if (!this.session) return;
    this.session.run_until(tMs);
  }

  runAll() {
    if (!this.session) return;
    this.session.run_all();
  }

  now() {
    return this.session ? this.session.now() : 0;
  }

  triggerButton(nodeId, kind = 'short') {
    if (!this.session) return false;
    return this.session.trigger_button(nodeId, kind);
  }

  triggerVoice(nodeId, kind = 'voice') {
    if (!this.session) return false;
    return this.session.trigger_voice(nodeId, kind);
  }

  triggerFall(nodeId) {
    if (!this.session) return false;
    return this.session.trigger_fall(nodeId);
  }

  getTraceLog() {
    if (!this.session) return '';
    return this.session.get_trace_log();
  }

  getState() {
    if (!this.session) return null;
    const raw = this.session.get_state_json();
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  getLossBudget(fromId, toId) {
    if (!this.session) return null;
    const raw = this.session.get_loss_budget_json(fromId, toId);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  getSummary() {
    if (!this.session) return null;
    const raw = this.session.get_summary_json();
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
