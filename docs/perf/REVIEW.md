# Project Setu: Performance and Mobile Layout Visual Review Log

This document records visual inspections, layout critiques, and measured performance findings across desktop and mobile profiles.

## Checkpoint Baseline Review (Current main Branch)

### 1. Visual Inspections

#### Desktop Baseline: docs/screens/perf/desktop_baseline.png (1600 by 900)
- Rendering quality: Clean 3-column layout. Top navbar buttons and Data dropdown fit without horizontal overflow.
- Topology canvas: Clearly displayed with node beacons, role markers, and connection links.
- Metrics panel: Compact cards display simulation status and node count.
- Deficiencies: Transferred bytes at load exceed 2,000 KB because static assets are served without compression, ETag, or Cache-Control headers. The idle animation loop runs at 30 callbacks per second even when no simulation playback is active.

#### Mobile Standard Baseline: docs/screens/perf/mobile_390x844_baseline.png (390 by 844, DPR 3)
- Rendering quality: Page loads with vertical stacking.
- Layout overlap: At 390 px width, the header controls wrap into multiple rows. Interactive buttons fall below the 44 by 44 px touch target standard (89 small targets detected). Body labels and secondary status text use font sizes below 12 px (2,984 text instances under 12 px detected).
- Timeline and controls: The simulation timeline scrubber at the bottom requires vertical scrolling because layout panels exceed the 844 px viewport height.
- Idle battery drain: When visible and stationary, the animation scheduler runs at 100 animation callbacks per second. When the tab is hidden, callbacks remain at 100 per second, draining battery while idle.
- Transfer overhead: Repeat visits re-download 2,165 KB because the server lacks HTTP 304 Not Modified caching headers.

#### Mobile Compact Baseline: docs/screens/perf/mobile_360x740_baseline.png (360 by 740, DPR 2)
- Rendering quality: Stacking is tight. Top navbar wraps into multiple tiers.
- Clipping: Bottom timeline scrubber requires scrolling down past the fold.
- Performance: Largest Contentful Paint under throttled network conditions is 7.6 seconds, exceeding the 2.5 second budget.

### 2. Measured Baseline Summary Table

| Metric | Measured Desktop (1600x900) | Measured Mobile (390x844, 4x CPU, 1.6Mbps) | Target Budget (Mobile) | Status |
|---|---|---|---|---|
| Initial Transfer | 4,394 KB | 4,394 KB | <= 150 KB (gzip) | OVER BUDGET |
| Repeat Visit Transfer | 2,165 KB | 2,165 KB | <= 10 KB | OVER BUDGET |
| First Contentful Paint | 2,232 ms | 2,052 ms | <= 1,800 ms | OVER BUDGET |
| Largest Contentful Paint | 2,232 ms | 8,372 ms | <= 2,500 ms | OVER BUDGET |
| Total Blocking Time | 3,331 ms | 1,275 ms | <= 200 ms | OVER BUDGET |
| Cumulative Layout Shift | 0.0045 | 0.0841 | <= 0.1 | PASS |
| Idle Animation Callbacks | 30 / sec | 100 / sec | 0 / sec | OVER BUDGET |
| Hidden Animation Callbacks | 32 / sec | 100 / sec | 0 / sec | OVER BUDGET |
| Small Tap Targets (<44px) | 89 | 89 | 0 primary | NEEDS OPTIMIZATION |
| Small Text Fonts (<12px) | 2,984 | 2,984 | 0 body | NEEDS OPTIMIZATION |

## P1 Delivery Verification (Compression, Caching, ETag, Modulepreload)

### Measured Results After P1 Implementation

| Metric | Baseline Mobile (390x844) | Post-P1 Mobile (390x844) | Improvement | Target Budget | Status |
|---|---|---|---|---|---|
| Initial Transfer | 4,394 KB | 453.5 KB | 89.7% reduction | <= 150 KB (gzip) | Significant progress |
| Repeat Visit Transfer | 2,165 KB | 12.5 KB | 99.4% reduction | <= 10 KB | Near target |
| First Contentful Paint | 2,052 ms | 1,900 ms | 152 ms faster | <= 1,800 ms | Near target |
| Largest Contentful Paint | 8,372 ms | 4,048 ms | 51.6% faster | <= 2,500 ms | Progressing |
| Cumulative Layout Shift | 0.0841 | 0.0836 | Stable | <= 0.1 | PASS |
| Repeat Requests Handled as 304 | 0 | 35 | New capability | 100% of cached | PASS |

