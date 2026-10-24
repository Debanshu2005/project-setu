# Project Setu — Production Cloud Deployment & Operations Guide

This guide provides end-to-end instructions for deploying the Project Setu hybrid cloud architecture:
- **Render Free**: Hosts the authoritative native C++ simulation engine (`setu_sim`) and operations REST/SSE bridge via Docker.
- **Vercel**: Hosts the responsive web dashboard and static operations console.
- **GitHub Actions**: Provides automated CI build verification on Linux and Windows, Docker validation, and backend test gates on every push.

---

## 1. Architectural Overview

```
                      +---------------------------------------+
                      |               BROWSER                 |
                      |   Disaster Operations Dashboard UI    |
                      +---------------------------------------+
                                  |                |
             Static Assets        |                | REST API & SSE Events
             & Fallback Demo      |                | (Live Digital Twin)
                                  v                v
                  +--------------------+     +---------------------------+
                  |    VERCEL HOST     |     |    RENDER WEB SERVICE     |
                  |  Frontend / HTML   |     | (Docker - Node.js + C++)  |
                  |  /api/config       |     |   0.0.0.0:${PORT}         |
                  +--------------------+     +---------------------------+
                                                           |
                                                           | Stdio JSON IPC
                                                           v
                                             +---------------------------+
                                             |  setu_sim (Native C++17)  |
                                             |  - setu::Node Core        |
                                             |  - Virtual FreeRTOS Tasks |
                                             |  - RF Channel & LoRa PHY  |
                                             +---------------------------+
```

### Execution Mode Clarity
1. **Actual C++ Protocol Core Simulation**: The authoritative simulation mode executed on Render or locally by `setu_sim`. Virtual nodes run the real C++ `setu::Node` state machine with SX1262 LoRa physical layer modelling, randomized backoffs, ACK matching, and FreeRTOS queue tasks.
2. **JavaScript Demo Fallback**: Hosted on Vercel Serverless (`/api/simulate`). This is an ephemeral in-memory demonstration engine. It is explicitly labeled as a demo fallback and never claims to execute native C++ code.
3. **Physical Hardware**: Actual ESP32-S3 firmware deployed to physical hardware wristbands via `firmware/` and ESP-IDF.

---

## 2. GitHub Actions Setup

The CI workflow is configured in `.github/workflows/ci.yml`.

### Triggers
- Automatic execution on every `push` to `main` and `feature/**` branches.
- Automatic execution on pull requests targeting `main`.
- Manual execution via `workflow_dispatch`.

### Automated Pipeline Jobs
1. **Native C++ Core (Linux GCC 13)**: Compiles `setu_core`, `setu_world`, `setu_sim`, and runs all 44 unit tests and 13 integration tests via `ctest`. Tests interactive CLI directly over stdin/stdout.
2. **Native C++ Core (Windows MSVC)**: Executes `.\scripts\build_windows.ps1` and `.\scripts\test_windows.ps1` ensuring full Windows parity.
3. **Docker Multi-Stage Build & Container Health**: Builds the Docker container, runs tests inside the container build stage, boots the container, and verifies HTTP responses from `/health` and `/api/status`.
4. **Backend API & Scenario Validation**: Validates all JSON scenario files and runs `tests/test_backend.mjs` verifying REST/SSE endpoints and real C++ protocol state transitions.

---

## 3. Render Deployment (Backend Service)

Render hosts the persistent Docker container running Node.js and the native C++ binary.

### Option A: Automatic Blueprint Deployment (Recommended)
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** > **Blueprint**.
3. Connect your GitHub repository (`project-setu`).
4. Select the `main` or `feature/cloud-deployment-fitl` branch.
5. Render will detect `render.yaml` and configure the service:
   - **Service Name**: `project-setu-backend`
   - **Runtime**: `Docker`
   - **Instance Type**: `Free`
   - **Healthcheck Path**: `/health`
6. Click **Apply**.
7. Once deployed, Render will provide a live service URL, e.g.:
   `https://project-setu-backend.onrender.com`

