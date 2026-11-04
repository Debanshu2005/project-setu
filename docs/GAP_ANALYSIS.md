# Project Setu: Gap Analysis and Setu Twin v2 Specification

This document provides a comprehensive technical gap analysis comparing the existing Project Setu user interface and visualization subsystem against the target AirSim-like 3D disaster mesh experience specified in Report v3 and the Master Prompt.

Screenshots of the current dashboard were captured via Playwright in `scripts/capture_gap_screenshots.mjs`.

---

## 1. Executive Summary: What Exists vs What Is Required

| Capability Area | Current State (Baseline) | Target State (Setu Twin v2) | Critical Gap |
| :--- | :--- | :--- | :--- |
| **3D Rendering Engine** | 2D Canvas with pseudo-isometric 2.5D math (`setu_twin_view.js`). No WebGL or Three.js. | Vendored Three.js (pinned, ES modules, no CDN/bundler). Real WebGL 3D world. | Fundamental: Replace 2D pseudo-projection with real WebGL 3D scene graph. |
| **Physical Geometry Parity** | Visual obstacles in canvas are independent 2D rectangles; radio propagation uses separate bounding boxes. | Unified scene description: scenario `environment` drives both Three.js rendering and C++ raycasting. | What you see is what the radio sees: identical geometry for walls, slabs, rubble, and terrain. |
| **Radio Visualization** | Static 2D line segments; no airtime rings; no animated hops; no collision sparks. | Dynamic 3D link tubes, glowing packet pulses, expanding airtime rings, wall penetration badges with dB loss, collision spark bursts. | Radio physics is made visible, tangible, and intuitive in real time. |
| **Wristband Digital Twin** | 2D SVG/CSS diagram in sidebar (`wristband_twin.js`). Flat button click and mock LED. | Full 3D inspectable wristband model in WebGL: strap, case, animated button, PCB, SX1262, ESP32-S3, LiPo, haptic vibration ripple, mic port. | Interactive hardware digital twin with live component current breakdown and 3D direct controls. |
| **Plain-English Narrator** | Basic timeline events and raw hex/JSON logs. | Top narration banner providing calm 1 to 2 sentence plain-English status; "Why did this fail?" root-cause explainer button. | Non-expert operators instantly understand mesh dynamics, failures, and rescues without reading hex. |
| **Camera and Navigation** | 2D Pan and Zoom only (`btnZoomFit`, wheel zoom). | Free-fly camera (WASD + mouse look like AirSim), orbit, top-down, chase camera, and "follow this SOS" tracking. | True 3D spatial exploration of collapsed structures and valleys. |
| **Disaster Scenarios (W1 to W5)** | Generic node coordinate grids without realistic physical ruins or dynamic environmental changes. | Five headline walkthroughs: W1 subterranean collapse, W2 100-node storm, W3 flash flood with rising water and washed-out relays, W4 15-min PDR search cone, W5 acoustic trigger in machinery noise. | Authoritative real-world disaster demonstrations with verifiable physics. |

---

## 2. Visual Baseline Audit (Playwright Screenshots)

The following baseline screenshots document the system state prior to Part B implementation:

### 2.1 Topology View
- **File:** `docs/screenshots/current_topology_view.png`
- **Current Capability:** 2D top-down grid representation of nodes with circular badges, basic link lines, zoom/fit buttons, and filter chips.
- **Identified Gaps:**
  - Elevation ($Z$-axis) is completely missing. Subterranean survivors appear on top of surface relays.
  - Obstacles (concrete slabs, collapsed masonry) are rendered as flat colored rectangles without thickness or material texture.
  - Links do not reflect physical Fresnel clearance or multi-path fading.
  - No visualization of RF airtime rings or packet travel time.

