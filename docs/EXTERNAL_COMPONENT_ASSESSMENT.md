# Project Setu: External Component Assessment & Integration Strategy

**Date**: October 2026  
**Document**: `docs/EXTERNAL_COMPONENT_ASSESSMENT.md`  
**Purpose**: Rigorous technical evaluation of upstream projects, emulators, RF engines, and sensor models against Project Setu's architecture and simulation requirements.

---

## 1. Assessment Methodology & Evaluation Criteria

Every external project is evaluated against the following criteria:
1. **Target Compatibility**: Does it support the ESP32-S3 (Xtensa dual-core LX7) and ESP-IDF v5/v6?
2. **Peripheral Coverage**: Does it support the physical peripherals used by Setu (Semtech SX1262 LoRa via SPI, NEO-6M GNSS via UART, MPU6050 IMU via I2C, INMP441 via I2S, LiPo ADC)?
3. **Execution Mode**: Does it genuinely execute compiled firmware binaries, execute shared portable logic, or merely mock behaviors?
4. **Automation & Testability**: Can it run unattended in automated unit/integration test suites (CI/CD) on host machines without interactive GUI intervention?
5. **Architectural Coherence**: Does it integrate cleanly into our authoritative C++ discrete-event engine (`sim::World`) without introducing duplicate radio models or competing schedulers?
6. **Licensing**: Is the component compatible with Setu's MIT license?

---

## 2. Detailed Component Assessments

### 2.1 ESP32 Firmware Execution Candidates

#### A. Espressif ESP Emulator (`espressif/esp-emulator`)
- **Purpose**: Official Espressif Rust-based emulator running ESP32/S3 binaries in browser (WASM) or Linux/macOS CLI.
- **Relevant Implementation**: Emulates CPU, MMU/PMP, interrupt controllers, timers, UART, GPIO, and FreeRTOS context switching.
- **Compatibility**: Supports ESP32-S3 dual-core Xtensa LX7 and boots standard ESP-IDF `firmware.bin` / `firmware.elf` images.
- **Peripheral Support**: Only standard on-chip peripherals (UART0, GPIO, timers, internal crypto, basic WiFi/BLE). **Zero support for external SPI LoRa transceivers (SX1262)**, external UART NMEA streaming, or I2C sensors out-of-the-box.
- **Build Requirements**: Rust toolchain, WASM/Cargo; prebuilt CLI binaries available for Linux/macOS, not native Windows.
- **License**: Apache 2.0.
- **Risks**: If our firmware binary boots on `esp-emulator`, the SX1262 SPI initialization check fails immediately, stalling node operation unless custom virtual SPI slave hooks are implemented.
- **Decision: Adapt / Use as Reference (Level 1 execution evaluation)**. We retain the native PlatformIO ESP32-S3 build path to generate valid Xtensa firmware binaries, while keeping our C++ virtual FreeRTOS adapter (`FirmwareNode`) as the primary fast, multi-node deterministic execution environment.

#### B. Wokwi ESP-IDF (`docs.wokwi.com`)
- **Purpose**: Web and VS Code-based embedded simulator for ESP32 and microcontrollers.
- **Relevant Implementation**: Executes compiled ESP-IDF binaries; supports custom peripheral chips through the Wokwi Custom Chips C API (`wokwi-api.h`).
- **Compatibility**: High for single-node ESP32-S3 firmware validation.
- **Peripheral Support**: Requires authoring custom WebAssembly modules (`sx1262.chip.c`, `mpu6050.chip.c`) to respond to SPI and I2C transactions.
- **Build Requirements**: `wokwi-cli` requires internet access and proprietary API tokens for automated headless CLI runs; not open-source for full local orchestration.
- **License**: Commercial / Proprietary platform with open custom chip API.
- **Risks**: High dependency on third-party cloud infrastructure; unable to orchestrate 50 simultaneous nodes exchanging RF packets with microsecond collision physics in a discrete-event loop.
- **Decision: Reference for Custom Chip SPI/I2C state machine design; Reject as core multi-hop simulation engine**.

