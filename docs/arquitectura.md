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
| Frontend | HTML/CSS/JS vanilla en módulos ES nativos (`js/`), sin framework ni build |
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
index.html / styles.css / js/ / fonts/  interfaz (servida por el backend)
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

## Caché de los estáticos (`js/` / `styles.css`)

`express.static` responde estos archivos con `Cache-Control: no-cache`
(`app.ts`), no con el default del navegador. La diferencia importa acá: sin
esa cabecera, un navegador puede quedarse con una versión vieja de
`styles.css` mientras ya descargó los módulos nuevos tras una actualización de
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
  `form-options`. La interfaz usa el mismo criterio al ordenar por columna.
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
`js/adjuntos.js`): se decodifica con `createImageBitmap`, se reescala a 1600 px de lado
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

## Decisión: el correo se configura desde la pantalla, no desde el `.env`

La plataforma se conecta por IMAP/SMTP a las casillas que la empresa ya tiene.
Los datos de servidor **no** viven en el `.env` ni en el código: se cargan
desde la pantalla, y por eso funciona con cualquier proveedor sin tocar nada.

La configuración está partida en dos a propósito:

| | Quién | Qué |
|---|---|---|
| `MailProvider` | Administrador | Host y puerto de IMAP y SMTP. Es la parte que puede salir mal o ser peligrosa. |
| `MailAccount` | Cada persona | Su casilla, con su usuario y contraseña. Las compartidas del sector las crea un Administrador. |

Así nadie tiene que pedirle los puertos a Infraestructura cada vez que se suma
alguien, y ningún Administrador ve la contraseña personal de nadie. Hay presets
para los proveedores habituales (Gmail, Microsoft 365, cPanel/Roundcube, Zoho,
Yahoo) que son **solo atajos**: siempre se puede cargar uno a mano.

### Lo que cambia en el perfil de riesgo

Hasta el correo, la plataforma no guardaba **nada** reversible: la contraseña
de una persona es un hash bcrypt y la sesión es un hash SHA-256. Un cliente de
correo no puede funcionar así — para conectarse al IMAP tiene que mandar la
contraseña real.

Se asume con tres decisiones explícitas:

- **AES-256-GCM** con la clave en `MAIL_ENCRYPTION_KEY`, que vive en el `.env`
  y **no** en la base. Quien se lleve un volcado sin el `.env` no puede hacer
  nada con esos cifrados. GCM además autentica: si alguien edita el cifrado en
  la base, el descifrado falla en vez de devolver basura.
- **Sin esa variable, el correo queda desactivado** y el resto funciona igual.
  No hay clave por defecto ni derivada: fallar cerrado es preferible a cifrar
  con algo que cualquiera pueda reproducir leyendo el código. El instalador la
  genera sola, también al actualizar una instalación vieja.
- Cada cifrado lleva su propio nonce, así dos casillas con la misma contraseña
  no producen el mismo texto cifrado.

### SSRF: a dónde se le permite conectarse al servidor

Configurar un servidor de correo es, técnicamente, decirle al backend "abrí una
conexión a este host y este puerto". Sin acotarlo, alguien con acceso de
Administrador podría apuntarlo a cualquier cosa que la plataforma alcance desde
adentro de la red y usarla como sonda.

`mail.network.ts` lo cierra: **resuelve el nombre antes de conectar** (no
alcanza con revisar el texto — `correo.empresa.com` puede resolver a
`127.0.0.1`), rechaza direcciones privadas, de loopback y de enlace local
—incluida `169.254.169.254`, la de metadatos de nube—, y limita los puertos a
los de correo. Se comprueba al guardar **y otra vez antes de cada conexión**,
porque entre una cosa y la otra un dominio puede cambiar a dónde apunta.

Si el servidor de correo está de verdad en la red interna, un Administrador lo
habilita con una casilla explícita. Es una decisión consciente, no un accidente.

### El HTML de los correos

Es la superficie más expuesta de la plataforma: todo lo demás lo escribió
alguien de la empresa, un correo lo escribió cualquiera. La defensa es de dos
capas, y la que sostiene el peso es la segunda:

1. `mail.sanitize.ts` saca lo obviamente peligroso y desactiva las imágenes
   remotas (un píxel de seguimiento delata que se abrió el correo, desde qué IP
   y a qué hora).
2. El resultado se muestra en un **`<iframe sandbox>` sin `allow-scripts`**,
   con su propia CSP. Eso no es una limpieza que pueda tener un agujero: es el
   navegador el que garantiza que ahí adentro no corre JavaScript. Aunque la
   limpieza dejara pasar algo, no habría ejecución. Verificado: el navegador
   registra `Blocked script execution in 'about:srcdoc'`.

### Rendimiento

