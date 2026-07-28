# ============================================================================
# CIGST - Instalador y panel de control por consola (Windows)
#
# Uso normal: doble click en install.bat (que ejecuta este script).
# No requiere permisos de administrador: solo usa Docker Desktop, que ya
# corre con tu usuario. No instala nada en Windows fuera de Docker.
# Compatible con Windows PowerShell 5.1 (el que viene con Windows 10/11).
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$LogFile = Join-Path $PSScriptRoot 'install.log'
$MinDockerMajor = 20
$HealthTimeoutS = 300

# --- Salida con formato ------------------------------------------------------
function Write-Log([string]$Message) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $LogFile -Value "$stamp $Message" -Encoding UTF8
}
function Say([string]$Message)  { Write-Host $Message; Write-Log $Message }
function Ok([string]$Message)   { Say "  [OK] $Message" }
function Bad([string]$Message)  { Say "  [X]  $Message" }
function Warn2([string]$Message){ Say "  [!]  $Message" }
function Title([string]$Message){ Write-Host ""; Say "== $Message ==" }

# --- Ejecucion de comandos nativos ------------------------------------------
# Nota de compatibilidad: en Windows PowerShell 5.1, redirigir el stderr de un
# programa nativo (2>&1, 2>$null) convierte cada linea en un ErrorRecord y,
# con ErrorActionPreference=Stop, puede cortar el script aunque el programa
# haya terminado bien (docker compose escribe su progreso por stderr). Por eso
# aca todo comando nativo pasa por cmd.exe o por Start-Process: PowerShell
# nunca ve el stderr crudo.

