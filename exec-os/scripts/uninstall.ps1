<#
.SYNOPSIS  Removes the ExecOS desktop shortcut and optionally all private local data.
.PARAMETER PurgeData   Delete %LOCALAPPDATA%\ExecOS entirely (evidence, state, journal, logs, config).
#>
[CmdletBinding()]
param([switch]$PurgeData)
$DataRoot = if ($env:EXECOS_HOME) { $env:EXECOS_HOME } else { Join-Path $env:LOCALAPPDATA "ExecOS" }
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "ExecOS.lnk"
if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed shortcut $lnk" }
if ($PurgeData) {
  if (Test-Path $DataRoot) {
    $answer = Read-Host "Delete ALL ExecOS local data in $DataRoot ? Type DELETE to confirm"
    if ($answer -eq "DELETE") { Remove-Item -Recurse -Force $DataRoot; Write-Host "Deleted $DataRoot" } else { Write-Host "Cancelled." }
  } else { Write-Host "No data directory at $DataRoot" }
} else { Write-Host "Local data kept at $DataRoot (use -PurgeData to remove)." }
