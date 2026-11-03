# Project Setu: Third-Party Dependencies and Component Registry

This document records all third-party software, libraries, specifications, and external data sources used across the Project Setu firmware, simulation engine, and dashboard.

Project Setu maintains a strict dependency hygiene policy:
* **Zero runtime npm dependencies** in `dashboard/server.js`.
* Standard library and native POSIX / Win32 APIs preferred.
* All vendor libraries are checked for license compatibility with Apache 2.0.

---

## 1. Third-Party Component Registry

| Component Name | Version / Commit | License | Usage Scope | Purpose & Justification |
| :--- | :--- | :--- | :--- | :--- |
| **doctest** | 2.4.11 | MIT | C++ Unit Testing (`tests/unit/`) | Fast, lightweight C++ test framework compiling into native test binaries. Header-only. |
| **Three.js** | r128 (vendor bundle) | MIT | Dashboard 3D Visualizer (`dashboard/vendor/`) | Client-side 3D scene rendering for Setu Twin (navigable disaster terrain, wristband inspection). Lazy-loaded via native browser ES module imports. |
| **Espressif ESP-SR (WakeNet & MultiNet)** | v1.5.0 | Apache-2.0 | Reference Voice DSP Specifications | Voice trigger latency (250 ms) and slot recognition window parameters cited in acoustic models. |
| **Semtech SX1261/2 Application Notes** | AN1200.22 / Rev 2.1 | Proprietary / Public Citation | RF Model Reference | Sensitivity lookup tables, capture threshold scaling, and front-end noise figures. |
| **TDK InvenSense INMP441 & MPU-6050** | Rev 1.1 / Rev 3.4 | Proprietary / Public Citation | Sensor Model Reference | Microphone sensitivity (-26 dBFS), SNR (61 dBA), and IMU noise density cited in sensor models. |
| **Aceinna gnss-ins-sim** | 2.1.1 | Apache-2.0 | Offline Inertial Modeling Reference | Reference algorithms for multi-axis inertial dead reckoning drift under GNSS denial. |
| **NVIDIA Sionna RT** | 0.15.0 | Apache-2.0 | Offline RF Ray-Tracing Reference | Architectural reference for polygonal obstacle penetration and reflection models. |

---

## 2. Server Runtime Policy

* The operations dashboard server (`dashboard/server.js`) utilizes only built-in Node.js standard modules (`node:http`, `node:fs`, `node:path`, `node:url`, `node:child_process`, `node:crypto`).
* Zero external packages are installed in `node_modules` for production server execution.
* The frontend uses modern browser-native ECMAScript modules (`import` / `export`) and standard Web APIs (`CanvasRenderingContext2D`, `fetch`, `EventSource`).
