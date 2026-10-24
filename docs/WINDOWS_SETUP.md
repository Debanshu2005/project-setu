# Project Setu — Windows Native Development & Operator Guide

This guide details the complete native Windows setup, build, test, and interactive operations dashboard workflow for **Project Setu**.

---

## 1. Prerequisites for Windows

Project Setu runs **natively on Windows 10/11** using modern C++20 and Node.js LTS. You do **not** need to install Ubuntu or WSL2.

### Required Tools
1. **CMake** (v3.20 or newer):
   ```powershell
   winget install Kitware.CMake
   ```
2. **Visual Studio 2022 Build Tools** (with "Desktop development with C++"):
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --add Microsoft.VisualStudio.Workload.VCTools"
   ```
   *(Or install via the Visual Studio Installer GUI)*
3. **Node.js LTS** (v18.x or v20.x):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

---

## 2. Quick-Start Workflow (One-Click PowerShell)

Clone the repository and run the automated PowerShell scripts in `scripts/`:

```powershell
# 1. Clone repository
git clone https://github.com/Debanshu2005/project-setu.git
cd project-setu

# 2. Check environment prerequisites
.\scripts\setup_windows.ps1

# 3. Build native C++ simulator & test executables (Release)
.\scripts\build_windows.ps1

# 4. Run automated unit, integration, and IPC tests
.\scripts\test_windows.ps1

# 5. Launch interactive operations dashboard
.\scripts\run_dashboard.ps1
```

---

## 3. Script Reference

| Script | Purpose | Parameters |
|---|---|---|
| `.\scripts\setup_windows.ps1` | Verifies CMake, MSVC `cl.exe`, and Node.js installation; checks `node_modules` | None |
| `.\scripts\build_windows.ps1` | Invokes CMake configure and build, stopping any running simulator instances | `-Config Release`, `-Clean` |
| `.\scripts\test_windows.ps1` | Runs CTest, direct test executables, and interactive IPC verification | `-Config Release` |
| `.\scripts\run_dashboard.ps1` | Launches `dashboard/server.js` and opens `http://localhost:3000` in default browser | `-Port 3000`, `-NoBrowser` |
| `.\scripts\clean_build.ps1` | Terminates locking processes, deletes `build/`, and performs clean rebuild | `-Config Release` |

---

## 4. Manual CMake Commands (Alternative)

If you prefer using pure CMake and npm commands directly:

```powershell
# Configure CMake
cmake -B build -DCMAKE_BUILD_TYPE=Release

# Build all targets (setu_core, setu_sim, unit_tests, integration_tests)
cmake --build build --config Release

# Run tests
ctest --test-dir build -C Release --output-on-failure

# Launch Dashboard
node dashboard/server.js
```

---

## 5. Troubleshooting on Windows

### 1. `fatal error LNK1104: cannot open file '.../setu_sim.exe'`
- **Cause**: An active background simulator process (`setu_sim.exe`) or the dashboard server has locked the executable.
- **Solution**: Run `Stop-Process -Name setu_sim -Force` in PowerShell, then run `.\scripts\build_windows.ps1`.

### 2. `cl.exe is not recognized`
- **Cause**: The MSVC compiler environment variables are not loaded in the standard PowerShell window.
- **Solution**: Open the **"x64 Native Tools Command Prompt for VS 2022"** from your Windows Start Menu, or use CMake directly which automatically locates the MSVC toolchain via `vswhere`.

### 3. Port 3000 in use
- **Cause**: Another service or past instance of `server.js` is running on port 3000.
- **Solution**: Launch on a custom port: `.\scripts\run_dashboard.ps1 -Port 3001` or run `Stop-Process -Name node -Force`.
