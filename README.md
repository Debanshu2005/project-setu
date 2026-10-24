# Project Setu: Off-Grid Disaster Communication Mesh & Simulation Suite

Project Setu is a phone-free, infrastructure-independent emergency communication system designed for disaster-response environments.

The shared device core (panic button classification, SOS packet generation, multi-hop flood relay, hub acknowledgment, bounded retries, dead-reckoning fallback, and duty-cycle accounting) is implemented in portable, hardware-independent C++17 (`shared/`).

The native simulator runs that exact core across dozens of virtual survivor and relay nodes over a modelled LoRa channel with log-distance path loss, shadowing, fast fading, collisions with capture effect, and fault injections (`simulation/native/`).

A modern disaster operations dashboard provides interactive network topology visualization, packet wire inspection, chronological event tracing, and analytics (`dashboard/`).

```text
project-setu/
├── shared/                 Portable C++ core, zero ESP-IDF or simulator dependencies
│   ├── include/setu/       hal.hpp, node.hpp, packet.hpp, button.hpp, dedup.hpp, duty_cycle.hpp
│   └── src/                Clean C++17 implementations
├── simulation/native/      RF channel model + CLI simulator (setu_sim)
│   ├── world.hpp / .cpp    Discrete-time RF channel & virtual sensor harness
│   └── main.cpp            CLI simulation runner with JSONL trace generation
├── firmware/esp32s3/       Hardware driver adapters & FreeRTOS wiring
│   └── include/            esp32_adapters.hpp, host_mocks.hpp
├── tests/
│   ├── unit/               Core logic, wire compatibility, and mock tests (39 tests)
│   └── integration/        Multi-hop mesh disaster scenarios (13 tests)
├── dashboard/              Disaster Response Operations Center (Web Visualizer & API)
│   ├── index.html          Clean, responsive command-center UI
│   ├── server.js           Local simulation API bridge (pure Node.js)
│   ├── src/                Engine, API client, wire parser, exporter
│   ├── components/         Topology canvas, timeline, packet inspector, charts
│   └── styles/             Dark navy/slate disaster-center design system
├── scenarios/              Reproducible disaster scenarios (Earthquake, Flood, Collapse)
│   └── traces/             Pre-generated high-fidelity simulation traces
└── docs/                   Architecture, simulation, and firmware guides
```

---

## 1. Quick Start: Build & Test

### Prerequisites
- CMake 3.16+
- C++17 Compiler (MSVC 2022 on Windows, or GCC/Clang on Linux/macOS)
- Node.js v18+ (for Operations Dashboard)

### Compile C++ Core, Simulator & Tests
```bash
# Configure build
cmake -S . -B build

# Build all targets in Release mode
cmake --build build --config Release

# Run automated test suites (52 tests total: 39 unit + 13 integration)
ctest --test-dir build -C Release --output-on-failure
```

---

## 2. Launch the Operations Dashboard

The dashboard runs locally without any external internet dependencies or API keys:

```bash
# Start the local simulation bridge server
node dashboard/server.js

# Open in browser:
http://localhost:3000
```

### Dashboard Features
- **Interactive Topology**: Canvas rendering with pan/zoom, link RSSI gradients, and animated packet pulses.
- **Trace Replayer**: Scrubber bar, playback speed control (0.5x to 10x), step forward/backward.
- **25-Byte Wire Inspector**: Raw hex viewer with color-coded field boundaries and parsed values.
- **SOS Console**: Trigger survivor alerts (Short, Double, Long, Voice commands).
- **Live Simulator Integration**: Run custom simulations directly from the web interface.
- **Analytics & Export**: SVG charts for PDR, drop causes, hop distributions, and CSV/JSON export.

---

## 3. Run Simulations from the Command Line

```bash
# Run a 25-node urban earthquake scenario with fault injections
./build/Release/setu_sim.exe --survivors 25 --relays 6 --zone 1200 --seed 42 --duration 35000 \
  --sf 8 --loss 0.04 --path-exp 3.6 \
  --trigger 7:long@1000 --trigger 3:voice-medical@4000 --trigger 14:short@6500 \
  --kill 102@2000 --gps-off 7@500 --block 100-101@3000 \
  --trace scenarios/traces/urban_earthquake.jsonl
```

Prints a JSON summary to stdout and writes a structured event trace to the specified `.jsonl` file.

---

## 4. Hardware Readiness & Firmware Target

The firmware architecture for ESP32-S3 is organized in `firmware/esp32s3/`:
- `esp32_adapters.hpp`: Concrete hardware adapter classes for SX1262 SPI, NEO-6M UART, MPU6050 I2C, ERM haptic PWM, battery ADC, and INMP441 I2S audio.
- `host_mocks.hpp`: Mock HAL implementations for host testing.
- `tests/unit/test_firmware_mocks.cpp`: Validates binary wire compatibility, clock disciplining, and GNSS-to-DR fallback logic.

---

## 5. Vercel Cloud Hosting & Serverless Deployment

Project Setu can be hosted directly on Vercel as an interactive web operations dashboard with both pre-generated native C++ traces and live serverless simulation execution.

### Architecture on Vercel
1. **Global CDN Static Edge**: The Operations Dashboard (`dashboard/index.html`, styles, canvas components) is served globally with zero build configuration.
2. **Serverless API Routes (`/api/*`)**:
   - `GET /api/status`: Health and platform telemetry.
   - `GET /api/scenarios`: Disaster scenario library.
   - `GET /api/traces` & `GET /api/trace/[filename]`: Pre-computed high-fidelity simulation traces.
   - `POST /api/simulate`: Serverless discrete-event RF simulation engine (`simulation/js/simulator.js`) running the complete path loss, log-normal shadowing, fast fading, Semtech airtime, and packet flooding models.
3. **Local Native C++ Mode**: When run locally (`node dashboard/server.js`), it seamlessly bridges to `build/Release/setu_sim.exe`.

### Deploy to Vercel

#### Option A: Via GitHub (Recommended)
1. Push this repository to GitHub:
   ```bash
   git remote add origin https://github.com/<your-username>/project-setu.git
   git branch -M main
   git push -u origin main
   ```
2. Open [vercel.com/new](https://vercel.com/new) and select your `project-setu` repository.
3. Click **Deploy**. Vercel detects `vercel.json` and `package.json` automatically.

#### Option B: Via Vercel CLI
```bash
# Log in to Vercel
npx vercel login

# Deploy production build
npx vercel --prod
```

---

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SIMULATION_GUIDE.md](docs/SIMULATION_GUIDE.md), and [docs/FIRMWARE_GUIDE.md](docs/FIRMWARE_GUIDE.md) for full technical specifications.

