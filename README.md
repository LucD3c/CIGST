# CIGST (CEMEVE) — Centro Integral de Gestión de Soporte Técnico

Plataforma interna de tickets y gestión de soporte técnico, pensada para correr
100% dentro de la red de la empresa: sin APIs externas, sin CDNs, sin salida a
internet en tiempo de ejecución.

## Estado del proyecto

- **Backend real:** Node.js + TypeScript, PostgreSQL, autenticación por sesión
  server-side, permisos por rol, CRUD completo de usuarios, personas, equipos,
  tickets y bitácora técnica. Corre en Docker.
- **Interfaz visual (`index.html` / `app.js` / `styles.css`):** el mismo
  diseño de siempre — pero `app.js` ya no usa datos falsos en `localStorage`:
  todo (login, sesión, tickets, personas, equipos, bitácora, usuarios) se lee
  y se escribe contra la API real, con la visibilidad que le corresponde a
  cada rol. Probado de punta a punta en un navegador real (ver "Qué quedó
  probado" más abajo).
- **Ronda de usabilidad:** el alta de tickets y equipamiento se simplificó a
  propósito para que cualquier persona lo complete en segundos: mayoría de
  desplegables, mínimo texto para tipear. Soporte puede cerrar/resolver un
  ticket con un clic desde la lista, sin entrar al detalle. El Panel
  administrador permite editar y eliminar usuarios de verdad.
- **Sectores y Turnos como secciones propias:** dejaron de crearse "al vuelo"
  desde un desplegable — ahora tienen su propia pantalla dentro de
  "Información", con listado, alta, edición y (para Sectores) el detalle de
  qué personas y equipos tiene asignados cada uno. El horario de soporte de
  un ticket también pasó a ser un catálogo administrable (**Turnos**) en vez
  de una hora tipeada a mano; la hora de creación del ticket queda registrada
  sola y se muestra en su detalle.
- **Roles: Administrador / Supervisor / User.** Se renombraron `Técnico` →
  `Supervisor` y `Empleado` → `User` (mismo alcance de antes en cada caso).
  La Bitácora técnica pasó a ser exclusiva de Administrador.
- **Chat interno (1 a 1):** mensajería directa entre cualquier par de
  usuarios de la plataforma (sin restricción por rol — es entre personas, no
  por jerarquía), 100% tráfico local. Cada quien solo puede leer/escribir sus
  propias conversaciones — ni siquiera un Administrador puede leer chats
  ajenos (ver "Privacidad del chat" en Seguridad). Sin grupos todavía.
- **Grupos de chat y estadísticas por persona en el Centro de operaciones:**
  planificado para una etapa posterior.

## Requisitos

- Docker Desktop (Windows/Mac) o Docker Engine + Docker Compose (Linux).
- Nada más. No hace falta instalar Node, PostgreSQL ni ninguna otra dependencia
  en la máquina donde corre la plataforma.

## Instalación

1. Copiar `.env.example` a `.env`.
2. Abrir `.env` y cambiar `POSTGRES_PASSWORD` y `SEED_ADMIN_PASSWORD` por
   contraseñas propias (importante: `SEED_ADMIN_PASSWORD` solo se usa la
   primera vez que se crea el usuario administrador; si ya arrancaste la
   plataforma una vez, cambiar el `.env` después no cambia esa contraseña).
3. Levantar todo:

   ```
   docker compose up -d
   ```

4. Esperar unos segundos a que los tres servicios queden arriba (`docker
   compose ps` debe mostrar `db` y `app` como `healthy`). El primer arranque
   crea la base de datos, aplica las migraciones y carga los datos iniciales
   automáticamente.
5. Abrir `http://IP-DEL-SERVIDOR:3000` (o `http://localhost:3000` si es la
   misma máquina) desde cualquier equipo de la red interna.

Nada de esto requiere acceso a internet salvo la primera vez que Docker
descarga las imágenes base y las dependencias (build). Una vez construida la
imagen, la plataforma funciona completamente offline dentro de la red interna.

### Apagar / reiniciar

```
docker compose down        # apaga todo, conserva los datos (volumen de Postgres)
docker compose up -d       # vuelve a levantar
docker compose down -v     # apaga y borra también los datos (reinicio de fábrica)
```

## Acceso inicial

| Usuario | Contraseña | Rol |
| --- | --- | --- |
| `admin` (o el valor de `SEED_ADMIN_USERNAME`) | la definida en `SEED_ADMIN_PASSWORD` | Administrador |
| `mgonzalez` | `empleado123` | User (dato de referencia, ver abajo) |

El primer arranque crea un único caso de referencia (una colaboradora, un
equipo asignado y un ticket) para poder probar el circuito completo sin
cargar datos a mano.

| Rol | Acceso |
| --- | --- |
| Administrador | Todos los módulos, incluidos Bitácora técnica y el panel de usuarios. |
| Supervisor | Tickets de todos los sectores (crea y gestiona los de cualquiera), personas, equipamiento y Sectores/Turnos. No ve Bitácora ni el panel de usuarios. |
| User | Solo sus propias solicitudes y la creación de un nuevo ticket. |

## Qué quedó probado en esta etapa

Levantando la plataforma desde cero (`docker compose down -v && docker compose
up -d`) se verificó tanto por API como **navegando la interfaz real en un
navegador (Chromium)**:

- Pantalla de login sin credenciales precargadas; login válido/inválido con el
  mismo mensaje de error mostrado en la interfaz, cierre de sesión real y
  expiración/renovación de sesión.
- Bloqueo por rate limiting tras intentos de login repetidos.
- La interfaz se adapta al rol logueado: un Administrador ve todos los
  módulos, incluida Bitácora técnica; un Supervisor ve soporte (tickets de
  todos los sectores, personas, equipamiento, Sectores/Turnos) pero no
  Bitácora ni el panel de usuarios; un User ve únicamente "Mis solicitudes",
  sin la barra de navegación de soporte, y solo sus propios tickets. Los
  intentos por fuera de lo que la interfaz permite igual son rechazados por
  el backend (`403`), no solo ocultados visualmente — incluida la Bitácora,
  que un Supervisor recibe con `403` si intenta acceder directo a la API.
- Alta, gestión (estado/prioridad/asignado a) y consulta de tickets desde el
  modal existente, con los datos reales de personas/equipos/sector/turno ya
  resueltos (sin ids sueltos, con los códigos legibles de siempre: `TK-001`,
  `EMP-001`, etc.). El formulario de ticket ya no pide horario disponible ni
  canal de contacto: la hora queda registrada sola y se muestra en el
  detalle.
- Alta de personas, equipos, eventos de bitácora y usuarios desde los mismos
  formularios existentes, con el desplegable de **Sector** listando solo los
  sectores ya creados desde la pantalla dedicada (sin alta al vuelo).
- Pantalla propia de **Sectores** (dentro de "Información"): listado, alta,
  edición, detalle con las personas y equipos de cada sector, y una sección
  de **Turnos de soporte** (alta/edición de los horarios que usa la empresa,
  con validación de formato `HH:MM` y de que inicio y fin no sean iguales).
- Menú de acciones rápidas (⋮) en la lista de tickets: marcar Resuelto, Cerrar
  o Asignarme sin abrir el detalle completo.
- Panel administrador: edición completa de un usuario (nombre, rol, persona
  vinculada, estado, contraseña) y **eliminación real** (no lógica) con
  confirmación, bloqueada si el usuario intenta borrarse a sí mismo o si
  dejaría la plataforma sin ningún Administrador activo.
- Errores de validación de la API se muestran con el mismo aviso (`toast`) que
  ya usaba la plataforma, sin cerrar el formulario, para poder corregir y
  reintentar.
- Borrado lógico (soft delete) en Personas, Equipos, Tickets, Bitácora,
  Sectores y Turnos: un registro eliminado deja de listarse pero no se pierde
  de la base. Usuarios es la única excepción deliberada (ver "Seguridad").
- La plataforma carga y funciona correctamente sobre HTTP simple (sin
  certificado), como corresponde a un despliegue típico en red interna.
- El backend sirve `index.html`/`app.js`/`styles.css` directamente (sin
  servidor aparte para el frontend).
- **Chat interno:** dos usuarios reales conversando en dos sesiones de
  navegador distintas, con el mensaje llegando al otro extremo únicamente
  por el polling HTTP de la app (sin recargar la página). Un mensaje con
  contenido `<script>alert(1)</script><img src=x onerror="alert(2)">` se
  verificó que se renderiza como texto plano — cero `<script>` insertado en
  el DOM, cero diálogo `alert()` disparado. Badge de no leídos en el ítem de
  navegación, matriz completa de permisos por API directa (ver "Privacidad
  del chat"), rate limiting de envío confirmado con una ráfaga de 30+1
  mensajes, y paginación de historial verificada con más de 30 mensajes en
  una misma conversación. Cero llamadas a hosts externos confirmado también
  durante varios ciclos de polling.

## Seguridad de esta etapa

- Contraseñas con hash (`bcrypt`), nunca en texto plano.
- Sesiones server-side: el navegador solo guarda un token opaco en una cookie
  `httpOnly`; la base solo guarda el hash de ese token, nunca el token en sí.
- `SameSite=Strict` en la cookie de sesión (protección contra CSRF sin agregar
  complejidad extra) y cabeceras de seguridad (`helmet`) con una política de
  contenido que no permite cargar nada desde fuera del propio servidor.
- Permisos por rol validados en el backend en cada endpoint (nunca solo en el
  frontend).
- Variables sensibles (contraseñas, nombres de cookie, etc.) únicamente por
  `.env`; nunca hardcodeadas en el código.
- La base de datos PostgreSQL no expone ningún puerto hacia fuera del host:
  solo es alcanzable entre contenedores de la misma plataforma.
- Eliminar un usuario desde el Panel administrador es un borrado físico real
  (a pedido explícito del negocio): la fila desaparece de la base, no queda
  marcada como inactiva. Las referencias que tenía (tickets creados/asignados,
  bitácora) quedan sin ese vínculo en vez de romperse, y sus sesiones activas
  se cierran en cascada. Un Administrador no puede borrarse a sí mismo ni
  dejar la plataforma sin ningún Administrador activo.

### Privacidad del chat

Un usuario solo puede leer o escribir en una conversación de la que es
participante — verificado explícitamente por API con un usuario ajeno,
que recibe `403` al intentar leer, escribir o marcar como leída una
conversación entre otras dos personas. **Esto rige también para
Administrador: no hay bypass por rol.** Es una decisión deliberada de
privacidad, no un descuido — la contracara es que hoy no existe ningún
camino de auditoría dentro de la plataforma para investigar un reclamo de
mal uso del chat (los mensajes viven en Postgres igual, así que un export a
nivel de base sigue siendo posible como último recurso). Si en algún
momento se necesita una vía formal, la recomendación es un mecanismo
separado y *auditado* (ej. exportar una conversación puntual bajo un motivo
registrado, con su propio log), no un acceso silencioso vía la interfaz.

Un usuario desactivado no puede autenticarse (y por lo tanto no puede
enviar ni recibir mensajes); tampoco se le puede iniciar una conversación
nueva, y si se desactiva a mitad de una conversación existente, el otro
participante ya no puede seguir escribiéndole ahí.

Pendiente para un despliegue en producción más exigente: HTTPS (vía un proxy
reverso interno, por ejemplo si se necesita cifrado dentro de la propia red),
rotación de contraseñas desde la interfaz (hoy se administra por API) y
auditoría inmutable de cambios.

## Arquitectura

```
backend/
  src/
    config/      configuración y validación de variables de entorno
    db/          cliente de Prisma (PostgreSQL)
    middleware/  autenticación, autorización por rol, validación, rate limit
    modules/     auth, users, employees, equipment, tickets, logbook, sectors,
                 schedules, chat (cada uno: routes -> controller -> service -> repository)
    routes/      router principal de /api
  prisma/        schema.prisma, migraciones y seed inicial
  Dockerfile
docker-compose.yml
index.html / app.js / styles.css / fonts/   interfaz existente (sin cambios de diseño)
```

Entidades: Rol, Usuario, Sesión, Persona, Equipo, Ticket, Bitácora técnica,
Sector, Turno (horario de soporte), Conversación y Mensaje (chat interno).
Todas con identificador UUID y fechas de auditoría, con soft delete
(`deletedAt`) donde tiene sentido y estas excepciones deliberadas: Sesión se
elimina de verdad al cerrar sesión o expirar (no tiene sentido conservar un
token muerto); Usuario se elimina de verdad cuando lo borra un Administrador
(ver "Seguridad"); y Conversación/Mensaje tampoco llevan `deletedAt` — este
alcance no incluye borrar ni editar mensajes, así que el campo no tendría
uso todavía. Si un usuario se elimina, sus conversaciones (y los mensajes
dentro de ellas) se eliminan en cascada junto con él, ya que una
conversación sin sus dos participantes deja de tener sentido.

**Sector** es el catálogo compartido de ubicaciones/áreas de la empresa
(`Administración`, `Sistemas`, etc.), administrado desde su propia pantalla:
Persona, Equipo y Ticket eligen su sector de esa misma lista, en vez de
tipearlo cada vez. Equipo ya no se vincula a una persona puntual sino a un
sector completo — la ficha de una persona muestra el equipamiento de su
propio sector. **Turno** es el catálogo de horarios de soporte de la empresa
(`Mañana` 07:30–14:30, `Tarde` 14:30–21:00 por defecto), administrado desde
la misma pantalla de Sectores; un ticket puede referenciar el turno en el que
se lo atendió.

La relación central se mantiene: **Persona/Sector → Equipamiento → Tickets →
solución/conocimiento**, con bitácora transversal.

**Chat interno:** una **Conversación** representa un par de usuarios (par
canónico: los dos ids se guardan siempre en el mismo orden alfabético, así
nunca se crean dos conversaciones para las mismas dos personas) y se crea
recién con el primer **Mensaje** — no existen conversaciones "vacías". Sin
tabla de grupos por ahora. El transporte elegido es **polling HTTP corto**,
no WebSocket ni SSE: a la escala de esta plataforma (algunas decenas de
usuarios en red interna), un canal de conexiones persistentes suma
complejidad real de mantenimiento sin una ganancia de latencia que importe
acá, mientras que el polling reutiliza el mismo patrón `fetch()` que ya usa
toda la SPA, no agrega infraestructura ni dependencias nuevas, y se
recupera solo de cualquier corte de red. Los intervalos son constantes
configurables en `app.js` (`CHAT_THREAD_POLL_MS` = 4 s con la conversación
abierta, `CHAT_UNREAD_POLL_MS` = 15 s para el badge global), no valores
sueltos en el código.

### Notas sobre el API para quien siga trabajando sobre esto

- `GET /api/sectors` y `GET /api/schedules` están disponibles para cualquier
  rol autenticado (un User los necesita para elegir sector/turno al pedir
  soporte); crear/editar es de soporte (Admin+Supervisor), borrar es solo
  Admin. `GET /api/sectors/:id` devuelve además las personas y equipos
  vinculados a ese sector (lo usa la pantalla de detalle).
- `GET /api/auth/me` devuelve, además de los datos de sesión, la persona
  vinculada al usuario (su sector y el equipamiento de ese sector) cuando
  corresponde — es lo que usa el portal de un User para no necesitar acceso a
  `/api/employees` (que es exclusivo de soporte).
- `GET /api/users/technicians` expone una lista acotada (id + nombre) de
  usuarios con rol Administrador/Supervisor activos, para el selector de
  "asignado a" en la gestión de tickets. A diferencia de `GET /api/users`
  (exclusivo de Administrador), este está disponible para cualquier rol de
  soporte.
- `GET /api/logbook` (y el resto de la Bitácora técnica) es exclusivo de
  Administrador — un Supervisor recibe `403` aunque antes (como Técnico)
  tuviera acceso.
- Los roles son datos, no un enum fijo en el esquema: `Técnico`/`Empleado`
  se renombraron a `Supervisor`/`User` con una migración de datos
  (`UPDATE roles SET name = ...`) que preserva los `id` existentes, así los
  usuarios ya creados no perdieron su vínculo de rol.
- El chat no restringe por rol quién puede escribirle a quién: los 3 roles
  usan `/api/chat/*` igual, la única condición es ser participante de la
  conversación (ver "Privacidad del chat"). `POST /api/chat/conversations`
  crea la conversación si no existía (o reutiliza la existente) y manda el
  primer mensaje en la misma transacción; de ahí en adelante se usa
  `POST /api/chat/conversations/:id/messages`. La paginación de
  `GET .../messages` es por cursor (`before`/`after`, mutuamente
  excluyentes) ordenado por `createdAt` **y** `id` como desempate — con un
  solo campo de orden, dos mensajes creados en el mismo milisegundo hacían
  que el cursor salteara filas; se detectó en la verificación de esta ronda
  probando una ráfaga rápida de mensajes.
- El envío de mensajes tiene rate limit por usuario autenticado (no por IP,
  a diferencia del login: varias personas de la misma oficina comparten
  salida a internet) — 30 mensajes por minuto, devuelve `429` al superarlo.
