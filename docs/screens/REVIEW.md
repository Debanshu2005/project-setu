# Project Setu: 3D Viewer Visual Review Log

This document records honest visual inspections of the 3D twin viewer. Every entry is based on opening and examining the actual rendered screenshots in docs/screens/.

## Checkpoint V-A Review (V1 Scale and Readability, V2 Demo Site and Obstacles)

### 1. docs/screens/V_W1_01_landing.png (Desktop 1600x720)
- Clearly 3D with depth and light: Yes. The scene is illuminated by balanced ambient, hemisphere, and directional sunlight. Slate navy atmospheric sky dome surrounds the dual coordinate grid (50 meter major, 10 meter minor).
- Can a stranger name every object: Yes. Every node features a tall emissive beacon pillar, ground beacon ring, and billboard label badge with ID and role. Color coding matches the legend: Survivor (Cyan), Relay (Amber), Hub (Green). Header displays an honest badge: "Open Terrain Model (No Obstacle Data in Scenario)".
- Are labels readable and not overlapping: Labels are legible at default zoom. Screen space collision avoidance maintains readable spacing.
- Are links and packets visible: Not yet. Simulation clock is at 0.0s. Radio physics rendering is part of work item V3.
- Is narrator text correct: Displays "Ready. Run simulation or step forward to inspect 3D disaster dynamics."
- Is anything clipped: No. Status indicator uses ellipsis truncation to prevent header clipping.
- What is still wrong: Radio links, packet pulses, and airtime rings are not yet drawn.

### 2. docs/screens/V_W1_01_landing_mobile.png (Mobile 390x844)
- Clearly 3D with depth and light: Yes. The 3D canvas scales properly on vertical mobile viewports.
- Can a stranger name every object: Beacon pillars and role colors are visible.
- Are labels readable and not overlapping: Billboard badges are readable, though smaller at 390 px width.
- Are links and packets visible: Not yet.
- Is anything clipped: No clipping. Responsive CSS flexbox stacks controls above the canvas and timeline below.
- What is still wrong: Header action buttons consume vertical space on small screens before scrolling down.

### 3. docs/screens/V_W1_02_demo_t3.png (Demo Site collapse_site_demo at t=3.1s)
- Clearly 3D with depth and light: Yes. The 250m x 250m compact site features a collapsed multi-level municipal structure. Tilted floor slabs, exterior shear walls, interior partitions, rubble mounds, and a rescue hub tent are rendered with distinct materials and shadow depth.
- Can a stranger name every object: Yes. Structural elements are clearly identifiable. Survivors are positioned under slabs, behind walls, and on upper floors. Rescue Hub 0 is housed under an emergency tent canopy. Header badge confirms: "Structural Model: 7 Obstacles (Concrete / Slabs / Rubble)".
- Are labels readable and not overlapping: Yes. The screen space collision avoidance pass staggers vertical positions of adjacent survivor badges (Node 1, Node 101, Node 5, Node 7, Node 9), preventing badge text from colliding.
- Are links and packets visible: Not yet. Trace events for Node 1 SOS and Relay 101 are loaded, but link lines and traveling pulses will be implemented in V3.
- Is narrator text correct: Shows event status. Plain English story narration is scheduled for V4.
- Is anything clipped: No clipping.
- Pixel assertion metrics: Coverage is 51.4% (PASS, requirement >= 12%), mean luminance is 80.8 (PASS, requirement >= 35), 95th percentile luminance is 200.0 (PASS, requirement >= 120), Cyan survivor pixels: 17,818, Amber relay pixels: 2,471, Green hub pixels: 2,966. Total node count is exactly 16 (1 Hub + 12 Survivors + 3 Relays).
- What is still wrong: Missing 3D radio link lines, packet traveling pulses, and wall attenuation dB badges.

### 4. docs/screens/scenario_7_subterranean.png (Scenario 7 GPS-Denied Subterranean)
- Clearly 3D with depth and light: Yes. Ground surface features a subterranean cutaway with concrete retaining perimeter walls, sub-level floor grid, and translucent surface slab. Survivor 3 is visibly positioned at y = -8 meters in the underground transit level.
- Can a stranger name every object: Yes. Underground cutaway features explicit Ground Level datum marker (0.0m) and depth labels (Underground Parking Concourse: -6.0m, Deep Transit Tunnel B2: -12.0m) with vertical depth ruler line.
- Are labels readable and not overlapping: Yes.
- Are links and packets visible: Not yet.
- Is anything clipped: No.
- Pixel assertion metrics: Coverage is 20.9% (PASS, requirement >= 12%), mean luminance is 81.7 (PASS, requirement >= 35), 95th percentile luminance is 165.0 (PASS, requirement >= 120), Cyan survivor pixels: 2,745, Amber relay pixels: 511, Green hub pixels: 1,143.
- What is still wrong: Radio penetration loss visualization through ground ceiling is pending V3.