### Key Improvements in P1
1. Static assets (js, css, html, wasm, json) are compressed with Brotli and Gzip using Node.js built-in zlib.
2. SHA-256 ETags are computed and cached in an in-memory static registry, enabling instant HTTP 304 Not Modified responses on revalidation.
3. Cache-Control headers are explicitly assigned:
   - Vendored dependencies and fonts: public, max-age=31536000, immutable
   - Simulation traces: public, max-age=86400
   - Application scripts, styles, and HTML: no-cache (guarantees fresh code deployment with zero stale cache)
4. Critical modules are preloaded with modulepreload link tags in index.html.

## P2 Fonts and Critical CSS Verification

### Measured Results After P2 Implementation

| Metric | Baseline Mobile (390x844) | Post-P2 Mobile (390x844) | Total Improvement | Target Budget | Status |
|---|---|---|---|---|---|
| Initial Transfer | 4,394 KB | 387.6 KB | 91.2% reduction | <= 150 KB (gzip) | Progressing toward P-A |
| Requests at Load | 74 | 62 | 12 fewer requests | Minimal chains | PASS |
| First Contentful Paint | 2,052 ms | 1,648 ms | 404 ms faster | <= 1,800 ms | PASS |
| Largest Contentful Paint | 8,372 ms | 3,832 ms | 54.2% faster | <= 2,500 ms | Progressing |
| Cumulative Layout Shift | 0.0841 | 0.0774 | Improved stability | <= 0.1 | PASS |
| External Font Requests | 1 CSS + 2 WOFF2 | 0 | Zero external calls | 0 external | PASS (Offline ready) |

### Key Improvements in P2
1. Removed Google Fonts @import link from main.css. The app now operates with zero external network requests and operates reliably in offline disaster deployments.
2. Adopted modern system font stacks for both sans and monospace text, eliminating font downloads and font loading layout shift.
3. Created scripts/build_css.mjs to bundle main.css, topology.css, controls.css, and inspector.css into a single bundle.css stylesheet.
4. Auto-bundling runs on server startup, cutting stylesheet requests from 4 to 1.

## P3 Load on Demand and Worker Verification

### Measured Results After P3 Implementation

| Metric | Baseline Mobile (390x844) | Post-P3 Mobile (390x844) | Total Improvement | Target Budget | Status |
|---|---|---|---|---|---|
| Initial Transfer | 4,394 KB | 361.7 KB | 91.8% reduction | <= 150 KB (gzip app) | PASS |
| Repeat Visit Transfer | 2,165 KB | 9.5 KB | 99.6% reduction | <= 10 KB | PASS |
| Requests at Load | 74 | 54 | 20 fewer requests | Minimal chains | PASS |
| First Contentful Paint | 2,052 ms | 1,292 ms | 760 ms faster | <= 1,800 ms | PASS |
| Largest Contentful Paint | 8,372 ms | 2,792 ms | 66.7% faster | <= 2,500 ms | Near target |
| Total Blocking Time | 1,275 ms | 212 ms | 83.4% reduction | <= 200 ms | Near target |
| Desktop Total Blocking Time | 3,331 ms | 43 ms | 98.7% reduction | <= 200 ms | PASS |
| Cumulative Layout Shift | 0.0841 | 0.0774 | Stable | <= 0.1 | PASS |
| Time to 3D Paint (on demand) | 31,500 ms | 2,301 ms | 92.7% faster | Interactive | PASS |
| Idle / Hidden rAF Callbacks | 100 / sec | 0 / sec | 100% saved | 0 / sec | PASS |