No se guarda ningún correo en la base: se le piden al proveedor los datos de la
pantalla y se descartan. Eso evita duplicar información sensible (en un centro
médico, el correo tiene datos de pacientes) y hace que el disco no crezca por
tener la plataforma abierta.

Las conexiones IMAP se reservan 90 segundos y se reusan: abrir una cuesta
entre medio segundo y un segundo (saludo TLS + autenticación), y hacerlo en
cada clic haría que la bandeja se sienta pesada. Hay un tope de 30 conexiones
simultáneas para que la memoria no crezca sin límite.

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

---

## Escala: qué cambia cuando la plataforma lleva años en uso

Las decisiones de esta sección existen por una sola razón: lo que funciona
perfecto con 26 tickets puede volverse inusable con quince mil, y eso pasa de
a poco, sin que nadie lo note hasta que ya molesta.

### Listados paginados (`utils/pagination.ts`)

Antes cada listado devolvía la tabla **entera** con todas sus relaciones, en
cada carga de pantalla. El servidor ahora manda de a una página y dice cuántos
hay en total.

- **El tope de 200 filas por página no es negociable desde el cliente.** Aunque
  alguien pida `pageSize=100000`, el servidor entrega 200. Es lo que garantiza
  que ninguna consulta pueda crecer sin límite con el paso de los años.
- **El orden lo pide el cliente pero lo decide el servidor**, a través de un
  mapa explícito por módulo (`ORDEN`). Una columna que no está en el mapa cae
  al orden por defecto: el cliente no puede ordenar por un campo arbitrario ni
  inyectar nada en la consulta.
- **El filtro de estado de los tickets pasó al servidor.** Con la lista
  paginada, filtrar en el navegador daría "los activos que hay entre los
  primeros 50", no "los activos".

### Orden alfabético: se resolvió en la base, no en Node

El orden correcto para el castellano se hacía reordenando en Node **después**
de traer la tabla completa. Ese truco deja de servir en cuanto se pagina: no se
puede ordenar bien un universo del que solo se trajo una página.

La solución definitiva fue marcar las columnas de texto con la colación
española (`es-x-icu`) en Postgres, con lo cual el orden correcto sale
directamente de la consulta:

```
sin colación:  Nunez | Ortiz | Zapata | alvarez | Álvarez | Ñandú
con colación:  alvarez | Álvarez | Nunez | Ñandú | Ortiz | Zapata
```

Se usa el español genérico y no el de un país puntual, para que la plataforma
sirva igual en cualquier empresa de habla hispana.

### Códigos correlativos atómicos (`utils/codeGenerator.ts`)

`TK-001`, `EMP-001`, `EQ-001` se generaban con `count() + 1`, que tenía una
condición de carrera real: dos altas simultáneas leían el mismo total, armaban
el mismo código y la segunda moría contra el índice único devolviendo un 500
genérico — la persona perdía lo que había escrito.

Ahora el número lo entrega Postgres con un `INSERT … ON CONFLICT DO UPDATE …
RETURNING` sobre una tabla `counters`, que es atómico por definición. Además se
comprueba que el código no esté ocupado, lo que permite convivir con los
códigos de equipo escritos a mano.

### Retención de datos sin uso (`maintenance/retencion.service.ts`)

Corre sola cada 6 horas y también a pedido desde el instalador. La regla que
manda sobre todo lo demás: **no se pierde nada que le sirva a nadie**. Solo se
eliminan sesiones vencidas, intentos de login viejos, avisos ya leídos, acuses
de publicaciones dadas de baja y archivos físicos sin ninguna fila que los
referencie. Ni un ticket, ni un mensaje, ni un archivo alcanzable — tampoco los
dados de baja, que se conservan para siempre.

### Control de espacio (`maintenance/disco.service.ts`)

El volumen de adjuntos comparte disco con la base de datos: si se llenara,
Postgres dejaría de poder escribir y se caería la plataforma entera. Hay dos
frenos, y los dos actúan antes de llegar a ese punto — un tope propio para los
adjuntos y un margen mínimo de espacio libre real. Cuando se frena una subida
**no se pierde nada de lo ya guardado**: lo único que pasa es que no entran
archivos nuevos.

### Compresión de imágenes en el servidor (`attachments.imagen.ts`)

El navegador ya comprimía antes de subir, pero esa compresión se saltea
pegándole directo a la API. La pasada del servidor corre **siempre**, venga el
archivo de donde venga. No toca PDF, planillas ni GIF (perdería la animación),
y si comprimir no achica nada conserva el original.

Medición real sobre una captura de pantalla: 351 KB → 85 KB, **4,2 veces más
chica**.

### Búsqueda de artículos indexada

