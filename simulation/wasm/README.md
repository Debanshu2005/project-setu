# Project Setu: WebAssembly Compilation Guide

This guide documents the compilation of the authoritative C++ simulation engine into WebAssembly using Emscripten.

## 1. Prerequisites

- Emscripten SDK (emsdk) version 3.1.50 or higher.
- CMake 3.16 or higher.

## 2. Compilation Instructions

1. Activate the Emscripten environment:
   ```bash
   source /path/to/emsdk/emsdk_env.sh
   ```

2. Configure with emcmake:
   ```bash
   emcmake cmake -B build-wasm -DCMAKE_BUILD_TYPE=Release
   ```

3. Build the WebAssembly module:
   ```bash
   cmake --build build-wasm --target setu_sim_wasm --config Release
   ```

4. Artifacts generated:
   - `build-wasm/setu_sim_wasm.wasm`: Precompiled WebAssembly bytecode. Verified and measured in CI build job. See `docs/CLAIMS.md` for exact measured binary size.
   - `build-wasm/setu_sim_wasm.js`: Emscripten module loader and ES6 runtime wrapper.
   - For browser delivery, artifacts are served via `dashboard/wasm/` and loaded by `dashboard/src/wasm_loader.js`.

## 3. JavaScript Integration

The generated module runs in both browser and Node.js environments without npm runtime dependencies:

```javascript
import createSetuSim from './setu_sim_wasm.js';

const Module = await createSetuSim();
const session = new Module.WasmSimSession();

// Initialize simulation with 15 survivors, 3 relays, 1000m zone, seed 42, and field profile
session.init(15, 3, 1000.0, 42, "field");

// Step forward 1000 ms
session.step(1000);

// Trigger a panic button press (short press = General SOS) on Node 1
session.trigger_button(1, "short");

// Run until 5000 ms
session.run_until(5000);

// Query link margin and loss budget between Node 1 and Hub 0
const lossBudget = JSON.parse(session.get_loss_budget_json(1, 0));
console.log("Link margin dB:", lossBudget.link_margin_db);

// Retrieve full state for 3D visualizer
const state = JSON.parse(session.get_state_json());
console.log("Node count:", state.nodes.length);
```

## 4. Architectural Guarantees

- Exact physics parity: Compiles the exact same C++ sources (`world.cpp`, `node.cpp`, `button.cpp`).
- Bit-level determinism: Uses portable `HashRandom` and `Xoshiro256PlusPlus` PRNG engines.
- Continuous CI verification: Automated job in `.github/workflows/ci.yml` compiles the module and validates line-by-line trace equality against the native simulator binary via `tests/test_engine_parity.mjs`.
- Zero npm runtime dependencies.