## Checkpoint V-B Review (V3 Make Radio Visible in 3D)

### 1. Conditional Approval Fixes (Before and After Verification)

#### Item 1: Stale State on First Load
- Before (Saved in `docs/screens/before/V_W1_01_landing_straight_cam.png`): Left metrics panel and header displayed 26 nodes from an uninitialized live default state, while the 3D twin rendered the 16 nodes of the collapse demo site. Inspector connected links list showed 25 links for Node 1.
- After (Saved in `docs/screens/V_W1_01_landing.png`): Removed the hardcoded live state overwrite on initial load. Left metrics panel displays exactly 16 nodes on startup. Header status shows `CORE C++ ENGINE ONLINE: 16 NODES (Earthquake Collapse Site (Compact Demo))`. Inspector RF links list recalculates from loaded scenario nodes. On switching to `gps_denied_rescue`, metrics panel updates to 17 nodes. Automated test in `tests/test_three_dashboard.mjs` verifies scenario node synchronization for both scenarios.

#### Item 2: Compact Distance-Aware Node Labels
- Before (Saved in `docs/screens/before/V_W1_02_demo_t3_large_labels.png`): Labels used wide billboard badges with large text (`NODE 1 (SURVIVOR)`). At standard zoom, labels produced visual clutter and required wide screen space avoidance.
- After (Saved in `docs/screens/V_W1_02_demo_t3.png`): Replaced wide static badges with distance-aware dual-mode sprites:
  1. Distance mode: Displays a compact pill with a circular role color dot and node ID (e.g. dot + `1`, dot + `101`, dot + `H0`).
  2. Interaction mode: Expands to full text (`NODE 1 (SURVIVOR)`) when hovered with the mouse or selected.
  3. Screen-pixel capping: Sprite world height scales proportionally with distance to camera so label screen height remains capped at 12 to 14 pixels.
  4. Viewport area footprint: Each compact badge occupies only 13px by 32.5px (0.07 percent of viewport area, well below the 10 percent limit). Verified by DOM evaluation assertion in `tests/test_three_dashboard.mjs`.

#### Item 3: Default Camera Framing and Follow SOS Exterior Bounds
- Before: Camera loaded on a straight-on Z axis looking directly forward, giving a flat perspective of the building facade.
- After: Camera loads at a 45-degree isometric angle from outside the building perimeter (`targetX + camDist * 0.707, targetY + camDist * 0.60, targetZ + camDist * 0.707`), looking downward at the collapsed slabs, survivors, and rescue tent. In Follow SOS and Follow Node modes, camera position is clamped to maintain at least 65 meters horizontal distance and 38 meters elevation, ensuring the camera remains strictly outside the building walls.

#### Item 4: Automated Link Pixel Assertions in Test Suite
- Script `scripts/check_pixel_assertions.mjs` was moved into the automated test suite as `tests/test_pixel_assertions.mjs` and wired into `npm test`.
- Changes made after first run: Added comparison between baseline landing state (t=0.0s) and in-flight transmission state (t=3.1s). Asserted that in-flight radio packet pulse pixels strictly exceed baseline at time zero (5,514 purple pixels at t=3.1s vs 52 at t=0.0s), along with amber wall crossing and green ACK ring assertions.

### 2. Screen-by-Screen Visual Critique

#### docs/screens/V_W1_01_landing.png (Desktop Landing with collapse_site_demo)
- Clearly 3D with depth and light: Yes. The collapsed municipal building with tilted concrete slabs, rubble heaps, access street, and command tent frames tightly from the 45-degree angle.
- Radio links visible: Yes. Filtered backbone links render with margin-based color coding. Blue solid for strong link (>15 dB margin), amber solid for medium link (5 to 15 dB margin), and red dashed for weak link (<5 dB margin). Zero visual hairball clutter.
- Metrics and header consistency: Left panel displays 16 nodes, header confirms 16 nodes.
- Label appearance: Compact badges (dot + ID) maintain 12 to 14 px screen height, leaving the architecture and survivors unobstructed.
- Pixel assertion metrics: Coverage is 13.4% (PASS, requirement >= 12%), mean luminance is 73.6 (PASS, requirement >= 35), 95th percentile luminance is 183.8 (PASS, requirement >= 120), Cyan survivor pixels: 2,977, Green hub pixels: 1,527.

