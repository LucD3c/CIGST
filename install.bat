@echo off
rem ==========================================================================
rem CIGST - Instalador para Windows: hace doble click aca y listo.
rem Lanza install.ps1 sin que tengas que abrir una terminal ni cambiar la
rem politica de ejecucion de PowerShell a mano (-ExecutionPolicy Bypass solo
rem aplica a esta ejecucion, no cambia nada en el sistema).
rem No requiere permisos de administrador.
rem ==========================================================================
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo El instalador termino con un error. Revisa el mensaje de arriba
  echo y el archivo install.log en esta misma carpeta.
  pause
)
endlocal
