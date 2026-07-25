# CIGST (CEMEVE) — Centro Integral de Gestión de Soporte Técnico

Plataforma interna de tickets y gestión de soporte técnico, pensada para correr
100% dentro de la red de la empresa: sin APIs externas, sin CDNs, sin salida a
internet en tiempo de ejecución.

## Estado del proyecto

- **Backend real (esta etapa):** Node.js + TypeScript, PostgreSQL, autenticación
  por sesión server-side, permisos por rol, CRUD completo de usuarios, personas,
  equipos, tickets y bitácora técnica. Corre en Docker y ya fue probado de punta
  a punta (ver "Qué quedó probado" más abajo).
- **Interfaz visual (`index.html` / `app.js` / `styles.css`):** es la que ya
  existía; el diseño no se tocó. Por ahora esa interfaz sigue usando su lógica
  local original (`localStorage`) para no romper nada visualmente. Conectarla
  al backend real (login, tickets, etc. contra la API) es la **próxima etapa**.
  El backend queda sirviendo esos mismos archivos estáticos, así que hoy ya se
  puede abrir la plataforma desde el navegador apuntando al servidor Docker.
- **Chat / grupos entre usuarios:** planificado para una etapa posterior, una
  vez conectada la interfaz al backend.

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
up -d`) se verificó, contra el backend real:

- Login válido/inválido, cierre de sesión y expiración de sesión.
- Bloqueo por rate limiting tras intentos de login repetidos.
- Un Administrador puede gestionar usuarios, personas y equipos; un Empleado
  recibe `403` al intentarlo.
- Un Empleado solo ve y crea sus propios tickets; no puede ver ni crear a
  nombre de otra persona.
- Alta, gestión (estado/prioridad/técnico asignado) y consulta de tickets.
- Alta de eventos de bitácora vinculados a un ticket y a un equipo.
- Borrado (soft delete): un registro eliminado deja de listarse pero no se
  pierde de la base.
- Validación de datos inválidos en el cuerpo de las solicitudes (respuesta
  `400` con el detalle del campo).
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
    modules/     auth, users, employees, equipment, tickets, logbook
                 (cada uno: routes -> controller -> service -> repository)
    routes/      router principal de /api
  prisma/        schema.prisma, migraciones y seed inicial
  Dockerfile
docker-compose.yml
index.html / app.js / styles.css / fonts/   interfaz existente (sin cambios de diseño)
```

Entidades: Rol, Usuario, Sesión, Persona, Equipo, Ticket y Bitácora técnica.
Todas con identificador UUID, fechas de auditoría (`createdAt`/`updatedAt`) y
borrado lógico (`deletedAt`) — excepto Sesión, que se elimina de verdad al
cerrar sesión o expirar, porque no tiene sentido conservar un token muerto.

La relación central se mantiene: **Persona → Equipamiento asignado → Tickets →
solución/conocimiento**, con bitácora transversal.
