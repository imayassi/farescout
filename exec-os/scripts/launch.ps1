<#
.SYNOPSIS  Starts the ExecOS local service and opens the app window.
.DESCRIPTION
  - Reuses an already-running instance if the port is bound.
  - Opens Microsoft Edge in app mode (falls back to the default browser).
  - Service binds to 127.0.0.1 only; the URL carries a per-install local token.
#>
[CmdletBinding()]
param([switch]$NoWindow, [switch]$NoSync)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DataRoot = if ($env:EXECOS_HOME) { $env:EXECOS_HOME } else { Join-Path $env:LOCALAPPDATA "ExecOS" }
$env:EXECOS_HOME = $DataRoot
$cli = Join-Path $Root "packages\server\dist\cli.js"
if (-not (Test-Path $cli)) { Write-Host "ExecOS is not built. Run scripts\install.ps1 first." -ForegroundColor Red; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Node.js not found. Run scripts\install.ps1." -ForegroundColor Red; exit 1 }

$port = 47810
$appYaml = Join-Path $DataRoot "config\app.yaml"
if (Test-Path $appYaml) { $m = Select-String -Path $appYaml -Pattern '^\s*port:\s*(\d+)' | Select-Object -First 1; if ($m) { $port = [int]$m.Matches[0].Groups[1].Value } }
$tokenFile = Join-Path $DataRoot "config\local-token"

$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening -and (Test-Path $tokenFile)) {
  Write-Host "ExecOS already running on port $port; opening window."
  $url = "http://127.0.0.1:$port/?token=$(Get-Content $tokenFile -Raw)".Trim()
} else {
  $args = @($cli, "start", "--no-open"); if ($NoSync) { $args += "--no-sync" }
  Push-Location $Root
  $proc = Start-Process -FilePath "node" -ArgumentList $args -WorkingDirectory $Root -PassThru -WindowStyle Minimized
  Pop-Location
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { Write-Host "ExecOS exited during startup (code $($proc.ExitCode)). Run: node packages\server\dist\cli.js doctor" -ForegroundColor Red; exit 1 }
    if ((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) -and (Test-Path $tokenFile)) { break }
  }
  if (-not (Test-Path $tokenFile)) { Write-Host "ExecOS did not start within 30s. Check $DataRoot\logs." -ForegroundColor Red; exit 1 }
  $url = "http://127.0.0.1:$port/?token=$(Get-Content $tokenFile -Raw)".Trim()
}
if ($NoWindow) { Write-Host $url; exit 0 }
$edge = @("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=$url", "--window-size=1440,960" }
else {
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) { Start-Process -FilePath $chrome -ArgumentList "--app=$url" } else { Start-Process $url }
}
