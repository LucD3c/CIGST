#!/usr/bin/env bash
# ============================================================================
# CIGST - Instalador y panel de control por consola (Linux / macOS)
#
# Uso:  ./install.sh
#
# No instala nada en el sistema operativo salvo (opcionalmente, y solo con
# confirmacion explicita) Docker Engine en Linux. Todo lo demas corre dentro
# de contenedores Docker.
# ============================================================================

set -u

# Trabajar siempre desde la carpeta del repo, sin importar desde donde se llame.
cd "$(dirname "$0")"

LOG_FILE="install.log"
MIN_DOCKER_MAJOR=20
HEALTH_TIMEOUT_S=300

# --- Salida con formato -----------------------------------------------------
log()  { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }
say()  { printf '%s\n' "$*"; log "$*"; }
ok()   { say "  ✅ $*"; }
fail() { say "  ❌ $*"; }
warn() { say "  ⚠️  $*"; }
title(){ printf '\n== %s ==\n' "$*"; log "== $* =="; }

# Ejecuta un comando mandando TODO su output a install.log (nunca crudo en
# pantalla); devuelve el codigo de salida real.
run_logged() {
  log "\$ $*"
  "$@" >> "$LOG_FILE" 2>&1
}

# --- Chequeo de requisitos ---------------------------------------------------
check_docker() {
  title "Chequeando requisitos"

  if ! command -v docker >/dev/null 2>&1; then
    fail "Docker no esta instalado."
    if [ "$(uname -s)" = "Darwin" ]; then
      say ""
      say "  En macOS instalalo con Docker Desktop:"
      say "    https://www.docker.com/products/docker-desktop"
      say "  Despues de instalarlo y abrirlo, volve a ejecutar este instalador."
      exit 1
    fi
    say ""
    say "  Este instalador puede instalar Docker Engine usando el script oficial"
    say "  de Docker (https://get.docker.com). No se descarga nada de otra fuente."
    printf '  ¿Instalar Docker Engine ahora? (escribi "si" para aceptar): '
    read -r resp
    if [ "$resp" != "si" ] && [ "$resp" != "SI" ] && [ "$resp" != "Si" ]; then
      say "  Instalacion cancelada. Podes instalar Docker manualmente siguiendo:"
      say "    https://docs.docker.com/engine/install/"
      exit 1
    fi
    say "  Descargando el script oficial de Docker (unica descarga externa)..."
    if ! curl -fsSL https://get.docker.com -o /tmp/get-docker.sh; then
      fail "No se pudo descargar el instalador de Docker. ¿Hay conexion a internet?"
      exit 1
    fi
    say "  Instalando Docker Engine (puede pedir tu contraseña de sudo)..."
    if ! sudo sh /tmp/get-docker.sh >> "$LOG_FILE" 2>&1; then
      fail "La instalacion de Docker fallo. Revisa $LOG_FILE para el detalle."
      exit 1
    fi
    sudo usermod -aG docker "$USER" >> "$LOG_FILE" 2>&1 || true
    ok "Docker Engine instalado."
    warn "IMPORTANTE: cerra sesion y volve a entrar (o reinicia) para poder usar"
    say "  Docker sin sudo. Despues volve a ejecutar ./install.sh"
    exit 0
  fi
  ok "Docker esta instalado."

  if ! docker info >/dev/null 2>&1; then
    # Distinguir "daemon apagado" de "sin permisos".
    if docker info 2>&1 | grep -qi "permission denied"; then
      fail "Tu usuario no tiene permisos para usar Docker."
      say "  Solucion: sudo usermod -aG docker $USER"
      say "  Despues cerra sesion y volve a entrar, y ejecuta ./install.sh de nuevo."
    else
      fail "Docker esta instalado pero no esta corriendo."
      if [ "$(uname -s)" = "Darwin" ]; then
        say "  Abri Docker Desktop y espera a que el icono de la ballena quede fijo."
      else
        say "  Inicialo con: sudo systemctl start docker"
      fi
    fi
    exit 1
  fi
  ok "Docker esta corriendo."

  local version major
  version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0")
  major=${version%%.*}
  if [ "${major:-0}" -lt "$MIN_DOCKER_MAJOR" ] 2>/dev/null; then
    fail "Docker $version es demasiado viejo (se necesita $MIN_DOCKER_MAJOR o mas nuevo)."
    say "  Actualizalo siguiendo: https://docs.docker.com/engine/install/"
    exit 1
  fi
  ok "Version de Docker: $version (minimo requerido: $MIN_DOCKER_MAJOR)."

  if ! docker compose version >/dev/null 2>&1; then
    fail "El plugin 'docker compose' (v2) no esta disponible."
    say "  Viene incluido en Docker Desktop y en las instalaciones modernas de"
    say "  Docker Engine. Guia: https://docs.docker.com/compose/install/"
    exit 1
  fi
  ok "Docker Compose v2 disponible."
}

