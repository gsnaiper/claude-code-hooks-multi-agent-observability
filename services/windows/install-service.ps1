# Claude Code Observability Server - Windows Service Installer
# Requires: NSSM (Non-Sucking Service Manager) or runs as scheduled task

param(
    [switch]$Uninstall,
    [switch]$UseScheduledTask
)

$ErrorActionPreference = "Stop"

$ServiceName = "ClaudeObservability"
$DisplayName = "Claude Code Observability Server"
$Description = "Real-time observability dashboard for Claude Code hooks"
$InstallDir = "$env:USERPROFILE\.claude\observability"
$BunPath = (Get-Command bun -ErrorAction SilentlyContinue).Source

if (-not $BunPath) {
    Write-Host "Error: bun is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Install bun from: https://bun.sh" -ForegroundColor Yellow
    exit 1
}

function Install-WithNSSM {
    $NssmPath = "$env:USERPROFILE\.claude\bin\nssm.exe"

    # Download NSSM if not present
    if (-not (Test-Path $NssmPath)) {
        Write-Host "Downloading NSSM..." -ForegroundColor Yellow
        $NssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
        $TempZip = "$env:TEMP\nssm.zip"

        Invoke-WebRequest -Uri $NssmUrl -OutFile $TempZip
        Expand-Archive $TempZip -DestinationPath "$env:TEMP\nssm" -Force

        New-Item -ItemType Directory -Path "$env:USERPROFILE\.claude\bin" -Force | Out-Null
        Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" -Destination $NssmPath

        Remove-Item $TempZip -Force
        Remove-Item "$env:TEMP\nssm" -Recurse -Force
    }

    # Install service
    Write-Host "Installing service with NSSM..." -ForegroundColor Yellow

    & $NssmPath install $ServiceName $BunPath run src/index.ts
    & $NssmPath set $ServiceName AppDirectory "$InstallDir\server"
    & $NssmPath set $ServiceName DisplayName $DisplayName
    & $NssmPath set $ServiceName Description $Description
    & $NssmPath set $ServiceName Start SERVICE_AUTO_START
    & $NssmPath set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "PORT=4000"
    & $NssmPath set $ServiceName AppStdout "$env:USERPROFILE\.claude\logs\observability.log"
    & $NssmPath set $ServiceName AppStderr "$env:USERPROFILE\.claude\logs\observability.error.log"

    # Start service
    & $NssmPath start $ServiceName

    Write-Host "Service installed and started successfully!" -ForegroundColor Green
}

function Install-WithScheduledTask {
    Write-Host "Creating scheduled task..." -ForegroundColor Yellow

    $Action = New-ScheduledTaskAction -Execute $BunPath -Argument "run src/index.ts" -WorkingDirectory "$InstallDir\server"
    $Trigger = New-ScheduledTaskTrigger -AtStartup
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $ServiceName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description $Description -Force

    # Start task immediately
    Start-ScheduledTask -TaskName $ServiceName

    Write-Host "Scheduled task created and started successfully!" -ForegroundColor Green
}

function Uninstall-Service {
    Write-Host "Uninstalling service..." -ForegroundColor Yellow

    # Try NSSM first
    $NssmPath = "$env:USERPROFILE\.claude\bin\nssm.exe"
    if (Test-Path $NssmPath) {
        & $NssmPath stop $ServiceName 2>$null
        & $NssmPath remove $ServiceName confirm 2>$null
    }

    # Try scheduled task
    Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue

    Write-Host "Service uninstalled successfully!" -ForegroundColor Green
}

# Main logic
if ($Uninstall) {
    Uninstall-Service
} elseif ($UseScheduledTask) {
    Install-WithScheduledTask
} else {
    Install-WithNSSM
}

Write-Host ""
Write-Host "Server URL: http://localhost:4000" -ForegroundColor Cyan
Write-Host "Dashboard:  http://localhost:4000" -ForegroundColor Cyan
