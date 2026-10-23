# Neuer Stand von GitHub: holen, Abhaengigkeiten nur wenn noetig, bauen, Wand-Server neu starten.
# Vom Mac:  npm run deploy   (scripts/deploy.sh: git push, dann dieses Skript per SSH)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
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
"Deploy: $($after.Substring(0, 7)) - $(git log -1 --format=%s)"
