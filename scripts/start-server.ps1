[CmdletBinding()]
param(
  [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$composeFile = Join-Path $projectRoot "docker-compose.yml"
$mirrorComposeFile = Join-Path $projectRoot "docker-compose.mirror.yml"
$environmentFile = Join-Path $projectRoot ".env.server"
$backupDirectory = Join-Path $projectRoot "data\Sicherungen"
Set-Location -LiteralPath $projectRoot

$oneDriveRoots = @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer) |
  Where-Object { $_ } |
  ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') } |
  Select-Object -Unique
if ($oneDriveRoots | Where-Object { $projectRoot.StartsWith($_ + '\', [StringComparison]::OrdinalIgnoreCase) }) {
  Write-Host "WARNUNG: Dieser Ordner liegt in OneDrive." -ForegroundColor Yellow
  Write-Host "Vor echten Schuelerdaten den gesamten App-Ordner auf den Schulserver oder einen nicht synchronisierten Datentraeger verschieben; .env.server und Datenbanksicherungen sind sensibel." -ForegroundColor Yellow
}

function Stop-WithMessage([string]$Message) {
  Write-Host "FEHLER: $Message" -ForegroundColor Red
  exit 1
}

function New-RandomHex([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Read-Settings([string]$Path) {
  $result = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $result }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed.Split(@("="), 2, [StringSplitOptions]::None)
    $result[$parts[0].Trim()] = $parts[1]
  }
  return $result
}

function Write-Settings([string]$Path, [hashtable]$Settings) {
  $preferredOrder = @(
    "POSTGRES_PASSWORD", "BETTER_AUTH_SECRET", "PUBLIC_URL", "WEB_ORIGINS", "APP_BIND_ADDRESS", "TRUST_PROXY"
  )
  $lines = New-Object Collections.Generic.List[string]
  $lines.Add("# Automatisch erzeugt. Enthaelt Server-Geheimnisse und darf nicht veroeffentlicht werden.")
  foreach ($key in $preferredOrder) {
    if ($Settings.ContainsKey($key)) { $lines.Add("$key=$($Settings[$key])") }
  }
  foreach ($key in ($Settings.Keys | Sort-Object)) {
    if ($preferredOrder -notcontains $key -and -not $key.StartsWith("BOOTSTRAP_TEACHER_")) {
      $lines.Add("$key=$($Settings[$key])")
    }
  }
  $temporaryPath = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
  try {
    [IO.File]::WriteAllLines($temporaryPath, $lines, (New-Object Text.UTF8Encoding($false)))
    # Temp-Datei und Ziel liegen im selben Ordner. Das Umbenennen verhindert,
    # dass bei einem Abbruch eine nur halb geschriebene Konfiguration bleibt.
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-LanAddress {
  $addresses = @()
  try {
    $addresses = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
      ForEach-Object {
        $route = $_
        $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
        $ipInterface = Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
        Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
          ForEach-Object {
            [PSCustomObject]@{
              Address = $_.IPAddress
              # Physische LAN-/WLAN-Adapter haben Vorrang vor VPN-, WSL- und
              # Docker-Adaptern. Innerhalb dieser Gruppe gewinnt die Route
              # mit der kleinsten kombinierten Windows-Metrik.
              VirtualPenalty = if ($adapter -and $adapter.HardwareInterface) { 0 } else { 1 }
              Metric = [int]$route.RouteMetric + [int]($ipInterface.InterfaceMetric | Select-Object -First 1)
            }
          }
      } |
      Sort-Object VirtualPenalty, Metric |
      Select-Object -ExpandProperty Address -Unique
  } catch { }
  if (-not $addresses) {
    try {
      $addresses = [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } |
        ForEach-Object { $_.IPAddressToString } |
        Where-Object { $_ -notmatch '^(127\.|169\.254\.)' }
    } catch { }
  }
  return $addresses | Select-Object -First 1
}

function ConvertTo-PlainText([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Test-LocalTcpPort([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $connection = $client.ConnectAsync("127.0.0.1", $Port)
    return $connection.Wait(800) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

# Windows PowerShell 5 wandelt erwartbare STDERR-Ausgaben nativer Programme bei
# $ErrorActionPreference="Stop" sonst in abbrechende NativeCommandError um. Die
# Funktion wird nur fuer reine Verfuegbarkeitsabfragen verwendet.
function Invoke-NativeProbe([string]$FilePath, [string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "SilentlyContinue"
    & $FilePath @Arguments *> $null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Wait-ForDocker([string]$DockerPath, [int]$Attempts = 24) {
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    Start-Sleep -Seconds 5
    if ((Invoke-NativeProbe $DockerPath @("version")) -eq 0) { return $true }
  }
  return $false
}

function Start-DockerDesktop([string]$DesktopPath) {
  if (-not (Get-Process -Name "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue)) {
    Write-Host "Docker Desktop wird gestartet ..."
    Start-Process -FilePath $DesktopPath -WindowStyle Hidden
  }
}

$dockerRoots = @(
  (Join-Path $env:ProgramFiles "Docker\Docker"),
  (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop")
) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "resources\bin\docker.exe")) }

$dockerRoot = $dockerRoots | Select-Object -First 1
$dockerPath = if ($dockerRoot) { Join-Path $dockerRoot "resources\bin\docker.exe" } else { $null }
if (-not $dockerPath) {
  $dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($dockerCommand) { $dockerPath = $dockerCommand.Source }
}
if (-not $dockerPath) {
  Stop-WithMessage "Docker Desktop wurde nicht gefunden. Bitte Docker Desktop installieren."
}

$dockerStatus = Invoke-NativeProbe $dockerPath @("version")
if ($dockerStatus -ne 0) {
  $ready = $false
  if ($dockerRoot) {
    $desktopPath = Join-Path $dockerRoot "Docker Desktop.exe"
    if (Test-Path -LiteralPath $desktopPath) {
      Start-DockerDesktop $desktopPath
      $ready = Wait-ForDocker $dockerPath
    }
  }

  # Erst wenn der normale Start wirklich fehlgeschlagen ist, wird die eng
  # begrenzte Reparatur fuer die bereits beobachteten Docker-Desktop-Fehler
  # ausgefuehrt. So fasst ein normaler Kaltstart keine Laufzeitdateien an.
  if (-not $ready -and $dockerRoot) {
    Write-Host "Der normale Docker-Start ist fehlgeschlagen. Fuehre eine gezielte Reparatur aus ..." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "repair-docker-startup.ps1") -DockerRoot $dockerRoot
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Docker Desktop konnte nicht vorbereitet werden." }
    if (Test-Path -LiteralPath $desktopPath) {
      Start-DockerDesktop $desktopPath
      $ready = Wait-ForDocker $dockerPath
    }
  }
  if (-not $ready) { Stop-WithMessage "Docker Desktop wurde nicht rechtzeitig bereit." }
}

$settings = Read-Settings $environmentFile
if (-not $settings.ContainsKey("POSTGRES_PASSWORD")) {
  $volumeStatus = Invoke-NativeProbe $dockerPath @("volume", "inspect", "appplanner2_gn_planer_postgres")
  if ($volumeStatus -eq 0) {
    Stop-WithMessage "Die Datenbank ist vorhanden, aber ihr Kennwort fehlt in .env.server. Zum Schutz der Daten wird nicht geraten oder ueberschrieben. Bitte .env.server aus der Sicherung wiederherstellen."
  } else {
    $settings["POSTGRES_PASSWORD"] = New-RandomHex 24
  }
}
if (-not $settings.ContainsKey("BETTER_AUTH_SECRET") -or $settings["BETTER_AUTH_SECRET"].Length -lt 32) {
  $settings["BETTER_AUTH_SECRET"] = New-RandomHex 48
}

$publicUrlOverride = ""
if ($LocalOnly) {
  $publicUrl = "http://localhost:3001"
  $settings["APP_BIND_ADDRESS"] = "127.0.0.1"
} else {
  $publicUrlOverride = if ($settings.ContainsKey("PUBLIC_URL_OVERRIDE")) {
    $settings["PUBLIC_URL_OVERRIDE"].Trim().TrimEnd("/")
  } else { "" }
  if ($publicUrlOverride) {
    $parsedPublicUrl = $null
    if (-not [Uri]::TryCreate($publicUrlOverride, [UriKind]::Absolute, [ref]$parsedPublicUrl) -or
        $parsedPublicUrl.Scheme -notin @("http", "https") -or $parsedPublicUrl.AbsolutePath -ne "/") {
      Stop-WithMessage "PUBLIC_URL_OVERRIDE muss eine vollstaendige HTTP- oder HTTPS-Adresse ohne Unterpfad sein."
    }
    $publicUrl = $publicUrlOverride
  } else {
    $lanAddress = Get-LanAddress
    if (-not $lanAddress) { Stop-WithMessage "Es konnte keine Netzwerkadresse dieses Rechners ermittelt werden." }
    $publicUrl = "http://${lanAddress}:3001"
  }
  $bindOverride = if ($settings.ContainsKey("APP_BIND_ADDRESS_OVERRIDE")) {
    $settings["APP_BIND_ADDRESS_OVERRIDE"].Trim()
  } else { "" }
  if ($bindOverride -and $bindOverride -notin @("0.0.0.0", "127.0.0.1")) {
    Stop-WithMessage "APP_BIND_ADDRESS_OVERRIDE darf nur 0.0.0.0 oder 127.0.0.1 sein."
  }
  if ($bindOverride -eq "127.0.0.1" -and -not $publicUrlOverride) {
    Stop-WithMessage "APP_BIND_ADDRESS_OVERRIDE=127.0.0.1 benoetigt fuer den Serverbetrieb eine PUBLIC_URL_OVERRIDE (z. B. fuer einen Reverse-Proxy)."
  }
  $settings["APP_BIND_ADDRESS"] = if ($bindOverride) { $bindOverride } else { "0.0.0.0" }
}
$settings["PUBLIC_URL"] = $publicUrl
$webOriginsOverride = if ($settings.ContainsKey("WEB_ORIGINS_OVERRIDE")) {
  $settings["WEB_ORIGINS_OVERRIDE"].Trim()
} else { "" }
$settings["WEB_ORIGINS"] = if ($LocalOnly) {
  "http://localhost:3001,http://127.0.0.1:3001"
} elseif ($webOriginsOverride) {
  $webOriginsOverride
} elseif ($publicUrlOverride) {
  $publicUrl
} else {
  $publicUrl
}
if (-not $settings.ContainsKey("TRUST_PROXY")) { $settings["TRUST_PROXY"] = "false" }
Write-Settings $environmentFile $settings
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

$composeArguments = @("compose", "--env-file", $environmentFile, "-f", $composeFile)
$mirrorHostDirectory = if ($settings.ContainsKey("BACKUP_MIRROR_HOST_DIRECTORY")) {
  $settings["BACKUP_MIRROR_HOST_DIRECTORY"].Trim()
} else { "" }
if ($mirrorHostDirectory) {
  if (Test-Path -LiteralPath $mirrorHostDirectory -PathType Container) {
    $composeArguments += @("-f", $mirrorComposeFile)
    Write-Host "Zweites Sicherungsziel: $mirrorHostDirectory"
  } else {
    Write-Host "WARNUNG: Das optionale zweite Sicherungsziel ist derzeit nicht erreichbar. Lokale Sicherungen bleiben aktiv." -ForegroundColor Yellow
  }
}

# Ein fremder oder noch manuell gestarteter Prozess auf Port 3001 wird nie
# automatisch beendet. Ein bereits laufender Compose-Container darf dagegen
# kontrolliert aktualisiert werden.
if (Test-LocalTcpPort 3001) {
  $composeAppId = (& $dockerPath @composeArguments ps -q app 2>$null | Out-String).Trim()
  if (-not $composeAppId) {
    Stop-WithMessage "Auf Port 3001 laeuft noch eine manuell gestartete Planer-Version. Bitte deren schwarzes Fenster mit Strg+C beenden und den Starter erneut oeffnen."
  }
}

Write-Host "Baue und starte App Planner 2. Beim ersten Mal kann dies einige Minuten dauern ..."
& $dockerPath @composeArguments up -d --build
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Die Docker-Dienste konnten nicht gestartet werden." }

$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Seconds 3
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/health" -TimeoutSec 2
    if ($health.status -eq "ok") { $healthy = $true; break }
  } catch { }
}
if (-not $healthy) {
  & $dockerPath @composeArguments logs --tail 80 app
  Stop-WithMessage "Die Anwendung wurde nicht rechtzeitig bereit. Die letzten Servermeldungen stehen oben."
}

$teacherCount = (& $dockerPath @composeArguments exec -T postgres psql -U gn_planer -d gn_planer -tAc "SELECT count(*) FROM teacher_profiles" | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Der Kontostand konnte nicht geprueft werden." }

if ($teacherCount -eq "0") {
  Write-Host ""
  Write-Host "Ersteinrichtung: Es gibt noch kein Administrationskonto." -ForegroundColor Cyan
  do {
    $loginId = (Read-Host "Anmelde-ID des Administrators [admin]").Trim()
    if (-not $loginId) { $loginId = "admin" }
    $validLogin = $loginId -match '^[A-Za-z0-9._-]{3,32}$'
    if (-not $validLogin) { Write-Host "Bitte 3-32 Zeichen ohne Leerzeichen verwenden." -ForegroundColor Yellow }
  } until ($validLogin)
  $displayName = (Read-Host "Anzeigename [Administration]").Trim()
  if (-not $displayName) { $displayName = "Administration" }

  do {
    $password = ConvertTo-PlainText (Read-Host "Neues Admin-Passwort (mindestens 12 Zeichen)" -AsSecureString)
    $confirmation = ConvertTo-PlainText (Read-Host "Passwort wiederholen" -AsSecureString)
    $validPassword = $password.Length -ge 12 -and $password -ceq $confirmation
    if (-not $validPassword) { Write-Host "Die Passwoerter muessen uebereinstimmen und mindestens 12 Zeichen lang sein." -ForegroundColor Yellow }
  } until ($validPassword)

  $oldId = $env:BOOTSTRAP_TEACHER_ID
  $oldName = $env:BOOTSTRAP_TEACHER_NAME
  $oldPassword = $env:BOOTSTRAP_TEACHER_PASSWORD
  try {
    $env:BOOTSTRAP_TEACHER_ID = $loginId
    $env:BOOTSTRAP_TEACHER_NAME = $displayName
    $env:BOOTSTRAP_TEACHER_PASSWORD = $password
    & $dockerPath @composeArguments run --rm --no-deps --entrypoint pnpm app bootstrap:teacher
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Das Administrationskonto konnte nicht angelegt werden." }
  } finally {
    $env:BOOTSTRAP_TEACHER_ID = $oldId
    $env:BOOTSTRAP_TEACHER_NAME = $oldName
    $env:BOOTSTRAP_TEACHER_PASSWORD = $oldPassword
    $password = $null
    $confirmation = $null
  }
}

Write-Host ""
Write-Host "App Planner 2 ist bereit: $publicUrl" -ForegroundColor Green
if ($LocalOnly) {
  Write-Host "Lokaler Test: Die Adresse ist nur auf diesem Rechner vorgesehen."
} else {
  Write-Host "Tablets und andere Rechner im selben Netzwerk oeffnen genau diese Adresse."
}
Write-Host "Datenbank und Anwendung laufen als Docker-Dienste im Hintergrund weiter."
Start-Process $publicUrl
