# Neuer Stand von GitHub: holen, Abhaengigkeiten nur wenn noetig, bauen, Wand-Server neu starten.
# Vom Mac:  npm run deploy   (scripts/deploy.sh: git push, dann dieses Skript per SSH)
# Nicht 'Stop': Vite und Git schreiben Hinweise nach stderr, das waere sonst ein Abbruch. Fehler zeigen die Exitcodes.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
# Nicht zweimal gleichzeitig (von Hand per npm run deploy und vom Auto-Update).
$lock = Join-Path $root 'logs\deploy.lock'
if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 10) { 'Ein Deploy laeuft schon.'; exit 0 }
New-Item -ItemType File -Force $lock | Out-Null
# Ein Fehler landet im Protokoll und gibt die Sperre frei, statt den Deploy stumm abzubrechen.
trap { "Deploy abgebrochen: $_"; Remove-Item $lock -ErrorAction SilentlyContinue; exit 1 }
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:Path"

$before = (git rev-parse HEAD).Trim()
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'git pull ging nicht (lokale Aenderungen auf dem Server?)' }
$after = (git rev-parse HEAD).Trim()
if ($before -ne $after -and ((git diff --name-only $before $after) -match 'package-lock\.json')) {
  npm.cmd ci --no-audit --no-fund
}
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen, der alte Stand laeuft weiter' }

# Der Server-Loop startet node nach dem Beenden von selbst wieder, jetzt mit dem neuen Build.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'vite\.js preview' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Warten, bis er wieder antwortet; dann die Bildschirme neu laden, sonst laufen sie mit dem alten Code weiter.
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
}
& 'C:\Program Files\Git\bin\bash.exe' -lc 'cd /c/hfg/irobot && bash scripts/imacs.sh reload'
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
Start-ScheduledTask -TaskName 'HfG Koepfe Kamera'
Remove-Item $lock -ErrorAction SilentlyContinue
"Deploy: $($after.Substring(0, 7)) - $(git log -1 --format=%s)"
