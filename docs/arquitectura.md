# Arquitectura técnica

> Documento para desarrolladores. Si solo querés instalar o usar la
> plataforma, alcanza con el [README](../README.md) y la
> [guía de usuario](guia-usuario.md).

## Stack

| Capa | Tecnología |
| --- | --- |
| Backend | Node.js 20 + TypeScript + Express 4 |
| Tiempo real | WebSocket (`ws`) sobre el mismo servidor HTTP |
| Base de datos | PostgreSQL 16 (vía Prisma ORM 5) |
| Frontend | HTML/CSS/JS vanilla en un solo archivo (`app.js`), sin framework ni build |
| Despliegue | Docker Compose (3 servicios: `db`, `migrate`, `app`) |

Ninguna parte de la plataforma hace llamadas a internet en tiempo de
ejecución: sin CDNs, sin APIs externas, sin telemetría. Las fuentes
tipográficas están auto-hospedadas en `fonts/`. Esto está verificado con
captura de tráfico de red en un navegador real (cero requests a hosts
externos, incluso con el chat en tiempo real abierto).

## Estructura del repositorio

```
backend/
  src/
    config/      configuración y validación de variables de entorno (Zod)
    db/          cliente de Prisma (PostgreSQL)
    middleware/  autenticación, autorización por rol, validación, rate limit
    modules/     auth, users, employees, equipment, tickets, logbook,
                 sectors, schedules, chat, notifications, attachments
                 (cada uno: routes -> controller -> service -> repository)
    realtime/    tiempo real por WebSocket: servidor, registro de
                 conexiones, audiencia (RBAC) y cupo de mensajes
    routes/      router principal de /api
  prisma/        schema.prisma, migraciones y seed inicial
  Dockerfile     multi-stage (builder + runtime, usuario no-root)
docker-compose.yml
install.sh / install.ps1 / install.bat    instalador por consola
index.html / app.js / styles.css / fonts/ interfaz (servida por el backend)
docs/                                     esta documentación
```

## Convenciones del backend

- **Capas por módulo**: `routes` declara URLs + middleware de permisos,
  `controller` traduce HTTP ↔ servicio, `service` contiene las reglas de
  negocio, `repository` es el único que toca Prisma. Ningún controller
  llama a Prisma directo.
- **Validación**: todo cuerpo/parámetro/query pasa por un schema Zod en el
  boundary (middleware `validate`). Los errores devuelven `400` con
  `fieldErrors` que el frontend muestra tal cual.
- **RBAC en el servidor**: los permisos se validan en cada endpoint
  (`requireRole`, `STAFF_ROLES`). Lo que el frontend oculta visualmente
  también está bloqueado en la API.
- **Roles como datos**: los nombres de rol viven en la tabla `roles`, no en
  un enum del esquema. El renombre `Técnico→Supervisor` / `Empleado→User`
  se hizo con una migración de datos que preserva los `id`.

## Los 3 servicios de Docker Compose

1. **db** — PostgreSQL 16.14 (versión fijada). No expone ningún puerto al
   host: solo es alcanzable desde los otros contenedores.
2. **migrate** — contenedor de un solo uso: aplica `prisma migrate deploy`
   y corre el seed (idempotente). `app` no arranca hasta que termina bien.
3. **app** — el backend, que además sirve el frontend estático. Único
   puerto publicado (`APP_PORT`, por defecto 3000). Corre como usuario
   no-root y tiene healthcheck propio (`/api/health`).

Las versiones de las imágenes están fijadas (`postgres:16.14-alpine`,
`node:20.20.2-alpine` en el Dockerfile): actualizar es una decisión
consciente, no un efecto colateral de un rebuild.

## Caché de los estáticos (`app.js` / `styles.css`)

