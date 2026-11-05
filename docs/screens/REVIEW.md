# Project Setu: 3D Viewer Visual Review Log

This document records honest visual inspections of the 3D twin viewer. Every entry is based on opening and examining the actual rendered screenshots in docs/screens/.

## Checkpoint V-A Review (V1 Scale & Readability, V2 Demo Site & Obstacles)

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
- Are labels readable and not overlapping: Yes. The screen space collision avoidance pass staggers vertical positions of adjacent survivor badges (e.g. Node 1, Node 101, Node 5, Node 7, Node 9), preventing badge text from colliding.
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

### 1. docs/screens/V_W1_01_landing.png (Desktop Landing with collapse_site_demo)
- Clearly 3D with depth and light: Yes. Preloads collapse_site_demo as default landing scenario per user decision. The multi-storey collapsed building, tilted slabs, rubble mounds, street, and command post tent render immediately on startup.
- Radio links visible: Yes. Filtered backbone links and best-margin links are rendered without cluttering into a hairball. Link thickness scales with margin. Blue solid indicates strong link (>15 dB margin), amber solid indicates medium link (5 to 15 dB margin), and red dashed indicates weak link (<5 dB margin). Colorblind safe with distinct dash pattern.
- Top toolbar layout: Clean. Compact buttons (Orbit, Top-Down, Free-Fly, Follow, Fit View, Toggle Heatmap) leave generous space before the right obstacle badge. Zero collision.
- Node composition: Exactly 16 physical nodes (1 Hub + 12 Survivors + 3 Relays).

### 2. docs/screens/V_W1_02_demo_t3.png (First SOS at t=3.1s with Wall Attenuation)
- Radio pulses and airtime rings visible: Yes. Node 1 initiates Trapped Under Debris SOS. A purple expanding airtime ring radiates across the floor. A purple packet pulse with a HOP 1 sprite badge travels along the link vector.
- Wall crossing attenuation visible: Yes. Link ray from Node 1 to Hub 0 intersects exterior west shear wall and corridor wall. Both intersected wall segments illuminate in bright amber emissive. Floating -22 dB and -20 dB attenuation badges hover over the wall midpoints.
- Drop flashes visible: Yes. Hub 0 receives the packet at -127.9 dBm (below sensitivity threshold of -123 dBm) and triggers a red drop flash with DROP: WEAK SIGNAL badge.
- Label overlap status: Clean. Node 12 and Node 11 survivor labels stagger vertically, keeping both fully readable without colliding.
- Pixel assertion metrics: Coverage is 53.1% (PASS, requirement >= 12%), mean luminance is 91.5 (PASS, requirement >= 35), 95th percentile luminance is 200.8 (PASS, requirement >= 120), Cyan survivor pixels: 16,635, Amber obstacle/relay pixels: 4,209, Green hub pixels: 2,552, Purple pulse pixels: 6,320.

### 3. docs/screens/V_W1_03_demo_t8.png (Intermediate Hop at t=8.2s)
- Intermediate hop packet visible: Yes. Node 7 transmits Medical SOS. An amber airtime ring radiates across the ground, and a HOP 2 packet pulse travels toward Relay 101.
- Sprite badge accumulation: Resolved. Seeking to 8.2s cleanly clears historical transient badges from 3.1s, preventing the previous pile-up. Max active badges are capped at 4.
- Pixel assertion metrics: Coverage is 51.0% (PASS, requirement >= 12%), mean luminance is 96.7 (PASS, requirement >= 35), Amber pixels: 23,268.

### 4. docs/screens/V_W1_04_ack_buzz.png (ACK Arrival & Wristband Buzz at t=4.5s)
- Acknowledgement return visible: Yes. Hub 0 returns ACK packet to Node 1. A green ACK airtime ring radiates across the hub perimeter. Alerts Delivered increments to 1, Delivery Ratio reaches 100%, and Latency displays 860 ms.
- Wristband twin response: Wristband tactile buzzer triggers haptic vibration pattern.
- Pixel assertion metrics: Coverage is 47.8% (PASS, requirement >= 12%), Green ACK/hub pixels: 2,743.

### 5. docs/screens/V_heatmap_node1.png (RF Coverage Heatmap for Node 1)
- Coverage heatmap visible: Yes. Toggle Heatmap button activates in blue (#0284c7). Ground is overlaid with path loss tiles computed from the C++ RF engine formula. Red tiles appear in the acoustic/RF shadow behind the 22 dB shear wall (negative link margin). Amber tiles show boundary coverage, and cyan tiles indicate strong margin.
- Pixel assertion metrics: Coverage is 68.6% (PASS, requirement >= 12%), Amber path loss pixels: 17,133.

### What is still wrong (Remaining for V4 through V8):
1. **Interactive Demo Button (W1 Walkthrough):** Primary header button is still "Run Simulation" which opens modal settings. "Start Earthquake Demo" one-click button will replace it in V4.
2. **Wristband 3D Inspector Panel (Item 5):** The wristband model panel in the right sidebar is still dark and lacks clear button component labels. To be lit and annotated in V6.
3. **Loss Budget Waterfall Dialog (Item 7 / W2 Walkthrough):** Clicking a dropped link or "Dropped" event currently shows a text modal. Interactive waterfall chart with physical component breakdown (distance, walls, body, shadow) will be wired in V5.
