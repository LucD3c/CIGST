# Arquitectura técnica

> Documento para desarrolladores. Si solo querés instalar o usar la
> plataforma, alcanza con el [README](../README.md) y la
> [guía de usuario](guia-usuario.md).

## Stack

| Capa | Tecnología |
| --- | --- |
| Backend | Node.js 20 + TypeScript + Express 4 |
| Base de datos | PostgreSQL 16 (vía Prisma ORM 5) |
| Frontend | HTML/CSS/JS vanilla en un solo archivo (`app.js`), sin framework ni build |
| Despliegue | Docker Compose (3 servicios: `db`, `migrate`, `app`) |

Ninguna parte de la plataforma hace llamadas a internet en tiempo de
ejecución: sin CDNs, sin APIs externas, sin telemetría. Las fuentes
tipográficas están auto-hospedadas en `fonts/`. Esto está verificado con
captura de tráfico de red en un navegador real (cero requests a hosts
externos, incluso durante el polling del chat).

## Estructura del repositorio

```
backend/
  src/
    config/      configuración y validación de variables de entorno (Zod)
    db/          cliente de Prisma (PostgreSQL)
    middleware/  autenticación, autorización por rol, validación, rate limit
    modules/     auth, users, employees, equipment, tickets, logbook,
                 sectors, schedules, chat, notifications
                 (cada uno: routes -> controller -> service -> repository)
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
- **Historiales de cambios**: `utils/changeLog.ts` compara antes/después en
  los services de employees/equipment/users y antepone la línea al campo
  `changeLog`; la zona horaria de esas marcas sale de `TZ` (compose la pasa,
  por defecto America/Argentina/Buenos_Aires).

## Decisión: chat por polling HTTP (no WebSocket/SSE)

A la escala objetivo (decenas de usuarios en red interna), un canal de
conexiones persistentes suma complejidad real de mantenimiento sin una
ganancia de latencia que importe. El polling reutiliza el mismo patrón
`fetch()` del resto de la SPA, no agrega dependencias y se recupera solo de
cortes de red. Intervalos como constantes en `app.js`:
`CHAT_THREAD_POLL_MS` (4 s, conversación abierta) y `CHAT_UNREAD_POLL_MS`
(15 s, badge global de no leídos).

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
