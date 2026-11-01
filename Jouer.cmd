@echo off
rem Double-clic pour lancer le jeu : npm.cmd passe la ou PowerShell bloque npm.
cd /d "%~dp0"
if not exist node_modules call npm.cmd install
call npm.cmd run dev -- --open
pause