### 2.2 Setu Twin View
- **File:** `docs/screenshots/current_setu_twin_view.png`
- **Current Capability:** 2.5D pseudo-isometric canvas drawing simple isometric diamonds and cylinders with rudimentary pan/rotate drag math.
- **Identified Gaps:**
  - Not WebGL: uses standard HTML5 Canvas 2D context (`getContext('2d')`).
  - No 3D meshes, no depth buffer, no lighting, no shadows.
  - No human models: victims are drawn as simple circles or pins.
  - Collapsed structural slabs cannot tilt, crumble, or pancake in 3D.
  - Performance degrades linearly with node and obstacle counts on large topologies.

### 2.3 Scientific Analytics View
- **File:** `docs/screenshots/current_analytics_view.png`
- **Current Capability:** 2D Canvas charts for battery drain, path loss waterfall, delivery ratio, and hop count distributions.
- **Identified Gaps:**
  - Charts are disconnected from the 3D spatial world. Selecting a bar in the chart does not highlight the responsible physical node or link in 3D.
  - No real-time correlation between instantaneous RF channel airtime and battery current spikes.

### 2.4 Wristband Hardware Inspector
- **File:** `docs/screenshots/current_wristband_twin.png`
- **Current Capability:** 2D SVG/CSS panel in the right sidebar with button press simulation and battery gauge.
- **Identified Gaps:**
  - Not a 3D model: cannot orbit, inspect internal PCB traces, or view component placement.
  - Haptic feedback is represented by a CSS shake animation on the sidebar panel rather than a physical 3D vibration ripple.
  - Internal battery pouch, SX1262 LoRa transceiver, and ESP32-S3 microcontroller are flat schematic drawings rather than layered 3D components.

---

## 3. Detailed Walkthrough Gap Analysis (W1 through W5)

### Walkthrough W1: Subterranean Collapse Multi-Hop Rescue
- **Scenario:** Multi-storey reinforced concrete building collapse. Survivors trapped on Floor -2 and Floor -1 behind 2 concrete slabs (22 dB attenuation per slab). Three surface relays, two shaft relays, and an incident command hub.
- **Current State:** Nodes are placed at synthetic $X, Y$ coordinates. Attenuation is computed numerically, but the visual viewer does not depict the collapsed building slabs, the rubble mound, or the shaft penetration path.
- **Target Experience in Setu Twin v2:**
  1. A low-poly 3D building with pancaked floor slabs tilted at realistic angles, cracked masonry walls, and rubble mounds.
  2. Trapped survivor models (lying down or crawling) wearing glowing wristbands under concrete slabs.
  3. Clicking the survivor wristband triggers SOS. A glowing pulse travels through the concrete slab (wall highlights with "-22 dB (concrete 20cm)" badge).
  4. Packet reaches the subterranean shaft relay, hops to the surface relay, and reaches the rescue hub tent.
  5. Rescue hub returns ACK packet along the reverse path. Wristband turns bright green and vibrates with physical ripple animation.
  6. Top narrator strip explains: "Survivor 3 SOS reached Command Hub via 2 relays (Subterranean Shaft 1 to Surface Ridge). ACK confirmed in 340 ms."

### Walkthrough W2: High-Congestion Storm (100 Survivors)
- **Scenario:** Earthquake triggers 100 wristbands simultaneously within a 500m zone. Extreme LoRa channel contention.
- **Current State:** 2D view overlaps 100 circles. Packets collide invisibly; drop counters tick up in the sidebar.
- **Target Experience in Setu Twin v2:**
  1. 100 survivor avatars scattered across the ruins.
  2. When the alarm sounds, 100 expanding translucent airtime rings radiate outward at speed proportional to LoRa airtime.
  3. Visual packet collision: where two uncoordinated transmissions overlap at a receiver without capture margin, a bright spark burst appears.
  4. Clicking the spark opens the Failure Explainer: "Collision: Node 14 and Node 82 transmitted concurrently on SF7 (868.1 MHz). Signal-to-Interference Ratio was 1.2 dB (below 6.0 dB SX1262 capture threshold)."
  5. The plain-English narrator explains how CAD (Channel Activity Detection) and backoff intervals clear the storm within 45 seconds without network collapse.

