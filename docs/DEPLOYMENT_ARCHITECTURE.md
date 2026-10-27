# Project Setu: Cloud Deployment Architecture & Zero-Budget Strategy

**Document Version:** 2.0.0  
**Date:** October 27, 2026  
**Status:** Zero-Budget Architecture Evaluation & Multi-Tier Deployment Plan

---

## 1. Zero-Budget Hosting Platform Evaluation Matrix

Under the explicit mandate to **avoid mandatory hosting expenses ($0.00/month)**, we evaluated cloud hosting architectures against Project Setu's computational, networking, and memory demands:

| Evaluation Criterion | **Vercel** (Frontend) | **Render Free** (Active Backend) | **Hugging Face / Koyeb** (Alt Free) | **Local + Cloudflare** (Zero-Cost Hybrid) | **Fly.io / Railway** (Paid Upgrade Only) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Role in Setu** | **Dashboard & Assets** | **Backend API & Simulator** | **Alternative Free Backend** | **High-Performance Worker** | *Optional Future Paid Tier* |
| **Execution Model** | Serverless Edge CDN | Container Web Service | Docker Space / Container | Native Host Process | Micro-VM / Container |
| **Mandatory Monthly Cost** | **$0.00** (Free Hobby) | **$0.00** (750 free hrs/mo) | **$0.00** (Community Free) | **$0.00** (Zero Cost) | **$3.50 – $7.00+ / month** |
| **Credit Card Required?** | **No** | **No** | **No** | **No** | **Yes (Mandatory signup)** |
| **Permanent Free Tier?** | **Yes** | **Yes** | **Yes** | **Yes (Self-hosted)** | **No (Trial/Credit only)** |
| **Cold Starts** | Zero (Global CDN Edge) | 45 – 75s (after 15m idle) | 60 – 90s (after 48h idle) | **Zero (Instant response)** | None (Always-on) |
| **CPU Allocation** | Shared edge burst | 0.1 shared vCPU | 2.0 vCPU (HF Spaces) | **Full Host CPU (4–16 cores)** | 1.0 shared vCPU |
| **Memory Allocation** | 1024 MB per invocation | 512 MB hard ceiling | 16 GB (HF Spaces) | **Full Host RAM (8–64 GB)** | 1024 MB – 2048 MB |
| **Long-Running Simulations** | ❌ 10s timeout limit | ✅ Supported (Asynch job) | ✅ Supported | ✅ **Unthrottled multi-core** | ✅ Supported |
| **Streaming (SSE / WebSockets)** | ⚠️ Limited / buffered | ✅ Supported (when awake) | ✅ Supported | ✅ **Low-latency native TCP** | ✅ Supported |
| **Persistent Storage** | ❌ Ephemeral | Ephemeral (disk index) | Ephemeral | **Local SSD / NVMe** | Paid NVMe Volumes |
| **Primary Verdict** | **Retain for Frontend** | **Active Zero-Cost Cloud** | **Viable Alternative** | **Recommended for Heavy Runs** | **Paywalled (Non-zero cost)** |

---

## 2. Platform Realities & Zero-Budget Strategy

### 2.1. Frontend: Vercel Free Tier ($0.00/mo)
- **Role**: Serves the user dashboard at `https://project-setu.vercel.app`.
- **Verdict**: **Retained**. Instant global asset delivery, zero cold starts for static files, and seamless preview deployments at zero cost.

### 2.2. Cloud Backend: Render Free Tier ($0.00/mo)
- **Role**: Primary cloud API and simulation engine at `https://project-setu-backend.onrender.com`.
- **Inactivity Handling**: Wakes from 15-minute idle sleep via client-side progressive retries (`SetuApi.pingBackendWithColdStartRetry`).
- **Verdict**: **Retained as default free cloud backend**. Engineered with asynchronous job queues, 512 MB memory guards, and disk streaming.