#### docs/screens/V_W1_02_demo_t3.png (First SOS at t=3.1s with Wall Attenuation)
- Radio pulses and airtime rings: Yes. Node 1 initiates Trapped Under Debris SOS. A purple expanding airtime ring radiates outward. A traveling purple packet pulse with HOP 1 badge moves along the link vector.
- Wall crossing attenuation: Yes. Link ray intersects exterior west shear wall and corridor wall. Intersected wall segments illuminate in bright amber emissive, and floating -22 dB and -20 dB attenuation badges hover over wall midpoints.
- Drop flashes: Hub 0 receives packet below sensitivity threshold and triggers a red drop flash with DROP: WEAK SIGNAL badge.
- Label overlap status: Clean. Staggered vertical avoidance ensures zero text collision.
- Pixel assertion metrics: Coverage is 59.9% (PASS, requirement >= 12%), mean luminance is 97.9 (PASS, requirement >= 35), 95th percentile luminance is 200.8 (PASS, requirement >= 120), Cyan survivor pixels: 20,030, Amber obstacle/relay pixels: 1,597, Purple packet pulse pixels: 5,514 (strictly exceeds t=0.0s baseline of 52).

#### docs/screens/V_W1_03_demo_t8.png (Intermediate Hop at t=8.2s)
- Intermediate hop packet: Yes. Node 7 transmits Medical SOS. Amber airtime ring radiates across the floor, and a HOP 2 packet pulse travels toward Relay 101.
- Badge cleanup: Historical badges from t=3.1s are cleared on timeline seek. Maximum active badges capped at 4.
- Pixel assertion metrics: Coverage is 51.0% (PASS, requirement >= 12%), Amber pixels: 23,268.

#### docs/screens/V_W1_04_ack_buzz.png (ACK Arrival & Wristband Buzz at t=4.5s)
- Acknowledgement return: Yes. Hub 0 returns ACK packet to Node 1. Green ACK airtime ring radiates across hub perimeter.
- Wristband twin response: Wristband tactile buzzer triggers haptic vibration pattern.
- Pixel assertion metrics: Coverage is 47.8% (PASS, requirement >= 12%), Green ACK pixels: 2,743.

#### docs/screens/V_heatmap_node1.png (RF Coverage Heatmap for Node 1)
- Coverage heatmap: Yes. Ground is overlaid with path loss tiles computed from the C++ RF engine formula. Red tiles appear in the acoustic and RF shadow behind the 22 dB shear wall. Amber tiles indicate edge margin, and cyan tiles indicate strong margin.
- Pixel assertion metrics: Coverage is 68.6% (PASS, requirement >= 12%), Amber path loss pixels: 17,133.


## Plan for W3: Interactive Live Engine Integration

Walkthrough W3 requires hands-on user interaction: selecting a survivor, pressing 3D wristband tactile buttons (short, double, long), issuing voice commands ("Setu"), dragging a survivor behind a wall, and killing a relay, with live links, packets, and outcomes updating in the scene.

Currently, the demo replays a precomputed trace. The live execution architecture will work as follows:

1. Seamless Replay-to-Live Handoff:
   - When the user performs an interactive action (button press, voice command, node drag, or relay kill), the client checks its mode.
   - If in replay mode, the client invokes `POST /api/control/init` with the active scenario configuration (nodes, obstacle geometry, RF profile). This initializes a native C++ World instance matching the exact layout visible in the 3D viewer.
   - The mode badge updates to `LIVE C++ CORE INTERACTIVE`.

2. Survivor Repositioning (Drag Behind Wall):
   - When a survivor is dragged, the viewer emits `POST /api/control/reposition` with `{ nodeId, x, y }`.
   - The native C++ engine updates the node spatial coordinates and runs line-of-sight ray intersection against all obstacle segments.
   - The server returns updated pairwise links and loss budgets. The viewer updates link lines, changing strong blue links to amber or red dashed links when blocked by walls.

3. Wristband Tactile Buttons and Voice Commands:
   - Clicking Short Button (Medical), Double Button (Trapped Under Slab), or Long Button (Evacuation Call) in the 3D wristband emits `POST /api/control/trigger` with the corresponding hazard type.
   - Speaking "Setu" with command payload dispatches an acoustic alert event.
   - The C++ simulator steps the network physics, generates multi-hop forwarding packets, and streams events via Server-Sent Events (`/api/control/stream`).
   - The 3D viewer renders the newly generated traveling packet pulses, airtime rings, and ACK returns live.

