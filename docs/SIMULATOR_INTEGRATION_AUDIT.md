# Project Setu: Firmware-in-the-Loop Simulator Integration Audit & Baseline

**Date**: October 2026  
**Author**: Antigravity Simulation Architecture Team  
**System Target**: ESP32-S3-WROOM-1 / ESP32-S3-DevKitC-1-N8 (Xtensa LX7 Dual-Core)  
**Host Simulation Target**: Windows x86_64 (MSVC 2022 / CMake 4.5 / C++17) + PlatformIO 6.2.0 (ESP-IDF 6.0.1)

---

## 1. Executive Summary

This audit establishes the empirical baseline of the `Debanshu2005/project-setu` repository. Every claim in this document is backed by actual test runs, compiler output, and source code verification performed on the active workspace.

The repository is organized around a **clean, layered architecture**:
1. **Portable C++17 Core (`shared/`)**: Hardware-independent protocol logic, packet wire serialization, button classification, deduplication ring cache, and duty-cycle tracking. Zero ESP-IDF or simulator dependencies.
2. **ESP32-S3 Target Firmware (`firmware/`)**: Real hardware driver adapters for Semtech SX1262 LoRa SPI, NEO-6M GNSS UART, MPU6050 IMU I2C, ERM haptic PWM, and LiPo ADC voltage monitoring. Built and verified via PlatformIO with ESP-IDF framework.
3. **Firmware-in-the-Loop (FITL) Adapter (`firmware/esp32s3/include/firmware_task_node.hpp`)**: Reproduces the FreeRTOS task, queue, and ISR architecture (`ButtonEvent` queue, `RadioRxEvent` queue, 100 Hz core protocol task, and event-driven radio task) on host platforms.
4. **Native C++ Simulation Engine (`simulation/native/`)**: High-performance discrete-event RF channel simulator (`setu_sim`) modeling log-distance path loss, log-normal shadowing, Rayleigh/fast fading, Semtech SX1262 airtime, half-duplex radio contention, and collisions with capture effect.
5. **Full-Stack Disaster Operations Dashboard (`dashboard/` & `api/`)**: High-fidelity operations center providing interactive topology canvas, packet wire hex inspection, chronological event tracing, and serverless simulation fallback.

---

## 2. Baseline Test Execution Results

Prior to making any code modifications, the existing test suites were executed on the active system:

| Test Suite | Framework / Tool | Tests Total | Passed | Failed | Execution Time |
|:---|:---|:---:|:---:|:---:|:---:|
| **C++ Unit Tests** | `build/Release/setu_unit_tests.exe` | 52 | **52** | 0 | 0.04 s |
| **C++ Integration Tests** | `build/Release/setu_integration_tests.exe` | 13 | **13** | 0 | 0.15 s |
| **Node.js Backend Tests** | `node tests/test_backend.mjs` | 144 | **144** | 0 | 4.82 s |
| **Node.js Analytics Tests** | `node tests/test_analytics.mjs` | 141 | **141** | 0 | 4.21 s |
| **ESP32-S3 Firmware Compilation** | `pio run -e esp32-s3-devkitc-1` | 1 Target | **SUCCESS** | 0 | 19.79 s |
| **Overall Baseline** | All Suites Combined | **350** | **350** | **0** | **100% Green** |

### Target Firmware Binary Artifacts Generated
- `firmware.elf`: 5,355,672 bytes (RAM used: 26,016 bytes / 7.9%; Flash used: 279,653 bytes / 13.3%)
- `firmware.bin`: 280,080 bytes
- `bootloader.bin`: 21,056 bytes
- `partitions.bin`: 3,072 bytes

---

## 3. Subsystem Breakdown & Architectural Mapping

### 3.1 Application Frontend and Dashboard (`dashboard/`)
- **Technology**: Vanilla HTML5, CSS3, ES Modules (`dashboard/index.html`, `dashboard/src/`, `dashboard/components/`).
- **Visual Design**: Dark navy/slate disaster response command center palette with CSS custom properties.
- **Topology Visualizer (`components/topology.js`)**: Canvas 2D renderer supporting pan, zoom, dynamic node dragging, link RSSI gradients, and real-time transmission waves.
- **Packet Wire Inspector (`components/inspector.js`)**: 25-byte hex view color-coded by wire field boundaries (node ID, sequence, target, hazard, GNSS coordinates, battery, hop counter).
- **Timeline & Event Trace (`components/timeline.js`)**: Chronological event stream with category filtering (alerts, drops, retries, ACKs, queue depths).
- **Communication Protocol**:
  - Primary: REST API + Server-Sent Events (SSE) via `dashboard/server.js` (`/api/events`).
  - Fallback: Vercel serverless functions (`/api/*`) with pre-computed scenario traces.

