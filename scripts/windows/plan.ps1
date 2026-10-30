# Bringt den Zeitplan der Seite auf die iMacs. Die Zeiten liegen in walls\schedule.json, was daraus folgt,
# rechnet der Wand-Server aus (src/schedule.ts, /api/schedule). Ein ausgeschalteter iMac laesst sich nicht wecken
# und nicht einstellen: Er bekommt den Plan, sobald er an ist, und sein Einschalten bis dahin ist das alte.
#   plan.ps1 tick    (alle 2 Minuten, auto-update.ps1) Plan geaendert, oder heute noch nicht gesetzt, und ein iMac an: setzen.
#   plan.ps1 abend   (Mo-Fr 21:00) dasselbe; bleibt als Reserve, falls die 2-Minuten-Aufgabe nicht laeuft.
#   plan.ps1 check   (taeglich 17:05) laut Plan aus und ein iMac doch an (z.B. nach Stromausfall): herunterfahren.
# Probelauf: -dry zeigt nur, was passieren wuerde.
param([string]$mode = 'tick', [switch]$dry)
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$imacs = Join-Path $PSScriptRoot 'imacs-task.ps1'
$appliedFile = Join-Path $root 'walls\schedule-applied.txt'
function Invoke-Imacs([string]$command) {
  if ($dry) { "wuerde ausfuehren: imacs.sh $command" } else { & $imacs $command }
}

# Laeuft der Wand-Server nicht, bleibt alles, wie es ist.
try {
  $plan = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 'http://127.0.0.1:8080/api/schedule'
} catch { exit 0 }
if (-not $plan.command) { exit 0 }

if ($mode -eq 'check') {
  if (-not $plan.on) { Invoke-Imacs 'shutdown' } elseif ($dry) { 'laut Plan an, nichts zu tun' }
  exit 0
}

$today = Get-Date -Format 'yyyy-MM-dd'
$applied = if (Test-Path $appliedFile) { (Get-Content $appliedFile -Raw).Trim() } else { '' }
if ($applied -eq "$($plan.command)|$today") { exit 0 }

# Nur wenn einer an ist: sonst laeuft jede Runde in die Zeitueberschreitung.
$any = $false
foreach ($line in Get-Content (Join-Path $root 'kiosk\.cache\imacs') -ErrorAction SilentlyContinue) {
  $ip = ($line -split '\s+')[1]
  if ($ip -and (Test-Connection -ComputerName $ip -Count 1 -Quiet -ErrorAction SilentlyContinue)) { $any = $true; break }
}
if (-not $any) { if ($dry) { 'kein iMac an' }; exit 0 }

Invoke-Imacs $plan.command
if (-not $dry) { Set-Content -Path $appliedFile -Value "$($plan.command)|$today" -Encoding ascii }
