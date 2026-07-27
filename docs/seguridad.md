# Seguridad

## Autenticación y sesiones

- Contraseñas con hash **bcrypt** (12 rondas), nunca en texto plano.
- Sesiones server-side: el navegador guarda solo un token opaco aleatorio en
  una cookie `httpOnly` + `SameSite=Strict`; la base guarda únicamente el
  **hash SHA-256** de ese token. Robar la base no permite fabricar sesiones.
- Expiración deslizante (por defecto 12 h, configurable con
  `SESSION_TTL_HOURS`). Cerrar sesión elimina la sesión de verdad.
- Rate limiting en el login (10 intentos por IP cada 5 minutos).

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
- PostgreSQL **no expone ningún puerto** fuera de la red interna de
  contenedores. El único puerto publicado es el de la app (`APP_PORT`).

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

## Pendiente para un despliegue más exigente

- HTTPS vía proxy reverso interno (si se necesita cifrado dentro de la red).
- Cambio de contraseña desde la propia interfaz por el usuario final (hoy lo
  hace un Administrador desde el panel).
- Auditoría inmutable de cambios.
