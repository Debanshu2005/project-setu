# Project Setu: Claims and Verification Ledger

This document tracks technical claims, physical specifications, binary measurements, and performance benchmarks for Project Setu. Every claim carries an explicit status label (`measured`, `cited`, or `assumed`) and a reproducible command.

## Status Label Definitions

- **measured**: Empirically measured from reproducible code, build artifacts, test suites, or instrumented hardware logs in this repository.
- **cited**: Referenced directly from official component datasheets, technical application notes, published peer-reviewed papers, or regulatory documentation.
- **assumed**: Design engineering baseline or operational assumption adopted in the absence of standardized field measurements.

## Claims Ledger

### 1. WebAssembly Engine Compilation and Parity
- **Claim:** The authoritative C++ simulation engine compiles to WebAssembly via Emscripten, producing exact line-by-line event and physical parity with the native desktop engine.
- **Status:** `measured`
- **Verification Command:** `node tests/test_engine_parity.mjs`
- **Measured WebAssembly Binary Size:** 278,879 bytes (272.34 KB) for `setu_sim_wasm.wasm` bytecode, and 104,827 bytes (102.37 KB) for `setu_sim_wasm.js` modular ES6 loader, measured directly in CI job `build-and-test-wasm`.
- **Runtime Dependencies:** Zero npm dependencies in `dashboard/server.js` and `dashboard/src/wasm_loader.js`.

### 2. Cross-Platform Determinism
- **Claim:** The `field` realism profile produces identical event counts, sequences, timestamps, and node coordinates across Linux GCC 13, Linux Clang, and Windows MSVC from the same seed.
- **Status:** `measured`
- **Verification Command:** `node tests/test_golden_baselines.mjs`
- **Permitted Variance:** Integer fields and coordinates match with 100 percent exactness. Floating-point fields (`rssi`, `snr`, `mah`) are bounded by at most 1 unit in the last printed digit due to 1-ULP standard C runtime math library variation between GNU libm and MSVCRT.

### 3. Battery Lifetime and Continuous Power Draw
- **Claim:** Continuous acoustic wake-word listening on ESP32-S3 draws approximately 76.1 mA idle current, yielding approximately 13.1 hours on a 1000 mAh 1S LiPo battery. In on-demand listening mode without continuous wake-word DSP, idle current drops to approximately 11.1 mA, extending battery life to approximately 90.1 hours (3.75 days).
- **Status:** `measured` (simulated energy model) / `cited` (ESP32-S3 Technical Reference Manual & SX1262 datasheet).
- **Verification Command:** `node tests/test_field_profile_energy.mjs`
- **Analytic Validation:** Simulated energy consumption matches analytic integration within 10 percent tolerance.

### 4. Semtech SX1262 LoRa Radio RF Characteristics
- **Claim:** Reference transmit power is +14 dBm at 868 MHz (EU868 / IN865). Receiver sensitivity is -123 dBm at Spreading Factor 7 (125 kHz bandwidth). Co-channel packet capture threshold is approximately 6.0 dB SIR.
- **Status:** `cited` (Semtech SX1262 Datasheet DS.SX1261-2.W.APP and Application Note AN1200.22).
- **Verification Command:** `node tests/test_rf_environment.mjs`

### 5. Acoustic Voice Detection in Disaster Noise
- **Claim:** Survivor panic voice utterances produce ~75 to 85 dB SPL at 1 meter. Ambient disaster background noise model defaults to 55.0 dB SPL. Neural wake-word trigger requires minimum SNR margin above ambient noise.
- **Status:** `cited` (P.56 speech acoustics standards) and `assumed` (55.0 dB SPL collapsed building background).
- **Verification Command:** `node tests/test_acceptance_scenarios.mjs`


### 6. Pedestrian Dead Reckoning Subterranean Drift
- **Claim:** Survivor pedestrian dead reckoning integrating MPU-6050 discrete step detection and gyroscope Z-axis heading under continuous GNSS denial limits search beacon drift to 13.05 meters mean at 5 minutes and 20.91 meters mean at 15 minutes during a straight walk (~1178 meters traveled), and 13.09 meters at 5 minutes and 20.91 meters at 15 minutes during a rubble crawl (~360 meters traveled).
- **Status:** `measured`
- **Verification Command:** `node tests/test_pdr_sensitivity.mjs`


### 7. Setu Twin v2 Real WebGL 3D Disaster World Visualizer
- **Claim:** The dashboard provides a genuine Three.js WebGL 3D navigable disaster environment rendering physical floor slabs, rubble obstacles, low-poly survivor avatars (standing, crawling, trapped under slab), elevated relay towers, rescue command hub, 3D radio link tubes colored by link margin, expanding airtime rings, collision sparks, dynamic flood water planes, and multiple camera modes (Orbit, Top-Down, AirSim Free-Fly, Follow Node) with zero npm runtime dependencies.
- **Status:** `measured`
- **Verification Command:** `node tests/test_three_import.mjs && node tests/test_three_dashboard.mjs`

### 8. Inspectable 3D Wristband Twin and Disaster Walkthroughs
- **Claim:** The dashboard features an interactive 3D digital twin of the Setu wristband hardware (elastomer strap, polycarbonate casing, ESP32-S3 MCU, SX1262 LoRa transceiver, 1000 mAh LiPo pouch, tactile SOS button with press animation, OLED display, RGB status LED, and haptic vibration feedback) with direct operational controls, live current draw telemetry, and 5 dedicated disaster walkthrough scenarios (W1 Subterranean Collapse, W2 High-Congestion RF Storm, W3 Dynamic Flash Flood, W4 GPS-Denied PDR Rescue, W5 Acoustic Trigger in Machinery Noise).
- **Status:** `measured`
- **Verification Command:** `node tests/test_acceptance_scenarios.mjs && node tests/test_three_dashboard.mjs`
