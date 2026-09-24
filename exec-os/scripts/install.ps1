<#
.SYNOPSIS
  ExecOS one-command installer for Windows.
.DESCRIPTION
  Validates prerequisites (Node.js 22.13+, npm, GitHub Copilot CLI, WorkIQ), installs dependencies,
  builds the application, initializes per-user configuration OUTSIDE the repository
  (%LOCALAPPDATA%\ExecOS), and creates a desktop shortcut.
  Nothing private is written into the cloned repository.
.PARAMETER SkipCopilotCheck
  Do not fail when GitHub Copilot CLI is missing (ExecOS then runs in degraded/rule-only mode).
.PARAMETER DemoData
  Enable the synthetic "mock" source so the UI can be explored without enterprise access.
.PARAMETER NoShortcut
  Do not create the desktop shortcut.
#>
[CmdletBinding()]
param(
  [switch]$SkipCopilotCheck,
  [switch]$DemoData,
  [switch]$NoShortcut
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot          # exec-os/
$AppName = "ExecOS"
$DataRoot = if ($env:EXECOS_HOME) { $env:EXECOS_HOME } else { Join-Path $env:LOCALAPPDATA $AppName }

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    WARN $msg" -ForegroundColor Yellow }
function Fail($msg, $fix) { Write-Host "    FAIL $msg" -ForegroundColor Red; if ($fix) { Write-Host "         -> $fix" -ForegroundColor Red }; exit 1 }

Write-Host ""
Write-Host "ExecOS installer" -ForegroundColor White
Write-Host "Repository : $Root"
Write-Host "Data root  : $DataRoot  (private; outside the repository)"
Write-Host ""

# 1. Node.js
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js not found." "Install Node.js 22 LTS from https://nodejs.org (or 'winget install OpenJS.NodeJS.LTS'), then re-run this script." }
$nodeVer = (& node --version).TrimStart("v")
$parts = $nodeVer.Split("."); $maj = [int]$parts[0]; $min = [int]$parts[1]
if ($maj -lt 22 -or ($maj -eq 22 -and $min -lt 13)) { Fail "Node.js $nodeVer is too old (need 22.13+ for the built-in SQLite module)." "Upgrade Node.js: winget upgrade OpenJS.NodeJS.LTS" }
Write-Ok "Node.js $nodeVer"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm not found." "Reinstall Node.js; npm ships with it." }

# 2. Data root must be outside any git repository (privacy boundary)
Write-Step "Preparing private data directory"
$probe = $DataRoot; $insideGit = $false
while ($probe -and (Split-Path $probe -Parent) -ne $probe) { if (Test-Path (Join-Path $probe ".git")) { $insideGit = $true; break }; $probe = Split-Path $probe -Parent }
if ($insideGit) { Fail "Data root $DataRoot is inside a git repository." "Set EXECOS_HOME to a directory outside any repository." }
foreach ($d in @("config", "data", "cache", "logs", "docs", "copilot-home")) { New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot $d) | Out-Null }
foreach ($pair in @(@("app.example.yaml", "app.yaml"), @("mcp.example.yaml", "mcp.yaml"))) {
  $src = Join-Path $Root "config\$($pair[0])"; $dst = Join-Path $DataRoot "config\$($pair[1])"
  if (-not (Test-Path $dst)) { Copy-Item $src $dst; Write-Ok "Seeded $dst from template" } else { Write-Ok "Kept existing $dst" }
}
if ($DemoData) {
  $appYaml = Join-Path $DataRoot "config\app.yaml"
  (Get-Content $appYaml) -replace '^(\s*mock:\s*)false', '${1}true' | Set-Content $appYaml
  Write-Ok "Demo data (synthetic organization) enabled in app.yaml"
}
$docsReadme = Join-Path $DataRoot "docs\README.txt"
if (-not (Test-Path $docsReadme)) { "Place private context documents (.md/.txt) here: priorities, strategy, operating plans, goals, budgets, org context, definitions, meeting notes. They are read locally and never copied into the repository." | Set-Content $docsReadme }

# 3. Dependencies + build
Write-Step "Installing dependencies (npm)"
Push-Location $Root
try {
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." "Check proxy settings (npm config get proxy) and access to registry.npmjs.org, then re-run." }
  Write-Ok "Dependencies installed"
  Write-Step "Building ExecOS"
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail "Build failed." "See the error above; run 'npm run build' in $Root for details." }
  Write-Ok "Build complete"
} finally { Pop-Location }

# 4. GitHub Copilot CLI
Write-Step "Checking GitHub Copilot CLI"
$copilot = Get-Command copilot -ErrorAction SilentlyContinue
$agency = Get-Command agency -ErrorAction SilentlyContinue
if ($copilot) {
  Write-Ok "copilot found: $($copilot.Source)"
  $probe = & copilot -p "Reply with the single word OK" -s --no-ask-user --disable-builtin-mcps 2>&1
  if ($LASTEXITCODE -eq 0 -and ($probe -match "OK")) { Write-Ok "Copilot is signed in" }
  else { Write-Warn2 "Copilot CLI is installed but not signed in. Run: copilot login" }
} elseif ($agency) {
  Write-Warn2 "'copilot' not found but 'agency' is present. Set intelligence.copilot.command: agency in $DataRoot\config\app.yaml if your environment launches Copilot through it."
} elseif ($SkipCopilotCheck) {
  Write-Warn2 "GitHub Copilot CLI not found; ExecOS will run in degraded mode (rules only)."
} else {
  Write-Warn2 "GitHub Copilot CLI not found. Install with: npm install -g @github/copilot   then run: copilot login"
  Write-Warn2 "Re-run with -SkipCopilotCheck to continue without it (degraded mode)."
}

# 5. WorkIQ (primary enterprise source)
Write-Step "Checking WorkIQ"
$workiq = Get-Command workiq -ErrorAction SilentlyContinue
if ($workiq) { Write-Ok "workiq found: $($workiq.Source). If not yet signed in run: workiq auth login  (then: workiq accept-eula)" }
else { Write-Warn2 "workiq not installed globally; npx will download @microsoft/workiq on first sync. To pre-authenticate: npm install -g @microsoft/workiq; workiq auth login; workiq accept-eula" }

# 6. Desktop shortcut
if (-not $NoShortcut) {
  Write-Step "Creating desktop shortcut"
  $desktop = [Environment]::GetFolderPath("Desktop")
  $lnk = Join-Path $desktop "$AppName.lnk"
  $target = Join-Path $Root "scripts\Start-ExecOS.cmd"
  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($lnk)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $Root
  $sc.Description = "ExecOS - private executive operating intelligence"
  $sc.WindowStyle = 7   # minimized console
  $edge = @("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { $sc.IconLocation = "$edge,0" }
  $sc.Save()
  Write-Ok "Shortcut: $lnk"
}

# 7. Doctor
Write-Step "Running diagnostics"
Push-Location $Root
try { $env:EXECOS_HOME = $DataRoot; & node packages\server\dist\cli.js doctor } finally { Pop-Location }

Write-Host ""
Write-Host "Done. Launch ExecOS from the desktop shortcut or: scripts\Start-ExecOS.cmd" -ForegroundColor Green
Write-Host "Configuration lives in $DataRoot\config (never committed)." -ForegroundColor Green
