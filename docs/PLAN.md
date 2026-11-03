# Project Setu: Master Implementation Plan

This roadmap defines the implementation schedule for Phases 1 through 4 of Project Setu simulation realism and visualization.
Every simulated physical effect carries a defensible status label: measured, cited from a source, or assumed.

## Phase 0: Foundations (Completed)

Goals:
- Establish test hygiene and eliminate brittle path dependencies.
- Reconcile documentation conflicts across Report v3, README, and code.
- Implement realism profile abstractions (`baseline`, `idealized`, `field`).
- Connect the event driven milliampere hour battery model into the simulation engine.
- Establish reproducible pseudo random generation independent of receiver iteration order.
- Record byte identical golden baselines for all 16 scenarios.

Deliverables:
1. `dashboard/sim_finder.js` cross platform binary resolution.
2. `docs/SPEC_CONFLICTS.md` with explicit human decision status labels.
3. `docs/ENGINE_PARITY.md` evaluating C++ versus JavaScript engines and WebAssembly roadmap.
4. `simulation/native/world.hpp` and `simulation/native/world.cpp` realism profiles and hash based reproducible fading.
5. Wired `BatteryEnergyModel` with continuous current reporting (with and without wake word DSP).
6. `tests/golden/*.jsonl` recorded for all 16 scenario files.
7. `tests/test_golden_baselines.mjs` automated byte level regression test suite integrated into CI.

Status: Ready for Checkpoint 0 human review.

---

## Phase 1: Setu Twin (Legibility and Visual Inspection)

Mission:
Build the Setu Twin visualizer in the spirit of AirSim. Enable non radio experts to inspect disaster mesh dynamics through 3D spatial navigation, physical wristband telemetry, plain English event narration, and side by side replay.

### Workstream 1.1: WebAssembly Engine Compilation
- Goal: Run single authoritative C++ physics directly in browser and node environments.
- Tasks:
  - Add CMake toolchain target for Emscripten (`setu_sim_wasm`).
  - Expose JSON-RPC bindings (`init`, `step`, `run_until`, `trigger`, `get_state`, `summary`).
  - Verify WebAssembly trace output matches native C++ output byte for byte.
- Status Label: Code migration (exact parity).

### Workstream 1.2: 3D Spatial Environment Visualizer
- Goal: Interactive 3D scene displaying rescue hub, relay positions, survivor wristbands, and RF propagation spheres.
- Tasks:
  - Implement client side 3D renderer using Three.js via vanilla script loading (zero npm runtime dependencies in server).
  - Provide tactical overhead view, free orbital camera, and first person wristband view.
  - Visualize LoRa packet propagation waves, signal degradation colors, and active link connections.
- Status Label: User interface visualization.

### Workstream 1.3: Wristband Digital Twin Panel
- Goal: Inspectable physical vehicle panel representing the hardware wristband.
- Tasks:
  - 3D CAD style wristband inspection panel showing ESP32-S3 enclosure, sealed panic button, ERM haptic motor vibration status, and status LEDs.
  - Live hardware telemetry dials: battery percentage, estimated milliampere draw, GNSS satellite lock status, and IMU motion state.
  - Interactive manual triggers: button click simulator (short, double, long) and voice command simulator.
- Status Label: Physical hardware inspection interface.

### Workstream 1.4: Plain English Event Narrator
- Goal: Real time event stream explanation for non technical disaster coordinators.
- Tasks:
  - Translate raw trace events into natural sentences. Example: "Survivor 4 activated Long Press (Trapped Under Debris). Packet #1 originated."
  - Highlight protocol anomalies in clear language. Example: "Relay 101 suppressed retransmission because Hub 0 already acknowledged Packet #1."
  - Flag RF drops clearly: "Packet dropped at Node 102 due to half duplex collision with Node 103."
- Status Label: Human factors legibility.

### Workstream 1.5: Timeline Scrubber and A/B Run Comparison
- Goal: Scrub backwards and forwards in simulated time, and compare two runs side by side.
- Tasks:
  - Bidirectional time scrubbing with event step controls.
  - A/B run comparison mode: evaluate baseline versus field realism profile, or compare SF7 versus SF9 under identical disaster geometry.
  - Export comparison metrics: delivery latency delta, packet delivery ratio difference, battery consumption difference.
- Status Label: Comparative analysis tool.