4. Killing a Relay:
   - Toggling a relay offline in the inspector emits `POST /api/control/node-state` with `{ nodeId, online: false }`.
   - The C++ engine removes the node from active routing tables. Subsequent packets reroute around the dead relay or trigger drop flashes if no alternate path exists.


## Work Item Roadmap (Master Prompt Original Numbering)

- **V1: Scale and readability** (Completed in Checkpoint V-A): Dual coordinate grid, glowing beacon pillars, ground rings, sky dome lighting, high-contrast materials.
- **V2: A real world to look at** (Completed in Checkpoint V-A): Compact collapse site demo (`collapse_site_demo.json`), multi-level building geometry, shear walls, tilted floor slabs, rubble mounds, rescue hub tent, subterranean cutaway.
- **V3: Make the radio visible in 3D** (Completed in Checkpoint V-B): Margin-based RF link lines, traveling packet pulses with hop badges, expanding airtime rings, receiver drop flashes, wall crossing highlights with attenuation badges, RF coverage heatmap overlay, distance-aware compact labels, 45-degree exterior camera framing.
- **V4: Narrator and failure analysis** (Completed in Checkpoint V-C):
  - Rewrote narrator to headline high-value events with plain English disaster story explanations.
  - Removed inappropriate failure alarms from normal deduplication events ("Stop Crying Wolf").
  - Implemented real physical loss budget waterfall breakdown dialog (distance, walls, human body, shadow, fading against -123 dBm receiver sensitivity) with one-sentence root cause verdict naming the largest physical contributor. Verified against native C++ RF engine loss calculations.
- **V5: Wristband model and interaction**:
  - Rebuild wristband 3D inspector panel with clear studio lighting, responsive sizing, and labeled components (OLED screen, tactile buttons, battery, antenna).
  - Wire interactive tactile buttons (Short, Double, Long, Voice) to dispatch alerts and animate haptic vibration.
- **V6: The one click demo and the camera**:
  - Replace "Run Simulation" with primary "Start Earthquake Demo" one-click button.
  - Move advanced settings into secondary modal dialog.
  - Dynamic cinematic camera sequencing: auto-follow the first SOS from survivor to relay to hub, and track ACK return.
- **V7: Flood scenario and scenario gallery**:
  - Implement flood disaster site with dynamic rising water level and fluid drift dynamics.
  - Multi-scenario visual selector gallery with thumbnail cards.
- **V8: Visual regression tests in CI**:
  - Automated headless Chromium screenshot capture and pixel difference verification integrated into CI pipeline.


## Checkpoint V-C Review: Narrator and Failure Waterfall (Parity Audit & Fixes)

### 1. Parity Audit: What Was Wrong in PR #8

An independent audit of PR #8 discovered significant arithmetic gaps and fabricated claims:

1. Mathematics Gap: For Node 1 to Hub 0 (143.4 m in `collapse_site_demo`), the modal displayed distance loss 75.5 dB, 2 walls (42.0 dB), no 15 dB extra loss term, SF7 sensitivity (-123.0 dBm), and margin -4.9 dB. Its rows summed to -110.7 dBm while stating -127.9 dBm (a 17.2 dB gap).
2. Fabricated Distance Link: The second screenshot showed an 850 m link to Node 104. Node 104 cannot exist in the 250 m demo site (whose relays are 100 to 102). Its rows summed to -89.4 dBm while stating -124.4 dBm.
3. Unsupported Claims: The footer claimed "Measured Bench", "Cited Datasheets", and "C++ RF Engine Parity". Nothing was measured on a bench, and numbers contradicted the engine.
4. Client Physics Re-Implementation: `dashboard/src/narrator.js` contained duplicate JavaScript physics (`computeLossBudget`, ray intersection) violating Ground Rule 4.
5. Inaccurate Verdict Attribution: The verdict blamed walls alone when distance path loss was in fact the largest contributor.

### 2. Required Changes Implemented

