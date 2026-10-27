# Project Setu: Production Cloud Deployment & Migration Guide

**Document Version:** 1.0.0  
**Date:** October 27, 2026  
**Target Systems:** Frontend (Vercel), Backend (Fly.io / Railway / Render), Docker Multi-Stage Build

---

## 1. Overview & Migration Strategy

This guide provides step-by-step instructions to migrate and deploy the Project Setu simulation platform.

The target architecture maintains a clean separation of concerns:
- **Frontend Dashboard**: Hosted on **Vercel** (`https://project-setu.vercel.app`).
- **Backend API & Simulation Engine**: Hosted on **Fly.io** (or **Railway**), executing in an isolated container with dedicated compute and persistent storage.

> [!IMPORTANT]
> The migration maintains 100% backward compatibility. The existing Render deployment remains fully functional until the operator verifies the new endpoint and updates the Vercel environment variable.

---

## 2. Environment Variables Reference

Configure these environment variables in your cloud provider's dashboard or CLI:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` (Fly/Local) / `10000` (Render) | Port the HTTP and SSE server binds to. |
| `NODE_ENV` | `production` | Enables production optimizations and disables debug traces. |
| `MAX_CONCURRENT_SIMS` | `2` | Maximum concurrent native C++ simulation processes executing simultaneously. |
| `SIM_TIMEOUT_MS` | `60000` | Hard wall-clock watchdog limit per job before automatic process cancellation (prevents zombie processes). |
| `MAX_JOB_EVENTS` | `2000` | Bounded in-memory event ring buffer per job (prevents Node.js heap exhaustion). |
| `SETU_SIM_PATH` | `/app/build/setu_sim` | Path to compiled native simulator binary in the Docker container. |
| `ALLOWED_ORIGINS` | `https://project-setu.vercel.app,...` | Comma-separated list of approved web origins for CORS policy. |
| `ALLOW_VERCEL_PREVIEWS`| `true` | Allows preview pull-request URLs matching `*.vercel.app`. |

---

## 3. Option A: Deployment to Fly.io (Recommended)

Fly.io runs the Setu container inside lightweight Firecracker micro-VMs with dedicated RAM and persistent NVMe volumes.

### Step 1: Install Fly CLI (`flyctl`)
```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

### Step 2: Authenticate & Initialize App
```bash
fly auth login
```
From the root of `project-setu`:
```bash
fly launch --no-deploy
```
Select your preferred primary region (e.g. `iad` for US East, `ams` for Europe, `sin` for Asia).

### Step 3: Create Persistent Volume for Traces
Create a 3 GB persistent volume mounted at `/app/scenarios/traces`:
```bash
fly volumes create setu_traces --size 3 --region iad
```

### Step 4: Deploy the Application
Deploy the pre-configured [fly.toml](file:///d:/CityGrid/my-project/project-setu/project-setu/fly.toml):
```bash
fly deploy
```

### Step 5: Verify Deployment & Probes
```bash
# Inspect machine status
fly status

# Test Liveness probe
curl -I https://project-setu-backend.fly.dev/health/liveness

# Test Readiness probe
curl https://project-setu-backend.fly.dev/health/readiness

# Tail live application logs
fly logs
```

---

## 4. Option B: Deployment to Railway (Turnkey Alternative)

Railway provides one-click Docker deployments with automatic HTTPS and usage-based billing.

### Step 1: Link Repository in Railway
1. Open [railway.app](https://railway.app) and create a **New Project**.
2. Select **Deploy from GitHub repo** and select `Debanshu2005/project-setu`.
3. Railway automatically detects the root [Dockerfile](file:///d:/CityGrid/my-project/project-setu/project-setu/Dockerfile) and [railway.json](file:///d:/CityGrid/my-project/project-setu/project-setu/railway.json).

### Step 2: Configure Environment Variables
Under service **Settings > Variables**, add:
- `PORT = 3000`
- `NODE_ENV = production`
- `MAX_CONCURRENT_SIMS = 2`
- `ALLOWED_ORIGINS = https://project-setu.vercel.app,http://localhost:3000`

### Step 3: Add Volume Mount (Optional)
Under service **Settings > Volumes**, add volume mounted to `/app/scenarios/traces`.

---

## 5. Option C: Render Paid Upgrade (In-Place)

If continuing with Render:
1. Open the **project-setu-backend** service on the Render Dashboard.
2. Under **Settings > Plan**, upgrade from **Free** to **Starter ($7/mo)**.
3. Under **Health Check Path**, update to `/health/liveness`.
4. This immediately eliminates the 15-minute idle spin-down.

---

## 6. Zero-Downtime Traffic Cutover (Vercel Frontend)

Once the new backend is running and verified:

1. Open your **Vercel Project Settings** for `project-setu`.
2. Navigate to **Settings > Environment Variables**.
3. Update `SETU_BACKEND_URL`:
   - From: `https://project-setu-backend.onrender.com`
   - To: `https://project-setu-backend.fly.dev` (or your Railway domain).
4. Trigger a redeployment in Vercel (or push a commit).
5. All traffic will seamlessly route to the new backend.

---

## 7. Emergency Rollback Procedure

If any issue arises with the new backend:

1. **Vercel Environment Variable Revert**:
   In Vercel Project Settings, change `SETU_BACKEND_URL` back to `https://project-setu-backend.onrender.com`.
2. **Instant Frontend Override**:
   Any operator can instantly point their browser to the fallback backend without waiting for deployment:
   - Click the **⚡ Backend** button in the dashboard navigation bar.
   - Enter `https://project-setu-backend.onrender.com` in the custom URL input.
   - Click **Save & Connect**. The preference is stored in `localStorage` and takes immediate effect.