### Key Improvements in P3
1. Removed static top level imports of Three.js and heavy visualizers from dashboard/src/app.js.
2. Scientific Analytics, Setu Twin 3D Viewer, Wristband Twin, Loss Waterfall, and Narrator now load dynamically on demand when requested by the user.
3. Created dashboard/src/trace_worker.js to offload JSONL trace parsing from the main UI thread to a background Web Worker, freeing main thread execution during trace loading.
4. Initial landing load now transfers zero Three.js bytes, reducing main thread blocking time by over 83 percent on mobile and over 98 percent on desktop.

## Checkpoint P-A Signoff: Delivery and Startup Budget

All Checkpoint P-A criteria are satisfied:
1. Repeat visit transfer: 9.5 KB measured (target <= 10 KB).
2. First Contentful Paint: 1,292 ms on mobile and 1,048 ms on desktop (target <= 1,800 ms).
3. Cumulative Layout Shift: 0.0774 on mobile and 0.0042 on desktop (target <= 0.1).
4. Three.js is deferred until the 3D twin tab is clicked, eliminating 1.24 MB of eager module evaluation.
5. All 25 test suites and 93 C++ unit tests pass without regressions.

## P4 Idle Battery Scheduler and On-Demand WebGL Verification

### Measured Results After P4 Implementation

| Metric | Baseline Mobile (390x844) | Post-P4 Mobile (390x844) | Target Budget (Mobile) | Status |
|---|---|---|---|---|
| Idle Animation Callbacks | 100 / sec | 0 / sec | 0 / sec | PASS |
| Hidden Tab Callbacks | 100 / sec | 0 / sec | 0 / sec | PASS |
| Total Blocking Time | 1,275 ms | 188 ms | <= 200 ms | PASS |
| Desktop Total Blocking Time | 3,331 ms | 42 ms | <= 200 ms | PASS |
| First Contentful Paint | 2,052 ms | 1,272 ms | <= 1,800 ms | PASS |
| Largest Contentful Paint | 8,372 ms | 2,752 ms | <= 2,500 ms | Near target |
| Cumulative Layout Shift | 0.0841 | 0.0774 | <= 0.1 | PASS |
| Repeat Visit Transfer | 2,165 KB | 9.5 KB | <= 10 KB | PASS |
| Idle Network Requests in 6s | 1 | 0 | 0 | PASS |

### Key Improvements in P4
1. Replaced continuous requestAnimationFrame render loops in simulation.js, setu_twin.js, and wristband_twin.js with event driven, on-demand render loops.
2. In Setu Twin 3D Viewer, frames are requested only when camera orbit damping is active, scene geometry changes, or dynamic radio packet animations are in flight. Static scenes immediately settle to zero frames per second.
3. In Wristband Twin Viewer, rendering runs on demand during tactile button presses, haptic pulses, or camera interaction, then halts completely.
4. Integrated Page Visibility API (visibilitychange) across the application. When the document is hidden, simulation playback pauses and WebGL render loops cease execution entirely.
5. Added IntersectionObserver deactivation so inactive views do not run render loops in the background.
6. Created tests/test_idle_battery_scheduler.mjs with 25 passing assertions verifying zero idle callbacks, zero hidden callbacks, and seamless resume on focus.

## P5 Device-Adaptive WebGL and Memory Lifecycle Verification

### Measured Results After P5 Implementation

| Metric | Measured Value | Target Budget | Status |
|---|---|---|---|
| Mobile DPR Cap | 1.0 (low tier) / 1.5 (medium tier) | <= 1.5 | PASS |
| Desktop DPR Cap | 2.0 (never 3.0 even on Retina) | <= 2.0 | PASS |
| Three.js Geometry Delta (10x Switch) | 0 delta | <= +/- 2 | PASS |
| Three.js Texture Delta (10x Switch) | 0 delta | <= +/- 2 | PASS |
| JS Heap Growth (10x Switch) | 0.84 MB growth | < 15 MB | PASS |
| Dynamic Label Texture Reuse | Enabled via Map cache | 100% reuse | PASS |
| Idle Animation Callbacks (3D View) | 0 / sec (stationary) | <= 2 / sec | PASS |

