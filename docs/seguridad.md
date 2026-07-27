# Seguridad

## Autenticación y sesiones

- Contraseñas con hash **bcrypt** (12 rondas), nunca en texto plano.
- Sesiones server-side: el navegador guarda solo un token opaco aleatorio en
  una cookie `httpOnly` + `SameSite=Strict`; la base guarda únicamente el
  **hash SHA-256** de ese token. Robar la base no permite fabricar sesiones.
- Expiración deslizante (por defecto 12 h, configurable con
  `SESSION_TTL_HOURS`). Cerrar sesión elimina la sesión de verdad.
- Rate limiting en el login (10 intentos por IP cada 5 minutos), más un
  límite general en el resto de la API (ver "Límites de uso" abajo).
- **CSRF**: no hay tokens anti-CSRF explícitos porque no hacen falta con
  este diseño — la cookie de sesión es `SameSite=Strict`, así que el
  navegador directamente **no la envía** en un pedido originado desde otro
  sitio (ni siquiera en una navegación de nivel superior, a diferencia de
  `Lax`). Sin la cookie, un formulario o script malicioso en otra página no
  tiene forma de autenticarse contra la API de CIGST.

## Permisos (RBAC)

Tres roles, validados **en el backend en cada endpoint** — lo que la
interfaz oculta también está bloqueado en la API (devuelve `403`):

| | Administrador | Supervisor | User |
| --- | :-: | :-: | :-: |
| Crear/gestionar tickets (de cualquiera) | ✅ | ✅ | solo crear; ve únicamente los propios |
| Ver Personas / Equipamiento / Sectores y Turnos | ✅ | ✅ (solo lectura) | ❌ (solo un directorio mínimo vía `/tickets/form-options` para armar su ticket) |
| Crear/editar/borrar Personas, Equipos, Sectores, Turnos | ✅ (con log de cambios) | ❌ | ❌ |
| Bitácora técnica | ✅ | ❌ | ❌ |
| Panel administrador (usuarios) | ✅ | ❌ | ❌ |
| Chat interno (1 a 1 y grupos donde es miembro) | ✅ | ✅ | ✅ |
| Crear/editar grupos de chat | ✅ | ❌ | ❌ |
| Notificaciones propias (campanita) | ✅ | ✅ | ✅ |

### Historiales de cambios (auditoría liviana)

Cada edición de una Persona, un Equipo o una cuenta de Usuario deja una
línea automática en su campo `changeLog` — "26/07/2026 21:14 — Sector: «A» →
«B»" — generada **solo por el backend** (el cliente nunca puede escribirla).
De una contraseña solo se registra el hecho ("Contraseña actualizada"),
jamás el valor. Los ven Admin (y Supervisor donde tiene lectura).

## Privacidad del chat

Un usuario solo puede leer o escribir en una conversación de la que es
participante, y en un grupo del que es **miembro** — verificado
explícitamente por API con un usuario ajeno, que recibe `403` al intentar
leer, escribir o marcar como leído tanto un 1 a 1 como un grupo ajeno.
**Esto rige también para Administrador: no hay bypass por rol** (el admin
crea y administra los grupos, pero para leerlos tiene que ser miembro — al
crear uno queda incluido automáticamente). Es una decisión deliberada de privacidad. La contracara:
hoy no existe un camino de auditoría dentro de la plataforma para investigar
un reclamo de mal uso del chat (los mensajes viven en Postgres, así que un
export a nivel de base sigue siendo posible como último recurso). Si se
necesita una vía formal, la recomendación es un mecanismo separado y
*auditado* (exportar una conversación puntual bajo un motivo registrado, con
su propio log), no un acceso silencioso desde la interfaz.

Protecciones específicas del chat:

- Contenido de mensajes escapado al renderizar (verificado con payloads
  `<script>` y `onerror` reales en navegador: se muestran como texto plano,
  cero ejecución).
- Límite de 2000 caracteres por mensaje, validado en el backend.
- Rate limit de envío: 30 mensajes por minuto **por usuario autenticado**
  (no por IP: varias personas de la misma oficina comparten salida de red).
- Un usuario desactivado no puede autenticarse (ni enviar ni recibir), no se
  le puede iniciar una conversación nueva, y las conversaciones existentes
  con él quedan bloqueadas para escritura.

## Cabeceras y red

- Helmet con CSP que no permite cargar nada desde fuera del propio servidor
  (`default-src 'self'`). No hay CDNs ni recursos externos.
- HSTS y `upgrade-insecure-requests` solo se activan con
  `COOKIE_SECURE=true` (cuando hay HTTPS delante) — en HTTP interno plano
  romperían la carga de la app.
- `app.js`/`styles.css` se sirven con `Cache-Control: no-cache`: el
  navegador siempre revalida contra el servidor antes de usar una copia
  guardada (barato en LAN, responde `304` si no cambió nada). Evita que,
  tras actualizar la plataforma, alguien quede con una mezcla de archivos
  viejos y nuevos por caché heurística del navegador.