# --- Configuracion del .env --------------------------------------------------
random_password() {
  # Solo letras y numeros: evita cualquier problema de escapes en .env/compose.
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20
}

# Clave larga para cifrar las credenciales de correo: de ella depende que esas
# contrasenas sigan a salvo aunque alguien se lleve una copia de la base.
random_key() {
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48
}

# Reemplaza el valor de una clave en .env (portable Linux/mac, sin sed -i).
set_env_var() {
  local key="$1" value="$2"
  awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' .env > .env.tmp \
    && mv .env.tmp .env
}

# Lee una contraseña sin mostrarla. Charset restringido para que nunca haga
# falta escapar nada en .env ni en la interpolacion de docker compose.
read_password() {
  local prompt="$1" __resultvar="$2" pass
  while true; do
    printf '%s' "$prompt"
    read -rs pass
    printf '\n'
    if [ -z "$pass" ]; then
      eval "$__resultvar=''"
      return 0
    fi
    if printf '%s' "$pass" | LC_ALL=C grep -Eq '^[A-Za-z0-9._!@#%^*+=-]{8,64}$'; then
      eval "$__resultvar=\$pass"
      return 0
    fi
    say "  La contraseña debe tener entre 8 y 64 caracteres y usar solo letras,"
    say "  numeros o . _ ! @ # % ^ * + = -  (sin espacios ni comillas)."
  done
}

# Completa las claves que una version anterior no tenia. Se ejecuta SIEMPRE,
# tambien al actualizar: sin esto, quien ya tenia la plataforma instalada
# tendria que editar el .env a mano cada vez que una funcion nueva necesita
# una variable, y la funcion aparecería rota sin explicacion.
ensure_env_vars() {
  [ -f .env ] || return 0
  local key="MAIL_ENCRYPTION_KEY"
  local actual
  actual=$(grep -E "^${key}=" .env 2>/dev/null | cut -d= -f2-)
  if [ -n "$actual" ]; then
    return 0
  fi
  if grep -qE "^${key}=" .env 2>/dev/null; then
    set_env_var "$key" "$(random_key)"
  else
    {
      printf '
'
      printf '# Clave para cifrar las contrasenas de las casillas de correo.
'
      printf '# Generada automaticamente por el instalador: no hace falta tocarla.
'
      printf '%s=%s
' "$key" "$(random_key)"
    } >> .env
  fi
  ok "Se genero la clave de cifrado del correo y se guardo en .env."
}

setup_env() {
  if [ -f .env ]; then
    ok "Ya existe un archivo .env: se respeta la configuracion actual."
    return 0
  fi
  title "Configuracion inicial (.env)"
  say "No existe .env todavia: se crea a partir de .env.example."
  say "Podes apretar Enter en cada pregunta para usar un valor seguro por defecto."
  cp .env.example .env

  local admin_pass pg_pass app_port
  read_password "  Contraseña del usuario administrador [Enter = generar una aleatoria]: " admin_pass
  if [ -z "$admin_pass" ]; then
    admin_pass=$(random_password)
    say "  Se genero una contraseña aleatoria (quedo guardada en .env, no se muestra aca)."
  fi

  read_password "  Contraseña interna de la base de datos [Enter = generar una aleatoria]: " pg_pass
  if [ -z "$pg_pass" ]; then
    pg_pass=$(random_password)
    say "  Se genero una contraseña aleatoria para la base (guardada en .env)."
  fi

  printf '  Puerto donde va a quedar la plataforma [Enter = 3000]: '
  read -r app_port
  case "$app_port" in
    '') app_port=3000 ;;
    *[!0-9]*) say "  Valor no numerico: se usa 3000."; app_port=3000 ;;
  esac

  set_env_var SEED_ADMIN_PASSWORD "$admin_pass"
  set_env_var POSTGRES_PASSWORD "$pg_pass"
  set_env_var APP_PORT "$app_port"
  chmod 600 .env 2>/dev/null || true
  ok "Archivo .env creado. Guardalo en un lugar seguro: contiene las contraseñas."
}