### Workstream 1.6: Loss Budget Waterfall
- Goal: Visual breakdown of link margin for any selected radio link.
- Tasks:
  - Render link margin bar chart: Transmit power (+14 dBm), minus free space loss, minus path loss exponent attenuation, minus obstacle loss, minus fast fading margin.
  - Compare effective receiver power against SX1262 sensitivity threshold (-123 dBm at SF7).
  - Explicitly label each contributor as measured, cited, or assumed.
- Status Label: RF educational breakdown.

Phase 1 Deliverables:
- Working WebAssembly simulator module (`build/wasm/setu_sim.wasm`).
- Setu Twin 3D visualizer in dashboard (`dashboard/components/setu_twin.js`).
- Wristband hardware inspector component (`dashboard/components/wristband_twin.js`).
- Event narrator log component (`dashboard/components/narrator.js`).
- Link loss budget waterfall component (`dashboard/components/loss_waterfall.js`).

Phase 1 Test Plan:
- Headless browser validation of 3D canvas mounting and animation loop.
- Byte level trace comparison between native CLI and WebAssembly engine across all 16 scenarios.
- Regression tests for time scrubber state restoration.

Human Checkpoint 1:
- Review Setu Twin 3D view, wristband twin panel, narrator legibility, and A/B comparison tool.

---

## Phase 2: RF and Environment Realism

Mission:
Upgrade RF propagation from abstract distance formulas to physically defensible disaster environment interactions.

### Workstream 2.1: 3D Obstacle Geometry
- Tasks:
  - Support polygonal obstacle definitions in scenario files (concrete walls, collapsed floor slabs, metal debris, water bodies).
  - Implement fast spatial ray casting using 2.5D bounding volume hierarchies.
- Status Label: Assumed geometric models cited from structural collapse literature.

### Workstream 2.2: Spatial Shadowing and Material Penetration
- Tasks:
  - Replace node ID hash shadowing with physical ray intersection attenuation.
  - Material attenuation lookup table: 200 mm reinforced concrete (18 to 28 dB at 868 MHz), brick masonry (8 to 14 dB), dry soil (15 dB per meter), flood water (50 dB per meter).
  - Cite attenuation values from ITU-R P.1238 and building penetration standards.
- Status Label: Cited from published RF propagation standards.

### Workstream 2.3: Human Body Shadowing and Antenna Orientation
- Tasks:
  - Wristband antenna is closely coupled to human tissue. Add 3D body shadowing sector (12 to 20 dB attenuation in rear 120 degree azimuth).
  - Model antenna pattern orientation relative to user posture (standing, prone under rubble, floating).
- Status Label: Cited from wearable antenna measurements in literature.

### Workstream 2.4: Mobility and Environmental Drift
- Tasks:
  - Fluid flow drift vectors for flood scenarios (moving survivor coordinates along water vectors).
  - Debris shifting events altering link blockage during the simulation run.
  - Walking, crawling, and stationary survivor motion profiles with obstacle collision.
- Status Label: Assumed mobility models.

### Workstream 2.5: Physical Collision and Spreading Factor Orthogonality
- Tasks:
  - Upgrade collision model from all or nothing window overlap to preamble versus payload collision analysis.
  - Implement SX1262 capture effect: receiver locks onto stronger signal if arrival precedes interference by 4 symbols and power margin exceeds 6 dB.
  - Spreading factor cross correlation matrix: packets on SF7, SF8, and SF9 interfere only based on inter-SF rejection ratios (16 to 22 dB isolation).
- Status Label: Cited from Semtech SX1261/2 datasheet and LoRa Alliance technical specifications.

Phase 2 Deliverables:
- Obstacle engine and material attenuation calculator in C++ engine (`simulation/native/rf_environment.hpp`).
- Scenario and CLI support for polygonal obstacles and fluid drift fields (`--obstacle`, `--fluid-drift`).
- Fine collision capture threshold scaling and multi-SF quasi-orthogonality matrix in `world.cpp`.
- REST API control endpoints for obstacles, fluid drift, and link loss budgets in `dashboard/server.js`.
- Verified golden baselines: 16/16 baseline scenarios remain backward compatible.

Phase 2 Test Results:
- All 87 C++ unit and integration tests passing (`ctest`).
- All 12 JavaScript test suites passing (`npm test`), including new `tests/test_rf_environment.mjs`.
- 16/16 baseline scenario traces byte-identical with commit 6628cfc.