- PostgreSQL **no expone ningún puerto** fuera de la red interna de
  contenedores. El único puerto publicado es el de la app (`APP_PORT`).

## Límites de uso (rate limiting)

Además del límite estricto de login (10 intentos / 5 min por IP) y el de
envío de mensajes de chat (30 / min por usuario), toda la API tiene un
límite general de contención: **600 pedidos cada 5 minutos**, por usuario
autenticado (por IP para pedidos sin sesión). No reemplaza a los límites
específicos — es una red de resguardo adicional para que ninguna cuenta,
por error de cliente, script o mal uso, pueda saturar el servidor. El uso
normal de la interfaz (incluido el polling del chat y de notificaciones)
queda muy por debajo: el techo existe para el caso anómalo, no para el uso
cotidiano.

## Archivos adjuntos

Los adjuntos (imágenes, PDF, planillas en tickets y chat) son el punto de
entrada más delicado de la plataforma, así que llevan defensas propias:

- **El tipo se determina por los bytes reales, no por lo que declara el
  cliente.** Después de escribir el archivo se leen sus primeros bytes y se
  compara con las firmas conocidas (PNG, JPEG, GIF, WEBP, PDF, XLSX, XLS);
  si no coincide con ninguna, el archivo se borra y la subida se rechaza —
  aunque la extensión y el `Content-Type` declarado fueran válidos.
  Verificado subiendo un HTML con `<script>` renombrado a `.png` y un
  ejecutable renombrado a `.pdf`: ambos rechazados.
- **Sin SVG ni HTML**: son los únicos formatos "de imagen/documento" que un
  navegador ejecutaría como código si se mostraran embebidos.
- **Solo las imágenes se sirven `inline`**; todo lo demás va con
  `Content-Disposition: attachment`, así el navegador nunca interpreta un
  PDF o una planilla dentro del origen de la aplicación. Siempre con
  `X-Content-Type-Options: nosniff`.
- **El nombre en disco lo genera el servidor** (UUID + extensión de una
  lista blanca): el nombre original del usuario nunca toca el sistema de
  archivos, así que no hay forma de escapar del directorio (path traversal)
  ni de sobrescribir archivos existentes.
- **Permisos de descarga heredados del recurso padre**: un adjunto de ticket
  lo ve quien puede ver ese ticket; uno de chat, solo los participantes de
  esa conversación o los miembros de ese grupo — **sin bypass por rol**
  (verificado: un Supervisor ajeno a la conversación recibe `403`). Un
  adjunto todavía sin enviar solo lo ve quien lo subió.
- **No se pueden usar adjuntos ajenos ni reutilizar uno ya enviado**: al
  crear el ticket o mensaje se valida que cada id sea del propio usuario y
  esté sin vincular (verificado con intentos reales de ambos casos).
- **Límites**: 10 MB por archivo, 5 archivos por envío, y un límite de
  subida propio (40 cada 10 minutos por usuario) más acotado que el general
  porque cada subida consume disco, no solo CPU.
- **Limpieza automática**: los adjuntos que se suben pero nunca se envían se
  borran (archivo + registro) pasadas 24 h, con una rutina que corre al
  arrancar y cada 6 h. Verificado: 24 huérfanos eliminados, los vinculados
  intactos, disco de 104,8 MB a 112 KB.

### Rendimiento (medido, no estimado)

La subida y la descarga van **en streaming a disco**, nunca cargando el
archivo entero en memoria. Medición real sobre el contenedor:

| Escenario | RAM del backend |
| --- | --- |
| En reposo | 30,6 MB |
| Tras subir 95 MB (10 archivos de 9,5 MB) | 40,9 MB |
| Durante 8 descargas simultáneas de 9,5 MB | 54,2 MB |

Es decir: +10 MB de RAM para 95 MB de archivos. Con almacenamiento en
memoria (el otro modo posible) esas mismas subidas habrían reservado ~95 MB.
El volumen de adjuntos es independiente del de la base, así que el disco se
puede monitorear y limpiar por separado.

## Endurecimiento de los contenedores

- Los 3 servicios corren con `security_opt: no-new-privileges:true`:
  ningún proceso dentro del contenedor puede escalar privilegios vía
  binarios `setuid`/`setgid`, aunque existieran.
- El contenedor `app` corre con **sistema de archivos de solo lectura**
  (`read_only: true`, con `/tmp` en memoria vía `tmpfs` y el volumen de
  adjuntos montado en `/app/uploads`). Fuera de esos dos puntos, si una
  dependencia comprometida intentara escribir un archivo en el contenedor
  (por ejemplo, para persistir un webshell), el sistema de archivos lo
  rechaza. Verificado tras agregar los adjuntos: `/app/uploads` escribible,
  `/app/hack.js` → `Read-only file system`.
