// Project Setu: WebAssembly Simulation Engine Loader
// Loads the Emscripten compiled WebAssembly module when available, with graceful fallback to server REST API.

let wasmModuleInstance = null;

export async function isWasmAvailable() {
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
    return false;
  }
  return true;
}

export async function loadWasmSimulator(wasmJsPath = '/simulation/wasm/setu_sim_wasm.js') {
  if (wasmModuleInstance) return wasmModuleInstance;

  const supported = await isWasmAvailable();
  if (!supported) {
    throw new Error('WebAssembly is not supported in this runtime environment');
  }

  try {
    // Dynamic import of Emscripten generated JS wrapper
    const createModule = (await import(wasmJsPath)).default;
    wasmModuleInstance = await createModule();
    console.log('[Setu Wasm] WebAssembly simulation engine initialized successfully');
    return wasmModuleInstance;
  } catch (err) {
    console.warn('[Setu Wasm] WebAssembly module not found or failed to initialize, using server fallback:', err.message);
    return null;
  }
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

  step(ms = 100) {
    if (!this.session) return;
    this.session.step(ms);
  }

  runUntil(tMs) {
    if (!this.session) return;
    this.session.run_until(tMs);
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

