# Project Setu: Off-Grid Disaster Communication Mesh & Scientific Simulation Suite

[![CI & Quality Gate](https://github.com/Debanshu2005/project-setu/actions/workflows/ci.yml/badge.svg)](https://github.com/Debanshu2005/project-setu/actions/workflows/ci.yml)
[![C++ Standard](https://img.shields.io/badge/C%2B%2B-17-blue.svg)](https://en.wikipedia.org/wiki/C%2B%2B17)
[![Node.js Version](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org/)
[![Radio Model](https://img.shields.io/badge/LoRa-SX1262%20%2F%20868MHz-orange.svg)](https://www.semtech.com/products/wireless-rf/lora-core/sx1262)
[![Target MCU](https://img.shields.io/badge/ESP--IDF-v5.1%20(ESP32--S3)-red.svg)](https://www.espressif.com/en/products/socs/esp32-s3)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Project Setu is an infrastructure-independent, phone-free disaster rescue mesh communication system and research-grade simulation suite. In catastrophic events (such as earthquakes, catastrophic floods, or structural collapses), terrestrial cellular towers and municipal power grids fail simultaneously. Project Setu enables trapped survivors to transmit life-critical SOS alerts from low-power wearable wristbands across an ad-hoc, multi-hop LoRa radio mesh directly to rescue command hubs—without cellular, internet, or satellite connectivity.

The platform unites an authoritative, hardware-agnostic ISO C++17 protocol core, an embedded FreeRTOS firmware implementation for the Espressif ESP32-S3, a discrete-event physical RF channel simulator, a cloud-ready Node.js operations API daemon, and an interactive Disaster Response Operations Center web dashboard.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Repository Directory Structure](#2-repository-directory-structure)
3. [Physical RF Channel & Propagation Engine](#3-physical-rf-channel--propagation-engine)
4. [25-Byte Binary Wire Protocol Specification](#4-25-byte-binary-wire-protocol-specification)
5. [SOS Emergency Lifecycle & Protocol Mechanics](#5-sos-emergency-lifecycle--protocol-mechanics)
6. [Interactive Disaster Operations Center (Dashboard)](#6-interactive-disaster-operations-center-dashboard)
7. [Production Cloud Deployment & Version Identification](#7-production-cloud-deployment--version-identification)
8. [REST & Streaming API Reference](#8-rest--streaming-api-reference)
9. [Embedded Firmware Target (ESP32-S3)](#9-embedded-firmware-target-esp32-s3)
10. [Building, Testing & Quality Gates](#10-building-testing--quality-gates)
11. [Command-Line Simulation Engine (`setu_sim`)](#11-command-line-simulation-engine-setu_sim)
12. [Research Reproducibility & Scientific Validation](#12-research-reproducibility--scientific-validation)

---

## 1. System Architecture

Project Setu is built upon four decoupled, mutually reinforcing architectural pillars:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        DISASTER OPERATIONS CENTER (Web Visualizer)                    │
│   • HTML5 Canvas Topology  • Scrubber Replayer  • Wire Inspector  • Scientific Metrics│
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ HTTP / SSE / JSON-RPC
┌──────────────────────────────────────────▼─────────────────────────────────────────────┐
│                    OPERATIONS BRIDGE & CLOUD DAEMON (server.js)                        │
│   • Multi-Tier Health Probes  • Concurrency Pool  • FIFO Queue  • Sub-10ms Latency     │
└─────────────────────┬─────────────────────────────────────────────┬────────────────────┘
                      │ Native Process Pipeline                     │ Portable Fallback
┌─────────────────────▼────────────────────────┐  ┌─────────────────▼────────────────────┐
│      NATIVE C++ ENGINE (world.cpp)           │  │   PORTABLE JS SIMULATOR (simulator.js│
│  • Discrete-Event RF Scheduling              │  │  • Pure ES Module Implementation    │
│  • Semtech AN1200.13 LoRa PHY Calculations   │  │  • In-Browser / Serverless Engine    │
│  • Cumulative SINR Interference Summation    │  │  • High-Fidelity C++ Parity          │
└─────────────────────┬────────────────────────┘  └──────────────────────────────────────┘
                      │ Compiles & Links Authoritative Shared Core
┌─────────────────────▼──────────────────────────────────────────────────────────────────┐
│                          AUTHORITATIVE SHARED PROTOCOL CORE                            │
│                                (shared/include/, shared/src/)                          │
│   • 25-byte Serialization   • Panic Button Filter  • Duplicate Suppression (dedup_)    │
│   • Bounded Retries & Backoff • Two-Way ACK Route  • FreeRTOS Queue Interception       │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ Hardware Abstraction Layer (HAL)
┌──────────────────────────────────────────▼─────────────────────────────────────────────┐
│                     PHYSICAL TARGET HARDWARE (ESP32-S3)                                │
│   • SX1262 LoRa SPI         • NEO-6M GNSS UART     • MPU6050 IMU Dead-Reckoning        │
│   • ERM Haptic PWM Driver   • ADC Fuel Gauge       • INMP441 I2S Voice Wake-Word       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Authoritative Shared Protocol Core (`shared/`)**: Pure ISO C++17 library with zero third-party or OS dependencies. It executes identically inside native desktop simulation, cloud worker containers, and physical bare-metal microcontrollers running FreeRTOS.
2. **Discrete-Event Physical RF Simulator (`simulation/native/`)**: Models the continuous RF channel, log-distance path loss, log-normal shadowing, small-scale fading, co-channel interference, and LoRa capture effect with sub-millisecond precision.
3. **Operations API & Concurrency Bridge (`dashboard/server.js`)**: Pure Node.js daemon (zero npm runtime dependencies) managing asynchronous simulation pools, FIFO worker scheduling, bounded streaming buffers, and dual `/version` introspection.
4. **Disaster Response Operations Center (`dashboard/`)**: A dark-mode, command-center web UI designed for operational dispatchers. Provides real-time HTML5 canvas topology rendering, packet wire inspection, chronological event scrubbing, and research-grade network analytics.

---

## 2. Repository Directory Structure

```text
project-setu/
├── .github/
│   └── workflows/
│       └── ci.yml               # Comprehensive 7-job CI matrix (Linux GCC, Windows MSVC, Docker, ESP-IDF, PlatformIO, Vercel)
├── api/
│   ├── config.js                # Vercel serverless configuration resolver
│   └── version.js               # Vercel serverless build version & commit metadata endpoint
├── dashboard/
│   ├── components/              # Modular UI components (TopologyCanvas, PacketInspector, Controls, etc.)
│   ├── src/
│   │   ├── api.js               # Dual-mode REST/SSE API client with progressive cold-start backoff
│   │   ├── app.js               # Application coordinator, modal controllers & connection diagnostics
│   │   ├── exporter.js          # Raw JSONL, normalized JSON, and CSV research telemetry exporter
│   │   ├── metrics.js           # Aggregate network metrics, latency histograms, and PDR calculations
│   │   ├── packet_parser.js     # Client-side 25-byte wire decoder and hex formatting
│   │   ├── scientific_metrics.js# Sliding-window PDR, bottleneck scoring, and battery models
│   │   └── simulation.js        # Event-loop replayer, scrubber controller & state synchronization
│   ├── styles/                  # Dark navy/slate operational styling and CSS design system
│   ├── index.html               # Main dashboard entrypoint
│   └── server.js                # Production cloud simulation bridge server (pure Node.js)
├── docs/                        # Scientific, firmware, and architectural specifications
│   ├── ARCHITECTURE.md          # Detailed engineering design document
│   ├── BENCH_TEST_PLAN.md       # Hardware laboratory bench test procedures
│   ├── DEPLOYMENT_GUIDE.md      # Multi-cloud zero-cost deployment manual
│   ├── EXPERIMENTAL_VALIDATION.md# RF empirical validation and reference measurements
│   ├── FIRMWARE_GUIDE.md        # ESP-IDF v5.1 & FreeRTOS task partition manual
│   └── HARDWARE_MATRIX.md       # BOM, pinouts, and physical hardware schematics
├── firmware/
│   ├── CMakeLists.txt           # ESP-IDF v5.1 project configuration
│   ├── platformio.ini           # PlatformIO multi-environment configuration
│   ├── esp32s3/                 # ESP32-S3 concrete hardware drivers
│   │   └── include/
│   │       ├── esp32_adapters.hpp # Concrete SPI, UART, I2C, ADC, and PWM adapters
│   │       ├── firmware_task_node.hpp # FreeRTOS ISR and queue integration
│   │       └── host_mocks.hpp   # Host-based test doubles for firmware validation
│   └── main/                    # Firmware application entrypoint
│       └── main.cpp             # FreeRTOS setup, task allocation, and core dispatch
├── scenarios/                   # Standardized disaster benchmark scenarios
│   ├── earthquake_urban.json    # 25-node high-density urban rubble collapse
│   ├── flash_flood.json         # Linear river valley mesh with relay wash-out faults
│   └── traces/                  # Pre-computed reference simulation JSONL traces
├── shared/                      # Portable C++17 Core Protocol
│   ├── include/setu/
│   │   ├── button.hpp           # Edge detection, debounce, and press pattern classifier
│   │   ├── dedup.hpp            # Sliding-window duplicate packet suppression cache
│   │   ├── duty_cycle.hpp       # Sliding 1-hour regulatory duty-cycle budget tracker
│   │   ├── hal.hpp              # Pure abstract interfaces for radio, clock, sensors, and haptics
│   │   ├── node.hpp             # Authoritative Setu state machine and transmit queues
│   │   └── packet.hpp           # 25-byte packed wire layout, bitfields, and serialization
│   └── src/
│       ├── button.cpp           # Multi-press and hold timing classification
│       ├── dedup.cpp            # Circular buffer sighting memory
│       ├── duty_cycle.cpp       # Millisecond airtime accounting window
│       ├── node.cpp             # SOS lifecycle, retries, relaying, and ACK handling
│       └── packet.cpp           # Endian-safe wire serialization and field validation
├── simulation/
│   ├── js/
│   │   └── simulator.js         # Portable ES-module JavaScript simulation engine
│   └── native/
│       ├── main.cpp             # Command-line simulator executable and JSON-RPC interactive loop
│       ├── world.hpp            # ChannelParams, SimNode, RF propagation, and positioning engine
│       └── world.cpp            # Continuous discrete-event RF simulation core
├── tests/
│   ├── integration/
│   │   └── test_mesh.cpp        # 15 end-to-end multi-hop mesh integration tests
│   ├── unit/
│   │   ├── test_core.cpp        # 40 core protocol and serialization unit tests
│   │   └── test_firmware_mocks.cpp # 25 FreeRTOS FITL, sensor fusion, and driver unit tests
│   ├── test_backend.mjs         # 165 backend API, security, and lifecycle integration tests
│   ├── test_custom_simulation.mjs # 81 role contract and parameter validation tests
│   ├── test_reliability.mjs     # 41 cloud reliability, concurrency, and latency tests
│   ├── test_scientific_analytics.mjs # Sliding-window PDR and throughput tests
│   ├── test_scientific_dashboard_ui.mjs # Frontend visualizer DOM and chart tests
│   └── test_simulator_js.mjs    # 163 portable JS simulator engine parity tests
├── CMakeLists.txt               # Master CMake configuration for C++ core and simulator
├── Dockerfile                   # Multi-stage container build (C++ compiler -> minimal Node.js runtime)
├── package.json                 # Node.js project manifest & automated test scripts
└── vercel.json                  # Vercel deployment configuration
```

---

## 3. Physical RF Channel & Propagation Engine

Project Setu does not use synthetic placeholders or arbitrary link-loss probabilities. It models the complete physical layer according to established wireless propagation physics:

### 3.1. Log-Distance Path Loss Model
Signal attenuation over distance $d$ (meters) is computed via the log-distance path loss model:

$$PL(d) = PL(d_0) + 10 \cdot n \cdot \log_{10}\left(\frac{d}{d_0}\right) + L_{\text{body}} + X_{\sigma}$$

- **Reference Loss ($PL(d_0)$)**: $31.2\text{ dB}$ free-space path loss at reference distance $d_0 = 1.0\text{ m}$ for the $868\text{ MHz}$ European / Asian ISM band ($f = 868\text{ MHz}$):
  $$PL(d_0) = 20 \log_{10}\left(\frac{4 \pi d_0 f}{c}\right) \approx 31.2\text{ dB}$$
- **Path Loss Exponent ($n$)**: Configurable from $2.0$ (free space) to $4.5$ (dense rubble and concrete collapse). Default is $n = 3.5$.
- **Body & Antenna Loss ($L_{\text{body}}$)**: Fixed $15.0\text{ dB}$ attenuation accounting for human tissue absorption, body shadowing, and reduced gain of compact wrist-worn helical antennas.
- **Log-Normal Shadowing ($X_{\sigma}$)**: Zero-mean Gaussian random variable $X_{\sigma} \sim \mathcal{N}(0, \sigma_{\text{shadow}}^2)$ with $\sigma_{\text{shadow}} = 4.0\text{ dB}$, representing obstruction by walls and obstacles.
- **Multipath Fast Fading ($Y_{\sigma}$)**: Zero-mean Gaussian per-packet variation $Y_{\sigma} \sim \mathcal{N}(0, \sigma_{\text{fading}}^2)$ with $\sigma_{\text{fading}} = 1.5\text{ dB}$.

### 3.2. Receiver Sensitivity Table (Semtech SX1262)
Demodulation limits are modeled precisely after Semtech AN1200.13 specifications for $125\text{ kHz}$ bandwidth:

$$\text{Sensitivity (dBm)} = -174 + 10\log_{10}(\text{BW}) + NF + SNR_{\text{limit}}(SF)$$

| Spreading Factor (SF) | Bandwidth | SNR Limit | Receiver Sensitivity Floor | Airtime (25 Bytes) | Max Range (Rubble) |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **SF7** | $125\text{ kHz}$ | $-7.5\text{ dB}$ | **$-123.0\text{ dBm}$** | $62\text{ ms}$ | $\approx 450\text{ m}$ |
| **SF8** | $125\text{ kHz}$ | $-10.0\text{ dB}$ | **$-126.0\text{ dBm}$** | $113\text{ ms}$ | $\approx 550\text{ m}$ |
| **SF9** | $125\text{ kHz}$ | $-12.5\text{ dB}$ | **$-129.0\text{ dBm}$** | $206\text{ ms}$ | $\approx 680\text{ m}$ |
| **SF10** | $125\text{ kHz}$ | $-15.0\text{ dB}$ | **$-132.0\text{ dBm}$** | $371\text{ ms}$ | $\approx 840\text{ m}$ |
| **SF11** | $125\text{ kHz}$ | $-17.5\text{ dB}$ | **$-134.5\text{ dBm}$** | $741\text{ ms}$ | $\approx 1020\text{ m}$ |
| **SF12** | $125\text{ kHz}$ | $-20.0\text{ dB}$ | **$-137.0\text{ dBm}$** | $1483\text{ ms}$ | $\approx 1250\text{ m}$ |

Any packet arriving with $\text{RSSI} < \text{Sensitivity}$ is dropped immediately with cause `why: "weak"` and recorded in telemetry.

### 3.3. Cumulative Co-Channel Interference & Capture Effect
In a multi-hop disaster mesh, concurrent transmissions across hidden nodes cause co-channel collisions. Project Setu computes cumulative interference power by summing the linear milliwatt powers of all overlapping transmissions in the passband:

$$P_{\text{total, mW}} = \sum_{k \in \text{Overlapping}} 10^{\frac{\text{RSSI}_k}{10}}, \quad P_{\text{total, dBm}} = 10 \log_{10}\left(P_{\text{total, mW}}\right)$$

- **Physical Sub-Sensitivity Cutoff Floor**: Individual signals as low as $10\text{ dB}$ below sensitivity ($\text{RSSI}_k \ge \text{Sens} - 10.0\text{ dBm}$) are included in the linear sum. While individually sub-sensitivity, multiple distant interferers combine linearly to lift the noise floor and destroy reception of an otherwise readable signal.
- **Capture Margin Decision**: A packet survives an active collision if and only if:
  $$\text{RSSI}_{\text{desired}} - P_{\text{total, dBm}} \ge \gamma_{\text{capture}} \quad (\gamma_{\text{capture}} = 6.0\text{ dB})$$
  If the Signal-to-Interference Ratio (SIR) is less than $6.0\text{ dB}$, the packet is dropped with cause `why: "collision"`.

### 3.4. LoRa Time-on-Air (ToA) Formulation
Packet duration is computed per Semtech SX1262 analytical equations:

$$T_{\text{air}} = T_{\text{preamble}} + T_{\text{payload}}$$
$$T_{\text{preamble}} = (N_{\text{preamble}} + 4.25) \times \frac{2^{SF}}{BW} \quad (N_{\text{preamble}} = 8)$$
$$N_{\text{payload}} = 8 + \max\left(\left\lceil \frac{8PL - 4SF + 28 + 16CRC - 20IH}{4(SF - 2DE)} \right\rceil \times (CR + 4), 0\right)$$
- Payload length $PL = 25\text{ bytes}$
- Header mode $IH = 0$ (explicit header)
- Low Data Rate Optimization $DE = 1$ when symbol duration exceeds $16\text{ ms}$ ($SF \ge 11$ at $125\text{ kHz}$), otherwise $0$.
- Coding rate $CR = 1$ (representing 4/5 forward error correction).

---

## 4. 25-Byte Binary Wire Protocol Specification

Project Setu defines a compact, fixed 25-byte binary frame optimized for extreme range and minimal LoRa airtime. Every field is strictly fixed in length and encoded in little-endian byte order:

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       Magic: 'S' 'T'          |        Origin Node ID         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|        Sequence Number        |        Target Node ID         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Reference Sequence        |  Hazard Enum  | Flags Bitfield|
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Latitude (microdegrees)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Longitude (microdegrees)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Battery Pct  |   Hop Count   | Contact Code  |    CRC-8      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Field Breakdown

| Byte Offset | Field | Type | Description |
| :---: | :--- | :--- | :--- |
| `[00 - 01]` | **Magic** | `uint8_t[2]` | Framing preamble bytes: `0x53` (`'S'`), `0x54` (`'T'`). Packets lacking this signature are rejected. |
| `[02 - 03]` | **Node ID** | `uint16_t` | Originator device ID ($1 - 99$: Survivors, $100 - 199$: Relays, $0$: Central Command Hub). |
| `[04 - 05]` | **Seq Number** | `uint16_t` | Monotonically increasing sequence number per originating node. Increments on retries. |
| `[06 - 07]` | **Target ID** | `uint16_t` | Destination device ID. Set to `0xFFFF` (Broadcast) for SOS alerts; set to victim Node ID for ACKs. |
| `[08 - 09]` | **Ref Seq** | `uint16_t` | Echoed sequence number in ACK packets, confirming the exact SOS sequence received. |
| `[10]` | **Hazard Enum** | `uint8_t` | Emergency classification: `0`: General SOS, `1`: Medical Emergency, `2`: Trapped under Debris, `3`: Fire / Hazard. |
| `[11]` | **Flags Bitfield** | `uint8_t` | Bit 0: `kFlagGps` (valid GNSS fix), Bit 1: `kFlagAck` (packet is an ACK), Bit 2: `kFlagDr` (dead-reckoned position). |
| `[12 - 15]` | **Latitude** | `int32_t` | WGS84 Latitude scaled by $10^6$ (microdegrees). Range: $-90 \times 10^6$ to $+90 \times 10^6$. |
| `[16 - 19]` | **Longitude** | `int32_t` | WGS84 Longitude scaled by $10^6$ (microdegrees). Range: $-180 \times 10^6$ to $+180 \times 10^6$. |
| `[20]` | **Battery** | `uint8_t` | Current battery level ($0 - 100\%$). When battery hits $0\%$, transmissions cut off. |
| `[21]` | **Hop Count** | `uint8_t` | Traversal distance ($0$ at origin; incremented by $+1$ at each relay hop; max $8$ hops). |
| `[22]` | **Contact Code**| `uint8_t` | Encoded recipient / team slot or wake-word status indicator. |
| `[23 - 24]` | **CRC-8 / Pad** | `uint8_t[2]` | Data integrity verification check and frame boundary padding. |

---

## 5. SOS Emergency Lifecycle & Protocol Mechanics

```text
[Wearable Wristband]                 [Solar Relay Node]                 [Command Hub]
        │                                    │                                │
        │── 1. Panic Button Press ───────────┼────────────────────────────────┤
        │   (Short / Double / Long)          │                                │
        │── 2. Dead-Reckoning / GNSS Fix ────┼────────────────────────────────┤
        │── 3. LoRa TX: SOS (Hop=0) ────────>│                                │
        │                                    │── 4. Verify dedup_ Sightings ──┤
        │                                    │── 5. Increment Hop Count (Hop=1)
        │                                    │── 6. Jittered Airtime Backoff ─┤
        │                                    │── 7. Rebroadcast SOS ─────────>│
        │                                    │                                │── 8. Dispatch Rescue Alert
        │                                    │                                │── 9. Enqueue ACK (Ref Seq)
        │                                    │<── 10. LoRa TX: ACK (Target) ──│
        │                                    │── 11. Rebroadcast ACK ─────────┤
        │<── 12. Receive ACK ────────────────│                                │
        │── 13. Cancel Retries               │                                │
        │── 14. Haptic Vibration Feedback   │                                │
```

### 5.1. Panic Button Classification Engine
A state machine inside [`shared/src/button.cpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/shared/src/button.cpp) classifies button taps into hazards:
- **Short Press ($\le 300\text{ ms}$)**: Dispatches **General SOS** (`Hazard::General`).
- **Double Press (two presses within $400\text{ ms}$)**: Dispatches **Trapped under Debris** (`Hazard::Trapped`).
- **Long Press (held $\ge 1200\text{ ms}$)**: Dispatches **Medical Emergency** (`Hazard::Medical`).
- **Voice Fallback**: Detection of wake-word ("Setu") without an attached voice slot defaults to a General SOS.

### 5.2. Multi-Hop Forwarding & Duplicate Suppression (`dedup_`)
To eliminate broadcast storms without running complex routing tables:
1. Every node maintains a sliding-window deduplication filter ([`shared/include/setu/dedup.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/shared/include/setu/dedup.hpp)) keyed on `{origin_id, seq_num, is_ack}`.
2. Relays track how many times a packet has been overheard in the air. If a relay overhears $\ge 3$ nearby neighbours rebroadcasting the same packet before its own backoff timer elapses, it suppresses its own transmission (`relay_suppressed`).
3. Packets that reach $\text{Hop Count} \ge 8$ are pruned (`ttl_drop`) to guarantee mesh loop termination.

### 5.3. Bounded Retries & Backoff Scheduling
If no ACK is received from the Hub:
- Survivors execute up to $3$ automated retries.
- Retries use a growing linear backoff: $T_{\text{retry}} = T_{\text{now}} + T_{\text{base}} \times (\text{attempt} + 1)$, where $T_{\text{base}} = 4000\text{ ms}$.
- Each retry originates a new sequence number ($seq + 1$) so intermediate relays do not discard the retry as a stale duplicate.
- If retries exhaust without an ACK, the device marks `gave_up = true` and triggers a distinct haptic pattern. Late ACKs arriving within a bounded rescue window are still honored.

---

## 6. Interactive Disaster Operations Center (Dashboard)

The frontend is an operational command-center web application built with pure vanilla Web Components and HTML5 Canvas (zero external frontend framework bloat):

- **Interactive Topology Visualizer (`dashboard/components/topology.js`)**: Real-time canvas rendering supporting multi-touch pan/zoom, link RSSI gradient shading, dead-reckoning positional error circles, and animated LoRa packet pulses.
- **Chronological Trace Scrubber (`dashboard/src/simulation.js`)**: Playback speed controls from $0.5\times$ to $10\times$, pause, restart, step forward, and jump to specific timestamps.
- **25-Byte Wire Inspector (`dashboard/components/inspector.js`)**: Real-time hex dump viewer with interactive field boundaries. Clicking any field highlights the corresponding bits and decodes raw values into human-readable engineering units.
- **Live SOS Console (`dashboard/components/console.js`)**: Allows dispatchers to simulate survivor button presses, inject hardware faults, trigger GNSS outages, or reposition nodes dynamically.
- **Scientific Analytics Suite (`dashboard/src/scientific_metrics.js`)**: Computes real-time sliding-window Packet Delivery Ratio (PDR), offered load vs throughput (bps/pps), latency distributions, and the Defensible Bottleneck Index:
  $$B_i = 0.40 \cdot (\text{Forwarding Load}) + 0.35 \cdot (\text{Drop Rate}) + 0.25 \cdot (\text{Queue Saturation})$$
- **Engine Diagnostics Modal (`modalBackendSettings`)**: Configures backend connectivity, provides automatic cold-start waking with retry animations, and verifies backend & frontend Git commit SHAs side-by-side.

---

## 7. Production Cloud Deployment & Version Identification

Project Setu uses a decoupled, zero-cost production deployment architecture:

```text
┌────────────────────────────────────────────────────────┐
│               VERCEL GLOBAL EDGE CDN                   │
│   • Static Operations Dashboard (HTML5 / CSS / Canvas) │
│   • Serverless API Routes (/api/config, /api/version)  │
│   • Fallback JavaScript Simulator (simulator.js)       │
└──────────────────────────┬─────────────────────────────┘
                           │ Cross-Origin HTTPS / SSE Stream
┌──────────────────────────▼─────────────────────────────┐
│               RENDER PRODUCTION CONTAINER              │
│   • Multi-stage Debian Docker Build                    │
│   • Compiled Native C++ Core (setu_sim)                │
│   • Pure Node.js Operations Bridge (server.js)         │
│   • Dual /version and /api/version Build Telemetry     │
└────────────────────────────────────────────────────────┘
```

### Deployment Version Identification
To maintain deployment integrity and prevent "version drift" without committing build hashes into source control:
1. **Backend (`GET /version` & `GET /api/version`)**: Returns runtime build metadata:
   ```json
   {
     "service": "project-setu-backend",
     "gitCommit": "e4663e4...",
     "buildTime": "2026-10-29T15:30:00Z",
     "environment": "render"
   }
   ```
2. **Frontend (`GET /api/version`)**: Vercel serverless function exposing `VERCEL_GIT_COMMIT_SHA`.
3. **Diagnostics Integration**: The Operations Dashboard queries both endpoints simultaneously, displaying commit badges and verifying synchronization.

---

## 8. REST & Streaming API Reference

The Operations API (`dashboard/server.js`) exposes the following endpoints:

| Endpoint | Method | Description | Sample Output |
| :--- | :---: | :--- | :--- |
| `/version` or `/api/version` | `GET` | Deployment commit SHA, build time, and service metadata | `{"service":"project-setu-backend","gitCommit":"e466..."}` |
| `/health` or `/api/health` | `GET` | Fast liveness probe (sub-5ms, zero disk I/O, event-loop safe) | `{"status":"ok","liveness":true,"engine":"c++_core"}` |
| `/health/readiness` | `GET` | Deep readiness probe checking worker capacity and memory | `{"status":"ok","readiness":true,"workerPool":{"active":0}}` |
| `/api/status` | `GET` | Platform status, native simulator detection, active jobs | `{"status":"online","simulatorFound":true,"activeJobs":0}` |
| `/api/metrics` | `GET` | Engine metrics, completed jobs, memory RSS bytes | `{"memory":{"rss":58200000},"jobManager":{"submitted":5}}` |
| `/api/jobs` | `POST` | Asynchronous simulation job submission (bounded queue) | `{"jobId":"sim_1793...","status":"queued"}` |
| `/api/jobs/:id` | `GET` | Real-time status, execution phase, and summary snapshot | `{"jobId":"sim_...","status":"completed","events":[...]}` |
| `/api/jobs/:id/results` | `GET` | Final simulation results and generated trace filename | `{"success":true,"traceFilename":"job_sim_....jsonl"}` |
| `/api/simulate` | `POST` | Synchronous batch simulation execution | `{"summary":{...},"events":[...]}` |
| `/api/simulate/stream` | `GET` | Server-Sent Events (SSE) live simulation trace stream | `event: event\ndata: {"t":1000,"ev":"tx",...}\n\n` |
| `/api/trace/:filename` | `GET` | Path-traversal-protected raw JSONL trace downloader | Streamed `.jsonl` trace file |
| `/api/control/init` | `POST` | Initializes interactive native C++ simulation instance | `{"ok":true,"cmd":"init","nodes":15}` |
| `/api/control/step` | `POST` | Steps simulation clock by specified milliseconds | `{"ok":true,"cmd":"step","t":1000}` |
| `/api/control/trigger` | `POST` | Triggers SOS on survivor node (`short`, `double`, `long`, `voice`)| `{"ok":true,"cmd":"trigger","node":1}` |
| `/api/control/trigger-all` | `POST` | Broadcast trigger wave across all survivor wristbands | `{"ok":true,"cmd":"trigger_all","count":10}` |
| `/api/control/state` | `POST` | Queries authoritative state of all virtual nodes | `{"nodes":[{"id":1,"role":"survivor","battery":98}]}` |

---

## 9. Embedded Firmware Target (ESP32-S3)

Project Setu firmware is implemented in `firmware/esp32s3/` for the Espressif ESP32-S3:

### FreeRTOS Multi-Task Partitioning

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        FREERTOS CORE CONCURRENCY                       │
├─────────────────┬──────────────────┬─────────────────┬─────────────────┤
│   RadioTask     │    SensorTask    │   ButtonTask    │   HapticTask    │
│  (Priority 5)   │   (Priority 3)   │  (Priority 4)   │  (Priority 2)   │
│                 │                  │                 │                 │
│ • SX1262 SPI    │ • NEO-6M NMEA    │ • Debounce ISR  │ • ERM Vibration │
│ • DIO1 ISR      │ • MPU6050 I2C    │ • Press Pattern │ • Multi-Pattern │
│ • LBT & TX/RX   │ • Dead-Reckoning │ • Emergency SOS │ • ACK Pulses    │
└─────────────────┴──────────────────┴─────────────────┴─────────────────┘
```

### Peripheral Pinout & Hardware Adapters

| Peripheral | Interface | Pin (ESP32-S3) | Driver Adapter File |
| :--- | :---: | :---: | :--- |
| **SX1262 LoRa Radio** | SPI | SCK: 12, MISO: 13, MOSI: 11, CS: 10, DIO1: 14 | [`esp32_adapters.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/firmware/esp32s3/include/esp32_adapters.hpp) |
| **NEO-6M GNSS** | UART | RX: 18, TX: 17 ($9600\text{ baud}$) | [`esp32_adapters.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/firmware/esp32s3/include/esp32_adapters.hpp) |
| **MPU6050 IMU** | I2C | SDA: 21, SCL: 22 ($400\text{ kHz}$) | [`esp32_adapters.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/firmware/esp32s3/include/esp32_adapters.hpp) |
| **ERM Vibration Motor** | LEDC PWM| GPIO 4 | [`esp32_adapters.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/firmware/esp32s3/include/esp32_adapters.hpp) |
| **Panic Button** | GPIO ISR | GPIO 0 (Active-Low, internal pull-up) | [`esp32_adapters.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/firmware/esp32s3/include/esp32_adapters.hpp) |
| **Battery Voltage** | ADC1 | GPIO 1 ($100\text{k}\Omega / 100\text{k}\Omega$ voltage divider) | [`esp32_adapters.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/firmware/esp32s3/include/esp32_adapters.hpp) |
| **INMP441 Microphone**| I2S | SCK: 41, WS: 42, SD: 2 ($16\text{ kHz}$) | [`esp32_adapters.hpp`](file:///d:/CityGrid/my-project/project-setu/project-setu/firmware/esp32s3/include/esp32_adapters.hpp) |

---

## 10. Building, Testing & Quality Gates

### 10.1. Prerequisites
- **CMake 3.16+**
- **C++17 Compiler** (MSVC 2022 on Windows, GCC 12+ or Clang 14+ on Linux/macOS)
- **Node.js v20 LTS**
- *(Optional for firmware)*: **ESP-IDF v5.1** or **PlatformIO Core**

### 10.2. Build the Native C++ Simulator & Tests
```bash
# 1. Configure Release build
cmake -B build -DCMAKE_BUILD_TYPE=Release

# 2. Compile all targets in parallel
cmake --build build --config Release -j$(nproc)

# 3. Execute full native test suite via CTest
ctest --test-dir build -C Release --output-on-failure
```

CTest executes **80 native test cases**:
- **65 Unit Tests (`setu_unit_tests`)**: Verifies 25-byte wire packing, bitfields, panic button edge timing, sliding deduplication, duty-cycle limits, Semtech airtime, MPU6050 step detection, and FreeRTOS task queues.
- **15 Integration Tests (`setu_integration_tests`)**: Simulates 15-node to 30-node mesh disaster scenarios, blocked link rerouting, dead relay survival, retry exhaustion, and sub-sensitivity co-channel collisions.

### 10.3. Run the Node.js Automated Test Suites
```bash
# Run all 8 JavaScript test suites (500+ assertions)
npm test
```
The test suite validates:
1. `test_custom_simulation.mjs`: Role contracts, role aliases, and fault tolerances.
2. `test_reliability.mjs`: Cloud concurrency pool, FIFO queueing, and sub-10ms API latency.
3. `test_backend.mjs`: Dual `/version` endpoints, CORS security, and interactive C++ lifecycle.
4. `test_simulator_js.mjs`: Bit-level parity between C++ and JS physical engines.
5. `test_analytics.mjs` & `test_scientific_analytics.mjs`: Sliding-window PDR, throughput, and bottleneck index.

### 10.4. Compile Firmware Targets
```bash
# Compile via PlatformIO
pio run -e esp32-s3-devkitc-1

# Or compile via ESP-IDF v5.1
cd firmware
idf.py set-target esp32s3
idf.py build
```

---

## 11. Command-Line Simulation Engine (`setu_sim`)

The compiled `setu_sim` executable supports both batch scenario execution and interactive JSON-RPC execution over standard I/O:

```bash
# Run a 25-node urban earthquake scenario
./build/Release/setu_sim.exe \
  --survivors 25 \
  --relays 6 \
  --zone 1200 \
  --seed 42 \
  --duration 35000 \
  --sf 7 \
  --path-exp 3.5 \
  --trigger 7:long@1000 \
  --trigger 3:voice-medical@4000 \
  --kill 102@2000 \
  --trace scenarios/traces/urban_earthquake.jsonl
```

### Interactive Simulation Mode (`setu_sim -i`)
Send line-delimited JSON commands to `stdin` and receive instant structured JSON responses from `stdout`:

```json
{"cmd":"init","survivors":5,"relays":2,"zone":600,"seed":42}
{"cmd":"trigger","node":1,"kind":"short"}
{"cmd":"step","ms":1000}
{"cmd":"get_state"}
{"cmd":"summary"}
{"cmd":"quit"}
```

---

## 12. Research Reproducibility & Scientific Validation

Project Setu is engineered for rigorous scientific peer review:

1. **Deterministic PRNG Sequencing**: Discrete event schedules and node positions are strictly reproducible across simulation runs when using the same seed.
2. **Honest Metric Denominators**: Packet Delivery Ratio (PDR) is evaluated both per-packet and per-unique-emergency to avoid inflated delivery statistics.
3. **No Synthetic Telemetry**: All SNR and RSSI metrics emitted in trace logs correspond directly to physical log-distance path loss, noise floor calculations, and cumulative SINR equations.
4. **Independent Physical Validation**: Sub-sensitivity interference sums and capture effect dynamics have been independently validated against Semtech AN1200.13 application notes and standard discrete-event wireless simulation methodologies.

---

## License

Project Setu is open-source software licensed under the **Apache License, Version 2.0**. See the [LICENSE](LICENSE) file for complete terms.
