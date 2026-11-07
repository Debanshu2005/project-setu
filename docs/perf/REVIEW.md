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
