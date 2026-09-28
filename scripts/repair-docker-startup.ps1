[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DockerRoot
)

$ErrorActionPreference = "Stop"

function Get-FullPath([string]$Path) {
  return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd('\')
}

$localAppData = Get-FullPath $env:LOCALAPPDATA
$dockerRootPath = Get-FullPath $DockerRoot
$perUserDockerRoot = Get-FullPath (Join-Path $localAppData "Programs\DockerDesktop")

if ($dockerRootPath.Equals($perUserDockerRoot, [StringComparison]::OrdinalIgnoreCase)) {
  # Die vorhandene Installation wurde bewusst als Benutzerinstallation angelegt.
  # Fehlt dieser Eintrag, kann Docker Desktop seinen Backend-Pfad nicht bestimmen.
  $registryPath = "HKCU:\SOFTWARE\Docker Inc.\Docker Desktop"
  $registeredLocation = (Get-ItemProperty -Path $registryPath -Name "InstallLocation" -ErrorAction SilentlyContinue).InstallLocation
  if (-not $dockerRootPath.Equals([string]$registeredLocation, [StringComparison]::OrdinalIgnoreCase)) {
    New-Item -Path $registryPath -Force | Out-Null
    New-ItemProperty -Path $registryPath -Name "InstallLocation" -Value $dockerRootPath -PropertyType String -Force | Out-Null
  }
}

# Laufzeitdateien dürfen nur angefasst werden, wenn wirklich kein Docker-Prozess
# mehr läuft. Images, Volumes und die WSL-Datenträger liegen in anderen Ordnern.
$dockerProcesses = Get-Process -Name "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue
if ($dockerProcesses) {
  exit 0
}

$runtimeTargets = @(
  @{
    Path = Join-Path $localAppData "Docker\run"
    Markers = @("sailor-ingest.sock", "dockerInference")
  },
  @{
    Path = Join-Path $localAppData "docker-secrets-engine"
    Markers = @("engine.sock")
  }
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
foreach ($target in $runtimeTargets) {
  $candidate = $target.Path
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    continue
  }

  $containsKnownSocket = $false
  foreach ($marker in $target.Markers) {
    if (Test-Path -LiteralPath (Join-Path $candidate $marker)) {
      $containsKnownSocket = $true
      break
    }
  }
  if (-not $containsKnownSocket) {
    continue
  }

  $source = (Resolve-Path -LiteralPath $candidate).Path.TrimEnd('\')
  if (-not $source.StartsWith($localAppData + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsicherer Docker-Laufzeitpfad: $source"
  }

  $destination = "$source.saved-$timestamp"
  $counter = 1
  while (Test-Path -LiteralPath $destination) {
    $destination = "$source.saved-$timestamp-$counter"
    $counter += 1
  }

  Move-Item -LiteralPath $source -Destination $destination
  Write-Host "Veraltete Docker-Laufzeitdateien wurden gesichert: $destination"
}
