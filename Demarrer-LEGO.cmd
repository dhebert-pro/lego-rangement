@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/network-info' -TimeoutSec 2).StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  start "" http://localhost:3000
  echo LEGO Rangement fonctionne deja.
  echo La page vient d'etre ouverte dans le navigateur.
  pause
  exit /b 0
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js n'est pas disponible sur ce PC.
  echo L'application ne demande aucune installation sur le telephone, mais le serveur doit fonctionner sur le PC.
  pause
  exit /b 1
)
echo Demarrage de LEGO Rangement...
echo Gardez cette fenetre ouverte pendant l'utilisation sur le telephone.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
node server.js
echo.
echo Le serveur s'est arrete.
pause