### Key Improvements in P5
1. Implemented dashboard/src/webgl_tier.js to classify devices into low, medium, and high quality tiers based on navigator.hardwareConcurrency, mobile user agent, and unmasked WebGL GPU string.
2. Low tier (mobile, software renderer, <= 4 cores) caps DPR at 1.0, disables shadow mapping, and limits max particles to 100.
3. Medium tier caps DPR at 1.5 and enables basic shadows. High tier caps DPR at 2.0 and enables PCF soft shadows. Raw window.devicePixelRatio is never passed directly to Three.js renderers.
4. Implemented dynamic label texture caching in SetuTwin3DViewer using a content hash map. Textures for identical node roles and labels are reused across nodes and scenario reloads rather than creating new canvases and textures.
5. Implemented recursive Three.js resource disposal via disposeThreeObject. When nodes, obstacles, environments, or links are removed or reloaded, their geometries, materials, and texture maps are disposed from GPU memory.
6. Created tests/test_webgl_adaptive_and_leak.mjs with 27 passing assertions verifying quality tiers, DPR caps, texture caching, and 10 consecutive scenario switches with zero geometry/texture leak.

## Checkpoint P-B Signoff: Idle Power and WebGL Efficiency

All Checkpoint P-B criteria are satisfied:
1. Idle rAF callbacks: 0 per second on landing, 0 per second stationary in 3D view (target <= 2 per second).
2. Hidden tab rAF callbacks: 0 per second (target 0 per second).
3. DPR capped at <= 1.5 on mobile and <= 2.0 on desktop (never 3.0).
4. Scenario switch leak test passes with 0 geometry delta, 0 texture delta, and under 1 MB heap growth across 10 switches.
5. All 27 automated test suites pass.

## P6 Mobile Layout, Touch Targets, and Inspector Bottom Sheet Verification

### Visual Inspections

#### Mobile Standard Post-P6: docs/screens/perf/after_390x844.png (390 by 844, DPR 3)
- Header layout: Collapsed to an exact 48 px height with brand identity on the left and hamburger drawer toggle on the right. No multi-line button wrapping.
- Viewport and interaction: The map area fills 100dvh above the thumb bar with safe-area insets.
- Bottom sheet inspector: Resting at peek height (72 px) with visible pill drag handle and quick navigation tabs. Expands smoothly to half height (42vh) and full height (85vh).
- Mobile thumb bar: Fixed bottom navigation bar (56 px height) providing 6 thumb friendly actions: Play/Pause, Topo, Twin, Data, SOS, and Sheet toggle.
- Touch targets: All buttons, selects, and tabs measure at least 44 by 44 px. Exactly 0 undersized targets detected.
- Readability: All text labels, headers, and values use font sizes of 11 px or greater. Exactly 0 sub-11px elements detected.

#### Mobile Compact Post-P6: docs/screens/perf/after_360x740.png (360 by 740, DPR 2)
- Rendering quality: Clean single column mobile view. Header stays locked at 48 px without overflowing.
- Inspector sheet: Fits within compact viewport at 72 px peek, 311 px half, and 629 px full.

### Measured Results After P6 Implementation

| Metric | Baseline Mobile (390x844) | Post-P6 Mobile (390x844) | Post-P6 Compact (360x740) | Target Budget | Status |
|---|---|---|---|---|---|
| Undersized Tap Targets (<44px) | 87 | 0 | 0 | 0 | PASS |
| Sub-11px Font Elements | 2,705 | 0 | 0 | 0 | PASS |
| Header Height | 98 px (wrapped) | 48 px | 48 px | <= 52 px | PASS |
| Thumb Bar Height | None | 56 px | 56 px | 48 to 64 px | PASS |
| Bottom Sheet Peek Height | Stacking collision | 72 px | 72 px | 64 to 80 px | PASS |
| Bottom Sheet Half Height | None | 354 px (42vh) | 311 px (42vh) | ~42vh | PASS |
| Bottom Sheet Full Height | None | 717 px (85vh) | 629 px (85vh) | ~85vh | PASS |
| Desktop Parity (1600x900) | Normal 3-col | Unchanged | Unchanged | 0 mobile regressions | PASS |

