# Wann die Wand laeuft: Montag bis Freitag, ausser an den Tagen in kiosk\ruhetage.txt.
# Die iMacs kennen nur Wochentage (pmset); um Ruhetage kuemmert sich der Server:
#   plan.ps1 abend   (Mo-Fr 21:00, die iMacs laufen noch) kommt als Naechstes ein Ruhetag, schalten sie sich
#                    erst am ersten Tag danach wieder ein; sonst der normale Wochenplan.
#   plan.ps1 check   (taeglich 17:05) ist heute ein Ruhetag und ein iMac doch an: herunterfahren.
# Probelauf: -dry zeigt nur, was passieren wuerde; -today 2026-12-22 tut so, als waere heute dieser Tag.
param([string]$mode = 'check', [switch]$dry, [string]$today = '')
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$imacs = Join-Path $PSScriptRoot 'imacs-task.ps1'
function Invoke-Imacs([string]$command) {
  if ($dry) { "wuerde ausfuehren: imacs.sh $command" } else { & $imacs $command }
}

$closed = @()
foreach ($line in Get-Content (Join-Path $root 'kiosk\ruhetage.txt') -Encoding UTF8) {
  if ($line -match '^\s*(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})') {
    $closed += , @([datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null), [datetime]::ParseExact($Matches[2], 'yyyy-MM-dd', $null))
  }
}
function Test-Open([datetime]$day) {
  if ($day.DayOfWeek -in 'Saturday', 'Sunday') { return $false }
  foreach ($range in $closed) { if ($day -ge $range[0] -and $day -le $range[1]) { return $false } }
  return $true
}

$day = if ($today) { [datetime]::ParseExact($today, 'yyyy-MM-dd', $null) } else { (Get-Date).Date }
if ($mode -eq 'check') {
  if (-not (Test-Open $day)) { Invoke-Imacs 'shutdown' } elseif ($dry) { 'heute offen, nichts zu tun' }
  exit 0
}

# abend: der naechste Werktag und der naechste Tag, an dem die Wand wirklich laeuft.
$weekday = $day.AddDays(1)
while ($weekday.DayOfWeek -in 'Saturday', 'Sunday') { $weekday = $weekday.AddDays(1) }
$open = $weekday
while (-not (Test-Open $open)) { $open = $open.AddDays(1) }
if ($open -eq $weekday) { Invoke-Imacs 'schedule 16:55 21:30 MTWRF' }
else { Invoke-Imacs "pause $($open.ToString('yyyy-MM-dd')) 16:55 21:30" }