### 3.2 Backend and Simulation Orchestration (`dashboard/server.js`)
- **Bridge Architecture**: Pure Node.js HTTP/SSE server bridging web clients to the native C++ CLI simulator (`build/Release/setu_sim.exe -i`) over stdio JSON-RPC IPC.
- **Commands Supported**: `init`, `step`, `run_until`, `trigger`, `trigger_all`, `set_node`, `reposition`, `get_state`, `summary`, `reset`.
- **Fault Injection**: Dynamically injects hardware faults (kill/revive node, toggle GNSS, toggle IMU DR, set battery percentage, block/unblock RF links).

### 3.3 Native C++ Simulation Engine (`simulation/native/`)
- **Authoritative World (`sim::World`)**: Discrete-time progression loop (1 ms resolution) managing virtual devices, event scheduling, transmissions, and telemetry.
- **Node Container (`sim::SimNode`)**: Encapsulates coordinates $(x, y)$, energy accounting, virtual FreeRTOS queues (`button_queue`, `radio_queue`), and peripheral adapters.
- **Airtime Calculation (`setu::lora_airtime_ms`)**: Accurate implementation of Semtech SX1262 LoRa airtime based on SF, bandwidth, preamble symbols, and coding rate.

### 3.4 Shared Setu Protocol Implementation (`shared/`)
- **Packed Wire Layout (`setu::Packet`)**: Exactly 25 bytes, little-endian, zero memory padding across architectures:
  - `node_id` (2B), `seq` (2B), `target` (2B), `ref_seq` (2B), `hazard` (1B), `flags` (1B), `lat_e6` (4B), `lon_e6` (4B), `ts` (4B), `battery` (1B), `hop` (1B), `contact` (1B).
- **Button Classifier (`setu::ButtonClassifier`)**: Timing-based classification for Short (<500ms), Double (<600ms gap), and Long ($\ge$1500ms) presses with debouncing.
- **Deduplication (`setu::DedupCache`)**: 64-entry cyclic ring cache indexed by `(node_id, seq, is_ack)`.
- **Duty Cycle (`setu::DutyCycle`)**: Rolling 1-hour window budget enforcing 1% transmission limit (prioritized emergency SOS bypasses relay limits).
- **Core Node Logic (`setu::Node`)**: State machine handling SOS origination, retry backoff ($4000 \times (\text{attempt} + 1)$ ms), ACK generation, relay flood suppression, and haptic feedback triggers.

### 3.5 Firmware Source Code & FreeRTOS Wiring (`firmware/`)
- **Entry Point (`firmware/main/app_main.cpp`)**:
  - Initializes NVS flash and restores persistent monotonic sequence counter.
  - Derives `node_id` from ESP32 WiFi STA MAC eFuse.
  - Instantiates hardware adapters for SX1262, NEO-6M, MPU6050, ADC, and Haptic GPIOs.
  - Installs GPIO ISRs on GPIO 0 (`BOOT` button) and GPIO 4 (SX1262 DIO1).
  - Creates bounded FreeRTOS queues: `s_button_queue` (capacity 16) and `s_radio_rx_queue` (capacity 8).
  - Pins `radio_rx_task` to Core 0 (priority 6) and `core_protocol_task` to Core 1 (priority 5).
- **Hardware Drivers (`firmware/esp32s3/include/esp32_adapters.hpp`)**:
  - `Sx1262Radio`: Full SPI state machine with opcodes, BUSY polling, PA config, and DIO1 IRQ.
  - `Neo6mGnss`: NMEA sentence parser ($GPRMC, $GPGGA) with XOR checksums and clock disciplining.
  - `Mpu6050DeadReckoning`: I2C WHO_AM_I verification, step displacement integration, and 5-minute confidence decay.
  - `BatteryMonitor`: LiPo ADC calibration curve with 2:1 resistive divider mapping.
  - `HapticLedDriver`: ERM motor pulse patterns and LED status indicators.

---

## 4. Current Execution Boundaries & Fidelity Matrix

