# Pruebas de la plataforma

Estas pruebas corren **contra la plataforma en funcionamiento**, no contra
funciones sueltas. Es a propósito: lo que interesa saber antes de una entrega
no es si una función devuelve lo que dice su firma, sino si alguien puede
entrar, cargar un ticket, adjuntar una captura y que todo eso siga funcionando
con setenta personas trabajando a la vez.

No hacen falta dependencias instaladas en la máquina: cada suite corre dentro
de un contenedor descartable, en la misma red de Docker donde vive la
plataforma.

## Antes de empezar

La plataforma tiene que estar levantada (opción 1 del instalador, o
`docker compose up -d`). Después:

```bash
# La contraseña del administrador sale del propio .env
PASS=$(grep -E '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2)

# El nombre de la red de Docker
NET=$(docker network ls --format '{{.Name}}' | grep cigst | head -1)
```

## Las suites

### `api.js` — comportamiento del servidor (33 comprobaciones)

Salud, sesión, paginación, orden alfabético español, números del tablero,
filtros, códigos propios de equipos, condiciones de carrera en los códigos
correlativos, política de contraseñas y búsqueda.

```bash
docker run --rm --network "$NET" -e ADMIN_PASS="$PASS" \
  -v "$PWD/pruebas/api.js:/t.js" node:20.20.2-alpine node /t.js
```

### `bases-de-conocimiento.js` — búsqueda y campos ocultos (8 comprobaciones)

Verifica que la búsqueda encuentre por el contenido del artículo, que se
actualice al editarlo y —lo más importante— que **no se pueda encontrar un
artículo buscando el valor de un campo marcado como oculto**. Ahí es donde se
guardan las credenciales compartidas.

```bash
docker run --rm --network "$NET" -e ADMIN_PASS="$PASS" \
  -v "$PWD/pruebas/bases-de-conocimiento.js:/t.js" node:20.20.2-alpine node /t.js
```

### `imagenes.js` — compresión en el servidor (10 comprobaciones)

Sube una imagen grande **directamente por la API**, salteando el navegador, que
es exactamente el agujero que tenía la compresión del lado del cliente.
Comprueba que el servidor la redimensione y la convierta igual, que no degrade
las imágenes chicas y que no toque los PDF.

```bash
docker run --rm --network "$NET" -e ADMIN_PASS="$PASS" \
  -v "$PWD/pruebas/imagenes.js:/t.js" node:20.20.2-alpine node /t.js
```

### `navegador.js` — la interfaz de verdad (50 comprobaciones)

Abre un navegador real, entra, recorre las nueve pantallas, ordena, filtra,
pagina, crea y edita un equipo con código propio, muestra y oculta la dirección
de red, y repite la navegación en una pantalla de teléfono. Termina revisando
que no haya quedado ningún error de JavaScript en la consola.

```bash
docker run --rm --network "$NET" -e ADMIN_PASS="$PASS" \
  -v "$PWD/pruebas/navegador.js:/w/t.js" -w /w \
  mcr.microsoft.com/playwright:v1.48.0-jammy \
  sh -c "npm i playwright@1.48.0 --no-audit --no-fund >/dev/null 2>&1 && node t.js"
```

### `carga.js` — 70 personas simultáneas

Abre 70 sesiones, 70 conexiones de tiempo real y hace cinco rondas de trabajo
en paralelo, sin pausa entre acciones (mucho más exigente que el uso real, donde
la gente piensa entre clic y clic).

**Necesita 70 cuentas de prueba** (`carga01` … `carga70`). Se crean una vez
desde el Panel administrador o por API, y **conviene borrarlas al terminar**:
son cuentas reales con acceso a la plataforma.

```bash
docker run --rm --network "$NET" \
  -v "$PWD/pruebas/carga.js:/w/t.js" -w /w node:20.20.2-alpine \
  sh -c "npm i ws@8.21.1 --no-audit --no-fund >/dev/null 2>&1 && node t.js"
```

Resultado de referencia en una máquina de escritorio común: 70/70 sesiones,
70/70 conexiones de tiempo real, 2.100 peticiones, **cero errores**, p95 de
853 ms, 145 peticiones por segundo.

## Sobre correr esto en producción

Las suites **crean datos** (equipos, usuarios, artículos, adjuntos). Están
pensadas para una instalación de prueba o para el laboratorio, no para la
plataforma que usa la empresa todos los días. Si hace falta correrlas contra
una instalación real, conviene hacer antes una copia de seguridad (opción 6 del
instalador) y borrar después lo que hayan creado.