### 2.3. Zero-Cost Hybrid: Local Node + Cloudflare Tunnel ($0.00/mo)
- **Role**: Provides workstation-class simulation compute with **zero cold starts, unlimited RAM, and multi-core C++ execution**.
- **Operation**: Operator runs `node dashboard/server.js` locally. For remote access, an encrypted HTTPS tunnel is launched via `cloudflared tunnel --url http://localhost:3000`.
- **Verdict**: **Recommended for heavy scenario sweeps and multi-node stress tests**.

### 2.4. Paid Platforms: Fly.io & Railway Status
- **Reality Check**: Live audit confirms that neither Fly.io nor Railway provides an indefinite free tier without a credit card. Both enforce payment methods and transition to billable tiers after trial exhaustion.
- **Verdict**: Available as optional, reversible future upgrades if the project ever provisions a cloud budget, but **strictly excluded from mandatory architecture**.

---

## 3. Decoupled Multi-Tier Architecture

```
+------------------------------------------------------------------------------------+
|                                OPERATOR BROWSER                                    |
|   https://project-setu.vercel.app  (or local dashboard)                            |
+------------------------------------------------------------------------------------+
              |                                                   |
              | 1. Static Assets & App JS (CDN)                   | 2. API & SSE Streams
              v                                                   v
+-----------------------------+               +--------------------------------------+
|       VERCEL EDGE CDN       |               |       BACKEND GATEWAY / WORKER       |
|                             |               |   (Render Free / Local Hybrid)       |
| - index.html                |               | [PORT 3000 / 10000 / HTTPS]          |
| - dashboard/src/*.js        |               |   - REST API & CORS Router           |
| - styles/*.css              |               |   - Liveness Probe (/health/liveness)|
| - api/config.js (config svc)|               |   - Readiness Probe (/health/readiness)|
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
                               | - Memory Guard (380 MB RSS) |       | - Throttled 100ms Step Rate |
                               | - Wall-Clock Timeout (60s)  |       | - Non-blocking I/O Pipes    |
                               | - Persistent jobs_index.json|       | - Recovery on container wake|
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
                                              |    STREAMED TRACE DISK LOGGING       |
                                              |  scenarios/traces/job_<id>.jsonl     |
                                              +--------------------------------------+
```

---

## 4. Architectural Boundaries & Resilience

### 4.1. Frontend Tier (Vercel)
- Fully decoupled from the backend lifecycle.
- Tolerates backend cold starts without throwing false timeout errors:
  - Uses `SetuApi.pingBackendWithColdStartRetry()` with up to 16 progressive polling attempts (~75-90s).
  - Displays dynamic status messages: `"WAKING UP FREE BACKEND... (Attempt X/16, ~45-70s elapsed)"`.
  - Operator can switch backend target at any time via the built-in modal (⚡ Backend).

### 4.2. API Gateway & Job Manager (Node.js)
- Pure asynchronous I/O. Incoming HTTP requests are never blocked by C++ computations.
- `POST /api/jobs` validates parameters and immediately returns **HTTP 202 Accepted** with `jobId`, `pollUrl`, and `eventsUrl` in <10ms.
- Server-Sent Events (SSE) provide live updates with sequence numbers, allowing automatic client reconnection without losing state.
- Bounded queue (max 5 queued jobs, returns HTTP 429 Too Many Requests on overflow).

### 4.3. Simulation Worker & Concurrency Pool
- Native C++ processes (`setu_sim`) are spawned as isolated child processes under a supervised worker pool.
- Concurrency is capped (`MAX_CONCURRENT_SIMS = 2`) to prevent CPU thrashing on shared 0.1 vCPU slices.
- Hard wall-clock timeouts (default: 60 seconds) terminate runaway processes automatically.

### 4.4. Persistence & State Recovery Layer
- Completed experiments and job statuses are tracked in `scenarios/traces/jobs_index.json`.
- Output traces are streamed directly to disk via `fs.createWriteStream`, bypassing process memory.
- If a free container spins down or restarts during an active run, `loadIndex()` marks the previous job as `status: 'interrupted'`, preserving completed history while gracefully resetting the queue.
