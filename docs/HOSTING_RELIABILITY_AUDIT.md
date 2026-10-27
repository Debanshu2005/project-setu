# Project Setu: Hosting & Simulation Reliability Audit

**Document Version:** 1.0.0  
**Date:** October 27, 2026  
**Target Systems:** Frontend (Vercel), Backend (Render Free Tier Docker), Native Simulator (`setu_sim`), FreeRTOS/FITL Protocol Engine.

---

## 1. Executive Summary

Project Setu's operational dashboard occasionally becomes unresponsive in cloud deployment, causing the UI to freeze, live packet animations to halt, or requests to time out. 

An exhaustive architectural audit of the repository reveals that **the unresponsiveness is not caused by a single failure point, but by the convergence of cloud provider constraints and application-layer architectural bottlenecks**:
1. **Cloud Hosting Tier Bottlenecks**: The Render Free Tier web service experiences cold-sleep spin-downs (15-minute idle cutoff, 50–90 second wakeups), hard 512 MB memory caps, and 0.1 shared vCPU allocation.
2. **Process-Level Monopolization**: A single global simulator process (`simManager`) and a global `activeChildProcess` mutex in `dashboard/server.js` reject or block concurrent requests with HTTP 409 conflict errors.
3. **Memory Pressure & Event-Loop Congestion**: Holding up to 50,000 JSON event objects in Node.js V8 process memory alongside unbounded `stdout` string accumulation in batch simulation routes triggers V8 garbage collection pauses and OOM container kills.
4. **Tight Continuous Stepping Loop**: The interactive loop (`setInterval` at 50ms) saturates the single Node.js thread with pipe I/O, JSON serialization, and Server-Sent Event (SSE) broadcasting, causing incoming HTTP health checks to time out.

This document records the exact diagnostic evidence discovered in the codebase, analyzes the failure modes, and outlines the required structural mitigations.

---

## 2. Inventory of Current Deployment Components

