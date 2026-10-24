<#
.SYNOPSIS
    Project Setu - Windows Native CMake Build Script
.DESCRIPTION
    Configures and builds the authoritative C++ simulation engine, shared portable core,
    unit tests, and integration tests using CMake and MSVC.
#>

[CmdletBinding()]
param(
    [string]$Config = "Release",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $projectRoot

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

try {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  Project Setu -- Native C++ Build ($Config)" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    $cmakeExe = Find-CMake
    if (-not $cmakeExe) {
        throw "CMake not found! Please install CMake or Visual Studio with C++ workload."
    }

    # Ensure running simulator instances are stopped to avoid LNK1104 file lock
    Get-Process -Name "setu_sim" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "Stopping running setu_sim process (PID $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force
    }

    $buildDir = Join-Path $projectRoot "build"
    if ($Clean -and (Test-Path $buildDir)) {
        Write-Host "Cleaning build directory..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $buildDir
    }

    Write-Host "`n[1/2] Configuring CMake project (using $cmakeExe)..." -ForegroundColor Cyan
    & $cmakeExe -B build -DCMAKE_BUILD_TYPE=$Config

    if ($LASTEXITCODE -ne 0) {
        throw "CMake configuration failed with exit code $LASTEXITCODE"
    }

    Write-Host "`n[2/2] Building all targets ($Config)..." -ForegroundColor Cyan
    & $cmakeExe --build build --config $Config

    if ($LASTEXITCODE -ne 0) {
        throw "CMake build failed with exit code $LASTEXITCODE"
    }

    # Verify key output binaries
    $simExe = Join-Path $buildDir "$Config\setu_sim.exe"
    if (-not (Test-Path $simExe)) {
        $simExe = Join-Path $buildDir "setu_sim.exe"
    }

    if (Test-Path $simExe) {
        Write-Host "`nBUILD SUCCESSFUL!" -ForegroundColor Green
        Write-Host "Authoritative Simulator Binary: $simExe" -ForegroundColor Cyan
        Write-Host "`nNext steps:" -ForegroundColor White
        Write-Host '  Run tests:     .\scripts\test_windows.ps1' -ForegroundColor Gray
        Write-Host '  Run dashboard: .\scripts\run_dashboard.ps1' -ForegroundColor Gray
    } else {
        Write-Host "`nBuild succeeded but setu_sim.exe was not found in expected output directories." -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}