# --- Estado / salud ----------------------------------------------------------
service_health() { # nombre-de-servicio -> healthy|starting|unhealthy|exited|missing
  local cid
  cid=$(docker compose ps -aq "$1" 2>/dev/null | head -1)
  if [ -z "$cid" ]; then echo "missing"; return; fi
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo "missing"
}

migrate_result() { # ok|fail|pending|missing
  local cid code status
  cid=$(docker compose ps -aq migrate 2>/dev/null | head -1)
  if [ -z "$cid" ]; then echo "missing"; return; fi
  status=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null)
  if [ "$status" != "exited" ]; then echo "pending"; return; fi
  code=$(docker inspect -f '{{.State.ExitCode}}' "$cid" 2>/dev/null)
  if [ "$code" = "0" ]; then echo "ok"; else echo "fail"; fi
}

show_status() {
  title "Estado de los servicios"
  local db app mig
  db=$(service_health db); app=$(service_health app); mig=$(migrate_result)

  case "$db" in
    healthy)  ok "Base de datos: funcionando." ;;
    starting) warn "Base de datos: iniciando..." ;;
    missing)  fail "Base de datos: no esta creada (usa la opcion 1 para instalar)." ;;
    *)        fail "Base de datos: con problemas ($db). Mira los logs (opcion 3)." ;;
  esac
  case "$mig" in
    ok)      ok "Migraciones y datos iniciales: aplicados." ;;
    pending) warn "Migraciones: en curso..." ;;
    missing) fail "Migraciones: sin ejecutar todavia." ;;
    *)       fail "Migraciones: fallaron. Mira los logs (opcion 3)." ;;
  esac
  case "$app" in
    healthy)  ok "Aplicacion: funcionando." ;;
    starting) warn "Aplicacion: iniciando..." ;;
    missing)  fail "Aplicacion: no esta creada (usa la opcion 1 para instalar)." ;;
    *)        fail "Aplicacion: con problemas ($app). Mira los logs (opcion 3)." ;;
  esac

  if [ "$app" = "healthy" ]; then
    local port
    port=$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2)
    say ""
    say "  ➜ Plataforma disponible en: http://localhost:${port:-3000}"
  fi
}

# --- Acciones del menu -------------------------------------------------------
diagnose_failure() {
  say ""
  fail "Algo fallo durante el arranque. Causas mas comunes:"
  if grep -qiE "port is already allocated|address already in use" "$LOG_FILE"; then
    say "  • El puerto elegido ya esta ocupado por otro programa."
    say "    Solucion: edita APP_PORT en .env (por ejemplo 3001) y proba de nuevo."
  fi
  if ! docker info >/dev/null 2>&1; then
    say "  • Docker se detuvo a mitad de camino. Inicialo y proba de nuevo."
  fi
  if [ "$(migrate_result)" = "fail" ]; then
    say "  • Las migraciones de la base fallaron (posible contraseña de Postgres"
    say "    cambiada despues del primer arranque: la base guarda la original)."
    say "    Si es una instalacion nueva sin datos, la opcion 6 (reset) lo arregla."
  fi
  say "  • El detalle tecnico completo quedo en: $LOG_FILE"
}

do_install() {
  setup_env
  ensure_env_vars
  title "Instalando / iniciando la plataforma"
  say "  (la primera vez descarga y construye las imagenes: puede tardar varios minutos)"
  say "  Paso 1/3: construyendo e iniciando contenedores..."
  if ! run_logged docker compose up -d --build; then
    diagnose_failure
    return 1
  fi
  say "  Paso 2/3: aplicando migraciones y datos iniciales..."
  say "  Paso 3/3: esperando a que la aplicacion pase su chequeo de salud..."
  local waited=0 app
  while [ $waited -lt $HEALTH_TIMEOUT_S ]; do
    app=$(service_health app)
    if [ "$app" = "healthy" ]; then
      local port user
      port=$(grep -E '^APP_PORT=' .env | cut -d= -f2)
      user=$(grep -E '^SEED_ADMIN_USERNAME=' .env | cut -d= -f2)
      say ""
      ok "¡Plataforma instalada y funcionando!"
      say ""
      say "  ➜ Entra desde cualquier equipo de la red interna a:"
      say "      http://localhost:${port:-3000}   (o http://IP-DE-ESTA-MAQUINA:${port:-3000})"
      say "  ➜ Usuario administrador: ${user:-admin}"
      say "  ➜ La contraseña es la que elegiste (o la generada) y esta en el"
      say "    archivo .env — guardalo en un lugar seguro y no lo compartas."
      return 0
    fi
    if [ "$app" = "exited" ] || [ "$(migrate_result)" = "fail" ]; then
      break
    fi
    printf '.'
    sleep 3
    waited=$((waited+3))
  done
  printf '\n'
  diagnose_failure
  return 1
}

