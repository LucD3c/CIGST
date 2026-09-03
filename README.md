<div align="center">

# CIGST
### Centro Integral de Gestión de Soporte Técnico

**Correo · Feed de novedades · Bases de conocimiento · Tickets · Chat en tiempo real**

Todo en un solo lugar, corriendo **100% dentro de la red de la empresa** —
sin depender de internet ni de ningún servicio externo, en ningún momento.

[![Docker Compose](https://img.shields.io/badge/Docker%20Compose-listo-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20.20.2-339933?logo=node.js&logoColor=white)](backend/Dockerfile)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16.14-4169E1?logo=postgresql&logoColor=white)](docker-compose.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](backend/tsconfig.json)
[![npm audit](https://img.shields.io/badge/npm%20audit-0%20vulnerabilidades-brightgreen)](docs/seguridad.md)
[![Auditoría](https://img.shields.io/badge/auditoría%20de%20seguridad-108%2F108-brightgreen)](docs/auditoria-seguridad.md)
[![Sin llamadas externas](https://img.shields.io/badge/tráfico-solo%20red%20interna-informational)](docs/seguridad.md)
[![Uso](https://img.shields.io/badge/uso-interno%20%2F%20privado-lightgrey)](#)

</div>

<br>

<p align="center">
  <img src="docs/img/centro-de-operaciones.png" alt="Centro de operaciones de CIGST" width="850">
</p>

<br>

## ¿Qué es CIGST?

CIGST es la plataforma interna de pedidos de la empresa: reemplaza la
planilla, el grupo de chat externo y las hojas sueltas por un único sistema
donde cualquier persona pide ayuda, el área correspondiente la resuelve, y
todo queda registrado — quién pidió qué, quién lo atendió, sobre qué equipo
o espacio, y cuándo.

No es solo para Sistemas: **cada sector que recibe pedidos define sus
propias categorías**. Sistemas puede tener "Hardware" y "Red";
Mantenimiento, "Arreglar" y "Modificación"; y así con cada área. El
formulario de ticket se adapta solo al sector elegido.

Se instala con un solo comando, en una sola máquina de la red interna, y el
resto de la empresa accede desde el navegador de siempre.

**Nada de lo que se carga sale a internet**, con una sola excepción que se
elige a propósito: si se configura el **Correo**, el servidor se conecta al
proveedor de correo de la empresa para traer y enviar los mensajes. Son
conexiones **salientes** —como las de Outlook—, no se abre ningún puerto y
nadie desde internet puede entrar. Sin configurar correo, no sale un byte. El
detalle completo está en [Seguridad](docs/seguridad.md).

## Por qué existe

| Sin CIGST | Con CIGST |
| --- | --- |
| Pedidos de soporte por chat/mail, se pierden entre mensajes | Un ticket por pedido, con estado, prioridad e historial |
| Cada área improvisa cómo clasificar sus pedidos | Cada sector define sus propias categorías de ticket |
| Las capturas del problema van por otro canal | Imágenes, PDF y planillas adjuntos al ticket o al chat |
| Nadie sabe qué equipo o espacio tiene cada sector | Inventario por sector, con historial automático de cada edición |
| El acceso a la info depende de quién pregunte primero | Permisos por rol, los mismos para todos, validados en el servidor |
| Coordinación por WhatsApp/email externo | Chat interno (1 a 1 y grupos) sin salir de la red de la empresa |
| Hay que recargar para ver si hubo novedades | Los mensajes y los cambios de estado llegan solos, al instante |
| Nadie se entera de un cambio salvo que lo busque | Notificaciones dentro de la plataforma, con un click al destino |
| "¿Ese ya se fue?" — hay que preguntar quién está | Horario laboral por persona: en línea / fuera de horario, calculado solo |
| Listas larguísimas donde los cerrados tapan lo urgente | Columnas ordenables y filtro que oculta los cerrados por defecto |
| Los avisos de la empresa se pierden en un grupo de WhatsApp | Feed de novedades, con la grilla del sábado como tabla y no como captura |
| Las claves de las obras sociales, en un Excel que circula por mail | Bases de conocimiento por área, con permisos y datos sensibles tapados |
| Dos pestañas abiertas: el correo propio y el del sector | Las dos casillas en la misma pantalla, sin salir de la plataforma |
| Una foto del celular ocupa 5 MB en el servidor | Las imágenes se achican solas antes de subir: **11 veces menos disco** |

## Funciones principales

- 📬 **Correo** — las casillas que la empresa **ya tiene**, dentro de la
  plataforma: leer, responder, enviar y eliminar sin abrir otra pestaña. Cada
  persona agrega su casilla y las compartidas del sector (recepción, turnos).
  Sirve con **cualquier proveedor** — Gmail, Microsoft 365, un hosting con
  cPanel/Roundcube o un servidor propio — y **se configura desde la pantalla**,
  sin tocar archivos ni código. No es un servidor de correo: solo hace
  conexiones salientes, como Outlook. No abre ningún puerto.
- 📰 **Feed de novedades** — el tablero de la empresa: avisos, novedades y la
  grilla de puestos del sábado. Publican Administradores y Supervisores; lo lee
  todo el personal. Se puede **pegar una tabla desde Excel** y queda como tabla
  de verdad (se busca, se lee en el celular, no es una captura de pantalla). Con
  comentarios, "me gusta", publicaciones fijadas y quiénes la leyeron.
- 📚 **Bases de conocimiento** — cada área arma la suya (Facturación, Sistemas,
  RR.HH.) con secciones y artículos: instructivos, accesos y procedimientos.
  Quien la crea decide **quién la lee y quién la edita**, por sector, por rango
  o por persona. Los datos sensibles (usuarios y claves compartidas) se muestran
  **tapados** hasta que alguien los revela con un clic.
- 🎫 **Tickets** — alta en segundos (todo por listas desplegables), estado,
  prioridad, responsable asignado y solución aplicada. Menú de acciones
  rápidas para resolver/cerrar/asignarse sin abrir el detalle.
- 🏷️ **Categorías por sector** — cada área que recibe pedidos define las
  suyas ("Hardware" o "Red" para Sistemas; "Arreglar" o "Modificación" para
  Mantenimiento). Al elegir el **sector a requerir** en un ticket — a qué
  área se le pide la ayuda, que no es dónde está el equipo — la lista de
  categorías se ajusta sola a ese sector.
- 🔎 **Listas ordenables, filtrables y paginadas** — clic en cualquier columna
  para ordenar (y otro para invertir), buscador que filtra al escribir, y el
  filtro de tickets que **oculta los cerrados por defecto**. El orden es el
  que uno espera en castellano: ignora mayúsculas, ubica bien los acentos y
  la ñ, y compara los números por valor (*Consultorio 3* antes que
  *Consultorio 213*) — lo resuelve la base de datos, así que **vale sobre el
  total y no sobre lo que se ve en pantalla**. Las listas largas se paginan de
  a 50: con quince mil tickets acumulados la plataforma sigue abriendo igual de
  rápido que el primer día.
- 📎 **Archivos adjuntos** — imágenes, PDF y planillas en tickets, chat,
  novedades y bases. Las imágenes se ven directamente; el resto se descarga.
  Hasta 5 archivos de 10 MB por vez. En el chat y en los editores se puede
  **pegar una captura con Ctrl+V** (la herramienta de Recortes de Windows deja
  la imagen en el portapapeles y se adjunta sola).
  Las **fotos se comprimen dos veces**: en el navegador antes de subir, y otra
  vez en el servidor para las que lleguen por cualquier otro medio. Una captura
  de pantalla pasa de 350 KB a 85 KB — **cuatro veces menos** — sin que se note
  al mirarla. Los PDF, las planillas y los GIF animados no se tocan.
- 💾 **El disco no se llena solo** — la plataforma controla cuánto ocupan los
  adjuntos y avisa antes de llegar al límite. Si lo alcanza, deja de aceptar
  archivos **nuevos** pero **no se pierde nada de lo guardado**: todo lo
  anterior se sigue abriendo y descargando. Además una rutina automática borra
  cada 6 horas los datos que ya no le sirven a nadie —sesiones vencidas, avisos
  viejos, archivos huérfanos— sin tocar jamás un ticket, un mensaje, un archivo
  en uso ni un artículo, ni siquiera los dados de baja.
- 👤 **Personas** — ficha por colaborador con su sector, contacto y tickets.
  Se le carga el **horario laboral** eligiendo entrada y salida de un reloj,
  y la plataforma muestra sola si está **en línea** o **fuera de horario**,
  calculado en el servidor (incluidos los turnos que cruzan la medianoche).
  Cada edición queda en un historial de cambios automático.
- 🏢 **Equipos y espacios** — no solo inventario informático: también
  consultorios, salas, puertas o instalaciones — cualquier cosa sobre la
  que se pida ayuda. El **código puede ser el tuyo**: si la empresa ya tiene
  etiquetas de inventario pegadas en las máquinas (`IMP-RECEP-02`), se carga
  con ese código y no con otro; si se deja vacío, la plataforma pone uno
  correlativo. Editable, con **historial de cambios automático** (qué cambió,
  de qué valor a qué valor, cuándo).
- 🗂️ **Sectores y turnos** — catálogo compartido por Personas, Equipos y
  Tickets; los turnos de soporte se configuran una vez por empresa. Desde el
  detalle de un sector se dan de alta personas ya ubicadas ahí.
- ⚡ **Tiempo real** — los mensajes del chat, los cambios de estado de los
  tickets y las notificaciones **aparecen solos**, sin recargar y sin esperar.
  Va por WebSocket sobre el mismo puerto y la misma cookie de sesión: no abre
  nada nuevo hacia afuera. Si se corta la red o se suspende el equipo,
  reconecta solo.
- 💬 **Chat interno** — mensajería 1 a 1 y grupos (los crea un
  Administrador), 100% tráfico local, con badge de no leídos y adjuntos.
- 🔔 **Notificaciones** — campanita con lo que te corresponde a vos: ticket
  nuevo, cambio de estado, asignación, alta en un grupo. Un click te lleva
  al lugar exacto.
- 🔐 **Permisos por rol** — Administrador, Supervisor y User, cada uno con
  exactamente el acceso que le corresponde (tabla completa en
  [seguridad.md](docs/seguridad.md)).
- 🌐 **"Mi IP"** — un botón en la barra superior que muestra la dirección de
  red de la computadora, para pasársela a sistemas o para que un técnico se
  conecte por VNC. Está **oculto por defecto** y cada persona ve únicamente la
  suya: una dirección interna es información de infraestructura y no tiene por
  qué quedar a la vista mientras alguien comparte pantalla.
- 📱 **Anda en el celular** — la barra lateral se convierte en un menú que se
  abre con el botón ☰. Las tablas **no esconden columnas**: se desplazan de
  costado, así que no se pierde ningún dato por estar mirando desde el teléfono.
- 📋 **Bitácora técnica** — registro de eventos de infraestructura, para
  Administradores.

<details>
<summary><strong>Ver más capturas de pantalla</strong></summary>
<br>

| | |
|---|---|
| ![Tickets](docs/img/tickets.png) | ![Sectores](docs/img/sectores.png) |
| ![Chat](docs/img/chat.png) | ![Panel administrador](docs/img/panel-administrador.png) |

</details>

## Instalación en 3 pasos

1. **Descargar el proyecto** (clonar el repositorio o bajar el ZIP y
   descomprimirlo).
2. **Ejecutar el instalador**:
   - 🪟 **Windows**: doble click en `install.bat`
   - 🐧 **Linux** / 🍎 **Mac**: en una terminal, `./install.sh`
3. **Elegir la opción 1** del menú y responder las preguntas (o apretar
   Enter para usar valores seguros por defecto). Al terminar, el instalador
   muestra la dirección para entrar, por ejemplo: `http://localhost:3000`

El mismo menú sirve después para el día a día:

```
   1) Instalar / iniciar / actualizar la plataforma
   2) Ver estado de los servicios
   3) Ver logs en vivo
   4) Reiniciar servicios
   5) Detener la plataforma
   6) Hacer copia de seguridad (datos + adjuntos)
   7) Restaurar una copia de seguridad
   8) Programar copias automaticas
   9) Liberar espacio (borra solo datos SIN USO)
  10) Resetear todo (BORRA los datos)
  11) Salir
```

> [!NOTE]
> La opción **9) Liberar espacio** elimina *únicamente* datos que ya no le
> sirven a nadie: sesiones vencidas, intentos de login viejos, avisos ya
> leídos y archivos que quedaron en disco sin ninguna referencia. **Nunca
> toca tickets, mensajes, conversaciones, imágenes, PDF, planillas, personas,
> equipos ni artículos** — tampoco los que están dados de baja. El detalle
> completo está en [docs/instaladores.md](docs/instaladores.md).

## Actualizar sin perder datos

> [!IMPORTANT]
> **Actualizar la plataforma NO borra nada.** Los datos viven en volúmenes de
> Docker independientes del código: al actualizar se reemplaza la aplicación,
> no la información. Tickets, personas, equipos, sectores, usuarios, chats,
> notificaciones y archivos adjuntos siguen exactamente donde estaban.

Para actualizar a una versión nueva:

1. **(Recomendado)** Opción **6** del menú → copia de seguridad. Queda en
   `backups/AAAA-MM-DD_HH-MM/` con la base completa, los adjuntos y una
   copia del `.env`. Guardala fuera de esa máquina.
2. Traer el código nuevo: `git pull` (o descargar el ZIP nuevo y reemplazar
   los archivos — **menos** tu `.env`, que es tuyo y nunca viene en el ZIP).
3. Opción **1** del menú. Reconstruye la aplicación, aplica las migraciones
   de base de datos que falten sobre los datos existentes, y la deja andando.

Lo único que borra datos es la opción **8 (Resetear)**, que además exige
escribir `BORRAR` para confirmar.

<details>
<summary><strong>Cómo se verificó esto</strong></summary>
<br>

Se instaló una versión anterior, se cargaron datos como los de una empresa
(5 sectores, 4 personas, 3 equipos, 5 tickets, 3 usuarios, bitácora y
mensajes de chat), y se actualizó a la versión actual con la opción 1. Tras
la actualización: **los mismos 5 sectores, 4 personas, 3 equipos, 5 tickets,
3 usuarios, bitácora y mensajes**, con las tablas nuevas creadas y vacías,
listas para usar.

También se probó el ciclo completo de respaldo: copia → borrado total de la
plataforma → restauración → los datos volvieron completos y la plataforma
siguió funcionando.

</details>

> **¿Qué hace exactamente el instalador, y por qué hace falta uno?**
> Respuesta completa, paso a paso, en [docs/instaladores.md](docs/instaladores.md).

## Requisitos

> [!IMPORTANT]
> Lo **único** que hay que instalar a mano, en cualquier sistema operativo,
> es **Docker** — es la única pieza que este proyecto no puede automatizar
> de forma segura (instalarla requiere permisos de administrador y,
> normalmente, un reinicio del equipo). Todo lo demás lo hace el instalador.

| Sistema | Qué instalar | Notas |
| --- | --- | --- |
| 🪟 Windows 10/11 (64 bits) | [Docker Desktop](https://www.docker.com/products/docker-desktop) | Requiere WSL2 y virtualización activa en la BIOS/UEFI (el instalador de Docker guía ambos pasos). |
| 🍎 macOS | [Docker Desktop](https://www.docker.com/products/docker-desktop) | — |
| 🐧 Linux | Docker Engine | El instalador de CIGST puede instalarlo por vos (con tu confirmación explícita), o hacerlo a mano con la [guía oficial](https://docs.docker.com/engine/install/). |

**No hace falta instalar Node.js, PostgreSQL, ni ninguna otra dependencia.**
Todo el software de la plataforma corre encapsulado dentro de contenedores
Docker — nada se instala en el sistema operativo más allá de Docker mismo.
Internet solo se usa una vez, durante la construcción inicial, para
descargar esas piezas (todas de fuentes oficiales: Docker Hub y el
registro oficial de npm — detalle en [seguridad.md](docs/seguridad.md));
después, el uso diario es 100% interno a la red de la empresa.

## Primer ingreso

- Usuario: `admin`
- Contraseña: la que elegiste durante la instalación (o la generada
  automáticamente de 20 caracteres, guardada en el archivo `.env` de esta
  carpeta — ver [`.env.example`](.env.example) para el detalle de cada
  variable).

La plataforma arranca con un caso de ejemplo cargado (una persona, un
equipo, un ticket y una conversación de chat) para probar el circuito
completo enseguida.

## Seguridad, en breve

- Sesiones server-side (cookie `httpOnly`, `SameSite=Strict`); nunca se
  guarda una contraseña ni un token de sesión en texto plano.
- Permisos por rol validados **en el servidor**, no solo ocultos en la
  interfaz.
- Cero llamadas a servicios externos en tiempo de ejecución (verificado con
  captura de tráfico de red).
- Contenedores reforzados: sin privilegios nuevos, backend con sistema de
  archivos de solo lectura, base de datos sin puerto expuesto al host.
- **Contraseñas exigentes**: mínimo 10 caracteres combinando al menos tres
  tipos, sin secuencias ni repeticiones, y sin las más usadas del mundo.
- **Fuerza bruta frenada donde corresponde**: 8 contraseñas erradas bloquean
  esa cuenta 15 minutos, y el bloqueo vive en la base de datos, así que
  **sobrevive a un reinicio**. Los ingresos correctos no consumen presupuesto:
  setenta personas entrando a la vez desde la misma red no se bloquean entre sí.
- **No arranca con la contraseña de ejemplo** del repositorio: corta el arranque
  con un mensaje que dice exactamente qué cambiar.
- **Las copias de seguridad no llevan la llave adentro**: la configuración se
  guarda aparte y cifrada, así una copia perdida no permite descifrar las
  credenciales de correo que contiene.
- `npm audit`: 0 vulnerabilidades conocidas. Todas las dependencias son de
  fuentes oficiales, con versiones fijadas.

Detalle completo, con la matriz de permisos por rol y la privacidad del
chat explicada punto por punto: **[docs/seguridad.md](docs/seguridad.md)**.
Y **108 controles ejecutados** contra la plataforma corriendo, no declarados:
**[docs/auditoria-seguridad.md](docs/auditoria-seguridad.md)**.

## Problemas comunes

| Síntoma | Qué hacer |
| --- | --- |
| Docker Desktop no arranca (Windows) | Verificar que la virtualización esté activada en la BIOS/UEFI y que WSL2 esté habilitado. |
| `docker: permission denied` (Linux) | Cerrar sesión y volver a entrar después de instalar Docker (tu usuario entra al grupo `docker` recién ahí). |
| "El puerto ya está ocupado" | Editar `APP_PORT` en el archivo `.env` (por ejemplo `3001`) y volver a la opción 1 del menú. |
| La interfaz se ve rota/desordenada justo después de actualizar la plataforma | Forzar recarga sin caché (`Ctrl+Shift+R`). No debería repetirse: el servidor ya obliga a revalidar los archivos en cada visita. |
| No se pueden subir archivos | El almacenamiento llegó al tope. Nada de lo guardado se perdió: opción **9) Liberar espacio** del menú, o ampliar `UPLOADS_MAX_GB` en el `.env`. |
| "Demasiados intentos fallidos" al entrar | Se erró la contraseña 8 veces. Se destraba solo a los 15 minutos, o un Administrador la restablece desde el Panel administrador. |
| El correo pide volver a escribir las contraseñas | La clave de cifrado del servidor cambió (típico tras restaurar una copia en un servidor nuevo). **No se perdió ningún correo**: los mensajes están en el servidor de correo. Hay que recargar la contraseña de cada casilla. |
| Cualquier otro error del instalador | El detalle técnico completo queda en `install.log`, en esta misma carpeta. |

> Para diagnóstico más a fondo —qué dicen los registros, cómo verificar que la
> base responde, qué mirar cuando va lento— está la
> **[guía de operación](docs/operacion.md)**.

## Documentación

| Documento | Para quién |
| --- | --- |
| 📘 **[Manual de uso](docs/guia-usuario.md)** ([PDF](docs/Manual-de-uso-CIGST.pdf)) | Cualquier persona — cómo se usa la plataforma día a día, con capturas. |
| ⬇️ **[Cómo descargar la plataforma](docs/Como-descargar-CIGST.pdf)** (PDF) | Quien va a instalarla — Windows y Linux, paso a paso. |
| ⚙️ **[Cómo instalar la plataforma](docs/Como-instalar-CIGST.pdf)** (PDF) | Quien va a instalarla — máximo detalle, Windows y Linux. |
| 🔧 **[Instaladores: análisis técnico](docs/instaladores.md)** | Quien prueba/audita `install.sh`/`install.ps1`. |
| 🛠️ **[Guía de operación](docs/operacion.md)** | **Sistemas / infraestructura** — el día a día: qué mirar, disco, copias de seguridad, registros, configuración completa, límites y diagnóstico. |
| 🏢 **[Puesta en producción](docs/deployment-empresa.md)** | Infraestructura — servidor web adelante (nginx/Apache), HTTPS y WebSocket. |
| 🏗️ **[Arquitectura](docs/arquitectura.md)** | Desarrolladores — stack, estructura del código, decisiones de diseño. |
| 🗄️ **[Modelo de datos](docs/base-de-datos.md)** | Desarrolladores — entidades, convenciones, migraciones. |
| 🧪 **[Pruebas](pruebas/LEEME.md)** | Quien quiera verificar la plataforma: 106 comprobaciones automatizadas. |
| 🔐 **[Seguridad](docs/seguridad.md)** | Cualquiera evaluando si confiar en la plataforma. |
| 🛡️ **[Auditoría de seguridad](docs/auditoria-seguridad.md)** | 108 controles **probados** contra la plataforma corriendo, no declarados. |

---

<div align="center">

Software interno — no distribuido públicamente.

</div>
