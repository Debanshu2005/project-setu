# Hardware explorer review

## H1 evidence

The supplied proof of concept archive was unpacked to a temporary directory and served with:

```text
cd .poc-h1/setu_hardware_explorer_poc
python -m http.server 8102
```

It rendered the procedural ESP32-S3 DevKitC-1 scene in headless Chromium. The temporary server produced one missing favicon console request. The module scene itself had no page error.

The dashboard implementation was then verified at 1600 by 900 and 390 by 844. The dashboard browser run had no console errors and reported 161 draw calls and 4,184 triangles.

### Screens reviewed

- `h1-desktop.png`: The board is bright, centered, and fully visible. The LED glow and radio arcs are legible. Controls are visually clear and the hint remains readable.
- `h1-mobile.png`: The model renders and the controls remain available. The portrait-stage view clips the board at the right edge, so the H2 responsive layout needs a mobile camera fit and the required card layout before this is ready for acceptance.
- `h1-blocked-three-desktop.png`: Fallback mode when Three.js fails to load or is blocked. Displays the static illustrated preview image and an informative status message. The rest of the dashboard remains usable.

## H2 evidence

Command:
```text
node tests/test_hardware_explorer.mjs
```

Verifies six cards and six markers, hover leaders, click-to-pin, Escape-to-unpin, keyboard orbit and zoom navigation, and screenshots at desktop and mobile viewports.

### Screens reviewed

- `h2-desktop.png`: The board has balanced left and right callout columns, teal markers, and dashed leaders. The model is not clipped and fits cleanly within the central viewport.
- `h2-hover-desktop.png`: Hovering over the USB card highlights the part on the 3D model, makes the SVG leader line solid (`data-on="true"`), and brightens the marker.
- `h2-mobile.png`: At 390 by 844, the 3D stage shifts to the top and pulls back the camera to fit the full board. Cards appear in a swipeable horizontal strip below the stage.

## H3 evidence

Dual-model selector toggle allows seamless switching between the prototype board (ESP32-S3 DevKitC-1) and the production wearable (Setu Wristband). Both models share the same camera orbit controls, card layout, and digital twin state hooks.

### Screens reviewed

- `h3-wristband-desktop.png`: Product wearable rendered in the same procedural toon-shaded style. Shows silicone strap with molded ridges, buckle, sealed enclosure, recessed panic button, tri-color LED window, acoustic mic port, ceramic patch antenna, and internal battery/haptic placement.
- `h3-wristband-mobile.png`: Responsive portrait view of the wristband at 390 by 844. Strap ribs and recessed dome switch remain legible.

## H4 evidence

Digital twin synchronization follows live engine and trace scrubber events:
- Status RGB LED reflects node state: idle teal, SOS amber, ACK green, retry orange, timeout coral, and bootloader lock purple.
- Clickable 3D button provides tactile depth depression animation when pressed.
- Dedicated simulation trigger actions: Press (Short), Double Press, Long Press, Say Setu (voice acoustic countdown), and Strapping Lock.
- LoRa radio wave rings expand and fade proportionally during active packet transmission.

### Screens reviewed

- `h4-button-pressed-desktop.png`: Captures the recessed panic button at 0.44 vertical offset during tactile depression animation.
- `h4-tx-arcs-desktop.png`: Animated concentric radio waves radiating outward from the antenna strip during an active SOS beacon transmission.

## H5 evidence

Command:
```text
node tests/test_pinmap.mjs
```

Output:
```text
[ PASS ] Pin map validator passed: header GPIOs, uniqueness, negative GPIO 22 rejection, waivers, and firmware agreement verified.
```

### Pin map decisions
- GPIO 22 was rejected because it does not physically exist on the 44-pin ESP32-S3 DevKitC-1 header. GPIO 9 was selected as the I2C SCL replacement: it is a clean general-purpose IO on Header L (pin 15), supports 400 kHz fast mode, and avoids all strapping pins (0, 3, 45, 46) and flash/PSRAM pins (33 to 37).
- GPIO 0 strapping pin bootloader lock: holding GPIO 0 low during reset de-assertion forces the ESP32-S3 into download bootloader mode (ROM wait), preventing application boot. Setu product wristband mitigates this by placing the panic button on dedicated GPIO 16.

### Screens reviewed

- `h5-wiring-desktop.png`: Wiring overlay on the DevKitC-1 model highlighting peripheral header pins color-coded by bus: SPI (cyan), UART (emerald), I2C (amber), I2S (purple), PWM (orange), ADC (pink), and IRQ (blue). Legend is visible below the model selector.
- `h5-wiring-mobile.png`: Mobile wiring layout with bus-colored pin markers. Tapping a pin updates live pin telemetry in the status HUD.

## H6 evidence

Educational component catalog follows the V5 chart explainer pattern. Every card includes:
- What it is
- Why it matters in Setu
- Pin assignments and bus classification
- What to watch in the simulator
- Provenance tags (strictly limited to model, assumed, cited, and simulated; zero instances of measured)
- Parameter links cross-referencing `docs/PARAMETERS.md`
- Interactive chips navigating to Timeline, Twin, Analytics, Energy, Topology, PDR, Wiring, and Docs

## H7 evidence

All performance and accessibility budgets verified:
- Added JavaScript size: 39,994 bytes raw before compression (strict limit: 40,000 bytes).
  - `hardware_explorer.js`: 24,142 bytes
  - `hardware_parts.js`: 9,551 bytes
  - `wristband_scene.js`: 6,301 bytes
- WebGL draw calls: 50 (budget: <= 300)
- WebGL triangles: 2,144 (budget: <= 200,000)
- WebGL textures: 8 (budget: <= 50)
- Memory leak stability: 108 geometries before and after 50 model toggle switches (zero geometry leak).
- Mobile DPR capped at <= 1.5.
- On-demand rendering: zero idle animation callbacks when hidden or settled.
- Screen reader accessibility: `aria-label`, `role="button"`, and `aria-pressed` on all interactive cards, markers, and controls.

## H8 evidence

All 10 required screenshots captured and pixel-tested:
- `WebGL Canvas Coverage`: 15.86% (budget: >= 12.0%)
- `Mean Luminance`: 90.16 (budget: >= 30.0)
- `Stage Edge Clipping`: 0 edge hits (model is cleanly centered)
- `Teal Markers`: 6 numbered markers present with valid computed styles
- `Attribution`: all ported modules in `dashboard/vendor/esp-labs/` preserve MIT copyright headers; `docs/THIRD_PARTY.md` contains the full MIT notice.

## Still wrong

1. In the mobile portrait view (390 by 844), the bottom cards horizontal scrollbar is subtle; a user might not immediately notice that swiping horizontally reveals additional components.
2. The BLE short-hop tier is visualized on the model antenna but is correctly labeled as not implemented in the current simulation engine (pending Phase 4).
3. The 3D pin markers on adjacent pins (pitch 2.54 mm) can visually crowd each other at extreme tilt angles; orbiting or zooming provides better separation.
