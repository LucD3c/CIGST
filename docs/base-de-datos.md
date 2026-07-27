# Modelo de datos

> Documento para desarrolladores. El esquema fuente está en
> [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma); esto
> es el mapa conceptual.

## Entidades

| Entidad | Tabla | Qué representa |
| --- | --- | --- |
| Role | `roles` | Los 3 rangos: Administrador, Supervisor, User |
| User | `users` | Cuenta que puede iniciar sesión |
| Session | `sessions` | Sesión activa (solo el hash del token, nunca el token) |
| Sector | `sectors` | Área/ubicación de la empresa (catálogo compartido) |
| TicketCategory | `ticket_categories` | Categorías de ticket **propias de cada sector** |
| Attachment | `attachments` | Archivo adjunto de un ticket o de un mensaje |
| Schedule | `schedules` | Turno de soporte (nombre + hora inicio/fin) |
| Employee | `employees` | Persona de la empresa (puede no tener cuenta) |
| Equipment | `equipment` | Equipo informático, vinculado a un sector |
| Ticket | `tickets` | Solicitud de soporte |
| LogbookEntry | `logbook_entries` | Evento de la bitácora técnica |
| Conversation | `chat_conversations` | Par de usuarios que chatean (par canónico único) |
| Message | `chat_messages` | Mensaje del chat (readAt lo marca el receptor) |

## Convenciones

- **Identificadores**: UUID en todas las tablas.
- **Auditoría**: `createdAt` / `updatedAt` en todas las entidades de negocio.
- **Borrado lógico** (`deletedAt`): Sector, Turno, Persona, Equipo, Ticket y
  Bitácora. Un registro eliminado deja de listarse pero no se pierde.
- **Índices**: toda clave foránea tiene su índice; los mensajes del chat
  tienen índice compuesto `(conversation_id, created_at)` para la paginación.

### Excepciones deliberadas al borrado lógico

- **Session**: se elimina de verdad al cerrar sesión o expirar — no tiene
  sentido conservar credenciales muertas.
- **User**: se elimina físicamente cuando lo borra un Administrador (pedido
  explícito del negocio). Sus referencias opcionales (tickets creados o
  asignados, bitácora) quedan en `NULL` vía `SetNull`; sus sesiones y sus
  conversaciones de chat (con los mensajes adentro) se borran en cascada.
- **Conversation / Message**: sin `deletedAt` — el alcance actual no incluye
  borrar ni editar mensajes, así que el campo no tendría uso.
- **TicketCategory**: se elimina de verdad. El Ticket guarda el **nombre**
  de la categoría como texto (una foto del momento), no una FK — así borrar
  una categoría deja de ofrecerla en el formulario sin alterar el historial
  de tickets que ya la usaron.
- **Attachment**: se elimina de verdad junto con su archivo físico. Los que
  quedan "sueltos" (subidos pero nunca enviados) los borra una rutina
  automática pasadas 24 h.

## Categorías de ticket por sector

`TicketCategory` tiene `@@unique([sectorId, name])`: dos sectores pueden
tener una categoría con el mismo nombre sin pisarse. Al crear un ticket, el
backend valida que la categoría pertenezca al sector elegido; si ese sector
todavía no tiene ninguna cargada (o el ticket no lleva sector), se acepta
`General` — nunca se bloquea a alguien que necesita pedir ayuda porque falta
configurar el catálogo.

## Adjuntos

Un `Attachment` pertenece a un ticket **o** a un mensaje (`ticketId` XOR
`messageId`); recién subido tiene ambos en `NULL` hasta que el ticket o
mensaje que lo referencia se crea. El archivo físico vive en el volumen
`cigst_uploads` con un nombre aleatorio (`storedName`) generado por el
servidor: el nombre original del usuario nunca llega al sistema de archivos.

## Relación central

```
Persona ──┐
          ├── Sector ── Equipamiento
Ticket ───┘      │
   │             └── (la ficha de una persona muestra el equipamiento
   │                  de su propio sector)
   └── Turno de soporte (Schedule)
```

Un Ticket referencia: persona a asistir, quién lo solicitó, equipo
(opcional), sector, turno de soporte, responsable asignado (User de rol
Admin/Supervisor) y quién lo creó. La hora de creación queda registrada
automáticamente (`createdAt`) y se muestra en el detalle — no se tipea.

## Migraciones

- Viven en `backend/prisma/migrations/` y se aplican solas en cada arranque
  (servicio `migrate` de compose, con `prisma migrate deploy`).
- El seed (`backend/prisma/seed.ts`) es idempotente: crea los 3 roles, el
  admin inicial (credenciales desde `.env`, solo la primera vez), 2
  sectores y 2 turnos de referencia, y un caso de ejemplo completo
  (persona + equipo + ticket + conversación de chat) para poder probar el
  circuito sin cargar datos a mano.
- Renombres de datos (ej. `Técnico→Supervisor`) se hacen con migraciones de
  datos (`UPDATE ...`) que preservan los `id`, así los vínculos existentes
  no se rompen.

### Cómo generar una migración nueva sin instalar nada local

```bash
# Postgres descartable para que prisma migrate dev compare esquemas:
docker run -d --name tmp_db --network cigst_tmp_net \
  -e POSTGRES_USER=cigst -e POSTGRES_PASSWORD=cigst -e POSTGRES_DB=cigst \
  postgres:16.14-alpine

docker run --rm --network cigst_tmp_net \
  -v "$PWD/backend:/work" -w /work \
  -e DATABASE_URL="postgresql://cigst:cigst@tmp_db:5432/cigst" \
  node:20.20.2-alpine sh -c "apk add --no-cache openssl && npm install && npx prisma migrate dev --name mi_cambio --skip-seed"

docker rm -f tmp_db
```

(El `apk add openssl` es obligatorio: el engine de Prisma lo necesita y
Alpine no lo trae por defecto.)
