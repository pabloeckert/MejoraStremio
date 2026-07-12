# Registra (o actualiza) la tarea de Windows Task Scheduler que mantiene
# caliente la instancia de AIOMetadata en ElfHosted, evitando el cold start
# que congela Stremio al abrir.
#
# Corre cada 20 minutos, todos los días, indefinidamente.
# Los logs van a: C:\Github\Herramientas\MejoraStremio\logs\keep-warm.log
#
# Uso (una sola vez, como Administrador):
#   pwsh scripts/setup-keep-warm.ps1
#
# Para desregistrar:
#   Unregister-ScheduledTask -TaskName "StremioKeepWarm" -Confirm:$false

$TaskName   = "StremioKeepWarm"
$ProjectDir = "C:\Github\Herramientas\MejoraStremio"
$LogDir     = Join-Path $ProjectDir "logs"
$LogFile    = Join-Path $LogDir "keep-warm.log"
$NodeExe    = "C:\Program Files\nodejs\node.exe"
$Script     = Join-Path $ProjectDir "scripts\keep-warm.mjs"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$Action = New-ScheduledTaskAction `
  -Execute $NodeExe `
  -Argument "`"$Script`"" `
  -WorkingDirectory $ProjectDir

# Trigger: cada 20 minutos, sin fin
$Trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 20) -Once -At (Get-Date)

$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable

$Principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$Params = @{
  TaskName  = $TaskName
  Action    = $Action
  Trigger   = $Trigger
  Settings  = $Settings
  Principal = $Principal
  Force     = $true
}

Register-ScheduledTask @Params | Out-Null

Write-Host "Tarea '$TaskName' registrada. Corre cada 20 min."
Write-Host "Logs: $LogFile"
Write-Host ""
Write-Host "Para verificar: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "Para desregistrar: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
