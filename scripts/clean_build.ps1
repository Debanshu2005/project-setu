<#
.SYNOPSIS
    Project Setu - Clean & Rebuild Script
.DESCRIPTION
    Terminates running simulator processes, cleans build artifacts, and performs a fresh rebuild.
#>

[CmdletBinding()]
param(
    [string]$Config = "Release"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $projectRoot

try {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  Project Setu — Clean & Rebuild ($Config)" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    Get-Process -Name "setu_sim" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "Terminating active simulator process (PID $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force
    }

    $buildDir = Join-Path $projectRoot "build"
    if (Test-Path $buildDir) {
        Write-Host "Removing $buildDir..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $buildDir
    }

    & "$PSScriptRoot\build_windows.ps1" -Config $Config -Clean
}
finally {
    Pop-Location
}