- El proceso del backend corre como usuario **no root** dentro del
  contenedor (`USER cigst`, ver `backend/Dockerfile`).
- PostgreSQL no expone ningún puerto al host (arriba).

## Borrado real de usuarios

Eliminar un usuario desde el Panel administrador es un borrado físico (a
pedido explícito del negocio). Guardas: un Administrador no puede borrarse a
sí mismo ni dejar la plataforma sin ningún Administrador activo. Las
referencias que tenía quedan en `NULL` en vez de romperse, y sus sesiones y
chats se eliminan en cascada.

## Salud de dependencias

`npm audit` al día de la última entrega: **0 vulnerabilidades conocidas**.

Todo lo que se descarga viene de fuentes oficiales, con versiones fijadas:

- **Imágenes Docker** (Docker Hub, imágenes oficiales): `postgres:16.14-alpine`,
  `node:20.20.2-alpine`.
- **Paquetes npm**: solo los declarados en `backend/package.json`, con
  `package-lock.json` (hashes de integridad verificados por `npm ci`).
- **Única descarga externa opcional**: el instalador de Linux puede bajar
  Docker Engine desde `get.docker.com` (script oficial de Docker), solo con
  confirmación explícita del usuario.

### Licencias de dependencias (todas de uso libre, aptas para uso comercial)

| Paquete | Versión | Licencia |
| --- | --- | --- |
| express | 4.22.2 | MIT |
| @prisma/client | 5.22.0 | Apache-2.0 |
| zod | 3.25.76 | MIT |
| helmet | 7.2.0 | MIT |
| bcryptjs | 2.4.3 | MIT |
| cookie-parser | 1.4.7 | MIT |
| dotenv | 16.6.1 | BSD-2-Clause |
| express-rate-limit | 7.5.1 | MIT |
| pino | 9.14.0 | MIT |
| pino-http | 10.5.0 | MIT |
| prisma (dev) | 5.22.0 | Apache-2.0 |
| typescript (dev) | 5.9.3 | Apache-2.0 |
| tsx (dev) | 4.23.1 | MIT |

## Configuración (`.env`)

Cada variable de entorno está documentada en detalle, con su implicancia de
seguridad, directamente en [`.env.example`](../.env.example) — incluye qué
valores hay que cambiar sí o sí antes de un uso real, cuáles son seguros
para dejar por defecto, y por qué. El instalador genera ese archivo solo
(con contraseñas aleatorias de 20 caracteres si no se elige una a mano); no
hace falta editarlo manualmente salvo que se quiera ajustar algo puntual.

## Auditoría de esta ronda (resumen de hallazgos y arreglos)

Revisión dirigida a exposición de datos y errores de plataforma, sobre el
código ya existente:

- **Código muerto de riesgo de confusión**: `safeCompareHash()` (comparación
  a tiempo constante) estaba definida pero nunca usada — la validación de
  sesión real es un `findUnique` por hash en la base, no una comparación
  manual, así que la función no aportaba nada y podía llevar a pensar que
  existía una defensa que en realidad no estaba conectada a ningún lado. Se
  eliminó.
- **UI que prometía algo que no hacía**: el checkbox "Recordarme" del login
  no estaba conectado a ninguna lógica (la duración de sesión ya la fija
  `SESSION_TTL_HOURS` de forma global). Se quitó para no mostrar
  funcionalidad falsa.
- **Sin red de contención general en la API**: solo login y chat tenían
  límite de pedidos. Se agregó un límite general (ver "Límites de uso").
- **Contenedores sin refuerzo adicional**: se agregó `no-new-privileges` a
  los 3 servicios y `read_only` + `tmpfs` al backend (ver "Endurecimiento
  de los contenedores"). Verificado con la batería de pruebas completa
  (API + navegador real) tras el cambio: sin regresiones.
- **Caché de estáticos inconsistente**: ver la entrada de `Cache-Control`
  arriba — no era una fuga de datos, pero sí una fuente real de "la
  plataforma se ve rota" tras actualizar.
- Revisado y confirmado sin hallazgos: inyección (todo el acceso a datos
  pasa por Prisma con consultas parametrizadas, sin SQL crudo en ningún
  módulo), XSS (todo el contenido de usuario pasa por `esc()` antes de
  interpolarse en el DOM — auditado archivo por archivo, no solo en el
  chat), fuga de `passwordHash` en cualquier respuesta de la API, y
  secretos en el repositorio o en las imágenes de Docker (`.dockerignore`
  excluye `.env`/`.git`/`node_modules` del contexto de build).

## Pendiente para un despliegue más exigente

- HTTPS vía proxy reverso interno (si se necesita cifrado dentro de la red).
- Cambio de contraseña desde la propia interfaz por el usuario final (hoy lo
  hace un Administrador desde el panel).
- Auditoría inmutable de cambios (más allá del historial de `changeLog` en
  Personas/Equipos/Usuarios, que no es inmutable a nivel base de datos).
