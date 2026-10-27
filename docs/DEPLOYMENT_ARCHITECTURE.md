# Project Setu: Cloud Deployment Architecture & Hosting Migration Analysis

**Document Version:** 1.0.0  
**Date:** October 27, 2026  
**Status:** Architecture Recommendation & Technical Evaluation

---

## 1. Hosting Platform Evaluation Matrix

We evaluated four candidate cloud hosting architectures against the specific computational, networking, and memory demands of Project Setu:

| Evaluation Criterion | **Vercel** (Frontend / Edge) | **Render (Paid Starter)** | **Railway (Hobby/Pro)** | **Fly.io (Shared-CPU Micro-VM)** *(Recommended)* |
| :--- | :--- | :--- | :--- | :--- |
| **Role in Setu** | **Dashboard & Assets** | Backend API & Simulation | Backend API & Simulation | **Backend API & Simulation** |
| **Execution Model** | Serverless Edge Lambdas | Long-running Container | Long-running Container | **Long-running Micro-VM (Firecracker)** |
| **Cold Starts** | Zero (Global CDN Edge) | None (Always-on) | None (Always-on) | **None (`auto_stop_machines = false`)** |
| **CPU Allocation** | Shared serverless burst | 0.5 shared vCPU | Shared vCPU (unthrottled) | **1.0 vCPU (shared or dedicated)** |
| **Memory Allocation** | 1024 MB per execution | 512 MB – 1 GB | Up to 8 GB (usage-based) | **1024 MB – 2048 MB (configurable)** |
| **Long-Running Simulations** | ❌ Hard 10s–60s execution limit | ✅ Supported | ✅ Supported | ✅ **Supported (no timeout limit)** |
| **Streaming (SSE / WebSockets)** | ⚠️ Limited / buffered on edge | ✅ Supported | ✅ Supported | ✅ **Native TCP / HTTP streaming** |
| **Persistent Storage** | ❌ Ephemeral only | ⚠️ Persistent disk ($0.25/GB/mo) | ⚠️ Ephemeral by default (volumes opt-in) | ✅ **Native NVMe Persistent Volumes (`fly volumes`)** |
| **Deployment Mechanism** | Git push / CLI | Docker / Git | Docker / Git | **Docker via `fly.toml` & `flyctl`** |
| **Live Log Streaming** | Edge runtime logs | Web dashboard log stream | Interactive CLI & UI log stream | **Real-time CLI (`fly logs`) & Grafana metrics** |
| **Expected Monthly Cost** | **$0.00** (Hobby plan) | **$7.00 / mo** (Starter 512MB) | **$5.00 / mo** (Usage-based) | **$3.19 – $5.70 / mo** (1GB RAM + 3GB Volume) |

---

## 2. Comparative Platform Analysis

### 2.1. Option 1: Vercel (Recommended for Frontend Only)
- **Strengths**: Vercel currently hosts the Setu frontend dashboard at `https://project-setu.vercel.app`. It provides instant global CDN caching, zero cold-start latency for static web assets, and effortless preview deployments on pull requests.
- **Limitations**: Vercel serverless functions have a 10-second default timeout (max 60 seconds on Pro) and cannot host a persistent, interactive C++ process communicating over standard input/output pipes.
- **Verdict**: **Retain Vercel for the frontend user interface**. Do not attempt to run the native simulation engine inside Vercel serverless functions.

### 2.2. Option 2: Render Paid Plan (Starter Tier — $7/mo)
- **Strengths**: Upgrading the existing Render service from `free` to `starter` eliminates the 15-minute idle spin-down and cold-start wake-up lag. It preserves the existing deployment URL (`https://project-setu-backend.onrender.com`).
- **Limitations**: The $7/mo Starter tier only allocates 512 MB of RAM and shared 0.5 vCPU. To safely run multiple concurrent simulations and avoid OOM crashes, an upgrade to the Standard tier ($25/mo for 2 GB RAM) is required. Disk persistence requires an additional paid volume add-on.
- **Verdict**: Viable as a zero-configuration fallback, but higher cost-to-performance ratio than modern alternatives.

### 2.3. Option 3: Railway (Turnkey Alternative — $5/mo base)
- **Strengths**: Railway offers an excellent developer experience, automatic Dockerfile detection, no idle sleep, generous memory ceilings (up to 8 GB on Pro), and seamless WebSocket/SSE streaming. Pricing is usage-based ($5/mo platform fee + per-minute resource consumption).
- **Limitations**: Metrics and observability are less granular than dedicated VM platforms; CPU allocation is variable under heavy noisy-neighbor conditions.
- **Verdict**: High-quality secondary choice if the team prefers an entirely managed UI-based workflow.

