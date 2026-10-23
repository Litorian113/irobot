@echo off
rem Der Wand-Server auf dem Windows-Rechner: liefert die Seite aus und verteilt die Blickrichtung
rem (vite preview mit dem Relay aus vite.config.ts). Laeuft als Aufgabe "HfG Koepfe Server" ab dem
rem Hochfahren, auch ohne Anmeldung, und startet nach einem Absturz von selbst neu.
cd /d "%~dp0..\.."
if not exist logs mkdir logs
:loop
echo %date% %time% Wand-Server startet >> logs\wall-server.log
"C:\Program Files\nodejs\node.exe" node_modules\vite\bin\vite.js preview --host 0.0.0.0 --port 8080 --strictPort >> logs\wall-server.log 2>&1
timeout /t 5 /nobreak >nul
goto loop