1. Single Source of Physics: Deleted all radio formulas, ray intersection, and sensitivity calculations from `dashboard/src/narrator.js`. The UI consumes telemetry directly from C++ engine `get_loss_budget`.
2. Engine Telemetry Parity: Extended `World::get_loss_budget` in C++, WebAssembly bindings, and JS preview engine to output: `distance_m`, `tx_power_dbm`, `ref_loss_db`, `path_loss_db`, `shadow_loss_db`, `extra_loss_db`, `fading_loss_db`, `obstacle_loss_db`, `crossed_obstacles`, `body_loss_db`, `noise_floor_dbm`, `rx_power_dbm`, `sensitivity_dbm`, `link_margin_db`, and `viable`.
3. Complete Row Display: The modal displays every row reported by the engine. Rows sum to the displayed received power with zero discrepancy (row sum delta: 0.00 dB).
4. Honest Provenance Tags: Adheres strictly to Ground Rule 5. Only `simulated`, `model`, `cited`, and `assumed` tags appear. The word `measured` has been eliminated.
5. Real Physical Verdict: The verdict identifies the actual largest loss term (distance path loss) and exact margin deficit below SF8 sensitivity (-126.0 dBm).
6. Non-Blocking Drawer Layout: The modal is formatted as a side panel (`top: 46px; right: 12px; width: 460px`), keeping the 3D scene fully visible. The narrator strip shows the current drop event text.

### 3. Screen-by-Screen Critique

#### docs/screens/V_W2_01_wall_failure_collapse_demo_node1_to_hub0.png (and V_W2_01_wall_failure.png)
- Scene Visibility: 3D scene remains visible behind the side panel. Node 1 SOS pulse, the shear wall, and drop flash at Hub 0 are clear.
- Link Identity: Node 1 (Survivor) to Hub 0 (Hub), 143.4 meters.
- Loss Breakdown:
  - Transceiver Output Power: +14.0 dBm [model]
  - Free-Space Reference Loss (1 m): -31.2 dB [cited]
  - Distance Path Loss Attenuation: -81.9 dB [model] (path loss exponent 3.8)
  - Log-Normal Shadowing: +4.2 dB constructive gain [simulated]
  - Hardware Front-End & Extra Fixed Loss: -15.0 dB [model]
  - Obstacle: exterior_south_shear_wall (concrete): -22.0 dB [assumed]
  - Human Body Torso Shadowing: 0.0 dB [model]
  - Fast Channel Fading: 0.0 dB [simulated]
  - Net Received Signal Power (RSSI): -131.9 dBm [simulated]
  - Thermal Noise Floor: -117.0 dBm [model]
  - Demodulation Sensitivity: -126.0 dBm [cited] (SF8)
  - Net Link Margin: -5.9 dB (DROPPED -5.9 dB Below Sens)
- Row Sum Arithmetic: 14.0 - 31.2 - 81.9 + 4.2 - 15.0 - 22.0 - 0.0 - 0.0 = -131.9 dBm. Delta to engine value is 0.00 dB.
- Physical Verdict: "Dropped with a -5.9 dB margin deficit below receiver sensitivity (-126.0 dBm). The largest loss contributor is distance path loss (-81.9 dB at 143.4 m), with obstacle attenuation (-22.0 dB from 22.0 dB exterior_south_shear_wall) and fixed extra loss (-15.0 dB)."
- What is still wrong: None. Every value matches C++ engine telemetry within 0.1 dB.

#### docs/screens/V_W2_02_distance_failure_collapse_demo_node9_to_node6.png (and V_W2_02_distance_failure.png)
- Scene Visibility: Side drawer format preserves 3D spatial context.
- Link Identity: Genuine `collapse_site_demo` drop at t=3731ms between Node 9 (Survivor) and Node 6 (Survivor), 97.1 meters.
- Loss Breakdown:
  - Transceiver Output Power: +14.0 dBm [model]
  - Free-Space Reference Loss (1 m): -31.2 dB [cited]
  - Distance Path Loss Attenuation: -75.5 dB [model]
  - Log-Normal Shadowing: -3.2 dB [simulated]
  - Hardware Front-End & Extra Fixed Loss: -15.0 dB [model]
  - Obstacle: interior_corridor_partition (concrete): -20.0 dB [assumed]
  - Human Body Torso Shadowing: 0.0 dB [model]
  - Fast Channel Fading: 0.0 dB [simulated]
  - Net Received Signal Power (RSSI): -130.9 dBm [simulated]
  - Thermal Noise Floor: -117.0 dBm [model]
  - Demodulation Sensitivity: -126.0 dBm [cited] (SF8)
  - Net Link Margin: -4.9 dB (DROPPED -4.9 dB Below Sens)