### Walkthrough W3: Flash Flood Dynamic Link Wash-Out
- **Scenario:** Mountain river valley. Five relays bridge survivor camps to the emergency operations center. Torrential rainfall causes flash flooding.
- **Current State:** Relays are static points. Link drops are synthetic timeouts.
- **Target Experience in Setu Twin v2:**
  1. 3D terrain heightfield representing the river valley, bridges, and mountain ridges.
  2. At $t=15\text{s}$, a translucent blue water plane begins rising rapidly through the riverbed.
  3. At $t=20\text{s}$, Water reaches Relay 2 (mounted on a low riverbank pole). Relay 2 tilts, submerges, and goes offline with a splash animation.
  4. Links connected to Relay 2 turn dashed amber, then fade to red drops.
  5. Mesh self-healing: Relay 1 detects route failure and re-routes packets through Relay 4 on the higher mountain ridge. Packets continue reaching the command hub.
  6. Narrator reports: "Relay 2 submerged by rising water level (+2.4m). Mesh dynamically rerouted traffic via Ridge Relay 4. Delivery restored in 2.1 seconds."

### Walkthrough W4: Dead Reckoning Rescue in GPS-Denied Void
- **Scenario:** Survivor crawls through a collapsed basement tunnel where GNSS satellites are entirely obstructed. Initial GNSS fix is lost at $t=0$.
- **Current State:** Coordinates are updated via an analytical random-walk formula; uncertainty is reported as a flat number in the inspector.
- **Target Experience in Setu Twin v2:**
  1. Survivor model crawls through subterranean void.
  2. As the survivor advances, MPU-6050 discrete step detections and gyroscope heading integrations advance the estimated position.
  3. A translucent 3D uncertainty sphere surrounds the survivor, expanding smoothly from 0m to 13m at 5 minutes and 21m at 15 minutes.
  4. A first-responder search avatar with a directional receiver enters the basement and navigates toward the expanding beacon sphere.
  5. When the rescuer comes within 10 meters, the beacon locks on, tightening the search cone and marking the victim as located.

### Walkthrough W5: Acoustic Voice Trigger in Machinery Roar
- **Scenario:** Search and rescue heavy equipment (concrete saws, excavators, diesel generators) creates intense acoustic noise ($88\text{ dB SPL}$ to $92\text{ dB SPL}$) while survivors attempt voice triggers.
- **Current State:** Acoustic SNR is calculated mathematically; a log message records detection or failure.
- **Target Experience in Setu Twin v2:**
  1. An acoustic noise soundfield plane rendered across the work site, with high-intensity noise rings around heavy machinery.
  2. Trapped survivor shouts "Help Setu!" (80 dB SPL at 1m). The 3D microphone port on the wristband twin pulses.
  3. In an 88 dB zone, the neural WakeNet sigmoid model achieves +6 dB SNR, passes the threshold, and triggers transmission.
  4. In a 92 dB zone near the concrete saw, voice SNR drops below +2 dB and the trigger fails. The narrator advises: "Acoustic trigger masked by concrete saw noise (92 dB SPL). Tactile button backup required."
  5. The survivor model depresses the tactile button (short press), immediately dispatching the emergency packet.

---

## 4. Architectural Transformation Plan for Part B