# Copia de seguridad completa: base de datos + archivos adjuntos, en una
# carpeta con la fecha. Sirve para guardar antes de actualizar o de forma
# periodica; se restaura con la opcion 7.
do_backup() {
  title "Copia de seguridad"
  if [ "$(service_health db)" != "healthy" ]; then
    fail "La base de datos no esta funcionando: encendé la plataforma (opcion 1) antes de hacer la copia."
    return 1
  fi
  local stamp dir user db
  stamp=$(date '+%Y-%m-%d_%H-%M')
  dir="backups/$stamp"
  mkdir -p "$dir"
  user=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2)
  db=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2)

  say "  Guardando la base de datos (tickets, personas, equipos, chats, usuarios)..."
  if ! docker compose exec -T db pg_dump -U "${user:-cigst}" -d "${db:-cigst}" > "$dir/base-de-datos.sql" 2>>"$LOG_FILE"; then
    fail "No se pudo guardar la base de datos. Detalle en $LOG_FILE"
    rm -rf "$dir"
    return 1
  fi
  say "  Guardando los archivos adjuntos..."
  docker compose exec -T app sh -c 'cd /app/uploads && tar cf - .' > "$dir/adjuntos.tar" 2>>"$LOG_FILE" || true
  cp .env "$dir/env-respaldo" 2>/dev/null || true

  local size
  size=$(du -sh "$dir" 2>/dev/null | cut -f1)
  ok "Copia guardada en: $dir  (${size:-?})"
  say "  Incluye: base de datos completa, archivos adjuntos y una copia del .env."
  warn "Guardá esa carpeta fuera de esta máquina (pendrive, red, nube privada)."
}

# Restaura una copia hecha con la opcion 6. Pisa TODOS los datos actuales.
do_restore() {
  title "Restaurar una copia de seguridad"
  if [ ! -d backups ] || [ -z "$(ls -A backups 2>/dev/null)" ]; then
    fail "No hay copias guardadas todavia (se crean con la opcion 6)."
    return 1
  fi
  say "  Copias disponibles:"
  local list i=1
  list=$(ls -1 backups)
  echo "$list" | while read -r b; do printf '    %s\n' "$b"; done
  printf '  Escribi el nombre exacto de la copia a restaurar (o Enter para cancelar): '
  read -r choice
  if [ -z "$choice" ] || [ ! -f "backups/$choice/base-de-datos.sql" ]; then
    say "  Cancelado (o esa copia no existe)."
    return 0
  fi
  warn "Esto REEMPLAZA todos los datos actuales por los de la copia."
  printf '  Para confirmar escribi exactamente RESTAURAR: '
  read -r confirm
  if [ "$confirm" != "RESTAURAR" ]; then
    say "  Cancelado: no se toco nada."
    return 0
  fi
  local user db
  user=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2); user=${user:-cigst}
  db=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2); db=${db:-cigst}

  # Los adjuntos se restauran ANTES de apagar el backend (el tar entra por el
  # contenedor app, que necesita estar levantado).
  if [ -f "backups/$choice/adjuntos.tar" ]; then
    say "  Restaurando los archivos adjuntos..."
    docker compose exec -T app sh -c 'cd /app/uploads && tar xf -' < "backups/$choice/adjuntos.tar" >>"$LOG_FILE" 2>&1 || true
  fi

  # Postgres no deja borrar una base con conexiones abiertas: hay que apagar
  # el backend y cortar las sesiones que queden, o el DROP falla y la
  # restauracion se aplicaria sobre los datos viejos.
  say "  Deteniendo la aplicacion para liberar la base..."
  run_logged docker compose stop app
  docker compose exec -T db psql -U "$user" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid <> pg_backend_pid();" >>"$LOG_FILE" 2>&1

  say "  Restaurando la base de datos..."
  if ! docker compose exec -T db psql -U "$user" -d postgres -c "DROP DATABASE IF EXISTS \"$db\";" >>"$LOG_FILE" 2>&1; then
    fail "No se pudo preparar la base para la restauracion. Detalle en $LOG_FILE"
    run_logged docker compose start app
    return 1
  fi
  if ! docker compose exec -T db psql -U "$user" -d postgres -c "CREATE DATABASE \"$db\" OWNER \"$user\";" >>"$LOG_FILE" 2>&1; then
    fail "No se pudo recrear la base. Detalle en $LOG_FILE"
    run_logged docker compose start app
    return 1
  fi
  # ON_ERROR_STOP: si una sola sentencia del dump falla, psql corta y avisa,
  # en vez de dejar una restauracion a medias que parezca exitosa.
  if ! docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$user" -d "$db" < "backups/$choice/base-de-datos.sql" >>"$LOG_FILE" 2>&1; then
    fail "Fallo la restauracion de la base. Detalle en $LOG_FILE"
    run_logged docker compose start app
    return 1
  fi

  say "  Encendiendo la aplicacion..."
  run_logged docker compose start app
  # Comprobacion real de que quedaron datos, no solo de que no hubo error.
  local tickets
  tickets=$(docker compose exec -T db psql -U "$user" -d "$db" -t -c "SELECT count(*) FROM tickets;" 2>/dev/null | tr -d ' \r\n')
  ok "Copia restaurada (${tickets:-?} tickets en la base). Verificá el estado con la opcion 2."
}

