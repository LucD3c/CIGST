# Guía de operación

> Para el área de sistemas / infraestructura: cómo se mantiene la plataforma
> funcionando, qué mirar, qué hacer cuando algo falla y qué se puede tocar sin
> romper nada.
>
> Para **instalarla**, ver el
> [README](../README.md#instalación-en-3-pasos). Para ponerla detrás de HTTPS,
> ver [puesta en producción](deployment-empresa.md).

> 🆕 **Nuevo en esta versión: [Unidades de red](#unidades-de-red-nuevo).** Lo
> único que pide a sistemas es que el servidor de CIGST llegue al servidor de
> archivos por el puerto 445.

---

## Lo mínimo que hay que saber

La plataforma son **tres contenedores de Docker**:

| Servicio | Qué es | Cuándo corre |
| --- | --- | --- |
| `db` | PostgreSQL 16 | Siempre |
| `migrate` | Actualiza la base y termina | Una vez en cada arranque |
| `app` | La plataforma (Node.js) | Siempre |

Y **dos volúmenes** donde vive todo lo que importa:

| Volumen | Qué guarda |
| --- | --- |
| `cigst_pgdata` | La base de datos completa |
| `cigst_uploads` | Los archivos adjuntos |

Esos dos volúmenes son independientes del código: **actualizar la plataforma no
los toca**. Lo que sí los borra es la opción "Resetear todo" del instalador, que
por eso pide escribir una palabra de confirmación.

Todo se maneja desde el menú del instalador (`./install.sh` en Linux,
`install.bat` en Windows). No hace falta escribir comandos de Docker a mano,
aunque se puede.

---

## Unidades de red (Nuevo)

> 🆕 **Nuevo en esta versión — en pocas palabras**
>
> - **Qué hace:** las carpetas compartidas del servidor de archivos de la
>   empresa (Windows o Samba) se usan desde CIGST, sin mapearlas en cada PC.
> - **Cómo se usa:** un Administrador las vincula en *Unidades de red →
>   Administrar unidades* con la ruta, el usuario y la contraseña **del servidor
>   de archivos**, y las asigna a personas o sectores. No se toca el `.env` ni
>   ningún archivo.
> - **Cómo está hecho:** el contenedor `app` trae el cliente oficial de Samba
>   (`smbclient`) y lo usa para cada operación. Los archivos pasan por flujo:
>   **no ocupan lugar en el disco de CIGST ni entran en sus copias de
>   seguridad**, porque viven en el servidor de archivos.

Lo que sistemas tiene que saber:

| Tema | Qué hay que hacer |
| --- | --- |
| Red | El servidor de CIGST tiene que llegar al servidor de archivos por el **puerto 445/TCP**. Es una conexión saliente: no se abre nada hacia CIGST |
| Ruta | Vincular por **dirección IP** (`\\192.168.1.10\Carpeta`). Los nombres tipo `\\SERVIDOR` solo funcionan si el DNS de la red los conoce |
| Protocolo | SMB2 o SMB3. Los servidores que solo hablan **SMB1** no funcionan, a propósito |
| Usuarios | Cada unidad usa un usuario del servidor de archivos. Los permisos y el tamaño máximo de archivo los decide ese servidor, no CIGST |
| Clave | Las contraseñas de las unidades se cifran con `MAIL_ENCRYPTION_KEY`, la misma del correo. Si se pierde, hay que volver a cargarlas |
| Copias | La copia de CIGST guarda qué unidades hay y a quién están asignadas. **Los archivos no**: se respaldan en el servidor de archivos |

Los límites están en [Límites de tráfico vigentes](#límites-de-tráfico-vigentes)
y los problemas típicos en [Diagnóstico](#una-unidad-de-red-no-conecta).

---

## El día a día: cómo saber que está bien

### Desde el instalador

La opción **2) Ver estado de los servicios** dice si cada contenedor está
levantado y sano. Es lo primero que hay que mirar ante cualquier reclamo.

### Desde la línea de comandos

```bash
docker compose ps
```

Los dos servicios permanentes tienen que decir `Up ... (healthy)`.

**Qué significa `healthy` acá**: el chequeo consulta la base de datos de
verdad, no solamente que el proceso esté vivo. Si Postgres se cae o el pool de
conexiones se agota, el contenedor pasa a `unhealthy`. Antes esto no era así —
la plataforma informaba "sano" con la base caída — y por eso ahora se puede
confiar en ese estado.

Comprobación manual:

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok","db":"ok"}     -> todo bien
# {"status":"error","db":"sin conexión"}  -> la base no responde
```

### Qué NO hace falta vigilar

Estas tareas se ejecutan de forma automática y se limpian solas; no requieren
intervención ni seguimiento:

| Tarea | Cada cuánto |
| --- | --- |
| Limpieza de datos sin uso | 6 horas (y al arrancar) |
| Borrado de adjuntos que quedaron sueltos | 6 horas |
| Control de espacio en disco | 1 hora |
| Latido de las conexiones en tiempo real | 30 segundos |

---

## Espacio en disco

Es el único recurso que, por acumulación, puede dejar la plataforma fuera de
servicio. Por eso tiene dos frenos independientes.

**Por qué importa**: el volumen de adjuntos comparte disco con la base de
datos. Si se llenara, Postgres dejaría de poder escribir y se caería **todo**,
no solo la subida de archivos.

| Freno | Variable | Por defecto |
| --- | --- | --- |
| Tope propio de los adjuntos | `UPLOADS_MAX_GB` | 20 GB |
| Aviso anticipado | `UPLOADS_AVISO_PORCENTAJE` | 80 % |
| Margen libre exigido en el disco físico | `DISCO_MINIMO_LIBRE_MB` | 1024 MB |

### Qué pasa al llegar al tope

Se dejan de aceptar **archivos nuevos**, con un mensaje que lo explica. Y lo
más importante: **no se pierde nada de lo ya guardado**. Todos los archivos
anteriores siguen ahí, se siguen abriendo y descargando igual. Lo único que no
se puede hacer es subir más hasta liberar lugar.

### Cuánto ocupa realmente

```bash
docker compose exec app du -sh /app/uploads
docker system df -v | grep cigst
```

Para dimensionar: cada imagen que entra se comprime **dos veces** (en el
navegador antes de subirla, y otra vez en el servidor para las que lleguen por
otro medio). Una captura de pantalla típica pasa de unos 350 KB a 85 KB — **cuatro
veces menos**. Los PDF, las planillas y los GIF animados no se tocan.

### Si se está quedando sin lugar

1. Opción **9) Liberar espacio** del instalador (ver más abajo).
2. Si aun así hace falta, subir `UPLOADS_MAX_GB` en el `.env` y reiniciar.
3. Si el disco físico es el límite, ampliar el disco de la máquina o mover el
   volumen a uno más grande.

---

## Limpieza de datos sin uso (opción 9)

**La regla que manda sobre todo lo demás: no se pierde nada que le sirva a
nadie.** Ni un ticket, ni un mensaje, ni una imagen, ni un PDF, ni una
planilla, ni una conversación, ni un artículo. **Tampoco los registros dados de
baja**: el borrado de la plataforma es lógico y esos datos se conservan para
siempre, porque un día alguien puede necesitar consultarlos.

Lo único que se elimina son datos que, por definición, ya no le sirven a nadie:

| Qué | Por qué es seguro |
| --- | --- |
| Sesiones vencidas | Son tokens muertos: la plataforma los rechaza igual |
| Intentos de inicio de sesión viejos | Solo existen para contar fuerza bruta en una ventana de minutos |
| Avisos ya leídos de más de 90 días | Un aviso es un puntero a algo que sigue existiendo intacto |
| Avisos que nadie abrió en más de un año | Ídem |
| "Visto" de publicaciones dadas de baja | Es el acuse de algo que ya no se muestra |
| Archivos en disco sin ninguna fila que los referencie | Son inalcanzables desde la interfaz: no hay forma de abrirlos |

Los archivos huérfanos se borran con **doble verificación** (se consulta la base
otra vez justo antes de borrar) y solo si tienen más de 24 horas, para que sea
imposible pisar una subida en curso.

La misma rutina corre sola cada 6 horas. La opción del menú sirve para
ejecutarla a demanda y, sobre todo, para **ver en pantalla el detalle exacto de
lo que se eliminó**.

### Ajustar cuánto se conserva

| Variable | Por defecto | Qué controla |
| --- | --- | --- |
| `RETENTION_NOTIF_LEIDAS_DIAS` | 90 | Avisos ya leídos |
| `RETENTION_NOTIF_SIN_LEER_DIAS` | 365 | Avisos que nadie abrió |

Subirlos conserva más historial de avisos; bajarlos libera más. Ninguno de los
dos toca datos de negocio.

---

## Copias de seguridad

### Manual (opción 6)

Guarda en `backups/AAAA-MM-DD_HH-MM/`:

- `base-de-datos.sql` — volcado completo de Postgres
- `adjuntos.tar` — todos los archivos
- `configuracion.env.cifrado` — el `.env`, **cifrado con una contraseña
  definida por el operador** (AES-256, 200.000 iteraciones de derivación)

> **Por qué la configuración va aparte y cifrada.** El `.env` contiene la clave
> con la que se descifran las contraseñas de las casillas de correo (y 🆕 de las
> unidades de red). Antes se
> copiaba tal cual dentro de la misma carpeta, con lo cual la copia guardaba a
> la vez los datos cifrados **y la llave para abrirlos**: quien se llevara el
> pendrive se llevaba todo.
>
> **Esa contraseña debe guardarse en una ubicación distinta de la copia.** Si
> ambas viajan juntas, el cifrado deja de aportar protección.

### Automática (opción 8)

Programa la copia en el `cron` del sistema: todos los días a las 2, o los
domingos a las 2. Conserva las **últimas 14** y borra las anteriores, para que
las copias no terminen llenando el disco que vinieron a proteger.

Una copia que depende de que alguien se acuerde de hacerla no es una copia.

**Dos advertencias que el instalador repite a propósito:**

1. Las copias quedan **en el mismo disco**. Si el disco se rompe, se rompen con
   él. Hay que copiarlas cada tanto a otro lado (disco externo, carpeta de red,
   nube privada).
2. La copia automática **no incluye la configuración**: cifrarla necesita que
   alguien escriba una contraseña. El `.env` se guarda a mano una vez, y
   después solo cuando cambia algo de correo.

### Restaurar (opción 7)

Detiene el backend (Postgres no permite borrar una base con conexiones
abiertas), corta las sesiones remanentes, recrea la base, carga el volcado con
`ON_ERROR_STOP=1` —si una sola sentencia falla, corta y avisa en vez de dejar
una restauración a medias—, restaura los adjuntos y vuelve a encender. Al
terminar informa **cuántos tickets quedaron en la base**, para que la
confirmación sea un hecho verificable.

Si la copia trae la configuración cifrada, primero ofrece restaurarla.

> **Esto importa mucho**: si la clave de correo (`MAIL_ENCRYPTION_KEY`) no es la
> misma con la que se guardaron las casillas, esas contraseñas quedan
> ilegibles. La plataforma lo detecta y lo avisa **por adelantado** en la
> pantalla de Correo, aclarando que no se perdió ningún mensaje (los correos
> viven en el servidor de correo, no acá). Hay que volver a cargar la
> contraseña de cada casilla.

---

## Los registros: qué dicen

```bash
docker compose logs app --tail 100      # últimas 100 líneas
docker compose logs app -f              # en vivo
docker compose logs app --since 1h      # última hora
```

Salen en JSON, un objeto por línea. El campo `level` sigue la escala de `pino`:

| `level` | Qué es | Hay que actuar |
| --- | --- | --- |
| 30 | Información normal | No |
| 40 | Aviso | Conviene mirarlo |
| 50 | Error | Sí |
| 60 | Fatal | Sí, urgente |

### Mensajes que conviene reconocer

| Mensaje | Qué significa | Qué hacer |
| --- | --- | --- |
| `CIGST backend escuchando en el puerto 3000` | Arrancó bien | Nada |
| `Tiempo real (WebSocket) activo en /ws` | El chat y las novedades en vivo funcionan | Nada |
| `Limpieza de datos sin uso: ...` | La rutina automática hizo su pasada | Nada |
| `Almacenamiento de adjuntos al N% del limite` | Se está llenando | Planificar espacio |
| `ALMACENAMIENTO LLENO` | No entran archivos nuevos | Liberar espacio ya |
| `COOKIE_SECURE=false` | Trabaja por HTTP sin cifrar | Decisión propia (ver abajo) |
| `La contraseña de la base de datos es todavía la de ejemplo` | **No arranca a propósito** | Cambiar `POSTGRES_PASSWORD` |
| `Healthcheck: la base de datos no responde` | Postgres caído o pool agotado | Ver el servicio `db` |
| 🆕 `Unidad de red vinculada` / `desvinculada` | Un Administrador agregó o quitó una unidad | Nada |
| 🆕 `Archivo subido a una unidad de red` / `eliminado de` | Movimiento normal de una persona | Nada |
| 🆕 `Eliminacion en unidad de red rechazada: contraseña incorrecta` | Alguien intentó eliminar con la contraseña equivocada | Si se repite mucho, revisar la *Actividad* de esa unidad |
| 🆕 `Descarga de unidad de red interrumpida` | Se cortó una descarga a mitad de camino (la persona cerró la pestaña o se cayó la red) | Nada, salvo que sea constante |
| 🆕 `No se pudo ejecutar smbclient` | Falta el cliente de Samba en el contenedor | Reconstruir con la opción 1 del instalador |

### Bajar o subir el detalle

`LOG_LEVEL` acepta `fatal`, `error`, `warn`, `info` (por defecto), `debug`,
`trace`, `silent`. Para diagnosticar algo puntual, `debug` un rato y volver a
`info`.

---

## Referencia de configuración (`.env`)

Todo se configura en el archivo `.env` de la carpeta de la plataforma. Después
de cambiarlo hay que reiniciar (opción 4 del instalador).

### Acceso y red

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `APP_PORT` | `3000` | Puerto donde escucha |
| `APP_BIND` | `0.0.0.0` | En qué dirección escucha. `0.0.0.0` = toda la red local; `127.0.0.1` = solo la propia máquina (para cuando hay nginx adelante) |
| `COOKIE_SECURE` | `false` | `true` cuando hay HTTPS |
| `TRUST_PROXY` | `false` | `true` **obligatoriamente** si hay un proxy inverso adelante |
| `SESSION_TTL_HOURS` | `12` | Cuánto dura una sesión sin actividad |
| `SESSION_COOKIE_NAME` | `cigst_session` | Nombre de la cookie |

> `TRUST_PROXY=true` no es opcional detrás de nginx: sin eso la plataforma ve la
> dirección del proxy en lugar de la de cada persona, y los límites de tráfico
> se aplican a todos como si fueran uno solo.

### Base de datos

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `POSTGRES_USER` | `cigst` | Usuario de la base |
| `POSTGRES_PASSWORD` | *(la genera el instalador)* | **La plataforma se niega a arrancar si quedó la de ejemplo** |
| `POSTGRES_DB` | `cigst` | Nombre de la base |
| `DB_POOL` | `30` | Conexiones simultáneas a Postgres |

`DB_POOL` cubre cómodo unas 70 personas trabajando a la vez. Subirlo solo tiene
sentido si también se sube `max_connections` de Postgres (por defecto 100).

### Almacenamiento e imágenes

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `UPLOADS_MAX_GB` | `20` | Tope de los adjuntos |
| `UPLOADS_AVISO_PORCENTAJE` | `80` | A partir de qué % se avisa |
| `DISCO_MINIMO_LIBRE_MB` | `1024` | Margen libre exigido en el disco |
| `IMAGEN_MAX_LADO` | `1600` | Lado máximo al que se reducen las imágenes |
| `IMAGEN_CALIDAD` | `0.82` | Calidad de compresión (0 a 1) |

### Retención

| Variable | Por defecto |
| --- | --- |
| `RETENTION_NOTIF_LEIDAS_DIAS` | `90` |
| `RETENTION_NOTIF_SIN_LEER_DIAS` | `365` |

### Correo y unidades de red

| Variable | Qué hace |
| --- | --- |
| `MAIL_ENCRYPTION_KEY` | Clave con la que se cifran las contraseñas de las casillas y 🆕 de las unidades de red |

La genera el instalador. **Si falta, Correo y Unidades de red quedan
desactivados y el resto de la plataforma funciona igual** — falla cerrado a propósito: es
preferible eso a cifrar con algo predecible.

**Esta clave debe resguardarse.** Si se pierde, las contraseñas de las casillas
y de las unidades guardadas son irrecuperables y hay que volver a cargarlas
manualmente. No se pierde ningún correo ni ningún archivo: los mensajes residen
en el servidor de correo y los archivos en el servidor de archivos, no en la
plataforma.

### Otras

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `TZ` | `America/Argentina/Buenos_Aires` | Zona horaria de fechas e historiales |
| `LOG_LEVEL` | `info` | Detalle de los registros |
| `SEED_ADMIN_USERNAME` | `admin` | Usuario administrador inicial |
| `SEED_ADMIN_PASSWORD` | *(la genera el instalador)* | Solo se usa la primera vez |

---

## Límites de tráfico vigentes

Están puestos para que un script o un error de programación no puedan saturar
el servidor, sin molestar al uso normal.

| Qué | Límite | Ventana | Se cuenta por |
| --- | --- | --- | --- |
| Intentos de inicio de sesión fallidos | 8 | 15 min | **Cuenta** |
| Intentos fallidos desde una red | 30 | 15 min | Dirección IP |
| Inundación de pedidos de login | 200 | 5 min | Dirección IP |
| Mensajes de chat | 30 | 1 min | Usuario |
| Subida de archivos | 40 | 10 min | Usuario |
| 🆕 Operaciones con unidades de red | 240 | 1 min | Usuario |
| 🆕 Eliminaciones en unidades de red | 30 | 1 min | Usuario |
| 🆕 Contraseña de unidad equivocada al eliminar | 5 | 15 min | Usuario y unidad |
| Resto de la API | 600 | 5 min | Usuario |
| Mensajes por WebSocket | 30 | 1 min | Usuario |
| Tramas por WebSocket | 240 | 1 min | Usuario |

Otros topes fijos: **10 MB por archivo**, **5 archivos por envío**, **64 KB por
trama de WebSocket**, **400 conexiones simultáneas**, **200 filas por página**
en cualquier listado.

Las operaciones con unidades de red cuentan **además** dentro del límite general
de la API (600 cada 5 minutos). Cada archivo subido es un solo pedido: en la
práctica alcanza para unos 500 archivos cada 5 minutos por persona.

Los archivos de las **unidades de red** no tienen tope de tamaño en la
plataforma: lo decide quien administra el servidor de archivos (cuotas, espacio).
Tampoco ocupan lugar en el disco de CIGST, porque pasan por flujo directo. Sí se
acotan los procesos simultáneos: hasta 16 operaciones (listar, eliminar) y 10
transferencias a la vez; el resto espera su turno unos segundos. Una subida
puede durar hasta 2 horas.

> **Requisito de red de las unidades:** la máquina donde corre CIGST tiene que
> poder llegar al servidor de archivos por el **puerto 445** (es la misma
> conexión que hace cualquier PC de la oficina al mapear una unidad). Si en la
> empresa las PC ya mapean unidades, casi seguro llega. Conviene vincular las
> unidades por **dirección IP**: los nombres tipo `\\SERVIDOR` solo funcionan si
> el DNS de la red los conoce.

> **Los ingresos correctos no consumen presupuesto.** Solo cuentan las
> contraseñas equivocadas. Esto importa en una oficina donde todos salen por el
> mismo router: antes, la persona número 11 que llegaba a la mañana quedaba
> bloqueada aunque escribiera bien su contraseña.
>
> La defensa real contra fuerza bruta es el límite **por cuenta** (8 fallos),
> que vive en la base de datos y **sobrevive a un reinicio** del contenedor.

---

## Actualizar

> 🆕 **Nuevo: opción 11) Actualizar desde GitHub.** Se usa siempre desde la
> **misma carpeta**, sin volver a descargar nada a mano.

1. `./install.sh` → opción **11** (o `./install.sh --actualizar`).
2. Leer qué trae la versión nueva y escribir `ACTUALIZAR`.
3. Opción **2** para ver los 3 servicios en verde.

La opción 11 construye la versión nueva con la plataforma funcionando, copia
la base con la aplicación detenida (alrededor de un minuto de corte) y, si la
versión nueva no arranca, vuelve a la anterior con la base tal como estaba. El
paso a paso, qué pasa si falla cada etapa y cómo hacerlo la primera vez en un
servidor con un instalador viejo está en
[instaladores.md](instaladores.md#actualizar-desde-github-opción-11-nuevo).

> **Nunca instalar la versión nueva en otra carpeta.** Docker guarda los datos
> según el nombre de la carpeta: desde una carpeta nueva la plataforma
> arranca vacía. El instalador avisa y frena si lo detecta.

La copia de la opción 11 queda en `backups/…_antes-de-actualizar/`. Ojo: las
copias automáticas (opción 8) conservan las 14 carpetas más recientes de
`backups/` y borran las más viejas, incluidas estas.

El servicio `migrate` aplica los cambios de base que hagan falta y recién
entonces arranca la plataforma.

**Si una migración falla, la plataforma NO arranca.** Eso es a propósito: es
más seguro no levantar que levantar con la base a medias. El mensaje lo explica
y aclara que los datos están intactos. Los pasos a seguir salen en el mismo
mensaje.

Los datos sobreviven porque viven en volúmenes independientes del código.

---

## Escala: hasta dónde llega

Medido con **70 personas trabajando a la vez**, sin pausa entre acciones (mucho
más exigente que el uso real, donde la gente piensa entre clic y clic):

| Medición | Resultado |
| --- | --- |
| Sesiones simultáneas | 70 de 70 |
| Conexiones de tiempo real | 70 de 70 |
| Peticiones | 2.100 |
| Errores | **0** |
| p95 de respuesta | 853 ms |
| Rendimiento | 145 peticiones por segundo |
| Memoria del contenedor | ~45 MB |

### El techo, dicho claro

La plataforma corre en **un solo proceso**, y no se puede correr en dos. El
registro de conexiones en tiempo real y los contadores de tráfico viven en la
memoria de ese proceso.

Es una decisión, no un descuido: evita tener que instalar y mantener un Redis.
Si algún día hicieran falta más personas, la salida es **una máquina más
grande** antes que un segundo proceso.

Está verificado que no pierde memoria: 200 conexiones abiertas y cerradas
mueven la memoria del contenedor de 44,9 a 45,1 MB.

### Hardware

Una PC de escritorio de oficina común alcanza. En la prueba de carga usó menos
del 3 % de CPU y unos 45 MB de RAM.

---

## Diagnóstico

### "No entra nadie"

```bash
docker compose ps
```

- **`app` no está**: opción 1 del instalador.
- **`app` reiniciándose**: `docker compose logs app --tail 50`. La causa más
  común es la contraseña de ejemplo en el `.env` (la plataforma se niega a
  arrancar a propósito) o una migración fallida.
- **Todo `healthy` pero no responde**: revisar el firewall de la máquina y que
  `APP_BIND` no esté en `127.0.0.1` si se entra desde otras computadoras.

### "Entra pero da error en todas las pantallas"

Casi siempre es la base. `curl -s http://localhost:3000/api/health` lo dice.
Ver `docker compose logs db`.

### "Dice que hay demasiados intentos fallidos"

Alguien erró la contraseña 8 veces. Se destraba solo a los 15 minutos, o un
Administrador puede restablecer la contraseña desde el Panel administrador sin
esperar.

### "No se pueden subir archivos"

Almacenamiento lleno. El mensaje lo dice y aclara que no se perdió nada. Opción
9 del instalador, o subir `UPLOADS_MAX_GB`.

### "El correo da error en todas las casillas"

Si la plataforma avisa que hay casillas que necesitan que vuelvas a escribir la
contraseña, es que `MAIL_ENCRYPTION_KEY` no es la misma con la que se guardaron
— típicamente tras restaurar una copia. Se restaura el `.env` original, o se
cargan de nuevo las contraseñas.

Si en cambio dice que el correo no está habilitado, falta
`MAIL_ENCRYPTION_KEY`: el instalador la genera sola con la opción 1.

### "Una unidad de red no conecta"

🆕 El mensaje de la pantalla dice cuál es el problema. Los más comunes:

| Lo que dice | Qué revisar |
| --- | --- |
| No se pudo conectar / no responde | Que el servidor de CIGST llegue al servidor de archivos por el puerto 445, y que la ruta use la **IP** y no el nombre |
| Rechazó el usuario o la contraseña | La contraseña cambió en el servidor de archivos: cargar la nueva en *Administrar unidades → Editar* |
| El usuario está bloqueado | Muchos intentos fallidos contra el servidor de archivos. Lo desbloquea quien administra ese servidor |
| No permite esta operación | El usuario de la unidad no puede leer o escribir esa carpeta. Se corrige en el servidor de archivos, no en CIGST |
| No tiene una carpeta compartida con ese nombre | El nombre del recurso en la ruta está mal escrito (`\\IP\Nombre`) |
| ¿Solo habla SMB1? | El servidor de archivos es muy viejo. Hay que habilitarle SMB2 o SMB3 |
| Volver a cargar la contraseña | `MAIL_ENCRYPTION_KEY` no es la misma con la que se guardó (típico tras restaurar una copia). Restaurar el `.env` original o cargar la contraseña de nuevo |

Para probar la conexión sin tocar nada, el botón **Probar** de *Administrar
unidades* intenta entrar con la contraseña guardada y muestra el resultado.

### "El chat no actualiza solo"

El WebSocket no está llegando. Si hay un proxy inverso adelante, casi seguro le
faltan las dos cabeceras de `Upgrade` — está explicado en
[puesta en producción](deployment-empresa.md).

### "Va lento"

1. `docker stats` para ver consumo de CPU y memoria.
2. Si el consumo de la base es elevado y hay peticiones en espera, revisar
   `DB_POOL`: el pool puede estar saturado.
3. Si el disco está lleno, el rendimiento de Postgres se degrada de forma
   marcada. Liberar espacio.

---

## Verificar que todo funciona

Las suites de [`pruebas/`](../pruebas/LEEME.md) corren contra la plataforma en
funcionamiento, dentro de contenedores descartables — no hay que instalar nada.
Son **106 comprobaciones**: API, bases de conocimiento, imágenes e interfaz en
un navegador real.

Sirven después de una actualización, después de mover la plataforma de máquina,
o cuando hay una duda concreta sobre si algo quedó bien.

> Las suites **crean datos**. Están pensadas para una instalación de prueba, no
> para la que usa la empresa todos los días.

🆕 Las **Unidades de red** todavía no tienen una suite en `pruebas/`: se
verificaron contra un servidor Samba de prueba (ver
[pruebas/LEEME.md](../pruebas/LEEME.md)). En producción, la forma rápida de
comprobar una unidad es el botón **Probar** de *Administrar unidades*.

---

## Lo que la plataforma no hace, y hay que resolver afuera

- **No manda correo de alertas.** Los avisos van al registro. Si se quiere una
  alerta por correo o por chat, hay que engancharla afuera leyendo los logs.
- **No tiene panel de métricas.** `docker stats` y los registros son lo que hay.
- **No replica ni tiene alta disponibilidad.** Si la máquina se apaga, la
  plataforma se apaga. La protección es la copia de seguridad.
- **No cifra el tráfico por sí sola.** Para HTTPS hay que poner un servidor web
  adelante ([guía](deployment-empresa.md)).