`express.static` responde estos archivos con `Cache-Control: no-cache`
(`app.ts`), no con el default del navegador. La diferencia importa acá: sin
esa cabecera, un navegador puede quedarse con una versión vieja de
`styles.css` mientras ya descargó el `app.js` nuevo tras una actualización de
la plataforma (caché heurística, cada archivo revalida en momentos
distintos) — la interfaz queda con clases nuevas pero estilos viejos, se ve
rota. `no-cache` no significa "no guardar": el navegador conserva el archivo
pero **siempre** revalida contra el servidor antes de usarlo (con ETag,
`express.static` responde `304` si no cambió — prácticamente gratis en red
local), así ambos archivos quedan sincronizados en cada visita sin depender
de que el usuario fuerce una recarga.

## Notas de API para quien siga trabajando

- `GET /api/sectors` y `GET /api/schedules` están disponibles para
  cualquier rol autenticado (un User los necesita para elegir sector/turno
  al pedir soporte); crear/editar es de soporte (Admin+Supervisor), borrar
  es solo Admin. `GET /api/sectors/:id` devuelve además las personas y
  equipos vinculados a ese sector.
- `GET /api/auth/me` devuelve, además de los datos de sesión, la persona
  vinculada al usuario (su sector y el equipamiento de ese sector) — es lo
  que usa el portal de un User para no necesitar `/api/employees` (que es
  exclusivo de soporte).
- `GET /api/users/technicians` expone una lista acotada (id + nombre) de
  usuarios Administrador/Supervisor activos, para el selector "asignado a".
- `GET /api/logbook` (y toda la Bitácora técnica) es exclusivo de
  Administrador.
- **Chat** (`/api/chat/*`): sin restricción por rol — la única condición es
  ser participante de la conversación (o miembro del grupo). `POST
  /api/chat/conversations` crea la conversación si no existía (par canónico
  de usuarios: los dos ids siempre en el mismo orden alfabético, imposible
  duplicar el par) y manda el primer mensaje en la misma transacción. La
  paginación de mensajes es por cursor (`before`/`after`, mutuamente
  excluyentes) ordenada por `createdAt` **e** `id` como desempate — con un
  solo campo de orden, dos mensajes del mismo milisegundo hacían saltear
  filas al cursor.
- **Grupos de chat** (`/api/chat/groups/*`): crear/editar/borrar es
  admin-only; leer/escribir es de los miembros (tabla `chat_group_members`,
  "leído" por miembro vía `lastReadAt`). Un `Message` pertenece a una
  conversación 1 a 1 **o** a un grupo (`conversationId` XOR `groupId`).
- **Notificaciones** (`/api/notifications/*`): cada usuario ve solo las
  suyas (el repositorio filtra por `userId` hasta en el mark-read). Las
  emiten los services de tickets (ticket nuevo → staff; cambio de estado →
  creador y afectado; asignación → responsable) y de chat (alta en grupo).
- **`GET /api/tickets/form-options`**: personas/equipos/sectores/turnos
  activos en versión mínima, accesible a cualquier rol autenticado — es lo
  que le permite al rango User armar un ticket para cualquier persona sin
  tener acceso a los listados completos (`/employees` y `/equipment` siguen
  siendo de staff).
- **Categorías por sector** (`/api/sectors/:id/categories`): alta y baja
  admin-only. `GET /api/tickets/form-options` devuelve todas las categorías
  de todos los sectores activos en una sola consulta, para que el
  formulario cambie la lista al elegir sector sin volver a pedir nada.
- **Adjuntos** (`/api/attachments`): `POST` sube (multipart, hasta 5
  archivos de 10 MB) y devuelve los ids; el ticket o mensaje se crea después
  mandando esos ids en `attachmentIds`. `GET /api/attachments/:id` descarga,
  validando primero que quien pide pueda ver el ticket o el mensaje que lo
  contiene (mismas reglas que el recurso padre, sin bypass por rol).