### Option B: Manual Web Service Setup
If not using Blueprints:
1. Click **New +** > **Web Service**.
2. Select repository `project-setu`.
3. Choose **Docker** runtime.
4. Set Dockerfile Path: `./Dockerfile`.
5. Set Health Check Path: `/health`.
6. Add Environment Variables:
   - `PORT`: `10000`
   - `NODE_ENV`: `production`
   - `ALLOWED_ORIGINS`: `https://your-app.vercel.app,http://localhost:3000`
7. Select **Free** instance type and click **Create Web Service**.

### Render Free Tier Notes & Limitations
- **Cold Starts**: Render Free web services spin down after 15 minutes of inactivity. The first incoming HTTP request wakes the container, taking 30–50 seconds.
- **Waking Indicator**: The Setu dashboard automatically detects Render cold starts and displays `WAKING UP RENDER ENGINE... (Cold start may take ~30s)` with retry pings to `/health`.
- **In-Memory State**: If the free container restarts, any in-memory simulation clock resets to 0. The API truthfully reports this via `/api/status` and `/api/control/status`.

---

## 4. Vercel Deployment (Frontend Operations Dashboard)

Vercel hosts the responsive browser client and static dashboard.

### Deployment Steps
1. Log in to [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** > **Project**.
3. Import the `project-setu` repository.
4. Leave framework preset as **Other** (Root directory: `./`).
5. Under **Environment Variables**, add:
   - `SETU_BACKEND_URL`: Your Render backend URL (e.g. `https://project-setu-backend.onrender.com`).
   - `NEXT_PUBLIC_SETU_BACKEND_URL`: Same URL (for dual compatibility).
6. Click **Deploy**.
7. Vercel will deploy the dashboard to `https://<your-project>.vercel.app`.

### Multi-Tier Backend URL Resolution
The dashboard resolves its target backend URL in this order:
1. **URL Query Parameter**: `https://<your-project>.vercel.app/?backend=https://project-setu-backend.onrender.com` (automatically saved).
2. **Window Global**: `window.__SETU_BACKEND_URL__` (if configured in HTML).
3. **User LocalStorage**: Configured via the in-app **⚡ Backend** button modal (no developer tools required).
4. **Vercel `/api/config`**: Fetches the server-configured `SETU_BACKEND_URL` environment variable.
5. **Localhost Auto-Detection**: When opened on `http://localhost:3000` or `http://127.0.0.1:3000`, automatically targets the local native bridge.

---

## 5. Local Windows Development Workflow

You do NOT need Linux, WSL, or Docker to develop and test Project Setu on Windows.

### Build and Test
From PowerShell in the project root:
```powershell
# 1. Build native C++ simulator and test binaries
.\scripts\build_windows.ps1

# 2. Run all CTest unit tests, integration tests, CLI check, and backend API suite
.\scripts\test_windows.ps1
```

### Run Local Operations Center
```powershell
# Start local Node.js bridge and operations dashboard
.\scripts\run_dashboard.ps1
```
Open `http://localhost:3000` in any web browser.

---

## 6. Verification Checklist

To verify that the live system is operating correctly end to end:
1. **Health Verification**:
   Navigate to `https://<your-render-app>.onrender.com/health`.
   Verify HTTP 200 response:
   ```json
   { "status": "ok", "service": "setu-simulation-backend", "simulatorFound": true }
   ```
2. **Dashboard Connection**:
   Open `https://<your-project>.vercel.app`.
   Verify the status indicator displays:
   `● CORE C++ ENGINE ONLINE`
3. **Real SOS Trigger & Protocol Verification**:
   - In the dashboard, select **Node 1** in the topology map.
   - Click **🚨 Short Press (General)**.
   - Click **Play** or **Step Forward**.
   - Inspect the right panel under **FreeRTOS Tasks & Queues (FITL)**:
     - Verify `Button ISR Queue` registered the edge.
     - Verify `Sequence Counter (seq)` incremented.
     - Verify `Originated / Relayed TX` incremented to `1`.
     - In the live console, observe real 25-byte LoRa packet dissemination across relays to the Hub.
