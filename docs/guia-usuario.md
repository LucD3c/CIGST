# CIGST — Manual de uso

*Cómo se usa la plataforma en el día a día, sin tecnicismos. La versión
completa con capturas está en [PDF](Manual-de-uso-CIGST.pdf) para imprimir o
compartir. Si todavía no la instalaste, ver antes
[Cómo descargar](Como-descargar-CIGST.pdf) y [Cómo instalar](Como-instalar-CIGST.pdf).*

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
| **User** | Crea tickets para sí mismo o para cualquier persona (con adjuntos), ve solo sus propias solicitudes, y usa el chat (1 a 1 y los grupos donde lo agregaron). Nada más. |

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
si corresponde el **equipo o espacio** — al elegirlo, el **sector se
completa solo**. La **categoría** cambia según el sector elegido: cada área
tiene las suyas. La fecha y hora se registran solas.

También podés **adjuntar archivos** (imágenes, PDF o planillas): hasta 5 por
ticket, de 10 MB cada uno. Es la forma más rápida de mostrar el problema —
una captura de pantalla vale más que tres párrafos de descripción.

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

## Equipos y espacios

No es solo inventario informático: acá va **cualquier cosa sobre la que se
pueda pedir ayuda**. Una PC o una impresora, sí — pero también un
**consultorio**, una **sala**, una **oficina**, una **puerta** o una
**instalación**. Por eso el tipo incluye tanto equipos como espacios, y el
nombre puede ser un modelo ("Dell OptiPlex") o una identificación de lugar
("Consultorio 213").

La idea **no** es cargar cada objeto de la empresa: solo lo que
efectivamente recibe pedidos. Si el pedido es "arreglar la puerta del
consultorio 213", alcanza con tener cargado ese consultorio y describir el
arreglo en la descripción del ticket.

Cada uno vive en un sector. **Editar es del Administrador**: cada cambio de
nombre, sector o estado queda registrado automáticamente en el panel
**Cambios**, con el valor anterior y el nuevo. No conviene crear uno nuevo
al reemplazar un equipo: se edita el existente y el historial guarda lo que
había antes.

---

## Sectores, turnos y categorías

![Sectores](img/sectores.png)

Las áreas de la empresa. El detalle de un sector muestra:

- Sus **personas** y sus **equipos y espacios** (clickeables, útil cuando
  dos se llaman igual en sectores distintos).
- Sus **categorías de ticket**: las que van a aparecer al crear un ticket
  dirigido a ese sector. Un Administrador las agrega y elimina desde ahí
  mismo. Ejemplo: Sistemas puede tener "Hardware", "Red / conectividad";
  Mantenimiento, "Arreglar", "Modificación"; y cada área las suyas.

Al eliminar una categoría, los tickets que ya la usaron **no se modifican**
— simplemente deja de ofrecerse para tickets nuevos.

En la misma pantalla se definen los turnos de soporte. Todo esto lo
administra el Administrador; el Supervisor lo ve.

---

## Mensajes: chat 1 a 1 y grupos

![Chat](img/chat.png)

Chateá con cualquier persona de la plataforma. Los **grupos aparecen siempre
primeros** en la lista, con su etiqueta. Enter envía, Shift+Enter baja de
línea, y el badge azul avisa los mensajes sin leer.

El botón 📎 permite **adjuntar archivos** (imágenes, PDF, planillas). Las
imágenes se ven directamente en la conversación; el resto aparece como una
tarjeta para descargar. Se puede mandar un archivo sin escribir nada.

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
