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
   cmake --build build-wasm --target setu_sim_wasm
   ```

4. Artifacts generated:
   - `build-wasm/setu_sim_wasm.wasm`: Precompiled WebAssembly bytecode (approximately 180 KB).
   - `build-wasm/setu_sim_wasm.js`: Emscripten module loader and runtime glue code.

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
console.log("Obstacle loss:", lossBudget.obstacle_loss); // "not modeled yet"
```

## 4. Architectural Guarantees

- Exact physics parity: Compiles the exact same C++ sources (`world.cpp`, `node.cpp`, `button.cpp`).
- Zero npm runtime dependencies.
- Deterministic trace generation across desktop, serverless, and browser execution.