# ¿El comando termina con exito? (stdout/stderr descartados)
function Test-Command([string]$CommandLine) {
  & cmd /c "$CommandLine >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

# Captura el stdout de un comando, descartando stderr.
function Invoke-Native([string]$CommandLine) {
  return (& cmd /c "$CommandLine 2>nul")
}

# Ejecuta un comando externo mandando su output a install.log; devuelve $true/$false.
# (el parametro NO puede llamarse $Args: es una variable automatica de PowerShell
# y llegaria siempre vacia)
function Run-Logged([string]$Exe, [string[]]$ArgList) {
  Write-Log ("`$ {0} {1}" -f $Exe, ($ArgList -join ' '))
  $outFile = [System.IO.Path]::GetTempFileName()
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath $Exe -ArgumentList $ArgList -WorkingDirectory $PSScriptRoot `
          -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    Get-Content $outFile -ErrorAction SilentlyContinue | ForEach-Object { Write-Log ("  " + $_) }
    Get-Content $errFile -ErrorAction SilentlyContinue | ForEach-Object { Write-Log ("  " + $_) }
    return ($p.ExitCode -eq 0)
  } finally {
    Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
  }
}

function Pause-BeforeExit {
  Write-Host ""
  Read-Host "Presiona Enter para cerrar esta ventana" | Out-Null
}

# --- Chequeo de requisitos ---------------------------------------------------
function Check-Docker {
  Title "Chequeando requisitos"

  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCmd) {
    Bad "Docker Desktop no esta instalado."
    Say ""
    Say "  Para usar CIGST primero instala Docker Desktop:"
    Say "    https://www.docker.com/products/docker-desktop"
    Say ""
    Say "  Requisitos de Docker Desktop:"
    Say "    - Windows 10/11 de 64 bits"
    Say "    - WSL2 habilitado (el instalador de Docker lo configura solo)"
    Say "    - Virtualizacion activada en la BIOS/UEFI del equipo"
    Say ""
    Say "  Este instalador NO lo instala automaticamente porque requiere permisos"
    Say "  de administrador y un reinicio: es mas seguro que lo hagas vos desde el"
    Say "  instalador oficial. Despues volve a hacer doble click en install.bat."
    Pause-BeforeExit
    exit 1
  }
  Ok "Docker esta instalado."

  if (-not (Test-Command 'docker info')) {
    Bad "Docker Desktop esta instalado pero no esta corriendo."
    Say "  Abrilo desde el menu Inicio (busca 'Docker Desktop') y espera a que el"
    Say "  icono de la ballena en la bandeja quede fijo (sin animacion)."
    Say "  Despues volve a ejecutar install.bat."
    Pause-BeforeExit
    exit 1
  }
  Ok "Docker esta corriendo."

  $version = [string](Invoke-Native 'docker version --format {{.Server.Version}}')
  $major = 0
  if ($version -match '^(\d+)\.') { $major = [int]$Matches[1] }
  if ($major -lt $MinDockerMajor) {
    Bad "Docker '$version' es demasiado viejo o no se pudo leer (se necesita $MinDockerMajor o mas nuevo)."
    Say "  Actualiza Docker Desktop desde la misma aplicacion (Settings > Software updates)."
    Pause-BeforeExit
    exit 1
  }
  Ok "Version de Docker: $version (minimo requerido: $MinDockerMajor)."

  if (-not (Test-Command 'docker compose version')) {
    Bad "El plugin 'docker compose' (v2) no esta disponible."
    Say "  Viene incluido en Docker Desktop: actualizalo a una version reciente."
    Pause-BeforeExit
    exit 1
  }
  Ok "Docker Compose v2 disponible."
}

# --- Configuracion del .env --------------------------------------------------
function New-RandomPassword {
  # Solo letras y numeros: evita cualquier problema de escapes en .env/compose.
  $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $bytes = New-Object byte[] 20
  $rng.GetBytes($bytes)
  $result = ''
  foreach ($b in $bytes) { $result += $chars[$b % $chars.Length] }
  return $result
}

function Set-EnvVar([string]$Key, [string]$Value) {
  $lines = Get-Content '.env'
  $updated = $lines | ForEach-Object {
    if ($_ -match ('^' + [regex]::Escape($Key) + '=')) { "$Key=$Value" } else { $_ }
  }
  # UTF-8 sin BOM: docker compose no siempre tolera el BOM en la primera linea.
  [System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), $updated, (New-Object System.Text.UTF8Encoding($false)))
}

# Lee una contraseña sin mostrarla en pantalla. Si la entrada esta redirigida
# (pruebas automatizadas), cae a lectura simple porque no hay consola real.
function Read-Password([string]$Prompt) {
  while ($true) {
    $plain = ''
    if ([Console]::IsInputRedirected) {
      Write-Host -NoNewline $Prompt
      $plain = [Console]::In.ReadLine()
      if ($null -eq $plain) { $plain = '' }
      Write-Host ""
    } else {
      $secure = Read-Host -Prompt $Prompt -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    if ($plain -eq '') { return '' }
    if ($plain -match '^[A-Za-z0-9._!@#%^*+=-]{8,64}$') { return $plain }
    Say "  La contraseña debe tener entre 8 y 64 caracteres y usar solo letras,"
    Say "  numeros o . _ ! @ # % ^ * + = -  (sin espacios ni comillas)."
  }
}

function Setup-Env {
  if (Test-Path '.env') {
    Ok "Ya existe un archivo .env: se respeta la configuracion actual."
    return
  }
  Title "Configuracion inicial (.env)"
  Say "No existe .env todavia: se crea a partir de .env.example."
  Say "Podes apretar Enter en cada pregunta para usar un valor seguro por defecto."
  Copy-Item '.env.example' '.env'

  $adminPass = Read-Password "  Contraseña del usuario administrador [Enter = generar una aleatoria]"
  if ($adminPass -eq '') {
    $adminPass = New-RandomPassword
    Say "  Se genero una contraseña aleatoria (quedo guardada en .env, no se muestra aca)."
  }

  $pgPass = Read-Password "  Contraseña interna de la base de datos [Enter = generar una aleatoria]"
  if ($pgPass -eq '') {
    $pgPass = New-RandomPassword
    Say "  Se genero una contraseña aleatoria para la base (guardada en .env)."
  }

  $port = Read-Host "  Puerto donde va a quedar la plataforma [Enter = 3000]"
  if ($port -notmatch '^\d+$') {
    if ($port -ne '') { Say "  Valor no numerico: se usa 3000." }
    $port = '3000'
  }

  Set-EnvVar 'SEED_ADMIN_PASSWORD' $adminPass
  Set-EnvVar 'POSTGRES_PASSWORD' $pgPass
  Set-EnvVar 'APP_PORT' $port
  Ok "Archivo .env creado. Guardalo en un lugar seguro: contiene las contraseñas."
}

function Get-EnvValue([string]$Key) {
  if (-not (Test-Path '.env')) { return '' }
  $line = Get-Content '.env' | Where-Object { $_ -match ('^' + [regex]::Escape($Key) + '=') } | Select-Object -First 1
  if ($line) { return $line.Substring($Key.Length + 1) }
  return ''
}

# --- Estado / salud ----------------------------------------------------------
function Get-ServiceHealth([string]$Service) {
  $cid = (Invoke-Native "docker compose ps -aq $Service") | Select-Object -First 1
  if (-not $cid) { return 'missing' }
  $status = [string](Invoke-Native "docker inspect -f ""{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"" $cid")
  if (-not $status) { return 'missing' }
  return $status.Trim()
}

function Get-MigrateResult {
  $cid = (Invoke-Native 'docker compose ps -aq migrate') | Select-Object -First 1
  if (-not $cid) { return 'missing' }
  $status = ([string](Invoke-Native "docker inspect -f ""{{.State.Status}}"" $cid")).Trim()
  if ($status -ne 'exited') { return 'pending' }
  $code = ([string](Invoke-Native "docker inspect -f ""{{.State.ExitCode}}"" $cid")).Trim()
  if ($code -eq '0') { return 'ok' }
  return 'fail'
}

function Show-Status {
  Title "Estado de los servicios"
  $db = Get-ServiceHealth 'db'
  $app = Get-ServiceHealth 'app'
  $mig = Get-MigrateResult

  switch ($db) {
    'healthy'  { Ok  "Base de datos: funcionando." }
    'starting' { Warn2 "Base de datos: iniciando..." }
    'missing'  { Bad "Base de datos: no esta creada (usa la opcion 1 para instalar)." }
    default    { Bad "Base de datos: con problemas ($db). Mira los logs (opcion 3)." }
  }
  switch ($mig) {
    'ok'      { Ok  "Migraciones y datos iniciales: aplicados." }
    'pending' { Warn2 "Migraciones: en curso..." }
    'missing' { Bad "Migraciones: sin ejecutar todavia." }
    default   { Bad "Migraciones: fallaron. Mira los logs (opcion 3)." }
  }
  switch ($app) {
    'healthy'  { Ok  "Aplicacion: funcionando." }
    'starting' { Warn2 "Aplicacion: iniciando..." }
    'missing'  { Bad "Aplicacion: no esta creada (usa la opcion 1 para instalar)." }
    default    { Bad "Aplicacion: con problemas ($app). Mira los logs (opcion 3)." }
  }

  if ($app -eq 'healthy') {
    $port = Get-EnvValue 'APP_PORT'
    if (-not $port) { $port = '3000' }
    Say ""
    Say "  => Plataforma disponible en: http://localhost:$port"
  }
}

# --- Acciones del menu -------------------------------------------------------
function Diagnose-Failure {
  Say ""
  Bad "Algo fallo durante el arranque. Causas mas comunes:"
  $logTail = ''
  if (Test-Path $LogFile) { $logTail = (Get-Content $LogFile -Tail 200) -join "`n" }
  if ($logTail -match 'port is already allocated|address already in use|bind: An attempt') {
    Say "  - El puerto elegido ya esta ocupado por otro programa."
    Say "    Solucion: edita APP_PORT en .env (por ejemplo 3001) y proba de nuevo."
  }
  if (-not (Test-Command 'docker info')) {
    Say "  - Docker Desktop se detuvo a mitad de camino. Abrilo y proba de nuevo."
  }
  if ((Get-MigrateResult) -eq 'fail') {
    Say "  - Las migraciones de la base fallaron (posible contraseña de Postgres"
    Say "    cambiada despues del primer arranque: la base guarda la original)."
    Say "    Si es una instalacion nueva sin datos, la opcion 6 (reset) lo arregla."
  }
  Say "  - El detalle tecnico completo quedo en: install.log"
}

function Do-Install {
  Setup-Env
  Title "Instalando / iniciando la plataforma"
  Say "  (la primera vez descarga y construye las imagenes: puede tardar varios minutos)"
  Say "  Paso 1/3: construyendo e iniciando contenedores..."
  if (-not (Run-Logged 'docker' @('compose', 'up', '-d', '--build'))) {
    Diagnose-Failure
    return
  }
  Say "  Paso 2/3: aplicando migraciones y datos iniciales..."
  Say "  Paso 3/3: esperando a que la aplicacion pase su chequeo de salud..."
  $waited = 0
  while ($waited -lt $HealthTimeoutS) {
    $app = Get-ServiceHealth 'app'
    if ($app -eq 'healthy') {
      $port = Get-EnvValue 'APP_PORT'; if (-not $port) { $port = '3000' }
      $user = Get-EnvValue 'SEED_ADMIN_USERNAME'; if (-not $user) { $user = 'admin' }
      Say ""
      Ok "¡Plataforma instalada y funcionando!"
      Say ""
      Say "  => Entra desde cualquier equipo de la red interna a:"
      Say "       http://localhost:$port   (o http://IP-DE-ESTA-MAQUINA:$port)"
      Say "  => Usuario administrador: $user"
      Say "  => La contraseña es la que elegiste (o la generada) y esta en el"
      Say "     archivo .env - guardalo en un lugar seguro y no lo compartas."
      return
    }
    if ($app -eq 'exited' -or (Get-MigrateResult) -eq 'fail') { break }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 3
    $waited += 3
  }
  Write-Host ""
  Diagnose-Failure
}

# Copia de seguridad completa: base de datos + adjuntos, en una carpeta con
# la fecha. Sirve para guardar antes de actualizar o de forma periodica.
function Do-Backup {
  Title "Copia de seguridad"
  if ((Get-ServiceHealth 'db') -ne 'healthy') {
    Bad "La base de datos no esta funcionando: encende la plataforma (opcion 1) antes de hacer la copia."
    return
  }
  $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
  $dir = Join-Path $PSScriptRoot "backups\$stamp"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $user = Get-EnvValue 'POSTGRES_USER'; if (-not $user) { $user = 'cigst' }
  $db = Get-EnvValue 'POSTGRES_DB'; if (-not $db) { $db = 'cigst' }

  Say "  Guardando la base de datos (tickets, personas, equipos, chats, usuarios)..."
  & cmd /c "docker compose exec -T db pg_dump -U $user -d $db > ""$dir\base-de-datos.sql"" 2>nul"
  if (-not (Test-Path "$dir\base-de-datos.sql") -or (Get-Item "$dir\base-de-datos.sql").Length -eq 0) {
    Bad "No se pudo guardar la base de datos. Detalle en install.log"
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    return
  }
  Say "  Guardando los archivos adjuntos..."
  & cmd /c "docker compose exec -T app sh -c ""cd /app/uploads && tar cf - ."" > ""$dir\adjuntos.tar"" 2>nul"
  Copy-Item (Join-Path $PSScriptRoot '.env') (Join-Path $dir 'env-respaldo') -ErrorAction SilentlyContinue

  $size = [math]::Round(((Get-ChildItem $dir -Recurse | Measure-Object Length -Sum).Sum / 1MB), 2)
  Ok "Copia guardada en: backups\$stamp  ($size MB)"
  Say "  Incluye: base de datos completa, archivos adjuntos y una copia del .env."
  Warn2 "Guarda esa carpeta fuera de esta maquina (pendrive, red, nube privada)."
}

# Restaura una copia hecha con la opcion 6. Pisa TODOS los datos actuales.
function Do-Restore {
  Title "Restaurar una copia de seguridad"
  $backupsRoot = Join-Path $PSScriptRoot 'backups'
  if (-not (Test-Path $backupsRoot) -or -not (Get-ChildItem $backupsRoot -Directory)) {
    Bad "No hay copias guardadas todavia (se crean con la opcion 6)."
    return
  }
  Say "  Copias disponibles:"
  Get-ChildItem $backupsRoot -Directory | ForEach-Object { Say "    $($_.Name)" }
  $choice = Read-Host "  Escribi el nombre exacto de la copia a restaurar (o Enter para cancelar)"
  $dump = Join-Path $backupsRoot "$choice\base-de-datos.sql"
  if (-not $choice -or -not (Test-Path $dump)) {
    Say "  Cancelado (o esa copia no existe)."
    return
  }
  Warn2 "Esto REEMPLAZA todos los datos actuales por los de la copia."
  $confirm = Read-Host "  Para confirmar escribi exactamente RESTAURAR"
  if ($confirm -cne 'RESTAURAR') {
    Say "  Cancelado: no se toco nada."
    return
  }
  $user = Get-EnvValue 'POSTGRES_USER'; if (-not $user) { $user = 'cigst' }
  $db = Get-EnvValue 'POSTGRES_DB'; if (-not $db) { $db = 'cigst' }

  # Los adjuntos se restauran ANTES de apagar el backend (el tar entra por el
  # contenedor app, que necesita estar levantado).
  $tar = Join-Path $backupsRoot "$choice\adjuntos.tar"
  if (Test-Path $tar) {
    Say "  Restaurando los archivos adjuntos..."
    & cmd /c "docker compose exec -T app sh -c ""cd /app/uploads && tar xf -"" < ""$tar"" >nul 2>&1"
  }

  # Postgres no deja borrar una base con conexiones abiertas: hay que apagar
  # el backend y cortar las sesiones que queden, o el DROP falla y la
  # restauracion se aplicaria sobre los datos viejos.
  Say "  Deteniendo la aplicacion para liberar la base..."
  Run-Logged 'docker' @('compose', 'stop', 'app') | Out-Null
  & cmd /c "docker compose exec -T db psql -U $user -d postgres -c ""SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid <> pg_backend_pid();"" >nul 2>&1"

  Say "  Restaurando la base de datos..."
  if (-not (Test-Command "docker compose exec -T db psql -U $user -d postgres -c ""DROP DATABASE IF EXISTS \""$db\"";""")) {
    Bad "No se pudo preparar la base para la restauracion. Detalle en install.log"
    Run-Logged 'docker' @('compose', 'start', 'app') | Out-Null
    return
  }
  if (-not (Test-Command "docker compose exec -T db psql -U $user -d postgres -c ""CREATE DATABASE \""$db\"" OWNER \""$user\"";""")) {
    Bad "No se pudo recrear la base. Detalle en install.log"
    Run-Logged 'docker' @('compose', 'start', 'app') | Out-Null
    return
  }
  # ON_ERROR_STOP: si una sentencia del dump falla, psql corta y avisa, en vez
  # de dejar una restauracion a medias que parezca exitosa.
  & cmd /c "docker compose exec -T db psql -v ON_ERROR_STOP=1 -U $user -d $db < ""$dump"" >nul 2>&1"
  $restoreOk = ($LASTEXITCODE -eq 0)

  Say "  Encendiendo la aplicacion..."
  Run-Logged 'docker' @('compose', 'start', 'app') | Out-Null
  if (-not $restoreOk) {
    Bad "Fallo la restauracion de la base. Detalle en install.log"
    return
  }
  # Comprobacion real de que quedaron datos, no solo de que no hubo error.
  $tickets = ([string](Invoke-Native "docker compose exec -T db psql -U $user -d $db -t -c ""SELECT count(*) FROM tickets;""")).Trim()
  Ok "Copia restaurada ($tickets tickets en la base). Verifica el estado con la opcion 2."
}

function Do-Logs {
  Title "Logs en vivo"
  Say "  Se abre una ventana nueva con los logs. Cerrala cuando termines de mirarlos."
  Start-Process powershell -ArgumentList @(
    '-NoProfile', '-NoExit',
    '-Command', "Set-Location '$PSScriptRoot'; docker compose logs -f --tail 100"
  )
}

function Do-Restart {
  Title "Reiniciando servicios"
  if (Run-Logged 'docker' @('compose', 'restart')) {
    Ok "Servicios reiniciados."
    Show-Status
  } else {
    Bad "No se pudo reiniciar. Detalle en install.log"
  }
}

function Do-Stop {
  Title "Deteniendo la plataforma"
  if (Run-Logged 'docker' @('compose', 'down')) {
    Ok "Plataforma detenida. Los datos quedan guardados."
    Say "  Para volver a encenderla: opcion 1 del menu."
  } else {
    Bad "No se pudo detener. Detalle en install.log"
  }
}

function Do-Reset {
  Title "Resetear todo (BORRA TODOS LOS DATOS)"
  Warn2 "Esto elimina contenedores y TODOS los datos cargados (tickets, personas,"
  Say "  equipos, chats, usuarios). No se puede deshacer."
  Say "  Si la plataforma ya esta en uso, hace primero una copia (opcion 6)."
  $confirm = Read-Host "  Para confirmar escribi exactamente BORRAR"
  if ($confirm -cne 'BORRAR') {
    Say "  Cancelado: no se borro nada."
    return
  }
  if (Run-Logged 'docker' @('compose', 'down', '-v')) {
    Ok "Datos eliminados. La proxima instalacion arranca de fabrica."
    Say "  (el archivo .env se conserva; borralo a mano si tambien queres regenerarlo)"
  } else {
    Bad "No se pudo resetear. Detalle en install.log"
  }
}

# --- Menu principal ----------------------------------------------------------
function Main-Menu {
  while ($true) {
    Write-Host ""
    Write-Host "   ============================================"
    Write-Host "      CIGST - Centro de Soporte Tecnico"
    Write-Host "   ============================================"
    Write-Host "   1) Instalar / iniciar / actualizar la plataforma"
    Write-Host "   2) Ver estado de los servicios"
    Write-Host "   3) Ver logs en vivo"
    Write-Host "   4) Reiniciar servicios"
    Write-Host "   5) Detener la plataforma"
    Write-Host "   6) Hacer copia de seguridad (datos + adjuntos)"
    Write-Host "   7) Restaurar una copia de seguridad"
    Write-Host "   8) Resetear todo (BORRA los datos)"
    Write-Host "   9) Salir"
    $opt = Read-Host "   Elegi una opcion [1-9]"
    if ($null -eq $opt) { exit 0 }
    switch ($opt.Trim()) {
      '1' { Do-Install }
      '2' { Show-Status }
      '3' { Do-Logs }
      '4' { Do-Restart }
      '5' { Do-Stop }
      '6' { Do-Backup }
      '7' { Do-Restore }
      '8' { Do-Reset }
      '9' { Say "Hasta luego."; exit 0 }
      default { Say "  Opcion invalida: elegi un numero del 1 al 9." }
    }
  }
}

try {
  Write-Log "===== install.ps1 iniciado ====="
  Check-Docker
  Main-Menu
} catch {
  Bad ("Error inesperado: " + $_.Exception.Message)
  Say "  El detalle tecnico completo quedo en install.log"
  Write-Log ($_ | Out-String)
  Pause-BeforeExit
  exit 1
}
