# Rollt neue Staende von GitHub von selbst aus: alle 2 Minuten nachsehen, ob der Branch weiter ist,
# dann deploy.ps1 (holen, bauen, Server und Bildschirme neu starten). Damit reicht von ueberall ein git push.
# Laeuft als Aufgabe "HfG Koepfe Update"; was passiert, steht in logs\deploy.log.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:Path"
git fetch -q origin 2>$null
if ($LASTEXITCODE -ne 0) { exit 0 }
# Gearbeitet wird auf main. Folgt der Server noch dem alten Branch, zieht er um: die Dateien bleiben,
# HEAD steht dann hinter origin/main und das Deploy unten holt den neuen Stand.
if ((git rev-parse --abbrev-ref HEAD).Trim() -eq 'feat/kamera-koepfe') {
  git checkout -q -B main 2>$null
  git branch -q --set-upstream-to=origin/main main 2>$null
}
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ((git rev-parse HEAD).Trim() -eq (git rev-parse "origin/$branch").Trim()) { exit 0 }
$log = Join-Path $root 'logs\deploy.log'
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') neuer Stand auf origin/$branch" | Out-File -Append -Encoding utf8 $log
& (Join-Path $PSScriptRoot 'deploy.ps1') *>&1 | Out-File -Append -Encoding utf8 $log
