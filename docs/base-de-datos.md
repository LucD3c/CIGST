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
| Equipment | `equipment` | Equipo o **espacio**, ubicado en un sector |
| Ticket | `tickets` | Solicitud de soporte |
| LogbookEntry | `logbook_entries` | Evento de la bitácora técnica |
| Conversation | `chat_conversations` | Par de usuarios que chatean (par canónico único) |
| ChatGroup | `chat_groups` | Grupo de chat con varios integrantes |
| ChatGroupMember | `chat_group_members` | Integrante de un grupo (+ su última lectura) |
| Message | `chat_messages` | Mensaje del chat (readAt lo marca el receptor) |
| Notification | `notifications` | Aviso dirigido a un usuario |

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

## Los dos sectores de un ticket (no confundirlos)

`Ticket.sectorId` es el **sector a requerir**: a qué área se le pide la
ayuda. Es un dato propio del pedido y **no se hereda** del sector de la
persona (`Employee.sectorId`, dónde trabaja) ni del equipo
(`Equipment.sectorId`, dónde está ubicado). Los tres son independientes a
propósito: alguien de Administración puede pedirle a Mantenimiento por una
PC que está en Depósito.

Antes el sector se completaba solo a partir del equipo, y eso hacía que el
formulario exigiera una categoría de un sector que el usuario nunca había
elegido.

## Horario laboral y disponibilidad

`Employee.workStartTime` / `workEndTime` guardan `HH:MM` como texto (no
`Date`): es una franja que se repite todos los días, no un instante. El
estado (`en-linea` / `fuera-de-horario` / `sin-horario`) **no se persiste**
— se calcula en cada lectura en `utils/workingHours.ts` usando la hora del
servidor en la zona `TZ`, así todos ven lo mismo sin depender del reloj de
cada equipo. Si el fin es menor que el inicio, el turno cruza la medianoche
y se evalúa como dos tramos.

## Orden alfabético

El `ORDER BY` de Postgres compara por código de carácter: `ZZ` antes que
`Zulema`, y `álvarez` después de `Zulema`. Para las listas que ve una
persona, los servicios reordenan con `utils/sortByName.ts`
(`Intl.Collator('es', { sensitivity: 'base', numeric: true })`), que ignora
mayúsculas y acentos y compara los números por valor. El frontend usa el
mismo criterio al ordenar por columna.

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