- **Historiales de cambios**: `utils/changeLog.ts` compara antes/después en
  los services de employees/equipment/users y antepone la línea al campo
  `changeLog`; la zona horaria de esas marcas sale de `TZ` (compose la pasa,
  por defecto America/Argentina/Buenos_Aires).
- **Disponibilidad de una persona**: `utils/workingHours.ts` calcula
  `en-linea` / `fuera-de-horario` / `sin-horario` a partir de
  `workStartTime`/`workEndTime` y la hora del servidor en `TZ`. No es una
  columna: se agrega al serializar en `employees.service`, así nunca queda
  un estado viejo guardado. Contempla turnos que cruzan la medianoche.
- **Orden alfabético**: `utils/sortByName.ts` reordena los listados con
  `Intl.Collator('es', { sensitivity: 'base', numeric: true })`. El
  `ORDER BY` de Postgres compara por código de carácter y deja `ZZ` antes
  que `Zulema`; para listas que lee una persona eso se ve desordenado. Se
  aplica en employees, users, sectors, equipment, el directorio del chat y
  `form-options`. `app.js` usa el mismo criterio al ordenar por columna.
- **Borrados**: `DELETE` en `/employees`, `/equipment`, `/sectors` (todos
  admin-only) y `/users`. Son borrados lógicos, así que los tickets
  conservan el nombre de la persona, el equipo y el sector aunque se hayan
  eliminado. `sectors.service.remove` **rechaza con 409** si el sector
  todavía tiene personas o equipos: si no, esas fichas quedarían apuntando
  a un sector inexistente y el desplegable de su formulario caería en "Sin
  definir" sin que nadie lo pida. Un usuario no puede eliminarse a sí mismo.
- **Tiempo real** (`/ws`): ver la sección de decisión más abajo. El cupo de
  mensajes del socket (`realtime.rateLimit.ts`) es **propio**: los limitadores
  de `express-rate-limit` son middleware HTTP y no ven un solo byte de lo que
  entra por el WebSocket. El cupo es el mismo que por HTTP (30 mensajes por
  minuto por usuario) para que el límite efectivo no dependa del transporte.
- **Feed** (`/api/feed`) y **bases de conocimiento** (`/api/knowledge`):
  comparten el motor de bloques (`utils/contentBlocks.ts`). El permiso del feed
  es por destinatario (`todos` o sectores) y el de una base sale de
  `knowledge.permissions.ts`, que combina sector, rango y persona. Un endpoint
  de base a la que no se tiene acceso responde **404, no 403**: quien no la
  puede ver tampoco deberia poder deducir que existe probando identificadores.
- **Referencias opcionales**: `utils/commonSchemas.ts → nullableUuid` acepta
  las tres formas de "sin valor" (`''` del formulario, `null` explícito de
  la API, campo ausente) y las guarda como `null`.

## Decisión: las imágenes se comprimen en el navegador, no en el servidor

Los adjuntos se guardaban tal como llegaban: una foto de celular ocupa entre 3
y 6 MB en disco, y a cinco fotos por ticket el volumen de uploads crece más de
1 GB por mes. El objetivo de despliegue es una PC de escritorio común, así que
eso no escala.

La solución habitual es reencodear del lado del servidor con `sharp`, que es un
binario nativo: suma peso a la imagen, ata el build a la plataforma y le pone
el trabajo de CPU justo al equipo que menos tiene para dar.

Acá se hace **en el navegador**, antes de subir (`comprimirImagen` en
`app.js`): se decodifica con `createImageBitmap`, se reescala a 1600 px de lado
mayor sobre un `canvas` y se reencodea a WebP con calidad 0.82 (con caída a
JPEG si el navegador no lo soporta).

- **Cero dependencias nuevas** en el servidor.
- El trabajo lo hace el equipo de quien sube, que está ocioso; el servidor solo
  recibe un archivo ya chico.
- Viaja menos por la red y la subida termina antes.
- Al reencodear se pierden los metadatos EXIF, que en una foto de celular
  incluyen la ubicación GPS.