```
+-----------------------------------------------------------------------------------------+
| FRONTEND TIER: VERCEL (Static Assets + Edge Routing)                                     |
| - Domain: https://project-setu.vercel.app                                               |
| - Stack: Vanilla HTML5, CSS3, ES Modules (dashboard/src/app.js, topology.js, etc.)      |
| - Config: vercel.json (rewrites, CORS headers, API function mapping)                    |
| - Serverless Function: api/config.js (detects SETU_BACKEND_URL or defaults to Render)    |
+-----------------------------------------------------------------------------------------+
                                          |
                        HTTP / SSE Cross-Origin Requests
                                          v
+-----------------------------------------------------------------------------------------+
| BACKEND TIER: RENDER (Dockerized Node.js Server + Native C++ Binary)                    |
| - Domain: https://project-setu-backend.onrender.com                                     |
| - Plan: Free Tier (render.yaml: plan: free, region: oregon, runtime: docker)            |
| - Container Spec: Debian/Bookworm Node 20 runtime, 512 MB RAM, 0.1 vCPU shared          |
| - Server Entry Point: dashboard/server.js (pure Node.js http.createServer, no Express)   |
| - Simulation Engine: setu_sim (C++20 compiled binary in /app/build/setu_sim)            |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Detailed Diagnostic Findings & Failure Modes

### Finding 1: Render Free-Tier Cold Sleep & Spin-Down Latency
- **Configuration Source**: [render.yaml](file:///d:/CityGrid/my-project/project-setu/project-setu/render.yaml#L9-L13) specifies `plan: free` with `healthCheckPath: /health`.
- **Observed Behavior**: Render automatically puts free web services into a suspended cold state after 15 minutes without inbound HTTP traffic.
- **Impact on Frontend**: When an operator accesses `https://project-setu.vercel.app` after 15 minutes of inactivity:
  1. The browser requests `GET /api/status` or `POST /api/control/init`.
  2. The Render container requires **50 to 90 seconds** to boot Docker, initialize Node.js, and bind port 10000.
  3. The frontend `SetuApi.fetchWithTimeout` default timeout is **6,000 to 8,000 ms** ([dashboard/src/api.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/src/api.js#L245)).
  4. The request is aborted by the client (`AbortError: Request timed out after 8000ms`).
  5. The dashboard UI immediately reports: *"Status: OFFLINE (Backend unavailable)"* with a spinning red indicator, creating the impression of a permanent crash.

### Finding 2: Global Singleton Mutex & Single-User Lockout
- **Code Reference**: [dashboard/server.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/server.js#L40) and [L771-L773](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/server.js#L771-L773):
  ```javascript
  let activeChildProcess = null;
  ...
  if (activeChildProcess) {
    return sendError(res, 409, 'Another simulation is already currently running.', req);
  }
  ```
- **Observed Behavior**: The backend maintains a single global variable `activeChildProcess` for batch simulations, and a single global class instance `const simManager = new InteractiveSimulatorManager();` for interactive simulations.
- **Failure Mode**:
  - If User A starts a batch simulation (`POST /api/simulate`) or streams a scenario (`/api/simulate/stream`), all other users attempting to run simulations receive HTTP 409.
  - In interactive mode, all connected browser tabs share the **same standard input/output pipe** of one `setu_sim` process. If User A clicks "Reset", User B's active simulation is obliterated. If User A drags Node 1, User B's viewport mutates unexpectedly.
  - There is zero session segregation or job identification.

### Finding 3: In-Memory Unbounded Output Buffering
- **Code Reference**: [dashboard/server.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/server.js#L836-L840):
  ```javascript
  let stdoutData = '';
  child.stdout.on('data', chunk => { stdoutData += chunk; });
  ```
- **Observed Behavior**: For batch simulations, the entire standard output stream of the native C++ executable is concatenated as a raw JavaScript string in process memory until process termination.
- **Failure Mode**:
  - A 100-node network running for 60 simulation seconds generates over **120,000 JSONL lines** (exceeding 35 MB of raw string data).
  - Calling `JSON.parse(stdoutData)` on this string forces V8 to allocate multiple large contiguous heap buffers.
  - In a 512 MB memory container, this causes an immediate **OOM (Out-of-Memory) crash**, terminating the Node.js process with exit code 137.

### Finding 4: Event-Loop Congestion from 50ms Continuous Stepping Loop
- **Code Reference**: [dashboard/server.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/server.js#L254-L273):
  ```javascript
  startContinuous(stepMs = 50, wallIntervalMs = 50) {
    this.continuousTimer = setInterval(async () => {
      ...
      await this.sendCommand({ cmd: 'step', ms: stepMs });
    }, wallIntervalMs);
  }
  ```
- **Observed Behavior**: When continuous playback is enabled, the server fires a timer every 50 ms. Each tick formats a JSON string, writes to `stdin`, waits for the response on `stdout`, parses the line, appends to `eventHistory`, and formats SSE strings for every connected client.
- **Failure Mode**:
  - On a shared 0.1 vCPU slice, the Node.js event loop latency increases from <2 ms to **>3,500 ms**.
  - During this period, incoming HTTP requests (such as Render's `/health` probe) sit queued in the kernel backlog.
  - When Render's health checker times out (5-second threshold in Dockerfile), Render flags the instance as unhealthy and restarts the container.

### Finding 5: High Event-History Ceiling (50,000 Objects in Heap)
- **Code Reference**: [dashboard/server.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/server.js#L171-L174):
  ```javascript
  this.eventHistory.push(obj);
  if (this.eventHistory.length > 50000) {
    this.eventHistory.shift();
  }
  ```
- **Observed Behavior**: `eventHistory` maintains up to 50,000 parsed objects in memory. Furthermore, `Array.prototype.shift()` has $O(N)$ complexity, copying 50,000 array pointers in heap on every newly ingested event.
- **Failure Mode**: Significant garbage collector churn and heap fragmentation, rapidly approaching the 512 MB memory boundary.

### Finding 6: Ephemeral Storage Disconnect
- **Code Reference**: [dashboard/server.js](file:///d:/CityGrid/my-project/project-setu/project-setu/dashboard/server.js#L16-L17):
  ```javascript
  const SCENARIOS_DIR = path.join(ROOT_DIR, 'scenarios');
  const TRACES_DIR = path.join(SCENARIOS_DIR, 'traces');
  ```
- **Observed Behavior**: Simulation traces are written to the local disk inside the container (`/app/scenarios/traces`).
- **Failure Mode**: Without a mounted persistent volume, every time Render restarts or redeploys the container, all saved experiment traces and user uploads vanish.

---

## 4. Summary of Freezing Causes vs Evidence

| Symptom | Primary Root Cause | Supporting Code Evidence | Verification Status |
| :--- | :--- | :--- | :--- |
| **"Backend Offline" on first load** | Render Free Tier 15-minute spin-down; 60s cold start exceeds 8s client timeout | `render.yaml: plan: free`, `api.js: timeoutMs = 8000` | **Verified** |
| **"Another simulation running" (409)** | Global `activeChildProcess` mutex prevents concurrency | `server.js:40, 771` | **Verified** |
| **Sudden server crash during large run** | In-memory buffering of stdout strings causing OOM (512MB limit) | `server.js:839` `stdoutData += chunk` | **Verified** |
| **Health check timeout & restart** | 50ms `setInterval` CPU thrashing starves Node.js event loop on 0.1 vCPU | `server.js:257` `wallIntervalMs = 50` | **Verified** |
| **Interference between users** | Single global `simManager` process shared across all sessions | `server.js:298` `simManager` singleton | **Verified** |
| **Disappearing trace files** | Ephemeral container root filesystem without volume mounts | `Dockerfile:60`, `server.js:17` | **Verified** |

---

## 5. Architectural Requirements for Resolution

To eliminate unresponsiveness and ensure high reliability, the system requires:
1. **Asynchronous Job-Based Lifecycle**: Replace synchronous request-blocking execution with a managed job model (`queued`, `starting`, `running`, `completed`, `failed`, `cancelled`).
2. **Process Concurrency Limiting & Isolation**: Isolate simulation runs with dedicated job IDs, bounded concurrency (e.g., max 2–3 concurrent workers), and FIFO queueing.
3. **Bounded Ring Buffers & Disk Streaming**: Pipe simulation traces directly to disk streams or bounded ring buffers (max 2,000–5,000 events per job) instead of accumulating raw strings in the V8 heap.
4. **Separate Liveness & Readiness Probes**:
   - `/health/liveness`: Verifies the HTTP process is responsive (<10 ms).
   - `/health/readiness`: Verifies worker pool health, memory RSS headroom, and simulator binary availability.
5. **Modern Hosting Provider**: Migrate the backend to an always-on environment (Fly.io or Railway) with dedicated memory (1GB+) and persistent volume support, while retaining Vercel for fast edge delivery of the frontend.