do_logs() {
  title "Logs en vivo (Ctrl+C para volver al menu)"
  trap ' ' INT
  docker compose logs -f --tail 100
  trap - INT
  say ""
}

do_restart() {
  title "Reiniciando servicios"
  if run_logged docker compose restart; then
    ok "Servicios reiniciados."
    show_status
  else
    fail "No se pudo reiniciar. Detalle en $LOG_FILE"
  fi
}

do_stop() {
  title "Deteniendo la plataforma"
  if run_logged docker compose down; then
    ok "Plataforma detenida. Los datos quedan guardados."
    say "  Para volver a encenderla: opcion 1 del menu."
  else
    fail "No se pudo detener. Detalle en $LOG_FILE"
  fi
}

do_reset() {
  title "Resetear todo (BORRA TODOS LOS DATOS)"
  warn "Esto elimina contenedores y TODOS los datos cargados (tickets, personas,"
  say "  equipos, chats, usuarios). No se puede deshacer."
  say "  Si la plataforma ya esta en uso, hacé primero una copia (opcion 6)."
  printf '  Para confirmar escribi exactamente BORRAR: '
  read -r confirm
  if [ "$confirm" != "BORRAR" ]; then
    say "  Cancelado: no se borro nada."
    return 0
  fi
  if run_logged docker compose down -v; then
    ok "Datos eliminados. La proxima instalacion arranca de fabrica."
    say "  (el archivo .env se conserva; borralo a mano si tambien queres regenerarlo)"
  else
    fail "No se pudo resetear. Detalle en $LOG_FILE"
  fi
}

# --- Menu principal ----------------------------------------------------------
main_menu() {
  while true; do
    printf '\n'
    printf '   ╔══════════════════════════════════════════╗\n'
    printf '   ║   CIGST - Centro de Soporte Tecnico      ║\n'
    printf '   ╚══════════════════════════════════════════╝\n'
    printf '   1) Instalar / iniciar / actualizar la plataforma\n'
    printf '   2) Ver estado de los servicios\n'
    printf '   3) Ver logs en vivo\n'
    printf '   4) Reiniciar servicios\n'
    printf '   5) Detener la plataforma\n'
    printf '   6) Hacer copia de seguridad (datos + adjuntos)\n'
    printf '   7) Restaurar una copia de seguridad\n'
    printf '   8) Resetear todo (BORRA los datos)\n'
    printf '   9) Salir\n'
    printf '   Elegi una opcion [1-9]: '
    read -r opt || exit 0
    case "$opt" in
      1) do_install ;;
      2) show_status ;;
      3) do_logs ;;
      4) do_restart ;;
      5) do_stop ;;
      6) do_backup ;;
      7) do_restore ;;
      8) do_reset ;;
      9) say "Hasta luego."; exit 0 ;;
      *) say "  Opcion invalida: elegi un numero del 1 al 9." ;;
    esac
  done
}

log "===== install.sh iniciado ====="
check_docker
main_menu
