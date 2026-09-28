$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentFile = Join-Path $projectRoot ".env.server"
$composeFile = Join-Path $projectRoot "docker-compose.yml"

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  Write-Host "FEHLER: Die Serverkonfiguration .env.server wurde nicht gefunden." -ForegroundColor Red
  exit 1
}

$dockerCandidates = @(
  (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
$dockerPath = $dockerCandidates | Select-Object -First 1
if (-not $dockerPath) {
  $dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($dockerCommand) { $dockerPath = $dockerCommand.Source }
}
if (-not $dockerPath) {
  Write-Host "FEHLER: Docker wurde nicht gefunden." -ForegroundColor Red
  exit 1
}

Set-Location -LiteralPath $projectRoot
& $dockerPath compose --env-file $environmentFile -f $composeFile down --timeout 60
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
