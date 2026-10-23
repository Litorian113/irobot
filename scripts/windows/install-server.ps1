# Macht diesen Windows-Rechner zum Server der Wand (einmal, als Administrator):
#   - Aufgabe "HfG Koepfe Server": wall-server.cmd ab dem Hochfahren, als SYSTEM, auch ohne Anmeldung
#   - Aufgabe "HfG Koepfe Kamera": camera.ps1 bei der Anmeldung dieses Benutzers
#   - Aufgabe "HfG Koepfe WLAN": wlan.ps1 bei der Anmeldung, haelt das WLAN "hfg" verbunden
#   - Aufgabe "HfG Koepfe Update": auto-update.ps1 alle 2 Minuten, rollt neue Staende von GitHub aus
#   - Aufgaben "HfG Koepfe Zeitplan" (Mo-Fr 21:00) und "HfG Koepfe Ruhetage" (taeglich 17:05): plan.ps1
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

$update = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\windows\auto-update.ps1`""
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 2)
$once = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
# Mit Admin-Rechten: der Deploy beendet den Wand-Server, und der laeuft als SYSTEM.
Register-ScheduledTask -TaskName 'HfG Koepfe Update' -Action $update -Trigger $every `
  -Principal (New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest) -Settings $once -Force | Out-Null

# Wann die Wand laeuft (plan.ps1, kiosk\ruhetage.txt): Mo-Fr 21:00 den naechsten Einschalttag setzen,
# taeglich 17:05 an Ruhetagen einen iMac herunterfahren, der sich doch eingeschaltet hat.
Get-ScheduledTask -TaskName 'HfG Koepfe Wochenende' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
$admin = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$plan = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\windows\plan.ps1`""
Register-ScheduledTask -TaskName 'HfG Koepfe Zeitplan' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "$plan abend") `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At '21:00') `
  -Principal $admin -Settings $once -Force | Out-Null
Register-ScheduledTask -TaskName 'HfG Koepfe Ruhetage' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "$plan check") `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '17:05') -Principal $admin -Settings $once -Force | Out-Null

# Wand (8080) und Setup (8090) aus dem Kabelnetz der iMacs und dem HfG-Netz (fuer die Seite im WLAN).
# Fuer jedes Profil: ein Netz ohne Router wie das der iMacs stuft Windows nach jedem Neustart als oeffentlich ein.
Get-NetFirewallRule -DisplayName 'HfG Koepfe Wand' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'HfG Koepfe Wand' -Direction Inbound -Protocol TCP -LocalPort 8080,8090 -Action Allow `
  -Profile Any -RemoteAddress '192.168.0.0/24', '172.16.0.0/12', 'LocalSubnet' | Out-Null

# Der Server soll nie schlafen gehen.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Start-ScheduledTask -TaskName 'HfG Koepfe Server'
Start-ScheduledTask -TaskName 'HfG Koepfe WLAN'
"Eingerichtet: HfG Koepfe Server (beim Hochfahren), HfG Koepfe Kamera und HfG Koepfe WLAN (bei der Anmeldung von $user)"