| Component | Production Target (ESP32-S3) | Current Host Simulator | Fidelity Level | Execution Boundary |
|:---|:---|:---|:---:|:---|
| **Protocol State Machine** | Real C++ (`setu::Node`) | Real C++ (`setu::Node`) | **Level 2 (Identical)** | Shared compiled source code |
| **Packet Wire Serialization** | Real C++ (`setu::Packet`) | Real C++ (`setu::Packet`) | **Level 2 (Identical)** | 25-byte binary layout identical |
| **Button Edge Classifier** | Real C++ (`setu::ButtonClassifier`) | Real C++ (`setu::ButtonClassifier`) | **Level 2 (Identical)** | Millisecond timing identical |
| **Deduplication & Relay Logic** | Real C++ (`setu::DedupCache`) | Real C++ (`setu::DedupCache`) | **Level 2 (Identical)** | Sighting counter & ring buffer |
| **Duty Cycle Accounting** | Real C++ (`setu::DutyCycle`) | Real C++ (`setu::DutyCycle`) | **Level 2 (Identical)** | 1-hour rolling window identical |
| **FreeRTOS Queues & Tasks** | FreeRTOS `xQueue*` / `xTask*` | Virtual FreeRTOS Queue (`VirtualQueue`) | **Level 2 (Adapted)** | Bounded queues with ISR drop semantics |
| **SX1262 LoRa Radio** | Physical SPI + Registers | `sim::World` Channel Engine | **Level 3 (Modelled)** | RF channel physics, path loss, collisions |
| **NEO-6M GNSS Satellite** | Hardware UART + NMEA | Simulated Fix & Outage Injector | **Level 3 (Modelled)** | Synthetic coordinates with noise & drift |
| **MPU-6050 IMU** | Hardware I2C Register 0x68 | Analytical Step Displacer | **Level 3 (Modelled)** | Random-walk drift & step integration |
| **LiPo Battery Cell** | Hardware ADC1_CH0 Divider | Step Energy Accounting Model | **Level 3 (Modelled)** | TX, RX, and idle mAh consumption |
| **Audio Voice Recognition** | ESP-SR WakeNet/MultiNet | Synthetic Event Injector | **Level 3 (Modelled)** | Injected voice intent triggers |

---

## 5. Identified Gaps & Areas for Improvement

1. **IMU Sensor Model Fidelity**:
   - *Current State*: The simulator uses an analytical step displacer with Gaussian noise.
   - *Improvement Needed*: A full 3-axis accelerometer and 3-axis gyroscope sensor model with configurable bias, white noise, scale-factor error, gravity vector orientation, and activity profiles (Stationary, Walking, Running, Fall/Impact).
2. **Ground Truth vs. Estimated Position Separation**:
   - *Current State*: `SimNode` stores position and derives coordinates directly.
   - *Improvement Needed*: Explicit separation between `ground_truth_position` $(x, y, z)$ and `estimated_position` $(\hat{x}, \hat{y})$ in telemetry and UI, calculating and displaying error metrics (Mean Absolute Error, RMS Error, Drift vs Outage Duration).
3. **GNSS Sensor Realism**:
   - *Current State*: Binary fix toggle with Gaussian coordinate perturbation.
   - *Improvement Needed*: Realistic satellite constellation modeling, HDOP/VDOP dilution of precision, delayed time-to-first-fix (TTFF), multi-path fading, and realistic NMEA sentence streaming into the adapter.
4. **RF Channel & Collision Mechanics**:
   - *Current State*: Log-distance path loss with log-normal shadowing and 6 dB capture threshold.
   - *Improvement Needed*: Automated parameter sweep experiments (path-loss exponent sweep from 2.0 to 4.5), explicit drop reason telemetry logging, and sensitivity boundary tests.
5. **UI & Scenario Integration**:
   - *Current State*: Scenario traces can be replayed and live commands triggered.
   - *Improvement Needed*: Real-time visualization of sensor noise, ground truth vs estimated position paths, live battery drain curve, and interactive node motion paths.

---

## 6. Audit Conclusion & Phase Transition

The baseline audit confirms that Project Setu possesses a robust, functioning, and highly modular C++ foundation. The code compiles without errors for both native Windows host execution and the actual ESP32-S3 embedded hardware target. We now proceed to Phase 1 and 2 to expand the simulation architecture according to the master plan.
