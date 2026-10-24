<#
.SYNOPSIS
    Project Setu - Windows Environment Prerequisites & Setup Script
.DESCRIPTION
    Verifies that the required Windows toolchain components (CMake, MSVC C++ Compiler, Node.js)
    are installed and configured, and sets up dashboard dependencies.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
function Find-CMake {
    $cmd = Get-Command "cmake" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:ProgramFiles\CMake\bin\cmake.exe",
        "${env:ProgramFiles(x86)}\CMake\bin\cmake.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\2022\*\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    )
    foreach ($c in $candidates) {
        $found = Get-Item $c -ErrorAction SilentlyContinue
        if ($found) { return $found[0].FullName }
    }
    return $null
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Project Setu -- Windows Toolchain & Dependency Check" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$allGood = $true

# 1. Check CMake
Write-Host "`n[1/4] Checking CMake installation..." -NoNewline
$cmakeExe = Find-CMake
if ($cmakeExe) {
    try {
        $cmakeVer = & $cmakeExe --version 2>$null
        $firstLine = ($cmakeVer -split "`n")[0]
        Write-Host " OK ($firstLine, path: $cmakeExe)" -ForegroundColor Green
    } catch {
        Write-Host " ERROR running $cmakeExe" -ForegroundColor Red
        $allGood = $false
    }
} else {
    Write-Host " MISSING" -ForegroundColor Red
    Write-Host "  -> Please install CMake (version >= 3.20): winget install Kitware.CMake" -ForegroundColor Yellow
    $allGood = $false
}

# 2. Check C++ Compiler (cl.exe or g++)
Write-Host "[2/4] Checking Native C++ Compiler (MSVC / Visual Studio Build Tools)..." -NoNewline
$hasCompiler = $false
try {
    $clVer = & cl 2>&1
    if ($clVer -match "Microsoft") {
        Write-Host " OK (MSVC cl.exe detected in current PATH)" -ForegroundColor Green
        $hasCompiler = $true
    }
} catch {}

if (-not $hasCompiler) {
    # Check if vswhere can locate Visual Studio
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vsInstall) {
            Write-Host " OK (Found VS Installation at: $vsInstall)" -ForegroundColor Green
            $hasCompiler = $true
        }
    }
}

if (-not $hasCompiler) {
    Write-Host " WARNING: cl.exe not found in active PATH." -ForegroundColor Yellow
    Write-Host "  -> Visual Studio Build Tools with 'Desktop development with C++' workload is recommended." -ForegroundColor Yellow
    Write-Host "  -> Run from 'x64 Native Tools Command Prompt for VS 2022' or install via:" -ForegroundColor Yellow
    Write-Host "     winget install Microsoft.VisualStudio.2022.BuildTools --override `"--passive --add Microsoft.VisualStudio.Workload.VCTools`"" -ForegroundColor Yellow
}

# 3. Check Node.js
Write-Host "[3/4] Checking Node.js (LTS recommended)..." -NoNewline
try {
    $nodeVer = & node --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $nodeVer) {
        Write-Host " OK ($nodeVer)" -ForegroundColor Green
    } else {
        throw "Node.js not found"
    }
} catch {
    Write-Host " MISSING" -ForegroundColor Red
    Write-Host "  -> Please install Node.js (v18+ LTS): winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    $allGood = $false
}

# 4. Dashboard npm packages
Write-Host "[4/4] Verifying Project Dependencies..." -NoNewline
$pkgJson = Join-Path $PSScriptRoot "..\package.json"
if (Test-Path $pkgJson) {
    Push-Location (Join-Path $PSScriptRoot "..")
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host " Installing npm packages..." -ForegroundColor Cyan
            & npm install --no-audit --no-fund
        } else {
            Write-Host " OK (node_modules present)" -ForegroundColor Green
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host " OK (Pure zero-dependency ESM server)" -ForegroundColor Green
}

Write-Host "`n----------------------------------------------------------" -ForegroundColor Cyan
if ($allGood) {
    Write-Host "Setup Check Complete: Toolchain ready for native Windows build." -ForegroundColor Green
    Write-Host "Next step: Run .\scripts\build_windows.ps1" -ForegroundColor Cyan
} else {
    Write-Host "Setup Incomplete: Please install missing prerequisites listed above." -ForegroundColor Red
}
Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
