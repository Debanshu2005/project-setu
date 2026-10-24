# Project Setu — Firmware Audit & Feasibility Assessment

**Role**: Senior C++ Systems Engineer, Embedded Firmware Architect, Network Simulation Engineer  
**Date**: October 2026  
**Objective**: Establish what firmware components can actually compile and execute, evaluate Vercel deployment constraints, and present the Firmware-in-the-Loop (FITL) implementation plan.

---

## 1. Baseline Audit: What Can Actually Be Compiled and Executed

### 1.1 ESP-IDF Compilation Status
- **Finding**: `firmware/main/app_main.cpp` and `firmware/esp32s3/` **do not currently compile as an ESP-IDF application** in this environment.
- **Root Cause**:
  1. The host environment is a native Windows development machine with MSVC 2022 and CMake, but **ESP-IDF (`idf.py`) is not installed**.
  2. The `firmware/` directory does not contain an ESP-IDF build manifest (`CMakeLists.txt` or `idf_component.yml`) required by the Espressif build system.
  3. `firmware/main/app_main.cpp` uses `#if defined(ESP_PLATFORM)` preprocessor guards. On host platforms, the FreeRTOS API headers (`freertos/FreeRTOS.h`, `freertos/task.h`, `freertos/queue.h`) and ESP-IDF drivers (`esp_timer.h`, `driver/gpio.h`, `nvs_flash.h`) are intentionally excluded.

### 1.2 Actual Firmware Entry Point, Tasks, and Dependencies
- **Entry Point**:
  - Target Hardware (ESP32-S3): `app_main()` initializes NVS, reads MAC eFuse to derive `node_id`, instantiates hardware adapters, allocates FreeRTOS queues (`s_button_queue`, `s_radio_rx_queue`), and spawns two pinned FreeRTOS tasks:
    - `core_protocol_task` (Core 1, 100 Hz): Drains `s_button_queue`, calls `node->on_button_edge()`, and runs `node->tick()`.
    - `radio_rx_task` (Core 0, event-driven): Drains `s_radio_rx_queue` on DIO1 IRQ and calls `node->on_radio_rx()`.
  - Host/Simulator: The entry point is `simulation/native/main.cpp`, which initializes `sim::World` and executes discrete time progression.
- **State Machines**:
  - The actual firmware state machines are located in `shared/`:
    - `setu::Node` (`shared/src/node.cpp`): Originator retry escalation, relay queue with randomized backoff, relay suppression, ACK generation, and ACK matching.
    - `setu::ButtonClassifier` (`shared/src/button.cpp`): Edge timing discrimination for Short (<500ms), Double (<600ms gap), Long ($\ge$1500ms), and bounce filtering.
    - `setu::DedupCache` (`shared/src/dedup.cpp`): 64-entry cyclic ring buffer tracking `(node_id, seq, is_ack)`.
    - `setu::DutyCycle` (`shared/src/duty_cycle.cpp`): 1-hour rolling window budget enforcement.
    - `setu::Packet` (`shared/src/packet.cpp`): 25-byte packed wire layout serialization and parsing.
- **Hardware Abstraction Layer (HAL)**:
  - `shared/include/setu/hal.hpp` defines abstract C++ interfaces (`IClock`, `IRandom`, `IRadio`, `IGnss`, `IDeadReckoning`, `IBattery`, `IHaptic`, `IAlertSink`, `ITraceSink`).
  - `firmware/esp32s3/include/esp32_adapters.hpp` provides driver implementations with host fallback math (NMEA `$GPRMC` parsing, LiPo discharge curves, and geodesic dead-reckoning).

### 1.3 Shared Code vs. Independently Reimplemented Code
- **Shared Code**: The C++ portable core (`shared/`) is compiled into both the native test suite and the simulator (`setu_core`).
- **Independently Reimplemented Code**: `simulation/js/simulator.js` is a separate JavaScript implementation that mimics protocol behavior in JS rather than executing the C++ source code.
- **Gap Identified**: In `simulation/native/world.cpp`, the simulator directly invoked `node->on_button_edge()` and `node->on_radio_rx()` without exercising the firmware's FreeRTOS task queues (`ButtonEvent` queue and `RadioRxEvent` queue).

---

## 2. Vercel Execution Feasibility & Architecture Options

### 2.1 Constraint Analysis: Vercel Serverless Functions
- Vercel Functions are **ephemeral, stateless Node.js serverless execution environments**.
- **Process Persistence**: A background native C++ process (`setu_sim.exe` or Linux binary) **cannot survive across multiple HTTP requests**. Each request spins up or reuses a frozen container.
- **Memory Persistence**: In-memory JavaScript variables do not persist across arbitrary user sessions or cold starts.
- **WebSocket / Long-lived SSE**: Standard Vercel Serverless functions have execution timeouts (10-15s on Hobby tier) and do not support standing bidirectional WebSocket connections.