### 2.4. Option 4: Fly.io (Primary Recommendation — ~$3.50 to $5.50/mo)
- **Strengths**:
  1. **Direct Compute**: Runs your existing Docker image directly inside lightweight, isolated **Firecracker micro-VMs**.
  2. **Dedicated Headroom**: Easily configured with **1024 MB or 2048 MB RAM** and 1 full vCPU, completely preventing OOM crashes during large scenario executions.
  3. **No Spin-Down**: Configuring `auto_stop_machines = false` guarantees the backend is always awake and listening.
  4. **Native Persistent Storage**: Single-command NVMe volume creation (`fly volumes create setu_traces --size 3`) permanently stores experiment trace logs across restarts.
  5. **Cost Effectiveness**: 1 shared CPU with 1024 MB RAM costs ~$3.19/month; 3 GB persistent storage is ~$0.45/month. Total cost is **under $4.00/month**.
  6. **Separate Health Checking**: Supports explicit `http_checks` with separate liveness and readiness paths.
- **Verdict**: **Selected as the primary target for the backend simulation engine**.

---

## 3. Selected Target Architecture

We implement a clean **decoupled architecture**:

```
+------------------------------------------------------------------------------------+
|                                OPERATOR BROWSER                                    |
|   https://project-setu.vercel.app  (or custom domain)                              |
+------------------------------------------------------------------------------------+
              |                                                   |
              | 1. Static Assets & App JS (CDN)                   | 2. API & SSE Streams
              v                                                   v
+-----------------------------+               +--------------------------------------+
|       VERCEL EDGE CDN       |               |        FLY.IO BACKEND MICRO-VM       |
|                             |               |                                      |
| - index.html                |               | [PORT 3000 / HTTPS Gateway]          |
| - dashboard/src/*.js        |               |   - REST API & CORS Router           |
| - styles/*.css              |               |   - Liveness Probe (/health/liveness)|
| - api/config.js (config svc)|               |   - Readiness Probe (/health/readiness|
+-----------------------------+               +--------------------------------------+
                                                                 |
                                              +------------------+------------------+
                                              |                                     |
                                              v                                     v
                               +-----------------------------+       +-----------------------------+
                               |    SIMULATION JOB MANAGER   |       |   INTERACTIVE TWIN MANAGER  |
                               |                             |       |                             |
                               | - Asynchronous Job Queue    |       | - Dedicated Active Session  |
                               | - Concurrency Limiter (<=2) |       | - Bounded Ring Buffer       |
                               | - Process Supervisor        |       | - Throttled 100ms Step Rate |
                               | - Wall-Clock Timeout (60s)  |       | - Non-blocking I/O Pipes    |
                               +-----------------------------+       +-----------------------------+
                                              |                                     |
                                              +------------------+------------------+
                                                                 |
                                                                 v
                                              +--------------------------------------+
                                              |     NATIVE C++ ENGINE (setu_sim)     |
                                              |                                      |
                                              | - Level 1: PlatformIO Target Parity  |
                                              | - Level 2: Shared FITL State Machine |
                                              | - Level 3: SX1262 LoRa RF & Sensors  |
                                              +--------------------------------------+
                                                                 |
                                                                 v
                                              +--------------------------------------+
                                              |    PERSISTENT VOLUME (/app/traces)   |
                                              |  3 GB NVMe Mount for JSONL Traces    |
                                              +--------------------------------------+
```

---

## 4. Architectural Boundaries

### 4.1. Frontend Tier (Vercel)
- Fully independent of the simulation engine. If the backend restarts or is temporarily offline, the frontend loads instantly, displays a descriptive connection status badge, and allows the operator to configure local parameters, view cached scenarios, or change the backend URL via the built-in modal.

### 4.2. API Gateway & Session Management (Node.js)
- Pure asynchronous I/O. Incoming HTTP requests are never blocked by C++ computations.
- Simulation requests return immediately with an allocated `jobId`.
- Server-Sent Events (SSE) provide live updates with sequence numbers, allowing automatic client reconnection without losing state.

### 4.3. Simulation Worker & Concurrency Pool
- Native C++ processes (`setu_sim`) are spawned as isolated child processes under a supervised worker pool.
- Concurrency is capped (default: 2 concurrent active simulations) to prevent CPU thrashing. Additional jobs are placed in a FIFO queue.
- Hard wall-clock timeouts (default: 60 seconds) terminate runaway processes automatically.

### 4.4. Persistent Volume Layer
- JSONL traces are streamed directly to `/app/scenarios/traces` using filesystem write streams, bypassing process memory.
