# Fuehrt imacs.sh-Befehle aus der Aufgabenplanung aus und schreibt das Ergebnis nach logs\imacs.log.
# Das Admin-Passwort der iMacs liest imacs.sh aus %USERPROFILE%\.hfg-imac-admin (nur dieses Konto darf es lesen).
#   imacs-task.ps1 "schedule 16:55 21:30 MTWRF" "shutdown"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$log = Join-Path $root 'logs\imacs.log'
foreach ($command in $args) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') imacs.sh $command" | Out-File -Append -Encoding utf8 $log
  & 'C:\Program Files\Git\bin\bash.exe' -lc "cd /c/hfg/irobot && bash scripts/imacs.sh $command" 2>&1 | Out-File -Append -Encoding utf8 $log
}
