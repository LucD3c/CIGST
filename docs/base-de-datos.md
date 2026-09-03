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
| Post | `posts` | Publicación del feed de novedades |
| PostBlock | `post_blocks` | Bloque de contenido de una publicación |
| PostSector | `post_sectors` | Sectores a los que va dirigida una publicación |
| PostComment | `post_comments` | Comentario de una publicación |
| PostReaction | `post_reactions` | Reacción a una publicación |
| PostView | `post_views` | Acuse de "visto" de una publicación |
| KbSpace | `kb_spaces` | Base de conocimiento (un área) |
| KbSection | `kb_sections` | Sección dentro de una base |
| KbArticle | `kb_articles` | Artículo, con su texto buscable |
| KbBlock | `kb_blocks` | Bloque de contenido de un artículo |
| KbPermission | `kb_permissions` | Quién ve y quién edita cada base |
| MailProvider | `mail_providers` | Servidor de correo configurado (solo Admin) |
| MailAccount | `mail_accounts` | Casilla, con su contraseña cifrada |
| MailAccess | `mail_access` | Quién puede usar una casilla compartida |
| **Counter** | `counters` | Contador atómico de los códigos correlativos |
| **LoginAttempt** | `login_attempts` | Intentos de inicio de sesión fallidos |

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

## Dos tablas que no son de negocio

Estas dos no representan nada del dominio: son mecanismos internos que resuelven
problemas concretos que se detectaron en producción.

### `counters` — los códigos correlativos

Una fila por prefijo (`TK`, `EMP`, `EQ`, `BIT`) con el último número emitido.

Antes los códigos se generaban con `count() + 1`, y eso tenía una condición de
carrera real: dos altas simultáneas leían el mismo total, armaban el mismo
código y la segunda moría contra el índice único devolviendo un error genérico
— la persona perdía lo que había escrito.

Ahora el número lo entrega Postgres en una sola sentencia:

```sql
INSERT INTO counters (prefix, value) VALUES ($1, 1)
ON CONFLICT (prefix) DO UPDATE SET value = counters.value + 1
RETURNING value;
```

Eso es atómico por definición: dos pedidos en paralelo reciben números
distintos siempre. Además se comprueba que el código no esté ocupado antes de
usarlo, lo que permite convivir con los **códigos de equipo escritos a mano**
(si alguien cargó `EQ-015` manualmente, el contador salta a 016 y sigue).

La migración que crea la tabla la siembra con el valor más alto entre la
cantidad de filas existentes y el número más alto que aparece en los códigos ya
emitidos, así la numeración continúa donde estaba.

### `login_attempts` — el freno de fuerza bruta

Una fila por intento fallido, con usuario, dirección de red y momento.

Vive en la base y no en memoria por un motivo concreto: el limitador anterior
era del proceso, así que **alcanzaba con reiniciar el contenedor** para que el
contador volviera a cero. Ahora el bloqueo sobrevive a reinicios,
actualizaciones y caídas.

Dos ventanas, ambas de 15 minutos:

| Límite | Cuánto | Por qué ese número |
| --- | --- | --- |
| Por cuenta | 8 fallos | Ocho errores seguidos ya no es alguien que se equivocó de tecla |
| Por dirección de red | 30 fallos | Más alto a propósito: una oficina entera sale por la misma IP y no se puede castigar a todos por uno |

Un ingreso correcto borra los fallos de esa cuenta. Las filas viejas las limpia
la rutina de retención.

## Orden alfabético: resuelto en la base

Las columnas de texto que se ordenan llevan la **colación española**
(`es-x-icu`), aplicada por migración:

```sql
ALTER TABLE employees ALTER COLUMN name TYPE TEXT COLLATE "es-x-icu";
```

Alcanza a `employees.name`, `equipment.model` y `.type`, `sectors.name`,
`tickets.title`, `users.name`, `schedules.name`, `logbook_entries.title`,
`kb_spaces.name` y `kb_articles.title`.

La diferencia, medida sobre los mismos datos:

```
sin colación:  Nunez | Ortiz | Zapata | alvarez | Álvarez | Ñandú
con colación:  alvarez | Álvarez | Nunez | Ñandú | Ortiz | Zapata
```

Antes esto se corregía reordenando en Node después de traer la tabla entera.
Ese truco **deja de servir en cuanto los listados se paginan**: no se puede
ordenar bien un universo del que solo se trajo una página. Por eso el orden se
mudó a donde corresponde.

Se usa el español genérico (`es-x-icu`) y no el de un país puntual, para que la
plataforma sirva igual en cualquier empresa de habla hispana.

## Búsqueda dentro de los artículos

`kb_articles.search_text` guarda el texto plano del artículo, con un índice GIN
de trigramas (`pg_trgm`) que permite buscar "contiene" sin recorrer la tabla.

Lo escribe el backend en cada guardado usando `plainTextOf()`, **la misma
función que excluye los campos marcados como ocultos**. Eso no es un detalle:
en las bases de conocimiento se guardan credenciales compartidas en campos
ocultos, y si el texto buscable las incluyera, cualquiera con acceso a la base
podría encontrar un artículo buscando una contraseña.

Antes la búsqueda traía hasta 500 artículos a memoria y los filtraba ahí:
pasados los 500, los que quedaban afuera **no aparecían nunca** en ninguna
búsqueda, y nadie se enteraba porque no había ningún aviso.

## Índices para paginar

Los listados devuelven de a una página, y para que eso no obligue a recorrer la
tabla entera cada vez, hay un índice compuesto por lista:

| Tabla | Índice |
| --- | --- |
| `tickets` | `(deleted_at, created_at)` |
| `employees` | `(deleted_at, name)` |
| `equipment` | `(deleted_at, model)` |
| `logbook_entries` | `(deleted_at, occurred_at)` |
| `kb_articles` | `(deleted_at, updated_at)` |

El `deleted_at` va primero porque **toda** consulta de listado filtra por él
(el borrado es lógico), así el índice sirve para el filtro y para el orden en
una sola pasada.

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
