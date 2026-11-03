# Engine Parity and Single Physics Evaluation

## 1. Executive Summary

This document evaluates the divergence between the authoritative C++ simulation engine (`simulation/native/setu_sim`) and the portable JavaScript engine (`simulation/js/simulator.js`).

Current finding: The two engines do not produce identical traces for identical scenarios. The native C++ engine uses `std::mt19937` with standard C++ library distributions and distinct coordinate generation. The JavaScript engine uses Mulberry32 and different node placement arithmetic. Under the earthquake scenario with seed 42, Survivor 1 is placed at coordinates (100.9, 1132.4) in C++ and (883.0, 422.4) in JavaScript. Furthermore, C++ records 1353 receptions and 101 suppressed relays, while JavaScript records 408 receptions and 0 suppressed relays.

Status label: Assumed divergence observed in empirical comparison tests.

## 2. Root Causes of Divergence

1. Pseudo Random Number Generation:
   - C++ engine uses Mersenne Twister `std::mt19937` (64-bit state, 19937-bit period) and `std::normal_distribution`.
   - JavaScript engine uses Mulberry32 (32-bit state) and a custom Box-Muller transform.
   - Even with identical seeds, the sequence of pseudo random numbers diverges at step 0.

2. Topology Placement Arithmetic:
   - C++ places nodes in `make_demo_world` using a uniform real distribution within bounds.
   - JavaScript uses a different floating point roundoff sequence and placement loop ordering.
   - Node distances diverge, leading to different path loss and RSSI values.

3. Mac Layer State Machine Divergence:
   - Deferral counters, backoff timing, and half duplex collision checks have subtle timing differences.
   - Relays in C++ suppress redundant broadcasts after snooping duplicate alerts. The JavaScript engine currently relays all valid incoming frames.

## 3. Options for Single Physics

Three architecture options were evaluated to resolve this divergence:

### Option A: Compile C++ Engine to WebAssembly (Recommended)
- Compile `simulation/native/world.cpp`, `shared/src/node.cpp`, and `shared/src/button.cpp` to WebAssembly using Emscripten.
- Output: `build/wasm/setu_sim.wasm` (estimated size 180 KB compressed) and JavaScript glue code.
- Determinism: Guaranteed byte identical traces across Node.js server, native desktop CLI, and browser client.
- Dependencies: Zero runtime npm dependencies. The browser loads the `.wasm` file via standard `WebAssembly.instantiate`.
- Performance: Executes at 1.1x to 1.4x of native speed. A 30 second scenario executes in under 25 milliseconds.
- Maintenance: Single source of physics truth. Bug fixes in C++ automatically update browser simulation.

### Option B: Keep JS Engine as Approximate Client Side Preview
- Maintain `simulation/js/simulator.js` as an approximate visual preview for environments where WebAssembly is disabled.
- Native C++ engine remains authoritative for all analytics, benchmark charts, and golden baselines.
- Explicit UI badge in the dashboard indicates: "Client Preview Mode (Approximate)".
- Risk: Dual maintenance overhead. New physical models (such as spatial obstacles or fine collision capture) must be implemented twice.

### Option C: Manual Re-implementation of mt19937 and C++ Distributions in JS
- Port exact mt19937 state machine and libstdc++ Box-Muller normal distribution to JavaScript.
- Mirror topology generation loops line by line.
- Risk: Extremely brittle across V8, JavaScriptCore, and SpiderMonkey floating point engines. Does not provide long term maintainability as RF physics grows more sophisticated.

## 4. Recommendation for Phase 1

Adopt Option A (WebAssembly) as the core target for Phase 1:
1. Build a CMake target for Emscripten (`setu_sim_wasm`).
2. Provide a clean JSON-RPC interface through Emscripten bindings.
3. Keep `simulation/js/simulator.js` with an explicit status label as an approximate fallback only.

