# Project Setu: Production Deployment & Zero-Budget Hosting Guide

**Document Version:** 2.0.0  
**Date:** October 27, 2026  
**Constraint Mandate:** $0.00/month mandatory budget. Maintain existing Render deployment functional while optimizing reliability and zero-budget alternatives.

---

## 1. Overview & Zero-Budget Strategy

This guide provides exact deployment instructions for Project Setu under the constraint: **Avoid mandatory hosting expenses ($0.00/month)**.

The deployment architecture is fully decoupled:
- **Frontend Dashboard**: Hosted on **Vercel Free Tier** (`https://project-setu.vercel.app`) with zero cold-start latency.
- **Backend API & Simulation Engine**:
  - **Option 1 (Default Cloud Free)**: **Render Free Plan** (`https://project-setu-backend.onrender.com`), optimized with asynchronous jobs, 512 MB memory guards, and disk streaming.
  - **Option 2 (Zero-Cost Hybrid — Recommended for Heavy Simulations)**: **Local Node + Cloudflare Tunnel** ($0.00/month, unlimited RAM, 0s cold start).
  - **Option 3 (High-Memory Cloud Free Alternative)**: **Hugging Face Spaces** (Docker Community Free, 16 GB RAM, 2 vCPUs).

> [!IMPORTANT]
> The existing Render deployment remains functional. Never delete or deprovision the active Render service until an alternative has been deployed and verified locally and remotely.

---

## 2. Environment Variables Reference

Configure these environment variables in your deployment environment:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` (Local/Cloudflare) / `10000` (Render) | Port the HTTP and SSE server binds to. |
| `NODE_ENV` | `production` | Enables production optimizations and disables debug traces. |
| `MAX_CONCURRENT_SIMS` | `2` | Maximum concurrent native C++ simulation processes executing simultaneously. |
| `MAX_QUEUE_SIZE` | `5` | Maximum queued simulation jobs before returning HTTP 429 Too Many Requests. |
| `SIM_TIMEOUT_MS` | `60000` | Hard wall-clock watchdog limit per job before automatic process cancellation. |
| `MAX_JOB_EVENTS` | `2000` | Bounded in-memory event ring buffer per job (prevents Node.js heap exhaustion). |
| `SETU_SIM_PATH` | `/app/build/setu_sim` (Docker) or `build/setu_sim` | Path to compiled native simulator binary. |
| `ALLOWED_ORIGINS` | `https://project-setu.vercel.app,...` | Comma-separated list of approved web origins for CORS. |
| `ALLOW_VERCEL_PREVIEWS`| `true` | Allows preview pull-request URLs matching `*.vercel.app`. |

---

## 3. Option 1: Render Free Tier Optimization (Default Active Cloud)

Your existing Render free tier deployment continues to run at **$0.00/month**. The following configuration maximizes its stability within the 512 MB RAM / 0.1 vCPU envelope:

### Step 1: Verify `render.yaml` Configuration
Ensure [render.yaml](file:///d:/CityGrid/my-project/project-setu/project-setu/render.yaml) specifies the free plan and points to the fast liveness probe:
```yaml
services:
  - type: web
    name: project-setu-backend
    runtime: docker
    plan: free
    region: oregon
    healthCheckPath: /health/liveness
    envVars:
      - key: PORT
        value: 10000
      - key: NODE_ENV
        value: production
      - key: MAX_CONCURRENT_SIMS
        value: 2
      - key: MAX_QUEUE_SIZE
        value: 5
      - key: SIM_TIMEOUT_MS
        value: 60000
      - key: MAX_JOB_EVENTS
        value: 2000
      - key: ALLOWED_ORIGINS
        value: https://project-setu.vercel.app,http://localhost:3000
```

### Step 2: Deploy to Render
Push your latest commits to `main`:
```bash
git add dashboard/server.js dashboard/src/api.js dashboard/src/app.js render.yaml
git commit -m "Optimize server for zero-budget Render free tier resilience"
git push origin main
```
Render automatically rebuilds the Docker container via webhook.

### Step 3: Verify Probes on Live Endpoint
```bash
# 1. Fast Liveness probe (<10ms response)
curl -I https://project-setu-backend.onrender.com/health/liveness

# 2. Readiness probe (checks binary & worker pool)
curl https://project-setu-backend.onrender.com/health/readiness

# 3. Live Metrics
curl https://project-setu-backend.onrender.com/api/metrics
```

### Step 4: Inactivity Sleep & Cold-Start Tolerance
- Render spins down after 15 minutes of zero HTTP traffic.
- When an operator accesses `https://project-setu.vercel.app`, the frontend's built-in `pingBackendWithColdStartRetry()` polls `/health/liveness` with status updates:  
  `"WAKING UP FREE BACKEND... (Attempt X/16, ~45-70s elapsed)"`.
- No artificial ping bots are needed or allowed; the app wakes up gracefully on real operator access.

---

## 4. Option 2: Zero-Cost Hybrid Architecture (Recommended for Heavy Runs)

For large-scale scenarios (e.g. 50–100 nodes, 60s sweeps), the shared 0.1 vCPU and 512 MB memory on free cloud tiers may throttle execution. The **Zero-Cost Hybrid** option executes the C++ simulation locally while allowing anyone to interact via the web dashboard.

### Step 1: Start the Local Node Engine
```bash
# From repository root
npm run dev
# or:
node dashboard/server.js
```
The server binds to `http://localhost:3000` with full access to your machine's CPU and RAM.

### Step 2: Launch Encrypted Cloudflare Tunnel (Zero Cost)
Cloudflare Tunnels allow exposing local ports over HTTPS with automated SSL, without opening firewall ports or paying for static IPs.
1. Download `cloudflared`:
   - Windows: `winget install Cloudflare.cloudflared` or download from Cloudflare.
   - macOS: `brew install cloudflared`
   - Linux: `sudo apt install cloudflared`
2. Run the tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Copy the generated HTTPS URL (e.g., `https://random-subdomain.trycloudflare.com`).

### Step 3: Connect Frontend to Tunnel
1. Open `https://project-setu.vercel.app`.
2. Click the **⚡ Backend** button in the top navigation bar.
3. Paste the tunnel URL and click **Save & Reconnect**.
4. You now enjoy **0s cold starts, unthrottled C++ multi-core compute, and zero hosting costs**.

---

## 5. Option 3: Alternative Free Cloud: Hugging Face Spaces (Docker Free)

If you need an always-available cloud fallback with substantially more RAM (16 GB) than Render:

1. Create a free account at [huggingface.co](https://huggingface.co).
2. Click **New Space** > Select **Docker** SDK > Select **Blank** template > Free Tier (2 vCPU, 16 GB RAM).
3. Connect your GitHub repository `Debanshu2005/project-setu` or push directly:
   ```bash
   git remote add hf https://huggingface.co/spaces/<your-username>/project-setu
   git push hf main
   ```
4. Hugging Face automatically builds the root `Dockerfile` and exposes port 7860 (set `PORT=7860`).
5. Inactivity timeout is **48 hours** (significantly longer than Render's 15 minutes).

---

## 6. Frontend Deployment: Vercel Free Tier ($0.00/mo)

The frontend is deployed to Vercel's global edge network at zero cost:

### Step 1: Link Repository in Vercel
1. Go to [vercel.com](https://vercel.com) and import `Debanshu2005/project-setu`.
2. Framework Preset: **Other**.
3. Root Directory: `./` (root).
4. Build Command: Leave blank (static HTML/JS/CSS).
5. Output Directory: Leave blank.

### Step 2: Environment Variables
Under Project Settings > Environment Variables:
- `SETU_BACKEND_URL` = `https://project-setu-backend.onrender.com` (or your hybrid URL).

### Step 3: Deploy & Verify
Click **Deploy**. Static assets are delivered instantly via Vercel's edge CDN with 0ms cold starts.

---

## 7. Emergency Rollback & Recovery Procedures

### Instant Frontend Backend Override
If the primary cloud backend is temporarily sleeping or undergoing maintenance, any user can redirect their session without a redeployment:
1. Click **⚡ Backend** on the dashboard.
2. Enter the fallback URL (e.g., `http://localhost:3000` or an alternate cloud instance).
3. Click **Save & Reconnect**. The setting is saved in browser `localStorage`.
4. To revert to default, click **Reset to Default URL**.

### Container Restart Recovery Verification
When the backend container restarts:
1. `GET /api/jobs` restores all completed historical experiments from `scenarios/traces/jobs_index.json`.
2. Any jobs that were running when the container was stopped are safely marked as `status: 'interrupted'`.
3. The queue is ready to accept new jobs immediately.