Medido con imágenes reales: una foto de 4032×3024 pasa de **6897 KB a 541 KB**
(−92 %, 489 ms) y una captura de 1920×1080 de **395 KB a 109 KB** (−72 %).
Factor de ahorro en disco: **11×**.

Qué NO se toca, a propósito: PDF y planillas (no son imágenes), GIF (podría
estar animado y el canvas se quedaría con el primer cuadro) e imágenes que ya
son chicas *y* están dentro del lado máximo — las dos condiciones importan,
porque una captura de colores planos puede pesar poco y medir 4000 px igual, y
esos píxeles ocupan memoria del navegador de quien la abre.

Es una **optimización, no un control de seguridad**: alguien podría subir por
la API sin pasar por el navegador. El límite de 10 MB por archivo sigue
aplicándose en el servidor, que es donde corresponde.

## Decisión: contenido por bloques, nunca HTML del usuario

El feed y las bases de conocimiento necesitan texto con formato, tablas,
imágenes y tarjetas. La forma habitual de resolver eso es guardar HTML escrito
por el usuario — y ahí aparece el XSS: alcanza con un `<img onerror=…>` en una
celda pegada desde Excel para ejecutar código en la sesión de quien lo lea.

Acá el contenido se guarda como una **lista de bloques con estructura
conocida** (`utils/contentBlocks.ts`): cada bloque tiene un `kind` y unos
campos validados con Zod contra el esquema de **ese** tipo. El cliente arma el
HTML a partir de esos datos escapando cada texto con `esc()`.

**No se guarda ni se renderiza marcado del usuario en ningún punto.** El XSS
deja de ser un riesgo a mitigar y pasa a ser imposible por construcción: no
hay por dónde entrar. Se verificó con payloads reales, incluida una tabla de
Excel con HTML malicioso pegada en el editor.

Efectos laterales, todos buenos:

- El formato es un dato, así que **todo se ve igual** lo escriba quien lo
  escriba: no hay diez tipografías ni diez tamaños de título.
- Se puede **buscar dentro del contenido** sin parsear HTML.
- Al pegar desde Excel se extraen **solo filas y celdas** (`DOMParser` sobre un
  documento inerte, leyendo `textContent`): estilos, scripts e imágenes del
  pegado se descartan y nunca se guardan.
- Los campos marcados como sensibles quedan fuera del texto de búsqueda: no
  tendría sentido taparlos en pantalla y devolverlos en un resultado.

## Decisión: tiempo real por WebSocket

Los mensajes del chat, los cambios en los tickets y las notificaciones se
**empujan** desde el servidor por un WebSocket (`ws`) montado sobre el mismo
servidor HTTP de Express: mismo puerto, mismo origen, misma cookie de sesión.
No abre nada nuevo hacia afuera ni requiere tocar el firewall.

La primera versión del chat usaba polling HTTP (4 s la conversación abierta,
15 s el contador de no leídos). Funcionaba, pero tenía dos costos que se
notan: hasta 4 segundos de demora en ver un mensaje, y un pedido cada pocos
segundos por cada persona conectada, estuviera pasando algo o no. **Ese
polling ya no existe** — se sacó por completo del cliente y del backend
(incluidos los endpoints `?after=` que lo servían).

### El transporte

`realtime/` tiene cinco piezas con una responsabilidad cada una:

| Archivo | Qué hace |
|---|---|
| `realtime.server.ts` | Handshake, heartbeat, revalidación de sesión, mensajes entrantes |
| `realtime.registry.ts` | `userId → sockets`, enviar y cerrar conexiones |
| `realtime.audience.ts` | **Quién puede recibir cada evento** (el RBAC del socket) |
| `realtime.rateLimit.ts` | Cupo de mensajes y de frames por usuario |
| `realtime.emit.ts` | API que usan los services para emitir |