```
+------------------------------------------------------------------------------------+
|                         SETU TWIN v2 3D ARCHITECTURE                               |
+------------------------------------------------------------------------------------+
|                                                                                    |
|   +--------------------------+                      +--------------------------+   |
|   |   C++ SIMULATION CORE    |                      |   THREE.JS 3D VIEWPORT   |   |
|   |   (Native / WebAssembly) |                      |   (Real WebGL Scene)     |   |
|   +--------------------------+                      +--------------------------+   |
|                |                                                  |                |
|                | Exports Scenario Environment                     | Loads Identical|
|                | (Slabs, Walls, Rubble, Water)                    | Geometry       |
|                v                                                  v                |
|   +----------------------------------------------------------------------------+   |
|   |                UNIFIED SCENE & RF GEOMETRY REPOSITORY                      |   |
|   |   - Scenario JSON `environment.geometry`                                   |   |
|   |   - Wall segments with material, thickness (cm), and floor index           |   |
|   |   - Floor slabs with tilt angles and pancake clearance                     |   |
|   |   - Rubble volume bounds and void corridors                                |   |
|   |   - Terrain elevation heightfield and dynamic water plane                  |   |
|   +----------------------------------------------------------------------------+   |
|                |                                                  |                |
|                | Raycast Attenuation (dB)                         | Render Meshes, |
|                | Obstacle Loss Calculation                        | Shaders, Fog   |
|                v                                                  v                |
|   +--------------------------+                      +--------------------------+   |
|   |   SX1262 LoRa Engine     | <=== Event Stream == | Radio Made Visible       |   |
|   |   - Path Loss Waterfall  |      (JSON-RPC /     | - Colored Link Tubes     |   |
|   |   - Co-Channel Capture   |       WebSocket)     | - Airtime Rings          |   |
|   |   - Collision Detection  |                      | - Packet Travel Pulses   |   |
|   |   - Energy Consumption   |                      | - Wall dB Badges         |   |
|   +--------------------------+                      +--------------------------+   |
|                                                                   |                |
|                                                                   v                |
|                                                     +--------------------------+   |
|                                                     | Inspectable Wristband    |   |
|                                                     | - Animated 3D Button     |   |
|                                                     | - PCB & Chip Layout      |   |
|                                                     | - Haptic Ripple Shader   |   |
|                                                     | - Component Power Bars   |   |
|                                                     +--------------------------+   |
|                                                                   |                |
|                                                                   v                |
|                                                     +--------------------------+   |
|                                                     | Plain-English Narrator   |   |
|                                                     | - Top Status Banner      |   |
|                                                     | - "Why did this fail?"   |   |
|                                                     +--------------------------+   |
+------------------------------------------------------------------------------------+
```

---

## 5. Part B Component Implementation Roadmap

1. **Vendor Three.js (Item B1):**
   - Vendor pinned Three.js release (`three.module.js`, `OrbitControls.js`, `FontLoader.js`, `TextGeometry.js`) in `dashboard/vendor/three/` with standard MIT license.
   - Configure ES module import map in `dashboard/index.html` and `index.html` with zero external CDNs and zero bundlers.
2. **Unified Geometry & Engine Support (Item B7 & B1):**
   - Extend scenario JSON schemas with `environment.geometry` (floor slabs, wall segments, rubble volumes, terrain heights, and water planes).
   - Verify that C++ RF obstacle raycasting and Three.js 3D mesh rendering ingest identical coordinate and material data.
3. **Radio Made Visible (Item B2):**
   - Build 3D link tube shaders with colorblind-safe margin gradations.
   - Implement animated packet travel pulses along links with hop/sequence labels.
   - Implement expanding translucent airtime rings and spark collision bursts.
   - Implement wall intersection badges displaying exact dB attenuation.
4. **Inspectable 3D Wristband Twin (Item B3):**
   - Build procedural 3D wristband model in WebGL: strap, casing, tactile button, OLED/LED display, SX1262 transceiver, ESP32-S3 microcontroller, LiPo pouch, and haptic motor.
   - Support interactive 3D controls (clicking button, dragging battery level, switching motion profiles).
   - Render live component-by-component current draw telemetry beside the 3D model.
5. **Plain-English Narrator & Failure Explainer (Item B4):**
   - Implement calm top narration strip translating simulation state into plain English.
   - Implement "Why did this fail?" modal triggered by dropped packets, dead batteries, or disconnected nodes.
6. **Five Headline Walkthroughs (Item B5):**
   - Deliver interactive walkthrough presets for W1 (Subterranean), W2 (Storm), W3 (Flash Flood), W4 (PDR Void), and W5 (Acoustic Roar).
7. **Cameras, Performance & Controls (Item B6 & B8):**
   - Implement Free-fly camera (WASD + mouse look), Orbit, Top-down, Chase, and "Follow this SOS".
   - Maintain 30+ FPS performance target; automate regression screenshot testing via Playwright in CI.
