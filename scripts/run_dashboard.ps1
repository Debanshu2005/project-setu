<#
.SYNOPSIS
    Project Setu - Launch Operations Dashboard & Simulator Control Server
.DESCRIPTION
    Launches the Node.js API and static server connecting the web digital twin
    to the native C++ simulation engine, then opens the browser.
#>

[CmdletBinding()]
param(
    [int]$Port = 3000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $projectRoot

try {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  Project Setu — Disaster Response Operations Dashboard" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    # Check simulator binary
    $simExe = Join-Path $projectRoot "build\Release\setu_sim.exe"
    if (-not (Test-Path $simExe)) {
        $simExe = Join-Path $projectRoot "build\setu_sim.exe"
    }

    if (-not (Test-Path $simExe)) {
        Write-Host "Native simulator binary not found at build/Release/setu_sim.exe" -ForegroundColor Yellow
        Write-Host "Building project first..." -ForegroundColor Cyan
        & "$PSScriptRoot\build_windows.ps1"
    }

    $url = "http://localhost:$Port"
    Write-Host "`nStarting Operations Dashboard Server on $url..." -ForegroundColor Green
    Write-Host "Authoritative C++ Engine: $simExe" -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop.`n" -ForegroundColor Gray

    if (-not $NoBrowser) {
        Start-Process $url
    }

    $env:PORT = "$Port"
    & node dashboard/server.js
}
finally {
    Pop-Location
}