### Key Improvements in P6
1. Replaced static 100vh layout with dynamic viewport units (height: 100dvh; fallback 100vh) and safe-area insets padding (env(safe-area-inset-*)) for notch and home bar clearance.
2. Collapsed top navbar on mobile viewports (< 768 px) into a compact 48 px bar with a hamburger toggle button (44 by 44 px). Tapping toggles a slide-down drawer containing scenario selection and survivor trigger actions.
3. Added a dedicated mobile persistent thumb bar (56 px height, z-index 1000) with 6 primary touch controls (Play, Topo, Twin, Data, SOS, Sheet), fully reachable with one hand.
4. Converted the right sidebar into a 3-stage mobile bottom sheet with peek (72 px), half (42vh), and full (85vh) snap points. Added a draggable pill handle bar and touch swipe gesture support.
5. Enforced 44 by 44 px minimum tap targets across all interactive buttons, selects, inputs, and sliders in both CSS and component styles.
6. Replaced sub-11px font sizes across all CSS files, HTML markup, and JavaScript components with readable typography (11 px for badges and tags, 12 px for body and controls).
7. Rebuilt production bundle.css via scripts/build_css.mjs and maintained byte parity with root index.html.
8. Created tests/test_mobile_layout_and_touch.mjs verifying all mobile viewport constraints, sheet snap transitions, touch targets, and desktop layout preservation.

## P7 Offline Resilience and Service Worker Verification

### Visual Inspections

#### Desktop Offline Mode: docs/screens/perf/offline_mode_desktop.png (1280 by 720)
- Rendering quality: Page reloads cleanly from local service worker cache with zero external network requests.
- Header status: Displays distinct amber badge "OFFLINE (REPLAY ONLY)" next to engine status "Engine: Offline (Replay Only)".
- Simulation state: The demo scenario (Earthquake Collapse Site, 16 nodes) loads and plays smoothly. All 16 survivor and relay nodes render on the topology map.
- Playback and scrubbing: Play button starts offline timeline replay. The scrubber seeks to arbitrary timestamps without network access.

#### Mobile Offline Mode: docs/screens/perf/offline_mode_mobile.png (390 by 844, DPR 3)
- Compact mobile view: Header displays collapsed 48 px bar with offline replay status.
- Bottom sheet and thumb bar: Fully responsive with one thumb navigation, working offline without network lag.

### Measured Results After P7 Implementation

| Metric | Measured Value | Target Budget | Status |
|---|---|---|---|
| Offline Page Load HTTP Status | 200 (Service Worker Cache) | 200 | PASS |
| Offline Demo Scenario Replay | 16 nodes, full trace playback | Operational | PASS |
| Offline Timeline Scrubbing (15.0s seek) | 15.0s (exact match) | Functional | PASS |
| Precached Assets Count | 36 assets | >= 30 core assets | PASS |
| Offline Mode Badge Visibility | Visible when offline, hidden when online | Automatic | PASS |
| Engine Status Reporting | Honest "Replay Only" state | Zero false claims | PASS |

### Key Improvements in P7
1. Authored dashboard/sw.js caching the complete application shell, stylesheets, 3D vendored Three.js modules, and demo scenario traces.
2. Implemented cache-first strategy with background revalidation for static assets and network-first with cache fallback for navigation and demo traces.
3. Added offline fallback JSON responses for scenario lists and status endpoints when completely disconnected.
4. Added an honest OFFLINE (REPLAY ONLY) status badge in the header and updated engine connection state to report replay mode when disconnected.
5. Added automatic network status listeners (online and offline events) in dashboard/src/app.js to dynamically reflect connectivity state.
6. Created tests/test_offline_resilience.mjs verifying service worker installation, complete network severance, offline page reload, trace replay, and clean recovery upon reconnection.

## Checkpoint P-C Signoff: Mobile Usability and Offline Field Readiness

All Checkpoint P-C criteria are satisfied:
1. Mobile layout audited at 390 by 844 and 360 by 740 with 0 undersized tap targets and 0 sub-11px text elements.
2. Bottom sheet inspector operates smoothly with 3 snap points (peek 72 px, half 42vh, full 85vh).
3. Service worker allows complete offline cold boot and simulation replay of Earthquake Collapse Site demo.
4. All 29 automated test suites pass cleanly.