Phase 2 Status: COMPLETED. Ready for Human Checkpoint 2.

Human Checkpoint 2:
- Review RF physics accuracy, material attenuation values, and obstacle visualization.

---

## Phase 3: Sensor Realism, Rig Calibration, and Acceptance Scenarios

Mission:
Model physical sensor inputs, calibrate against bench test measurements, and validate against 5 critical disaster acceptance scenarios.

### Workstream 3.1: Voice and Acoustic Trigger Realism
- Tasks:
  - Model INMP441 MEMS microphone sensitivity (-26 dBFS) and acoustic signal to noise ratio.
  - Implement acoustic noise injection for rubble collapse (rockfalls, screams, ambient heavy machinery).
  - Model wake word DSP detection delay (250 ms) and command recognition window (3000 to 4000 ms).
  - Model voice false positive and false negative probability curves as a function of acoustic SNR.
- Status Label: Cited from MEMS microphone datasheets and voice DSP specifications.

### Workstream 3.2: IMU and Inertial Dead Reckoning Degradation
- Tasks:
  - MPU-6050 accelerometer and gyroscope drift integration.
  - Accelerometer fall impact signature detection (4g shock followed by inactivity).
  - Dead reckoning error growth model: drift accumulates quadratically over time during GNSS denial.
- Status Label: Measured from sensor noise specifications and empirical dead reckoning studies.

### Workstream 3.3: Bench Rig Calibration
- Tasks:
  - Integrate physical RSSI and packet loss measurements from `docs/BENCH_TEST_PLAN.md`.
  - Calibrate SX1262 front end losses and noise figures against real hardware test bench runs.
  - Update status labels from "assumed" to "measured" for all validated parameters.
- Status Label: Measured from physical ESP32-S3 plus SX1262 hardware bench tests.

### Workstream 3.4: Global Sensitivity Analysis
- Tasks:
  - Automated parameter sweep framework across path loss exponent (2.0 to 4.5), node density (5 to 100), and transmit power (10 to 22 dBm).
  - Compute Sobol indices for delivery latency and packet delivery ratio.
- Status Label: Computational sensitivity analysis.

### Workstream 3.5: Five Golden Disaster Acceptance Scenarios
- Tasks:
  - Scenario 1: Multi-story reinforced concrete building collapse (30 survivors, 5 relays, extreme attenuation, GNSS denied).
  - Scenario 2: Flash flood river valley (20 survivors with fluid drift, elevated relays on ridges).
  - Scenario 3: Underground subway tunnel partition (linear mesh topology, collapsed tunnel blockage, dead reckoning fallback).
  - Scenario 4: High density urban earthquake aftershock (100 survivors triggering within 10 seconds, mesh congestion stress test).
  - Scenario 5: Mixed hazard survival network (medical emergencies, trapped survivors, battery depleted relays).
- Status Label: Verified acceptance scenarios.

Phase 3 Deliverables:
- Acoustic and voice processing model in C++ simulator.
- IMU drift and fall impact detection pipeline.
- Benchmark calibration dataset from physical hardware.
- Five comprehensive disaster acceptance scenarios with automated validation suites.

Phase 3 Test Plan:
- Sensitivity sweep validation tests.
- Physical bench comparison tests with error bounds.
- Automated acceptance scenario regression suite.

Human Checkpoint 3:
- Review calibrated physical parameters, sensitivity reports, and acceptance scenario results.

---

## Phase 4 (Optional): Ray-Traced RF Propagation and Drift Baking

Mission:
Explore research grade simulation extensions for specialized disaster planning.

### Workstream 4.1: GPU Accelerated Ray Tracing
- Evaluate Sionna RT or OptiX based GPU ray tracing for complex 3D city models.
- Pre-bake diffraction and reflection maps into scenario files for fast runtime execution.
- Status Label: Research extension.

### Workstream 4.2: Hardware Temperature and Environmental Drift
- Model oscillator frequency drift (crystal versus TCXO) across temperature range (-10 C to +60 C).
- Model battery internal impedance increase and capacity drop under cold temperature immersion.
- Status Label: Cited from battery chemistry and oscillator datasheets.

Human Checkpoint 4:
- Final project evaluation and long term roadmap handoff.

