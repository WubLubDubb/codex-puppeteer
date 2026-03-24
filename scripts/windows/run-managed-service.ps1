param(
  [string]$NodeCommand = "node",
  [int]$RestartDelaySeconds = 5
)

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Entry = Join-Path $ProjectRoot "src\service-entry.js"

while ($true) {
  Write-Host "Starting managed WxCodex service from $Entry"
  & $NodeCommand $Entry
  $ExitCode = $LASTEXITCODE
  Write-Warning "Managed service exited with code $ExitCode. Restarting in $RestartDelaySeconds second(s)..."
  Start-Sleep -Seconds $RestartDelaySeconds
}
