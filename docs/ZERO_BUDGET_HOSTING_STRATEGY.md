# Project Setu: Zero-Budget Hosting Strategy & Platform Evaluation

**Document Version:** 1.0.0  
**Date:** October 27, 2026  
**Constraint Mandate:** $0.00/month mandatory hosting budget. Preserve existing Render deployment while maximizing reliability and cold-start tolerance.

---

## 1. Executive Summary & Zero-Budget Mandate

Project Setu requires hosting for three interdependent layers:
1. **Frontend Dashboard UI**: Interactive topology visualizer, timeline inspector, node control panel, and analytics.
2. **Backend Gateway & API**: Node.js REST API, Server-Sent Events (SSE) packet streamer, scenario manager, and job scheduler.
3. **Simulation Worker**: Native C++ simulation executable (`setu_sim`) simulating ESP32 FreeRTOS tasks, SX1262 LoRa physical layers, and multi-hop flood routing.

### The Core Constraints
- **Strict Zero Budget**: Avoid all mandatory hosting fees ($0.00/month). No provisioning of paid tiers or paywalled resources.
- **Preserve Existing Deployment**: The currently active Render Free Tier backend (`https://project-setu-backend.onrender.com`) and Vercel Frontend (`https://project-setu.vercel.app`) must remain functional and reversible.
- **No Inactivity Policy Evasion**: Render and other free hosting providers strictly monitor synthetic traffic. Periodic ping bots or artificial cron pings to prevent sleep violate terms of service, trigger account suspensions, or get rate-limited.
- **Architectural Solution**: Rather than attempting to "cheat" provider sleep policies or paying for always-on resources, the application must be engineered to **tolerate legitimate cold starts gracefully**, decouple execution from request lifecycles, enforce memory bounds, and isolate failures.

---

## 2. Truth-in-Hosting: Verification of Cloud Free Tiers

Many cloud platforms historically advertised "free tiers" that have either been discontinued, altered to require credit cards, or converted to temporary promotional credits. The following evaluation documents verified platform policies as of late 2026:

### 2.1. The "Free Tier" Myth: Fly.io & Railway
- **Fly.io**:
  - *Current Status*: **No Permanent Free Tier**.
  - *Verification*: Fly.io discontinued its legacy free allowance in 2023. Currently, Fly.io requires a valid credit card during onboarding and grants only a temporary credit or 7-day trial. Organizations without active credit cards are blocked from provisioning machines. Leaving an app running accrues monthly charges against the registered credit card.
  - *Verdict*: **Not eligible under the zero-budget constraint**.
- **Railway**:
  - *Current Status*: **No Permanent Free Tier**.
  - *Verification*: Railway terminated its permanent $5/month free execution credit. New accounts receive a one-time 30-day trial credit ($5), after which the account is suspended unless converted to a paid Hobby ($5/mo platform fee + usage) or Pro plan with a credit card.
  - *Verdict*: **Not eligible under the zero-budget constraint**.

### 2.2. Verified Zero-Cost Platforms

| Platform | Permanent Free Tier? | Credit Card Required? | Idle Inactivity Sleep | Cold Start Latency | RAM Limit | CPU Allocation | Persistent Storage | SSE / WebSockets |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Vercel** (Frontend) | **Yes** (Hobby) | No | None (Global Edge CDN) | 0 ms | 1024 MB (Edge) | Shared serverless | None (Static) | ⚠️ Limited (Edge Lambdas) |
| **Render** (Backend) | **Yes** (Free) | No | **Yes (15 min idle)** | **45 – 75 s** | **512 MB** | **0.1 shared vCPU** | Ephemeral | ✅ Full (when awake) |
| **Hugging Face Spaces** | **Yes** (Community) | No | **Yes (48 hr idle)** | **60 – 120 s** | **16 GB** | **2 vCPU** | Ephemeral | ✅ Full (when awake) |
| **Koyeb** | **Yes** (Eco Free) | No | **Yes (inactivity)** | **30 – 60 s** | **512 MB** | **0.1 vCPU** | Ephemeral | ✅ Full (when awake) |
| **Oracle Cloud (OCI)** | **Yes** (Always Free) | Yes (Identity check only) | **None (Always On)** | **0 ms** | **Up to 24 GB** | **Up to 4 Ampere cores** | **200 GB Block** | ✅ Full |
| **Local + Cloudflare** | **Yes** (Zero Cost) | No | **None (Local machine)** | **0 ms** | **Host RAM (8–64GB)** | **Host CPU (4–16 cores)** | **Host SSD/NVMe** | ✅ Full |