- Row Sum Arithmetic: 14.0 - 31.2 - 75.5 - 3.2 - 15.0 - 20.0 - 0.0 - 0.0 = -130.9 dBm. Delta to engine value is 0.00 dB.
- Physical Verdict: "Dropped with a -4.9 dB margin deficit below receiver sensitivity (-126.0 dBm). The largest loss contributor is distance path loss (-75.5 dB at 97.1 m), with obstacle attenuation (-20.0 dB from 20.0 dB interior_corridor_partition) and fixed extra loss (-15.0 dB)."
- What is still wrong: None. Both screenshots originate from real `collapse_site_demo` simulation traces.

### 4. Parity Test Suite Verification

Test suite `tests/test_loss_waterfall_engine_parity.mjs` executes 129 automated assertions across live C++ engine and replay paths:
- 5 links in `collapse_site_demo` (all 12 budget rows match engine within 0.1 dB, rows sum to Rx power within 0.001 dB, SF8 sensitivity is -126.0 dBm, wall count matches engine).
- 5 links in Scenario 7 `gps_denied_rescue` (engine values and row sum parity verified).
- Replay path portable simulator parity (verified against native C++ engine).
- Exponent mutation check: Path loss exponent mutated from 3.0 to 4.2. Modal path loss increased by exactly 25.88 dB, perfectly matching theory `10 * (4.2 - 3.0) * log10(143.381)`.
- Real drop filter: "Why did this fail?" button triggers only on real packet drops (`weak`, `collision`, `halfduplex`, `loss`, `duty`, `blocked`) and remains hidden on normal deduplication and suppression events.


---

## VI. SCIENTIFIC CHART HOVER EXPLAINERS (PART B)

### 1. Requirements and Design Overview

Every scientific chart across the dashboard now provides clear, instant explanations on hover and focus:
1. Trigger Info Icon: A dedicated info button (`ℹ️`) sits beside every chart title. It uses semantic HTML (`<button role="button" aria-haspopup="dialog" aria-expanded="false">`) and opens within 120 ms (well within the 150 ms specification).
2. Pinned State & Keyboard Navigation: Clicking or tapping the button pins the explainer card open so it can be scrolled and read without closing. Pressing Escape or clicking elsewhere closes the dialog and restores focus to the trigger button.
3. Chart Body Dwell Hint: Moving the cursor onto a chart canvas and pausing for 700 ms displays a compact floating pill: "What is this graph? Hover the info icon for details". The pill hides immediately upon mouse movement and never obstructs interactive crosshairs or tooltips.
4. Axis and Legend Hover: Margins and legends explain their respective metrics, units, and physical meanings when hovered.
5. Enriched Spatial Tooltips: The Node Link Quality Matrix explains the meaning of each cell status (observed, unobserved, blocked). The Cartesian Trajectory plot explains error displacement arrows, GNSS fixes, dead reckoning outages, and ground truth paths.
6. Seven Required Sections: Every explainer strictly incorporates What is this graph, Why is it needed, X versus Y, How to read it, Data origin, Caveats, and Expert Details.
7. Ground Rule Compliance: Zero bench measurements exist in the project, so the word "measured" is completely absent from all explainers. Only honest provenance tags (`simulated`, `model`, `cited`, `assumed`) are used. Zero em dashes and zero double dashes are authored.

### 2. Gallery Critique: All 20 Scientific Charts

#### 1. docs/screens/charts/rssi_vs_distance_model.png
- Chart Title: Simulated RSSI vs Distance Model
- X versus Y: X axis: Distance (m, log) versus Y axis: Received Signal Strength (dBm, linear).
- Visual Quality: Clear dark aesthetic, cyan theoretical curve, and sensitivity threshold line at -126.0 dBm for SF8.
- Provenance Tags: [simulated], [model], [cited]
- Critique: Explainer card appears cleanly in the top right corner opposite low-distance data points. The X versus Y relationship is clear.

#### 2. docs/screens/charts/path_loss_vs_theory.png
- Chart Title: Observed Path Loss vs Theory Curve
- X versus Y: X axis: Distance (m, linear) versus Y axis: Path Loss (dB, linear).
- Visual Quality: Displays log-distance theoretical curve alongside empirical attenuation points with obstacle elevation.
- Provenance Tags: [simulated], [model], [cited], [assumed]
- Critique: The margin budget threshold is dynamically filled from current scenario parameters.

#### 3. docs/screens/charts/snr_vs_distance.png
- Chart Title: Signal-to-Noise Ratio (SNR) vs Distance
- X versus Y: X axis: Distance (m, linear) versus Y axis: SNR (dB, linear).
- Visual Quality: Clear threshold lines for SF7 (-7.5 dB), SF10 (-15.0 dB), and SF12 sensitivity floor.
- Provenance Tags: [simulated], [model], [cited]
- Critique: Explicitly notes SX1262 LoRa demodulation capture boundaries.

