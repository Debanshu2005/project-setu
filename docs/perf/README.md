# Project Setu: Performance and Smoothness Engineering Guide

This document describes the measurement harness, testing methodology, performance budgets, and audit procedures for Project Setu.

## 1. Methodology and Harness Architecture

Performance auditing is automated via `scripts/perf_audit.mjs` using Playwright and Chrome DevTools Protocol (CDP).

### Emulated Profiles

1. Desktop:
   - Viewport: 1600 by 900 px
   - Device pixel ratio: 1.0
   - Network and CPU: unthrottled local connection

2. Mobile Standard:
   - Device: Emulated modern mid-range smartphone (iPhone 14 / Pixel standard profile)
   - Viewport: 390 by 844 px
   - Device pixel ratio: 3.0
   - Network throttling: 1.6 Mbps download, 750 kbps upload, 150 ms round-trip time
   - CPU throttling: 4x CPU slowdown

3. Mobile Compact:
   - Device: Compact smartphone profile
   - Viewport: 360 by 740 px
   - Device pixel ratio: 2.0
   - Network throttling: 1.6 Mbps download, 750 kbps upload, 150 ms round-trip time
   - CPU throttling: 4x CPU slowdown

## 2. Metrics Captured

1. Wire Transfer and Caching:
   - Initial wire transfer bytes via CDP loadingFinished events
   - Repeat visit transfer bytes to verify browser caching and 304 Not Modified responses
   - Total HTTP request count at initial load and reload

2. Core Web Vitals:
   - First Contentful Paint (FCP) via PerformanceObserver
   - Largest Contentful Paint (LCP) via PerformanceObserver
   - Cumulative Layout Shift (CLS) via PerformanceObserver
   - Total Blocking Time (TBT) summing task durations exceeding 50 ms

3. Battery and CPU Drain:
   - Idle animation callbacks per second: requestAnimationFrame invocations during 4 seconds of stillness
   - Hidden tab animation callbacks per second: requestAnimationFrame invocations when document.hidden is true

4. Mobile Layout and Touch Audit:
   - Count of interactive elements smaller than 44 by 44 px
   - Count of text elements with computed font size below 12 px
   - Detection of unexpected horizontal page scrolling

5. WebGL 3D Inspector:
   - Time to first 3D frame upon switching to Setu Twin view
   - Three.js draw calls, triangles, lines, textures, and geometry memory allocations

## 3. Limits and Constraints

1. Headless Chromium uses software WebGL (SwiftShader) in sandboxed and CI environments. GPU frame times in headless testing reflect CPU-emulated rasterization, not dedicated mobile silicon.
2. Synthetic throttling simulates network bandwidth limits and CPU constraints reproducibly. Verification on physical hardware devices is required for tactile confirmation.
3. CI numbers serve as automated regression controls to prevent bloat.

## 4. Hardware Verification Checklist

Test on a physical mid-range phone (such as Pixel 6a or Samsung Galaxy A54) over cellular or throttled Wi-Fi:
- Initial page load displays topology map and metrics within 2.5 seconds.
- Panning and zooming on the 2D topology canvas feels direct and responsive.
- Switching to Setu Twin 3D view renders smoothly at 30 fps or higher.
- Idle battery usage shows zero active rendering loops when the app sits idle.
- Timeline scrubber dragging updates without stuttering or dropped frames.

