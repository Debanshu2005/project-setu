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
- **Measured WebAssembly Binary Size:** Recorded during Emscripten compilation in CI job `build-wasm`. Target bytecode artifact `setu_sim_wasm.wasm` is measured directly by `stat -c %s build-wasm/setu_sim_wasm.wasm`.
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
