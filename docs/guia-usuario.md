# CIGST — Manual de uso

*Cómo se usa la plataforma en el día a día, sin tecnicismos. La versión
completa con capturas está en [PDF](Manual-de-uso-CIGST.pdf) para imprimir o
compartir.*

---

## ¿Qué es CIGST?

CIGST es la plataforma interna de soporte técnico de la empresa: tickets,
personas, equipos, sectores, chat interno con grupos y notificaciones — todo
en un solo lugar. **Funciona solo dentro de la red de la empresa**: nada de
lo que se carga sale a internet.

---

## Cómo se instala (una sola vez, en un solo equipo)

1. Descargar la carpeta del proyecto.
2. **Windows**: doble click en `install.bat` — **Linux/Mac**: `./install.sh`
3. Elegir la opción **1** del menú y responder las preguntas (o Enter para
   valores seguros por defecto).

Al terminar, el instalador muestra la dirección para entrar (por ejemplo
`http://servidor:3000`). El resto del personal solo necesita esa dirección y
su navegador: no instala nada.

---

## Entrar a la plataforma

![Pantalla de ingreso](img/login.png)

Abrí el navegador, escribí la dirección que te pasó Sistemas, y entrá con tu
usuario y contraseña. ¿La olvidaste? Un Administrador te asigna una nueva
desde el Panel administrador.

---

## Los tres rangos y sus permisos

| Rango | Qué puede hacer |
| --- | --- |
| **Administrador** | Todo: crea y edita personas, usuarios, equipos, sectores y turnos (cada edición deja registro de cambios), gestiona tickets, usa el chat, crea los grupos, y es el único que ve Bitácora técnica y Panel administrador. |
| **Supervisor** | Ve todo el trabajo de soporte y lo opera: crea y gestiona tickets de cualquiera. Ve personas, equipos y sectores con sus historiales, pero **no puede crear ni editar** esos catálogos. No ve Bitácora ni Panel administrador. |
| **User** | Crea tickets para sí mismo o para cualquier persona, ve solo sus propias solicitudes, y usa el chat (1 a 1 y los grupos donde lo agregaron). Nada más. |

Los permisos se controlan en el servidor: lo que tu rango no permite, la
plataforma lo rechaza aunque se intente por otra vía.

---

## El Centro de operaciones

![Centro de operaciones](img/centro-de-operaciones.png)

La pantalla principal del equipo de soporte: tickets abiertos, urgentes, en
proceso y la actividad reciente. En **Actividad reciente**, el nombre de la
persona y el código del ticket son clickeables y llevan directo a la ficha o
al ticket.

---

## Notificaciones (la campanita)

![Notificaciones](img/notificaciones.png)

Arriba a la izquierda, al lado del logo, está la campanita 🔔 con el número
de notificaciones sin leer. Tocando una notificación vas directo a lo que te
avisa (el ticket, el grupo…) y queda marcada como leída. Llegan avisos por:
ticket nuevo (al equipo de soporte), cambio de estado de tu ticket, ticket
asignado a vos, y alta en un grupo de chat.

---

## Tickets

**Crear** (cualquier rango): + Nuevo ticket / + Solicitar soporte → elegí a
la **persona a asistir** (vos u otra persona), título breve, descripción, y
si corresponde el **equipo** — al elegirlo, el **sector se completa solo**
con el sector actual de ese equipo. La fecha y hora se registran solas.

![Nuevo ticket](img/ticket-nuevo.png)

**Seguir y resolver** (Administrador y Supervisor): el detalle permite
cambiar estado, asignar responsable y anotar la solución; el menú ⋮ de cada
fila resuelve/cierra/asigna sin abrir nada. El ticket siempre muestra los
datos **actuales** del equipo involucrado, aunque haya cambiado después.

---

## Personas

![Ficha de persona](img/ficha-persona.png)

La ficha de cada colaborador: sector, contacto, horario, tickets y el
equipamiento de su sector (clickeable). **Crear y editar es del
Administrador**; cada edición deja una línea automática en el panel
**Cambios** de la ficha ("de X a Y", con fecha y hora).

---

## Equipamiento y su historial de cambios

Cada equipo vive en un sector. **Editar es del Administrador**: cada cambio
de modelo, sector o estado queda registrado automáticamente en el panel
**Cambios** del equipo, con el valor anterior y el nuevo. Ese historial
permite ver, por ejemplo, si un sector tiene demasiada rotación de equipos.
No conviene crear un equipo nuevo al reemplazar uno: se edita el existente y
el historial guarda lo que había antes.

---

## Sectores y turnos

![Sectores](img/sectores.png)

Las áreas de la empresa. El detalle de un sector muestra sus personas y
equipos — ambos clickeables, útil cuando dos equipos se llaman igual en
sectores distintos. En la misma pantalla se definen los turnos de soporte.
Crear y editar es del Administrador.

---

## Mensajes: chat 1 a 1 y grupos

![Chat](img/chat.png)

Chateá con cualquier persona de la plataforma. Los **grupos aparecen siempre
primeros** en la lista, con su etiqueta. Enter envía, Shift+Enter baja de
línea, y el badge azul avisa los mensajes sin leer.

- **Grupos**: los crea el Administrador (+ Nuevo grupo), elige integrantes de
  cualquier rango (cada uno recibe una notificación), y puede editarlos o
  eliminarlos. Todos los integrantes leen y escriben; cada mensaje muestra
  quién lo mandó.
- **Privacidad**: una conversación la ven solo sus participantes y un grupo
  solo sus integrantes. Nadie más — ni siquiera un Administrador que no sea
  parte.

---

## Panel administrador (solo Administradores)

![Panel administrador](img/panel-administrador.png)

Cuentas de usuario: crear, cambiar rango o contraseña, desactivar o eliminar.
Cada modificación deja su línea en el historial **"Cambios de esta cuenta"**.
La plataforma no permite quedarse sin ningún Administrador activo.

---

## Preguntas frecuentes

**No veo alguna sección de este manual.** Es normal: cada rango ve solo lo
suyo. Si creés que te falta acceso, hablá con un Administrador.

**¿Cómo sé si mi pedido avanzó?** Te llega una notificación cada vez que tu
ticket cambia de estado, y lo ves en "Mis solicitudes".

**¿Se pierde algo si se apaga el servidor?** No: los datos quedan guardados.

**¿Quién puede leer mis chats?** Solo los participantes.

**¿La información sale a internet?** No, nunca.
