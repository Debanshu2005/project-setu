# Production Error Resolution: Custom Simulation "Cannot read properties of undefined (reading 'toUpperCase')"

**Repository:** `Debanshu2005/project-setu`  
**Target:** Project Setu Operations Dashboard & LoRa Mesh Simulator  
**Date:** October 2026  
**Status:** Resolved & Verified (81 Regression Tests Passing, 416 Total Assertions Passing)

---

## 1. Executive Summary

An unhandled exception was reported on the Project Setu production operations dashboard when launching custom simulations from the operator modal:
```text
Custom simulation failed: Cannot read properties of undefined (reading 'toUpperCase')
```

This caused custom simulation playback to crash, left the dashboard UI in an unresponsive "simulating" state, and prevented operators from inspecting nodes or executing interactive scenarios.

This document details the exact execution failure path, the root cause in the simulator I/O and data contract, the comprehensive fix applied across the API and frontend components, and the regression test suite added to prevent any recurrence.

---

## 2. Root Cause & Failure Path Analysis

### 2.1 The Execution Path
When an operator clicks "Run Custom Simulation" in the UI:
1. **Modal Submission (`dashboard/src/app.js`):**  
   `executeCustomSimulation()` collects parameters (`survivors`, `relays`, `seed`, `sf`, `loss`, `path_exp`) and calls `SetuApi.runSimulation(payload)`.
2. **Backend Job Execution (`dashboard/server.js`):**  
   The HTTP endpoint `POST /api/simulate` forwards parameters to `jobManager.createJob(...)`.  
   `executeJob()` spawns the C++ native simulator binary `setu_sim.exe`.
3. **Trace Stream Collision in Server:**  
   Prior to this fix, `executeJob()` spawned `setu_sim` with `--trace job.traceFilePath` while simultaneously opening `job.writeStream = fs.createWriteStream(job.traceFilePath, { flags: 'w' })`.  
   When `setu_sim` ran, it wrote the trace to `job.traceFilePath` directly, and printed the summary JSON to `stdout`. Node.js was listening on `child.stdout.on('data')` and writing those lines into `job.writeStream`, which clobbered byte 0 of `job.traceFilePath`, truncating/corrupting the `node_init` events at the start of the trace file (e.g. corrupt lines like `e":"survivor","x":727.459...`).
4. **Client Trace Ingestion (`dashboard/src/simulation.js`):**  
   When the dashboard fetched the generated trace file via `SetuApi.fetchTrace(...)`, the corrupted lines were skipped, leaving initial nodes (such as Node 0 and Node 1) without a `node_init` record.
5. **Node Inspection & Unchecked Property Access:**  
   When `inspector.js` rendered Node 1:
   - Line 89 checked `if (n.role === 'survivor')` -> evaluated to `false` because `n.role` was `undefined`.
   - The execution branched into `else` (assumed to be a relay or hub).
   - Line 175 executed:
     ```javascript
     <span>${n.role.toUpperCase()} Node Controls (ID ${n.id})</span>
     ```
   - Invoking `.toUpperCase()` on `undefined` threw `TypeError: Cannot read properties of undefined (reading 'toUpperCase')`.
   - The unhandled exception crashed `executeCustomSimulation()`, caught at line 1481.
   - The status indicator was left in an error state without diagnostic stack traces, and buttons could become locked.

### 2.2 Latent Vulnerabilities Across Components
A full audit of the codebase revealed several additional unshielded calls to `.toUpperCase()`:
- `dashboard/components/inspector.js` line 175 (`n.role.toUpperCase()`)
- `dashboard/components/topology.js` line 195 (`node.role.toUpperCase()` inside `updateTooltip()`)
- `dashboard/components/console.js` line 469 (`p.role.toUpperCase()` inside `populatePeerNodes()`)
- `dashboard/components/console.js` line 217 (`status.toUpperCase()`)
- `dashboard/components/console.js` line 247 (`kind.toUpperCase()`)
- `dashboard/components/charts.js` line 69 (`metrics.session.mode.toUpperCase()`)
- `dashboard/components/charts.js` line 191 (`def.category.toUpperCase()`)
- `dashboard/components/timeline.js` line 302 (`ev.ev.toUpperCase()`) and line 366 (`ev.toUpperCase()`)
- `dashboard/components/node_health.js` line 103 (silently assigned `SURVIVOR` fallback if role was missing, misrepresenting nodes).

---

## 3. Implementation of the Fix

### 3.1 Resolving the File Stream Collision in `server.js`
In [dashboard/server.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/server.js):
- Changed simulator argument from `--trace job.traceFilePath` to `--trace -` (stdout stream).
- Piped trace events (`parsed && parsed.ev`) cleanly through `job.writeStream` to disk and broadcast them over SSE without file contention.
- Ensured summary JSON is parsed separately from stdout buffer via regex match `match(/\{[\s\S]*"totals"[\s\S]*\}/)`.
- Validated and normalized `role` on all `node_init` events at the server boundary before writing to disk or broadcasting.