La búsqueda dentro del contenido traía hasta 500 artículos a memoria y los
filtraba ahí: pasados los 500, los que quedaban afuera **no aparecían nunca**
en ninguna búsqueda y nadie se enteraba. Ahora hay una columna `search_text`
con índice GIN (`pg_trgm`), que el backend escribe en cada guardado usando
`plainTextOf()` — la misma función que **excluye los campos ocultos**, para que
una contraseña compartida no se pueda encontrar buscándola.

### Un solo proceso: el techo consciente del diseño

El registro de conexiones en tiempo real y los contadores de tráfico viven en
la memoria del proceso, lo que significa que la plataforma **no puede correr en
dos procesos a la vez**. Es una decisión, no un descuido: elimina la necesidad
de un Redis o similar, y para el rango de uso previsto sobra.

Medición con **70 personas trabajando simultáneamente**, sin pausa entre
acciones (mucho más exigente que el uso real): 70/70 sesiones, 70/70
conexiones de tiempo real, 2.100 peticiones, **cero errores**, p95 de 853 ms,
145 peticiones por segundo.

Si algún día hicieran falta más, la salida es una máquina más grande. El día
que eso no alcance, habría que mover el registro de sockets y los contadores a
un almacén compartido — pero ese día está bastante más lejos que el horizonte
de esta plataforma.

---

## La interfaz, repartida en módulos (`js/`)

Durante mucho tiempo toda la interfaz vivió en un único `app.js` de 3.475
líneas. Funcionaba, pero encontrar algo ahí adentro costaba, y ese costo sube
solo con el tiempo.

Ahora son **18 archivos**, ninguno de más de 480 líneas:

| Archivo | Qué hace | Líneas |
|---|---|---|
| `estado.js` | Estado compartido, en un único objeto | 36 |
| `util.js` | Escapado de HTML, insignias, roles | 39 |
| `nucleo.js` | Cliente de la API y manejo de errores | 52 |
| `normalizar.js` | Traduce las respuestas del servidor a la forma que usa la pantalla | 64 |
| `notificaciones.js` | La campanita | 85 |
| `datos.js` | Qué se carga en cada pantalla | 106 |
| `armazon.js` | Login, barra lateral, menú del celular, botón Mi IP | 113 |
| `app.js` | Router y arranque | 121 |
| `adjuntos.js` | Compresión de imágenes, subidas, pegar con Ctrl+V | 183 |
| `listas.js` | Tablas, orden por columna y vistas de listado | 198 |
| `paginacion.js` | Paginado, filtros y redibujado de listas | 205 |
| `tiemporeal.js` | WebSocket y reconexión | 235 |
| `feed.js` | Novedades | 254 |
| `conocimiento.js` | Bases de conocimiento | 273 |
| `chat.js` | Mensajes 1 a 1 y grupos | 350 |
| `formularios.js` | Altas, ediciones y bajas | 365 |
| `bloques.js` | Renderizado y editor de bloques de contenido | 445 |
| `correo.js` | Webmail | 476 |

### Sin compilar nada, a propósito

Son **módulos ES nativos**, los que el navegador entiende sin ayuda:
`<script type="module" src="js/app.js">`. No hay webpack, ni Vite, ni un paso
de `npm run build` para el frontend. Esto no es nostalgia: es lo que permite que
instalar la plataforma siga siendo levantar Docker y nada más, y que dentro de
cinco años cualquiera pueda abrir un archivo, entenderlo y cambiarlo sin
reconstruir una cadena de herramientas que para entonces estará desactualizada.

### El estado compartido

Un `export let` de un módulo ES se puede **leer** desde otro módulo pero no se
puede **reasignar** desde afuera, y acá hay decenas de lugares que escriben
estado ajeno: el router cambia de vista, cerrar sesión limpia el chat y el
correo, el WebSocket agrega mensajes. Por eso los 23 valores que de verdad
comparten varios módulos viven juntos en un objeto (`estado.js`), que sí se
muta desde donde sea.

Los otros 21 valores mutables **se quedaron dentro del módulo que los usa**: si
solo le importan al correo, no tienen por qué ser visibles para el resto.

### Cómo se ordenaron las dependencias

`estado.js` no importa nada de nadie, y `nucleo.js` y `util.js` son las bases
sobre las que se apoya todo lo demás. Las pantallas dependen de esas tres, no
al revés. Hay ciclos entre las pantallas y el router (una vista llama a
`render`, el router dibuja la vista), y eso es correcto: los módulos ES los
resuelven sin problema mientras las llamadas ocurran al usar la aplicación y no
al cargarla, que es exactamente el caso.

### La superficie de pruebas

`window.CIGST` expone unas pocas funciones internas para que las pruebas
automatizadas puedan llevar la interfaz a estados que a mano costaría armar
(por ejemplo forzar páginas de tres filas para ejercitar el paginador sin
cargar doscientas personas). No abre ninguna puerta: cualquier código que corra
en la página ya podría llamar a esas funciones, porque vive en el mismo origen.