#### C. Espressif ESP-SR (`espressif/esp-sr`) & S3-SR
- **Purpose**: Espressif's official offline speech recognition framework (AFE acoustic front-end, WakeNet wake-word engine, MultiNet command recognition).
- **Relevant Implementation**: Optimized Xtensa LX7 PIE SIMD neural network routines for keyword spotting ("Setu") and intent classification.
- **Compatibility**: Requires physical ESP32-S3 silicon or bit-for-bit instruction emulation with PIE SIMD support.
- **Build Requirements**: ESP-IDF with `esp-sr` component, large neural model flash weights.
- **License**: Apache 2.0 with proprietary binary model blobs.
- **Risks**: Running deep neural networks in host C++ simulations introduces extreme computational overhead for zero gain in protocol verification.
- **Decision: Reference for intent mapping and timing windows; Adapt via Level 2/3 test adapters**. In host simulation, voice commands and wake-words are injected into the firmware's application interface (`on_wake_word()`, `on_voice_command()`) with realistic recognition confidence and window timeouts.

---

### 2.2 LoRa and Mesh Simulation Candidates

#### D. LoRaMeshSim (`YuChenUoG/LoRaMeshSim`) & LoRaSim (`paafam/LoRaSim`)
- **Purpose**: Python SimPy-based discrete-event simulators for LoRa packet transmission, airtime, and collision analysis.
- **Relevant Implementation**:
  - Semtech packet duration formulas (preamble, payload, low-data-rate optimization).
  - Log-distance path loss with log-normal shadowing.
  - Co-channel collision model: overlapping packets in the same frequency/spreading factor are evaluated using a 6 dB capture effect threshold.
- **Compatibility**: High theoretical synergy with Setu's RF engine.
- **Files/Interfaces Affected**: `simulation/native/world.hpp`, `world.cpp`.
- **License**: GPL v3 / MIT.
- **Risks**: Python SimPy is slow for interactive real-time IPC bridges with hundreds of nodes.
- **Decision: Integrate / Adapt equations into Setu's native C++ engine**. Setu's C++ `sim::World` already runs these exact equations in compiled C++17. We adopt their exact Semtech airtime verification test vectors and log-normal shadowing parameters.

#### E. loramesh (`AmSach/loramesh`)
- **Purpose**: Lightweight, zero-dependency pure Python LoRa mesh flooding simulator.
- **Relevant Implementation**: Basic multi-hop flooding, hop counter decrement, sequence deduplication, and ETSI duty-cycle limits.
- **Compatibility**: Directly aligns with Setu's multi-hop flooding approach.
- **License**: MIT.
- **Decision: Use as Reference**. Setu's portable C++ core (`setu::Node`, `setu::DedupCache`, `setu::DutyCycle`) already implements these features in high-performance C++.

#### F. lora-mesh-network (`markuslehner/lora-mesh-network`) & Richmond-LoRa-Mesh
- **Purpose**: Real-world LoRa mesh testbeds and web-based telemetry visualizers.
- **Relevant Implementation**: Visualizing node links, packet hops, RSSI gradients, and emergency alerts on web dashboards.
- **Decision: Reference for UI/Dashboard features**. Setu's web dashboard already implements superior interactive canvas rendering, packet wire inspection, and live event tracing.

#### G. ns-3 LoRaWAN Module (`icsa-hua/LoraWAN`)
- **Purpose**: Full-stack LoRaWAN network simulation in ns-3 (end devices, gateways, network server).
- **Relevant Implementation**: Detailed physical layer modeling, Rayleigh fading, and orthogonal SF spreading.
- **Compatibility Conflict**: LoRaWAN is a centralized star-of-stars topology with gateway joins and network servers. Project Setu is an infrastructure-independent peer-to-peer ad-hoc mesh.
- **License**: GPL v2.
- **Decision: Reject**. Importing ns-3 or LoRaWAN architecture would break Setu's peer-to-peer mesh principles.