### 3.2 Formal Data Contract & Normalization in `simulation.js`
In [dashboard/src/simulation.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/src/simulation.js):
Implemented and exported the canonical role normalization function:
```javascript
export function normalizeRole(role, nodeId = null) {
  if (role === null || role === undefined) {
    if (nodeId === 0 || nodeId === '0') return 'hub';
    return 'unknown';
  }
  const str = String(role).trim().toLowerCase();
  if (!str) {
    if (nodeId === 0 || nodeId === '0') return 'hub';
    return 'unknown';
  }
  if (str === 'hub' || str === 'rescue_hub' || str === 'command_center') return 'hub';
  if (str === 'relay' || str === 'lora_relay' || str === 'tower') return 'relay';
  if (str === 'survivor' || str === 'victim' || str === 'wristband') return 'survivor';
  return str;
}
```
**Key guarantees:**
1. **Never returns null or undefined**: Always returns a trimmed lowercase string.
2. **No silent misrepresentation**: If a node ID is not 0 (Hub) and its role is unspecified, it is assigned `'unknown'`, not arbitrarily converted to `'survivor'`.
3. **Trace boundary assurance**: In `loadTrace()`, all events referencing node IDs ensure the corresponding node record exists with a normalized role, followed by a final validation pass over all nodes.

### 3.3 Safe UI Rendering Fallbacks Across Components
1. **[dashboard/components/inspector.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/components/inspector.js):**
   - Normalized `role` safely before inspection:
     ```javascript
     const rawRole = (n && n.role !== undefined && n.role !== null) ? String(n.role).trim().toLowerCase() : (n && n.id === 0 ? 'hub' : 'unknown');
     const role = (rawRole === 'hub' || rawRole === 'relay' || rawRole === 'survivor') ? rawRole : (rawRole || 'unknown');
     ```
   - Replaced direct unchecked `n.role.toUpperCase()` with `role.toUpperCase()`.
   - Added a safe fallback diagnostic controls card for nodes with `'unknown'` role so the inspector renders cleanly without throwing or crashing.

2. **[dashboard/components/topology.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/components/topology.js):**
   - Guarded `updateTooltip` with `(node && node.role ? String(node.role) : (node && node.id === 0 ? 'hub' : 'unknown')).toUpperCase()`.
   - Added safe rendering in `drawNode` for custom/unknown roles (distinct neutral slate shape `#64748b` with light outline `#cbd5e1`).
   - Safely evaluated filters in `matchesFilter(node)`.

3. **[dashboard/components/console.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/components/console.js):**
   - Guarded peer node dropdown role rendering: `(p && p.role ? String(p.role) : (p && p.id === 0 ? 'hub' : 'unknown')).toUpperCase()`.
   - Guarded target role indicator: `(node.role ? String(node.role) : (node.id === 0 ? 'hub' : 'unknown')).toUpperCase()`.
   - Added an "Other Nodes" optgroup for unknown/custom nodes in `populateNodes()`.
   - Defensively guarded element lookups and event binding in `bindEvents()`.

4. **[dashboard/components/node_health.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/components/node_health.js):**
   - Replaced arbitrary fallback `node.role ? node.role.toUpperCase() : 'SURVIVOR'` with safe contract normalization (`'UNKNOWN'` if non-hub).

5. **[dashboard/components/charts.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/components/charts.js) & [dashboard/components/timeline.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/components/timeline.js):**
   - Guarded all string properties (`session.mode`, `def.category`, `ev.ev`, `ev`) with `String(...)` before calling `.toUpperCase()`.

### 3.4 Robust Error Reporting & Button State Restoration
In [dashboard/src/app.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/src/app.js):
- In `executeCustomSimulation()`:
  - Saved execute button text and disabled both modal and header buttons upon launch.
  - Added strict validation checking that `events` is a non-empty array before calling `loadTrace()`, throwing a descriptive error if the simulator output is empty or broken.
  - Added full `console.error('[Setu Custom Sim] Execution failed:', err)` to ensure stack traces are visible in the browser developer console.
  - Placed button re-enabling (`disabled = false`) and status indicator cleanup (`classList.remove('simulating')`) in a guaranteed `finally` block so the UI is never left locked.
- Applied identical safeguards to `runScenarioLive(sc)`.

---

## 4. Verification & Regression Testing

A dedicated automated test suite was created in [tests/test_custom_simulation.mjs](file:///d:/CityGrid/my-project/project-setu/project-setu/tests/test_custom_simulation.mjs), containing 81 assertions covering all failure modes:

| Test Case | Description | Result |
| :--- | :--- | :---: |
| **Data Contract** | `normalizeRole` with canonical roles, casing, aliases, undefined, null, empty strings, and custom roles | **PASS** |
| **Normal Simulation** | Custom simulation execution, trace retrieval, event parsing, node_init validation, SimulationEngine state | **PASS** |
| **Missing Role (Bug Repro)** | Node with `role: undefined` inspected, hovered, drawn in topology, and populated in console without throwing | **PASS** |
| **Unexpected Role** | Node with role `'DRONE_RECON'` rendered safely with fallback controls and neutral slate shape | **PASS** |
| **Malformed / Empty Trace** | Corrupted JSONL line recovery, undeclared node resolution, diagnostic error on empty trace | **PASS** |
| **Simulation Failure** | Controlled API error response when simulation fails, UI responsiveness maintained | **PASS** |
| **Sequential Simulations** | Simulation 1 (Seed 11) followed by Simulation 2 (Seed 22) on same engine: clean reset, no state leaks | **PASS** |

### Complete Test Results
All test suites across the repository were executed and passed cleanly:
```bash
npm test
```
- `tests/test_custom_simulation.mjs`: **81 passed, 0 failed**
- `tests/test_reliability.mjs`: **41 passed, 0 failed**
- `tests/test_backend.mjs`: **153 passed, 0 failed**
- `tests/test_analytics.mjs`: **141 passed, 0 failed**
- **CTest Suite (`ctest --test-dir build -C Release`)**: **2/2 passed (unit & integration, 100% success)**

Total: **416 passed, 0 failed**.