#### 4. docs/screens/charts/link_quality_matrix.png
- Chart Title: Node-to-Node Link Quality Matrix
- X versus Y: X axis: Receiver Node ID (integer) versus Y axis: Transmitter Node ID (integer).
- Visual Quality: Matrix grid with color scale from emerald green to amber and slate.
- Provenance Tags: [simulated]
- Critique: Card explains asymmetric links, isolated survivor clusters, and relay forwarding bottlenecks.

#### 5. docs/screens/charts/pdr_timeline.png
- Chart Title: Mission Packet Delivery Ratio (PDR)
- X versus Y: X axis: Simulation Time (s, linear) versus Y axis: Delivery Ratio (%, linear).
- Visual Quality: Tracks cumulative PDR (solid green) against sliding-window PDR (dashed cyan).
- Provenance Tags: [simulated], [model]
- Critique: Distinguishes unique originated emergency alerts from relay duplicate forwards.

#### 6. docs/screens/charts/latency_cdf.png
- Chart Title: End-to-End Latency Empirical CDF
- X versus Y: X axis: Latency (ms, linear) versus Y axis: Cumulative Probability (%, linear).
- Visual Quality: Empirical step function with quantile annotations for p50, p90, and p95.
- Provenance Tags: [simulated]
- Critique: Explains evacuation alerting speed and network responsiveness.

#### 7. docs/screens/charts/throughput_and_rate.png
- Chart Title: Delivered Payload Throughput & Packet Rate
- X versus Y: X axis: Simulation Time (s, linear) versus Y axis: Throughput and Rate (bps / pps, linear).
- Visual Quality: Dual series showing goodput in bits per second and load in packets per second.
- Provenance Tags: [simulated], [model]
- Critique: Directly clarifies the difference between raw airtime utilization and delivered payload data.

#### 8. docs/screens/charts/packet_loss_vs_distance.png
- Chart Title: Packet Loss Probability vs Distance
- X versus Y: X axis: Distance (m, linear) versus Y axis: Loss Rate (%, linear).
- Visual Quality: Solid red curve with shaded loss area against the critical distance threshold.
- Provenance Tags: [simulated], [model]
- Critique: Explains the cliff edge behavior of LoRa packet reception near receiver sensitivity.

#### 9. docs/screens/charts/delivered_by_hop_count.png
- Chart Title: Delivered Messages by Hop Count
- X versus Y: X axis: Hop Count (hops, discrete) versus Y axis: Message Count (packets, integer).
- Visual Quality: Bar distribution showing direct line of sight arrivals versus multi-hop relay forwarding.
- Provenance Tags: [simulated], [model]
- Critique: Clarifies multi-hop relay dependency across subterranean and collapsed structures.

#### 10. docs/screens/charts/relay_activity.png
- Chart Title: Relay Forward Transmissions / 2s Window
- X versus Y: X axis: Simulation Time (s, linear) versus Y axis: Forward Count (pkts / 2s, linear).
- Visual Quality: Activity rate lines per relay node identifying traffic hot spots.
- Provenance Tags: [simulated]
- Critique: Identifies traffic bottlenecks and airtime saturation risks.

#### 11. docs/screens/charts/collisions_vs_retransmission.png
- Chart Title: Airtime Collisions vs Retransmission Rate
- X versus Y: X axis: Simulation Time (s, linear) versus Y axis: Collision Events (collisions, integer).
- Visual Quality: Stacked or overlaid series illustrating simultaneous transmission contention.
- Provenance Tags: [simulated], [model]
- Critique: Explains the physical impact of ALOHA packet collisions during incident bursts.

#### 12. docs/screens/charts/channel_loss_dynamics.png
- Chart Title: Channel Loss Dynamics
- X versus Y: X axis: Simulation Time (s, linear) versus Y axis: Drop Events (drops / 2s, linear).
- Visual Quality: Timeline of drops categorized by physical cause: weak signal, collision, half duplex, blocked.
- Provenance Tags: [simulated]
- Critique: Gives direct visibility into why packets fail across simulation intervals.

#### 13. docs/screens/charts/fleet_soc.png
- Chart Title: Fleet State of Charge (%)
- X versus Y: X axis: Simulation Time (s, linear) versus Y axis: State of Charge (%, linear).
- Visual Quality: Step-down battery percentage lines for survivor wristbands and relay towers.
- Provenance Tags: [simulated], [model], [cited]
- Critique: Explains mission lifetime limits and current drain rates.

