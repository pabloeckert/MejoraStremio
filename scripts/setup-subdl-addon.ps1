# Registra (o actualiza) la tarea de Windows Task Scheduler que arranca el
# addon local de SubDL al iniciar sesión.
#
# El addon corre en http://localhost:11337 y sirve subtítulos en español de
# SubDL filtrando SDH (hi=false). Stremio lo instala como addon de subtítulos.
#
# Uso (una sola vez, como Administrador):
#   SUBDL_KEY=... pwsh scripts/setup-subdl-addon.ps1
#   o pasarlo directamente:
#   pwsh scripts/setup-subdl-addon.ps1 -SubdlKey "tu-api-key"
#
# Para desregistrar:
#   Unregister-ScheduledTask -TaskName "StremioSubDLAddon" -Confirm:$false

param(
  [string]$SubdlKey = $env:SUBDL_KEY
)

if (-not $SubdlKey) {
  Write-Error "Falta SUBDL_KEY. Pasarla como -SubdlKey o via env SUBDL_KEY=..."
  exit 1
}

$TaskName   = "StremioSubDLAddon"
$ProjectDir = "C:\Github\MejoraStremio"
$LogDir     = Join-Path $ProjectDir "logs"
$LogFile    = Join-Path $LogDir "subdl-addon.log"
$NodeExe    = "C:\Program Files\nodejs\node.exe"
$Script     = Join-Path $ProjectDir "scripts\subdl-addon.mjs"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# Wrapper: setea SUBDL_KEY antes de lanzar Node, redirige output al log
$WrapperScript = Join-Path $ProjectDir "scripts\_subdl-addon-runner.ps1"
@"
`$env:SUBDL_KEY = '$SubdlKey'
`$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path '$LogFile' -Value "--- Inicio `$ts ---"
& '$NodeExe' '$Script' 2>&1 | Add-Content -Path '$LogFile'
"@ | Set-Content -Path $WrapperScript -Encoding UTF8

$Action = New-ScheduledTaskAction `
  -Execute "pwsh.exe" `
  -Argument "-WindowStyle Hidden -NonInteractive -File `"$WrapperScript`"" `
  -WorkingDirectory $ProjectDir

# Trigger: al iniciar sesión del usuario actual
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -RunOnlyIfNetworkAvailable

$Principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$Params = @{
  TaskName    = $TaskName
  Action      = $Action
  Trigger     = $Trigger
  Settings    = $Settings
  Principal   = $Principal
  Description = "Addon local Stremio para subtítulos SubDL en español sin SDH. Puerto 11337."
  Force       = $true
}

Register-ScheduledTask @Params | Out-Null

Write-Host "Tarea '$TaskName' registrada. Arranca al iniciar sesión."
Write-Host "Puerto: http://localhost:11337/manifest.json"
Write-Host "Logs: $LogFile"
Write-Host ""
Write-Host "Para arrancar ahora sin reiniciar:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "Para instalar en Stremio:"
Write-Host "  Stremio → Addons → Buscar addon → pegar: http://localhost:11337/manifest.json"
Write-Host ""
Write-Host "Para desregistrar:"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
