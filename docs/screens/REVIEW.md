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