#### 14. docs/screens/charts/energy_vs_forwarding.png
- Chart Title: Energy Drain vs Forwarding Load
- X versus Y: X axis: Forwarded Packets (pkts, linear) versus Y axis: Total Energy Drain (mAh, linear).
- Visual Quality: Scatter plot with linear regression line showing energy consumed per relay forward.
- Provenance Tags: [simulated], [model]
- Critique: Quantifies relay forwarding cost in milliampere hours.

#### 15. docs/screens/charts/trajectory_error_vectors.png
- Chart Title: Cartesian Trajectory & Position Estimation Error Vectors
- X versus Y: X axis: Easting (m, linear) versus Y axis: Northing (m, linear).
- Visual Quality: 2D spatial coordinate plot showing ground truth path, estimated path, and red error vectors.
- Provenance Tags: [simulated], [model]
- Critique: Red error displacement vectors clearly indicate dead reckoning drift during GNSS outages.

#### 16. docs/screens/charts/position_error_timeline.png
- Chart Title: Horizontal Position Error vs Time (m)
- X versus Y: X axis: Simulation Time (s, linear) versus Y axis: Position Error (m, linear).
- Visual Quality: Error line with red shaded GNSS outage intervals.
- Provenance Tags: [simulated], [model]
- Critique: Clarifies pedestrian dead reckoning sensor drift accumulation when satellite lock is lost.

#### 17. docs/screens/charts/ack_latency_cdf.png
- Chart Title: Time-to-First-ACK CDF
- X versus Y: X axis: Time-to-First-ACK (ms, linear) versus Y axis: Cumulative Probability (%, linear).
- Visual Quality: Empirical CDF curve tracking the elapsed duration before a survivor wristband receives vibrating confirmation.
- Provenance Tags: [simulated]
- Critique: Directly evaluates human survivor assurance latency.

#### 18. docs/screens/charts/comparative_latency_cdfs.png
- Chart Title: Comparative End-to-End Latency eCDFs
- X versus Y: X axis: Latency (ms, linear) versus Y axis: Cumulative Percentage (%, linear).
- Visual Quality: Multi-curve CDF comparison across baseline and custom simulation experiments.
- Provenance Tags: [simulated]
- Critique: Validates performance gains across algorithmic or topology adjustments.

#### 19. docs/screens/charts/sidebar_latency_cdf.png
- Chart Title: End-to-End Latency CDF (Sidebar Quick View)
- X versus Y: X axis: Latency (ms, linear) versus Y axis: Cumulative Percentage (%, linear).
- Visual Quality: Compact CDF plot embedded in the sidebar operations panel.
- Provenance Tags: [simulated]
- Critique: Provides immediate latency overview without leaving the primary 3D and topology view.

#### 20. docs/screens/charts/sidebar_rssi_vs_distance.png
- Chart Title: Quick Plot: RSSI vs Distance (Sidebar Quick View)
- X versus Y: X axis: Distance (m, linear) versus Y axis: Received Signal Strength (dBm, linear).
- Visual Quality: Compact scatter plot with theoretical path loss curve in the sidebar.
- Provenance Tags: [simulated], [model], [cited]
- Critique: Gives quick confirmation of radio link budget health directly in the sidebar.

### 3. Verification and Automated Test Results

1. Test Suite `tests/test_chart_explainers.mjs`:
   - 201 automated unit and DOM assertions passed.
   - All 20 charts verified for completeness, non-empty sections, no placeholders, and valid word counts.
   - Axis consistency verified for all 20 charts against engine definitions.
   - Provenance tag audit passed with zero occurrences of "measured".
   - Dynamic parameter fill verified for SF7 (-123.0 dBm) and SF8 (-126.0 dBm).
   - Accessibility contract verified (`role="button"`, `role="dialog"`, `aria-haspopup="dialog"`, `aria-expanded`, Escape key handling, 120 ms keyboard trigger).
   - 700 ms dwell timer and instant movement cancellation verified.
   - Mutation guardrails verified (deleting sections or adding unmapped canvases fails tests).

2. Playwright E2E Script `scripts/capture_chart_explainers.mjs`:
   - Launched headless Chrome across all workspace domains and sidebar.
   - Captured 20 screenshots of every explainer card to `docs/screens/charts/<explainerId>.png`.
   - Verified that data point tooltips and dwell hints function without collision.
