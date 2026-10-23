# Die Kamera-Seite: wartet, bis der Wand-Server antwortet, dann Chrome im Vollbild mit der Webcam.
# Laeuft als Aufgabe "HfG Koepfe Kamera" bei der Anmeldung (die Kamera braucht eine Sitzung am Bildschirm).
# 127.0.0.1, not localhost: Windows tries IPv6 first, the server listens on IPv4. Both count as secure for the camera.
$url = 'http://127.0.0.1:8080/?slot=4&camera=1&preview=1'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Start-Transcript -Path (Join-Path $root 'logs\camera.log') -Append | Out-Null
while ($true) {
  try { Invoke-WebRequest 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Write-Output "Server noch nicht da: $($_.Exception.Message)"; Start-Sleep -Seconds 3 }
}
Write-Output "Server da, starte Chrome: $url"
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) { $chrome = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' }
# Eigenes Profil; die Kamera ohne Nachfrage freigeben, keine Wiederherstellen-Blase nach einem Absturz.
Start-Process $chrome -ArgumentList @(
  "--user-data-dir=$env:LOCALAPPDATA\hfg-kamera", '--kiosk', '--no-first-run', '--no-default-browser-check',
  '--use-fake-ui-for-media-stream', '--disable-session-crashed-bubble', '--noerrdialogs', $url
)