No se usa Redis ni un broker de mensajes: a la escala objetivo (hasta ~50
usuarios simultáneos en red interna) todo lo sostiene **un solo proceso Node**,
y no hay varias instancias entre las que compartir estado. Medido con 50
conexiones simultáneas: 15 ms de latencia de entrega promedio, CPU por debajo
del 3 %, 41 MB de RAM.

### Solo empuje: el cliente nunca se suscribe

Este es el punto de seguridad más importante del diseño. **No existe un
mensaje `subscribe`.** El cliente no puede pedir "mandame los eventos de la
conversación X" ni "de los tickets del sector Y".

Antes de emitir cualquier cosa, el servidor consulta la base y arma la lista
exacta de usuarios habilitados (`realtime.audience.ts`); el evento sale
únicamente hacia los sockets de esos usuarios, y el payload se arma por
destinatario (el mismo mensaje es `mine: true` para quien lo mandó y
`mine: false` para quien lo recibe). Un cliente manipulado desde la consola del
navegador no tiene forma de agregarse a una audiencia que no le corresponde,
porque no hay ningún mensaje que lo permita.

**El RBAC de la API HTTP no se hereda**: por el socket no pasa ningún
middleware de Express. `realtime.audience.ts` reimplementa explícitamente el
alcance de `tickets.service.list()`/`getById()` y la regla de participantes del
chat. Si esas reglas cambian en el service, hay que cambiarlas también ahí —
está anotado en el propio archivo.

### Lo que el cliente sí puede mandar

Tres cosas, todas acotadas: `ping`, `chat:send` y `chat:read`. `chat:send` y
`chat:read` pasan por **el mismo service** que usan los endpoints HTTP, así que
las validaciones de participante y de privacidad son las mismas, no una copia
que pueda quedar desalineada.

### Reconexión

El cliente reconecta solo, con backoff de 1 s a 20 s. Hay un caso que no se
resuelve con eso y que aparece al suspender un equipo: **el navegador puede
dejar el socket en estado `OPEN` aunque ya no pase nada por él** (se verificó:
con la red caída, Chromium mantiene `readyState === 1`). Para eso hay una sonda
de vida — al volver la pestaña al frente o al recuperarse la red, se manda un
`ping` y se espera el `pong`; si no contesta en 4 segundos, se descarta la
conexión y se reconecta. No es polling: no pide información y solo corre en
esos dos eventos.

Del lado del servidor, el heartbeat cada 30 s cumple la misma función
(`ping`/`pong`, se termina lo que no contesta) y además **revalida la sesión
contra la base**. Eso último es defensa en profundidad: un socket se autentica
una sola vez, en el handshake, y sin revalidar seguiría vivo después de que la
sesión expire o de que desactiven la cuenta, aunque algún camino de código se
olvide de avisar.


## Decisión: HSTS/upgrade-insecure-requests condicionados

El despliegue típico es HTTP simple dentro de una red interna (sin
certificado). Helmet por defecto manda `Strict-Transport-Security` y el CSP
`upgrade-insecure-requests`, que hacen que el navegador fuerce HTTPS y la
app deje de cargar. Ambos se activan solo cuando `COOKIE_SECURE=true` (es
decir, cuando hay un proxy HTTPS delante). Ver `backend/src/app.ts`.

## Cómo se verificó cada ronda

Criterio repetido en todas las entregas antes de dar por cerrado:

1. `docker compose down -v && docker compose up -d --build` (desde cero).
2. Batería de pruebas por API directa con `curl` (matriz de permisos entre
   los 3 roles, validaciones, casos borde, rate limits).
3. Navegación real en Chromium (Playwright) de cada pantalla nueva,
   incluyendo captura de consola y de red (para confirmar cero llamadas
   externas) y pruebas de XSS con payloads reales.
4. Revisión de logs de los 3 servicios (sin errores ni warnings).
5. Reset a estado semilla limpio y commits organizados por área.