### 2.2 Evaluation of Execution Options

| Criterion | Option A: WebAssembly in Browser Worker | Option B: Separate Persistent Service | Option C: Hybrid Architecture (Recommended) |
|---|---|---|---|
| **Execution Environment** | Client Browser (Web Worker) | Dedicated Cloud VM / Container (e.g. Render/Railway) | Persistent Backend + Vercel Dashboard Client |
| **Real C++ Code Execution** | Yes (if Wasm toolchain available) | **Yes (Direct native C++ compilation)** | **Yes (Direct native C++ execution)** |
| **Toolchain Feasibility** | Blocked locally (`emcc`/`clang` not installed) | **Feasible (Uses existing MSVC/GCC/CMake)** | **Feasible (Native Windows / Linux backend)** |
| **Vercel Compatibility** | Fully static on Vercel | Vercel hosts UI; points to Backend URL | Vercel hosts UI; connects to persistent engine |
| **Stateful Interaction** | Client-side memory | Stateful server process | Dynamic connection with live reconnection |
| **Cost & Complexity** | Zero server cost | Requires container hosting | Works locally out of the box + cloud deployable |

**Selected Architecture: Option B / Hybrid**:
1. The **Authoritative Firmware-in-the-Loop Engine** runs natively (`setu_sim` / `setu_fitl_sim` via `server.js`).
2. The **Vercel Frontend** acts as the universal visual operations console.
3. The dashboard UI includes an explicit **Backend Connection Manager** allowing operators to connect to:
   - `http://localhost:3000` (Local native C++ execution on Windows).
   - Any remote persistent service URL (e.g. `https://sim.project-setu.org`).
   - Seamless offline fallback with deterministic pre-computed traces.

---

## 3. High-Priority Bugs & Inconsistencies

1. **Firmware Queue Bypassing**: `sim::World` did not model the FreeRTOS task queues (`s_button_queue`, `s_radio_rx_queue`) defined in `app_main.cpp`, jumping straight into `setu::Node`.
2. **JavaScript Simulator Discrepancy**: Vercel `/api/simulate` ran `simulation/js/simulator.js`, which does not execute the authoritative C++ code.
3. **Firmware vs. Network Event Confusion**: Previous event traces did not clearly separate firmware internal events (`btn_isr`, `queue_rx`, `haptic_pulse`, `raw_tx`) from network channel events (`path_loss`, `collision`, `capture`).

---

## 4. Implementation Plan

### Phase 1: Virtual FreeRTOS Queue & Firmware Task Target
- Create `firmware/esp32s3/include/firmware_task_node.hpp` implementing virtual FreeRTOS queues:
  - Bounded `s_button_queue` (capacity 16, ISR dispatch).
  - Bounded `s_radio_rx_queue` (capacity 8, radio IRQ dispatch).
  - Virtual `core_protocol_task` operating at 100 Hz.
  - Virtual `radio_rx_task` event loop.
- Connect virtual hardware adapters (`VirtualClock`, `VirtualRandom`, `VirtualRadio`, `VirtualGnss`, `VirtualDr`, `VirtualBattery`, `VirtualHaptics`).

### Phase 2: Firmware-in-the-Loop Simulation Target (`setu_fitl_sim`)
- Update `CMakeLists.txt` to compile `firmware/main/app_main.cpp` and `firmware_task_node.hpp` into the simulation world.
- Ensure every virtual node in `sim::World` is an isolated firmware instance with its own queues and tasks.
- Verify simulated transmissions pass real 25-byte serialized packets through `sim::Channel`.

### Phase 3: Comprehensive Automated Verification
- Create `tests/unit/test_firmware_in_the_loop.cpp` verifying:
  - Simulated button press enters button ISR queue.
  - Core task drains queue and triggers `ButtonClassifier`.
  - Exact 25-byte packet is serialized and sent to radio.
  - Radio packet is received into receiver's radio ISR queue.
  - Receiver firmware task processes packet and generates ACK.
  - Origin firmware accepts ACK and terminates retries.
  - Node failure and link partitioning cause honest retry exhaustion.

### Phase 4: Dashboard & Vercel Integration
- Add backend connection manager to `dashboard/src/api.js` and `dashboard/index.html`.
- Expose firmware-level telemetry and queue depth in `dashboard/components/inspector.js`.
- Update `api/status.js` and `api/simulate.js` to report firmware execution status and prevent false claims.
- Run all tests and verify full green build on Windows.