---

### 2.3 IMU and Positioning Simulation Candidates

#### H. IMU-Simulator (`lmwmason/IMU-Simulator`)
- **Purpose**: Inertial measurement unit simulation providing 3-axis accelerometer and gyroscope numerical integration.
- **Relevant Implementation**: Noise generation (white noise, random walk bias), gravity vector projection, coordinate frame transformations.
- **Compatibility**: C++ / Python algorithms easily portable to Setu's sensor harness.
- **Decision: Integrate / Adapt into Setu's MPU6050 Sensor Model**. We adapt its stochastic sensor error model (bias, noise, gravity vector) into Setu's virtual IMU to generate realistic physical sensor readings from ground-truth trajectories.

#### I. ROS 2 MPU6050 Driver (`kimsniper/ros2_mpu6050`)
- **Purpose**: Hardware driver for MPU6050 communicating over I2C.
- **Relevant Implementation**: Register layout definitions (WHO_AM_I, PWR_MGMT_1, ACCEL_CONFIG, GYRO_CONFIG, ACCEL_XOUT_H/L).
- **Decision: Reference for Register Verification; Reject ROS 2 framework dependency**. Setu already implements this exact register interface in `firmware/esp32s3/include/esp32_adapters.hpp`.

---

## 3. External Integration Summary Table

| Candidate Project | Domain | Source Language | License | Decision | Concrete Action in Project Setu |
|:---|:---|:---:|:---:|:---:|:---|
| `espressif/esp-emulator` | Firmware Exec | Rust | Apache 2.0 | **Reference / Level 1 Path** | Retain PlatformIO Xtensa target build; document execution boundary |
| `wokwi/esp-idf` | Firmware Exec | C / Wasm | Proprietary | **Reference** | Reference for custom chip register mapping; avoid proprietary cloud lock-in |
| `espressif/esp-sr` | Voice Recognition | C / Assembly | Apache 2.0 | **Adapt (Level 2/3)** | Synthetic intent injection with realistic timing and false-trigger tests |
| `LoRaMeshSim` | LoRa Simulation | Python (SimPy) | GPL v3 | **Integrate Equations** | Cross-validate Semtech airtime, 6 dB capture effect, and log-distance path loss |
| `AmSach/loramesh` | LoRa Mesh | Python | MIT | **Reference** | Validate duplicate suppression and 1% duty cycle accounting |
| `markuslehner/lora-mesh-network` | Telemetry UI | JS / Arduino | MIT | **Reference** | Validate dashboard link state and packet hop inspection |
| `ns-3 LoRaWAN` | Network Simulation | C++ | GPL v2 | **Reject** | Incompatible star-of-stars / gateway network server assumptions |
| `IMU-Simulator` | Inertial Sensing | C++ / Python | MIT | **Integrate / Adapt** | Implement 3-axis IMU noise, bias, gravity vector, and motion profiles |
| `ros2_mpu6050` | I2C Driver | C++ | MIT | **Reference** | Confirm MPU6050 register addresses and scaling factors |

---

## 4. Architectural Boundaries Defined

To maintain transparency and engineering rigor, every component in Project Setu is tagged with its execution tier:
- **Level 1 — Genuine Firmware Execution**: Compiled Xtensa LX7 `.bin` / `.elf` executing on physical hardware or CPU emulators.
- **Level 2 — Shared Production Logic**: Portable C++ source code (`setu::Node`, `setu::Packet`, `setu::ButtonClassifier`, `setu::DedupCache`, `setu::DutyCycle`, `FirmwareNode`) compiled directly into the simulator.
- **Level 3 — Explicit Behavioral Models**: Physical world models (RF propagation, 6 dB capture collisions, 3-axis IMU noise, GNSS outages, LiPo ADC discharge curves).

This ensures no simulation result is falsely represented as hardware-tested.