---

## 3. Platform Capabilities & Trade-Offs

### 3.1. Render Free Tier (Current Baseline)
- **Monthly Allowance**: 750 free instance hours per month. For a single web service, 750 hours is sufficient to run 24/7 for an entire month without running out of hours.
- **Inactivity Behavior**: Shuts down container after 15 minutes of zero incoming HTTP requests.
- **Cold Start Latency**: 45 to 75 seconds from initial TCP request to port listening.
- **Resource Limits**: 512 MB RAM, 0.1 shared vCPU. Exceeding 512 MB triggers immediate SIGKILL (exit code 137).
- **Background Processes**: Free tier does not support standalone background worker services ($7/mo). Background tasks must be spawned as child processes of the web server while handling incoming requests.
- **Storage**: Ephemeral root filesystem. Wiped on container spin-down or redeployment.

### 3.2. Hugging Face Spaces (Docker Engine Alternative)
- **Monthly Allowance**: Unlimited execution for public Spaces.
- **Inactivity Behavior**: Sleeps after **48 hours** of inactivity (substantially better than Render's 15 minutes).
- **Resource Limits**: **16 GB RAM and 2 dedicated vCPUs** on the free tier. This provides 32x the memory of Render and eliminates CPU throttling for native C++ compilation and execution.
- **Trade-Off**: Designed primarily for ML/data apps; interface is typically wrapped in an `iframe`. However, direct HTTP API access is fully supported via `https://<space-name>.hf.space`.

### 3.3. Koyeb Free Tier
- **Monthly Allowance**: 1 Eco-Nano service ($0.00/month).
- **Inactivity Behavior**: Automated sleep on idle; wakes automatically on HTTP traffic.
- **Resource Limits**: 512 MB RAM, 0.1 vCPU, 2.5 GB bandwidth.
- **Advantage**: Fast wakeups (~30-45s) with automated TLS certificates.

### 3.4. Oracle Cloud Always Free (OCI)
- **Monthly Allowance**: Completely free compute up to 4 Arm Ampere A1 cores and 24 GB RAM.
- **Inactivity Behavior**: **Never sleeps**. Real 24/7 compute.
- **Persistent Storage**: 200 GB persistent block volume storage included.
- **Trade-Off**: Requires credit card validation during registration (fraud prevention, though never billed); Arm architecture requires cross-compilation or building inside the Arm instance; setup requires manual Linux server administration via SSH.

---

## 4. Application Architectural Changes Implemented

To make Project Setu thrive on free hosting tiers, the application was re-architected across four dimensions:

### 4.1. Decoupled Asynchronous Job Execution (Prompt API Returns)
Simulations are never run synchronously inside HTTP request handlers. When a simulation is launched:
1. Client issues `POST /api/jobs` with scenario parameters.
2. Server validates parameters, instantiates a `SimulationJob`, registers it in the `SimulationJobManager`, and immediately returns **HTTP 202 Accepted** in **<10 ms** with `jobId`, `pollUrl`, and `eventsUrl`.
3. Client tracks progress asynchronously via polling `GET /api/jobs/:id` or subscribing to dedicated SSE stream `GET /api/jobs/:id/events`.
4. Result endpoints (`GET /api/jobs/:id/results`) return completed summaries without blocking.

### 4.2. Bounded Concurrency, Queuing & Resource Guards
To prevent container OOM crashes under 512 MB RAM:
- **Worker Concurrency Limit**: Maximum 2 concurrent worker processes (`MAX_CONCURRENT_SIMS = 2`).
- **Bounded Queue**: Maximum 5 queued simulation jobs (`MAX_QUEUE_SIZE = 5`). Submitting beyond 5 returns **HTTP 429 Too Many Requests** with clear queue capacity indicators.
- **Memory RSS Pre-Spawn Guard**: Before spawning a child simulation process, the server inspects `process.memoryUsage().rss`. If RSS exceeds 380 MB (~75% of the 512 MB container ceiling), job execution is deferred until GC or active jobs finish.
- **Process Cancellation Watchdog**: `POST /api/jobs/:id/cancel` issues `SIGTERM` followed by a 3-second `SIGKILL` unref watchdog, terminating runaway processes immediately.
- **Wall-Clock Timeout**: Every job has a 60-second watchdog timer preventing deadlocked simulations from hanging the container.

### 4.3. Zero-Memory Disk Streaming & Event Ring Buffers
- Output from `setu_sim` is piped directly to a file write stream (`fs.createWriteStream`) on disk (`scenarios/traces/job_<id>.jsonl`).
- Node.js V8 heap buffers are never bloated with megabytes of JSON lines.
- Live streaming SSE events are retained in a bounded ring buffer of 2,000 events max per job.

### 4.4. Legitimate Cold-Start Tolerance (No Ping Bots)
Rather than evading sleep with artificial ping bots:
- The frontend client implements progressive retry logic (`SetuApi.pingBackendWithColdStartRetry`).
- When accessing the dashboard during a container cold start:
  - The UI updates status to: `"WAKING UP FREE BACKEND... (Attempt X/16, ~45-70s elapsed)"`.
  - The client makes non-blocking health checks every 2 seconds with 5-second timeouts.
  - As soon as the container finishes booting, the UI instantly flips to green `"ONLINE"` and loads scenario data.

---

## 5. Persistence & State Recovery Across Service Restarts

Free cloud containers experience regular restarts due to idle spin-down, platform maintenance, or Git redeployments. Here is the exact behavior and persistence model:

### 5.1. Persistent Job Index (`scenarios/traces/jobs_index.json`)
The `SimulationJobManager` maintains a persistent disk-backed index file. On every job lifecycle change (creation, start, completion, failure, cancellation), the index is serialized to disk.

### 5.2. What Happens When a Free Service Restarts
1. **Running or Queued Jobs**:
   - If the container is suspended or restarted while a simulation job is `running` or `queued`, the OS process tree is terminated.
   - Upon container boot, `SimulationJobManager.loadIndex()` reads `jobs_index.json`.
   - Any job previously recorded in `running`, `starting`, or `queued` state is automatically marked as **`status: 'interrupted'`** with error diagnostic:  
     `"Job interrupted by container restart / cold sleep"`.
   - The job is never left in an inconsistent "infinite running" state.
2. **Completed Jobs**:
   - Completed job records (summary statistics, duration, node counts, delivery totals) remain fully intact in `jobs_index.json`.
   - The UI lists historical runs via `GET /api/jobs`.
3. **Trace Files**:
   - Piped trace files (`scenarios/traces/job_<id>.jsonl`) remain available across sleep/wake cycles within the same container lifecycle.
   - Note on redeployments: A fresh `git push` or container redeploy recreates the root filesystem on Render Free, clearing previous trace logs. To preserve traces permanently at zero cost, download completed traces using the Dashboard's **Export Trace** button.

---

## 6. Zero-Cost Hybrid Architecture (Recommended)

To achieve the best balance of zero cost, zero cold-start delay, and maximum simulation throughput, Project Setu supports a **Zero-Cost Hybrid Architecture**:

```
+-----------------------------------------------------------------------------------------+
| ARCHITECTURE TIER 1: GLOBAL EDGE FRONTEND (Vercel Free Tier - $0.00/mo)                 |
| - URL: https://project-setu.vercel.app                                                  |
| - Fast worldwide static asset delivery via edge CDN (0ms cold start)                    |
| - Dynamic backend configuration via Settings Modal (⚡ Backend)                          |
+-----------------------------------------------------------------------------------------+
                                          |
                +-------------------------+-------------------------+
                |                                                   |
                v                                                   v
+---------------------------------------+   +---------------------------------------------+
| OPTION A: CLOUD FREE BACKEND          |   | OPTION B: LOCAL HYBRID ENGINE               |
| (Render Free / Koyeb / HF Spaces)     |   | (Cloudflare Tunnel + Local Node - $0.00/mo) |
| - $0.00/month                         |   | - $0.00/month                               |
| - 512 MB – 16 GB RAM                  |   | - 16–64 GB RAM, 8–16 CPU cores              |
| - Tolerates 45-75s cold start         |   | - ZERO COLD START (Instant execution)       |
| - Handled by progressive UI retries   |   | - Runs on operator workstation/laptop       |
| - Good for public demos & sharing     |   | - Encrypted HTTPS tunnel via cloudflared    |
+---------------------------------------+   +---------------------------------------------+
```

### How to Run the Zero-Cost Hybrid Engine:
1. Start the backend locally on your computer:
   ```bash
   node dashboard/server.js
   ```
2. (Optional) Expose it securely to the internet over encrypted HTTPS using Cloudflare's free tunnel (no port forwarding or static IP needed):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Open `https://project-setu.vercel.app`, click **⚡ Backend**, paste your tunnel URL (or `http://localhost:3000`), and click **Save & Reconnect**.
4. You now have an unlimited, unthrottled simulation engine with 0s cold start and zero hosting costs.

---

## 7. Comparative Feature Matrix: Free vs Paid Hosting

| Capability / Feature | **Zero-Budget Tier (Current)** | **Paid Cloud Tier ($5–$15/mo)** |
| :--- | :--- | :--- |
| **SOS Generation & Packet Flow Simulation** | ✅ 100% Functional | ✅ 100% Functional |
| **SX1262 LoRa PHY & RF Path Loss Model** | ✅ 100% Functional | ✅ 100% Functional |
| **Decoupled Asynchronous Simulation Jobs** | ✅ Supported (max 2 concurrent) | ✅ Supported (5–10 concurrent) |
| **Live Packet Streaming (SSE)** | ✅ Supported (while awake) | ✅ Supported (24/7) |
| **Interactive Node Control & Fault Injection** | ✅ Supported (throttled 100ms) | ✅ Supported (high-speed 20ms) |
| **Trace Analysis & Metrics Dashboard** | ✅ 100% Functional | ✅ 100% Functional |
| **First Load Latency after 15m Inactivity** | ⚠️ **45–75s cold start** (handled in UI) | ✅ **< 1s instant response** |
| **Trace Persistence Across Git Redeploys** | ⚠️ Ephemeral (export to download) | ✅ Permanent NVMe Volume ($0.25/GB) |
| **Continuous Unattended Fleet Workloads** | ⚠️ Bounded to active HTTP sessions | ✅ Dedicated 24/7 background daemons |
| **Simultaneous Multi-Tenant Simulations** | ⚠️ Max 2 concurrent (queue up to 5) | ✅ High concurrency (dedicated vCPUs) |
| **Total Monthly Cost** | **$0.00** | **$7.00 – $25.00+ / month** |

---

## 8. Summary of Steps to Maintain Zero Expenses

1. **Keep Render Free Deployment**: Retain the existing `render.yaml` configuration with `plan: free`. Do not upgrade to `starter` or provision paid disks.
2. **Deploy Frontend on Vercel Free**: Retain `vercel.json` with Hobby plan ($0.00).
3. **Use Progressive Cold Start UI**: Allow the dashboard to wake Render legitimately without artificial pings.
4. **Use Local / Cloudflare Tunnel for Heavy Testing**: For long parameter sweeps or multi-node stress tests, use the Local Hybrid mode to avoid free-tier CPU throttling.
