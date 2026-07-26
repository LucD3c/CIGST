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
  desplegables, mínimo texto para tipear, y un catálogo de **Sectores**
  reutilizable (se puede crear un sector nuevo al vuelo desde el propio
  desplegable). Soporte puede cerrar/resolver un ticket con un clic desde la
  lista, sin entrar al detalle. El Panel administrador permite editar y
  eliminar usuarios de verdad.
- **Chat / grupos entre usuarios:** planificado para una etapa posterior.

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
| `mgonzalez` | `empleado123` | Empleado (dato de referencia, ver abajo) |

El primer arranque crea un único caso de referencia (una colaboradora, un
equipo asignado y un ticket) para poder probar el circuito completo sin
cargar datos a mano.

| Rol | Acceso |
| --- | --- |
| Administrador | Todos los módulos, incluido el panel de usuarios. |
| Técnico | Tickets, personas, equipamiento y bitácora. |
| Empleado | Solo sus propias solicitudes y la creación de un nuevo ticket. |

## Qué quedó probado en esta etapa

Levantando la plataforma desde cero (`docker compose down -v && docker compose
up -d`) se verificó tanto por API como **navegando la interfaz real en un
navegador (Chromium)**:

- Pantalla de login sin credenciales precargadas; login válido/inválido con el
  mismo mensaje de error mostrado en la interfaz, cierre de sesión real y
  expiración/renovación de sesión.
- Bloqueo por rate limiting tras intentos de login repetidos.
- La interfaz se adapta al rol logueado: un Administrador ve todos los
  módulos; un Técnico ve soporte pero no el panel de usuarios; un Empleado ve
  únicamente "Mis solicitudes", sin la barra de navegación de soporte, y solo
  sus propios tickets. Los intentos por fuera de lo que la interfaz permite
  igual son rechazados por el backend (`403`), no solo ocultados visualmente.
- Alta, gestión (estado/prioridad/técnico asignado) y consulta de tickets
  desde el modal existente, con los datos reales de personas/equipos ya
  resueltos (sin ids sueltos, con los códigos legibles de siempre: `TK-001`,
  `EMP-001`, etc.).
- Alta de personas, equipos, eventos de bitácora y usuarios desde los mismos
  formularios existentes, ahora con el catálogo de **Sectores** compartido
  (con alta "al vuelo" desde el propio desplegable, solo para soporte).
- Menú de acciones rápidas (⋮) en la lista de tickets: marcar Resuelto, Cerrar
  o Asignarme sin abrir el detalle completo.
- Panel administrador: edición completa de un usuario (nombre, rol, persona
  vinculada, estado, contraseña) y **eliminación real** (no lógica) con
  confirmación, bloqueada si el usuario intenta borrarse a sí mismo o si
  dejaría la plataforma sin ningún Administrador activo.
- Errores de validación de la API se muestran con el mismo aviso (`toast`) que
  ya usaba la plataforma, sin cerrar el formulario, para poder corregir y
  reintentar.
- Borrado lógico (soft delete) en Personas, Equipos, Tickets, Bitácora y
  Sectores: un registro eliminado deja de listarse pero no se pierde de la
  base. Usuarios es la única excepción deliberada (ver "Seguridad").
- La plataforma carga y funciona correctamente sobre HTTP simple (sin
  certificado), como corresponde a un despliegue típico en red interna.
- El backend sirve `index.html`/`app.js`/`styles.css` directamente (sin
  servidor aparte para el frontend).

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
    modules/     auth, users, employees, equipment, tickets, logbook, sectors
                 (cada uno: routes -> controller -> service -> repository)
    routes/      router principal de /api
  prisma/        schema.prisma, migraciones y seed inicial
  Dockerfile
docker-compose.yml
index.html / app.js / styles.css / fonts/   interfaz existente (sin cambios de diseño)
```

Entidades: Rol, Usuario, Sesión, Persona, Equipo, Ticket, Bitácora técnica y
Sector. Todas con identificador UUID, fechas de auditoría
(`createdAt`/`updatedAt`) y borrado lógico (`deletedAt`), con dos excepciones
deliberadas: Sesión se elimina de verdad al cerrar sesión o expirar (no tiene
sentido conservar un token muerto), y Usuario se elimina de verdad cuando lo
borra un Administrador (ver "Seguridad").

**Sector** es el catálogo compartido de ubicaciones/áreas de la empresa
(`Administración`, `Sistemas`, etc.): Persona, Equipo y Ticket eligen su
sector de esa misma lista, en vez de tipearlo cada vez. Equipo ya no se
vincula a una persona puntual sino a un sector completo — la ficha de una
persona muestra el equipamiento de su propio sector.

La relación central se mantiene: **Persona/Sector → Equipamiento → Tickets →
solución/conocimiento**, con bitácora transversal.

### Notas sobre el API para quien siga trabajando sobre esto

- `GET /api/sectors` está disponible para cualquier rol autenticado (un
  Empleado lo necesita para elegir su sector al pedir soporte); crear/editar
  es de soporte (Admin+Técnico), borrar es solo Admin.
- `GET /api/auth/me` devuelve, además de los datos de sesión, la persona
  vinculada al usuario (su sector y el equipamiento de ese sector) cuando
  corresponde — es lo que usa el portal de un Empleado para no necesitar
  acceso a `/api/employees` (que es exclusivo de soporte).
- `GET /api/users/technicians` expone una lista acotada (id + nombre) de
  usuarios con rol Administrador/Técnico activos, para el selector de "técnico
  asignado" en la gestión de tickets. A diferencia de `GET /api/users`
  (exclusivo de Administrador), este está disponible para cualquier rol de
  soporte.
