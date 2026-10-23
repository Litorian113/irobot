# Haelt das WLAN "hfg" verbunden: nach einem Neustart scheitert die erste Verbindung oft
# ("Treiber waehrend der Zuordnung getrennt"), und Windows versucht es dann nicht weiter.
# Laeuft als Aufgabe "HfG Koepfe WLAN" ab der Anmeldung; ueber dieses WLAN erreicht man den Server.
$network = 'hfg'
while ($true) {
  $ssid = netsh wlan show interfaces | Select-String '^\s+SSID\s+:\s+(.+)$' | ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() } | Select-Object -First 1
  if ($ssid -ne $network) { netsh wlan connect name=$network | Out-Null }
  Start-Sleep -Seconds 30
}
