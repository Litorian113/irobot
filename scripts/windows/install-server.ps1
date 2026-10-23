# Macht diesen Windows-Rechner zum Server der Wand (einmal, als Administrator):
#   - Aufgabe "HfG Koepfe Server": wall-server.cmd ab dem Hochfahren, als SYSTEM, auch ohne Anmeldung
#   - Aufgabe "HfG Koepfe Kamera": camera.ps1 bei der Anmeldung dieses Benutzers
#   - Aufgabe "HfG Koepfe WLAN": wlan.ps1 bei der Anmeldung, haelt das WLAN "hfg" verbunden
# Erneut ausfuehren schadet nicht.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force (Join-Path $root 'logs') | Out-Null

$forever = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

$server = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$root\scripts\windows\wall-server.cmd`"" -WorkingDirectory $root
Register-ScheduledTask -TaskName 'HfG Koepfe Server' -Action $server -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Settings $forever -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

# The real account name: over SSH USERDOMAIN says WORKGROUP.
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$camera = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\windows\camera.ps1`""
Register-ScheduledTask -TaskName 'HfG Koepfe Kamera' -Action $camera -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) `
  -Principal (New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive) -Settings $forever -Force | Out-Null

$wlan = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\windows\wlan.ps1`""
Register-ScheduledTask -TaskName 'HfG Koepfe WLAN' -Action $wlan -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) `
  -Principal (New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive) -Settings $forever -Force | Out-Null

# Der Server soll nie schlafen gehen.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Start-ScheduledTask -TaskName 'HfG Koepfe Server'
Start-ScheduledTask -TaskName 'HfG Koepfe WLAN'
"Eingerichtet: HfG Koepfe Server (beim Hochfahren), HfG Koepfe Kamera und HfG Koepfe WLAN (bei der Anmeldung von $user)"
