# Cómo funcionan los instaladores (`install.sh` / `install.ps1` / `install.bat`)

> Este documento es para quien va a **probar o auditar** el instalador —
> por ejemplo, desplegando en máquinas virtuales limpias de Windows y
> Linux — y quiere entender exactamente qué hace cada paso, por qué existe,
> y qué esperar en cada sistema operativo. Si solo querés instalar la
> plataforma, con el [README](../README.md) alcanza.

## Por qué existe un instalador (y qué es "instalar" acá)

CIGST no es un programa que se instala en el sistema operativo en el
sentido tradicional (no copia archivos a `Program Files`, no registra
servicios de Windows, no toca el `PATH`). **Todo el software de la
plataforma corre encapsulado dentro de contenedores Docker** — Node.js,
PostgreSQL, y todas las dependencias de ambos viven *dentro* de esos
contenedores, no en el sistema operativo anfitrión.

Entonces, ¿qué hace falta "instalar"? Dos cosas:

1. **Construir las imágenes de Docker** de la plataforma (`docker compose
   build`): esto descarga las piezas base (Node 20.20.2, dependencias npm
   fijadas en `package-lock.json`) y arma con ellas dos imágenes propias
   (`cigst-app`, `cigst-migrate`), además de descargar la imagen oficial de
   PostgreSQL 16.14. Es un proceso que consume ancho de banda e internet
   **una sola vez** (o cada vez que el código cambia); nunca en el uso
   normal del día a día.
2. **Configurar la instancia** (`.env`): cada empresa que use CIGST necesita
   sus propias contraseñas y su propio puerto — no tiene sentido que todas
   las instalaciones del mundo compartan una contraseña de administrador
   por defecto. El instalador pregunta esto una única vez, la primera vez.

El instalador (`install.sh` en Linux/Mac, `install.ps1` + `install.bat` en
Windows) automatiza ambos pasos y le da forma de menú a las tareas que se
repiten después (ver estado, ver logs, reiniciar, apagar, resetear), para
que nadie tenga que memorizar comandos de `docker compose`.

## Por qué dos scripts distintos por sistema operativo (y no uno solo)

Se evaluó una alternativa multiplataforma (un instalador en Node.js, por
ejemplo) y se descartó: **exigiría tener Node.js instalado en el sistema
anfitrión** — exactamente lo que esta plataforma promete no necesitar (todo
corre dentro de Docker). Usar el intérprete de comandos que cada sistema ya
trae de fábrica (`bash` en Linux/Mac, PowerShell en Windows) evita agregar
esa dependencia extra:

- **Linux/Mac**: `install.sh`, un script de `bash` — viene preinstalado en
  ambos sistemas.
- **Windows**: `install.ps1` (PowerShell) + `install.bat` (un lanzador de 8
  líneas). PowerShell 5.1 viene preinstalado desde Windows 7/Server 2008 R2
  en adelante — ningún Windows 10/11 necesita instalar nada para correrlo.

## Windows: por qué `install.bat` además de `install.ps1`

Windows, por política de seguridad de fábrica, no deja hacer doble click en
un `.ps1` y que se ejecute — lo abre en un editor de texto en su lugar, o
bloquea la ejecución según la política de PowerShell configurada
(`Restricted` es habitual). Pedirle al usuario que abra una terminal y
ejecute `powershell -ExecutionPolicy Bypass -File install.ps1` a mano es
exactamente la fricción que se quiere evitar.

`install.bat` existe solo para resolver ese doble click:

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
```

`-ExecutionPolicy Bypass` **no cambia ninguna configuración del sistema**:
es un flag que aplica *solo a esa ejecución puntual*, lanzada desde ese
`.bat`. La política de PowerShell del sistema (la que ve `Get-ExecutionPolicy`
en cualquier otra ventana) queda exactamente igual que antes. Tampoco pide
permisos de administrador — Docker Desktop corre con el usuario normal, así
que el instalador también.

## Qué pasa exactamente en cada arranque (opción 1 del menú)

```
Setup-Env  →  docker compose up -d --build  →  espera de salud  →  resumen final
```

1. **`Setup-Env` / `setup_env`**: si no existe `.env`, lo crea copiando
   `.env.example` y pregunta 3 cosas por consola (contraseña de admin,
   contraseña de Postgres, puerto) — Enter en cualquiera usa un valor
   generado al azar de 20 caracteres o el puerto 3000. Si `.env` ya existe
   (instalaciones siguientes), este paso no hace nada: no pisa una
   configuración ya elegida.
2. **`docker compose up -d --build`**: constrs las imágenes (la primera vez
   descarga capas base de Docker Hub; las siguientes reconstrucciones
   reutilizan lo que no cambió — mucho más rápido) y levanta los 3
   servicios en orden:
   - `db` (PostgreSQL) arranca primero; el instalador espera a que su
     healthcheck (`pg_isready`) esté en verde.
   - `migrate` arranca recién cuando `db` está sano: aplica las migraciones
     de base de datos (crea todas las tablas) y carga los datos iniciales
     (rol Administrador, la cuenta admin, dos sectores y turnos de
     ejemplo, un caso de prueba completo). Es un contenedor de un solo uso
     — termina y se apaga solo.
   - `app` arranca recién cuando `migrate` terminó **con éxito**: si las
     migraciones fallaran, `app` ni siquiera se levanta (evita que la
     plataforma quede corriendo contra una base a medio migrar).
3. **Espera de salud**: el instalador consulta cada 3 segundos el estado
   de salud del contenedor `app` (el mismo healthcheck que usa Docker,
   `GET /api/health`) hasta que responde `healthy`, con un tope de 5
   minutos. Recién ahí se considera "instalado".
4. **Resumen final**: URL de acceso, usuario administrador, y el
   recordatorio de guardar el `.env`.

### ¿Esto "descarga dependencias"? ¿De dónde?

Sí, y de exactamente dos lugares, ambos oficiales:

- **Docker Hub** (`hub.docker.com`): las imágenes base `node:20.20.2-alpine`
  y `postgres:16.14-alpine`, ambas con tag de versión fijo (nunca `latest`).
- **El registro oficial de npm** (`registry.npmjs.org`): los paquetes
  declarados en `backend/package.json`, con las versiones exactas
  congeladas en `backend/package-lock.json` (`npm ci` instala *exactamente*
  esas versiones, no "la última compatible").

Nada se descarga de un tercer origen, ni binarios sueltos, ni scripts de
URLs arbitrarias. El detalle completo de licencias y auditoría de estas
dependencias está en [seguridad.md](seguridad.md).

Estas descargas ocurren **solo durante el build** (la primera vez, o cada
vez que se actualiza el código de la plataforma) — nunca durante el uso
normal del día a día, que es 100% local a la red de la empresa.

## Qué SÍ automatiza el instalador (para que el usuario no tenga que hacer nada de esto a mano)

- Detectar si Docker está instalado, corriendo, y en una versión soportada.
- Crear y completar el `.env` con contraseñas seguras.
- Construir las imágenes, levantar los 3 contenedores en el orden correcto,
  y esperar a que estén realmente sanos (no solo "arrancados").
- Diagnosticar las causas más comunes de fallo (puerto ocupado, Docker
  apagado, migración fallida) con una explicación en español y sin jerga,
  en vez de un stacktrace crudo.
- Guardar el detalle técnico completo en `install.log` para diagnóstico,
  sin ensuciar la pantalla principal.
- Dar un menú para las tareas de mantenimiento habituales (estado, logs,
  reiniciar, apagar, resetear) sin tener que aprender comandos de Docker.

## Lo único que el instalador NO automatiza (a propósito)

**Instalar Docker Desktop en Windows.** Es una decisión deliberada, no una
limitación técnica: instalar Docker Desktop requiere permisos de
administrador y, casi siempre, un reinicio del equipo — automatizar eso
"silenciosamente" desde un script sería invasivo y además fallaría de
formas difíciles de diagnosticar en equipos con políticas corporativas
(antivirus, restricciones de instalación, WSL2 deshabilitado). El
instalador detecta que falta, explica exactamente qué instalar y por qué
(el link oficial, los requisitos de Windows 10/11 64 bits + WSL2 +
virtualización activa en la BIOS/UEFI), y se detiene ahí — el resto de la
instalación de CIGST en sí queda 100% automatizado.

En **Linux**, Docker Engine sí se puede automatizar de forma segura (no
pide reiniciar el equipo), así que ahí el instalador **ofrece** instalarlo
por vos usando el script oficial (`get.docker.com`) — pero nunca sin
confirmación explícita: pregunta primero, y solo con un "si" explícito
descarga y ejecuta ese script.

## Actualizar una instalación que ya está en uso

Es el escenario más delicado: la plataforma ya tiene datos reales de una
empresa y hay que llevarla a una versión nueva **sin perder nada**.

### Por qué los datos sobreviven

El código y los datos viven en lugares distintos:

| Qué | Dónde vive | Qué le pasa al actualizar |
| --- | --- | --- |
| Aplicación (backend + interfaz) | Imagen de Docker | Se reconstruye |
| Base de datos | Volumen `cigst_pgdata` | **Intacto** |
| Archivos adjuntos | Volumen `cigst_uploads` | **Intacto** |
| Configuración y contraseñas | `.env` (fuera del repo) | **Intacto** |

`docker compose up -d --build` (lo que hace la opción 1) recrea contenedores,
pero **nunca toca los volúmenes**. Lo único que los borra es
`docker compose down -v`, que es exactamente lo que hace la opción 8
(Resetear) — y por eso exige escribir `BORRAR` para confirmar.

Las migraciones de base de datos se aplican de forma incremental
(`prisma migrate deploy`): Prisma lleva registro de cuáles ya se corrieron y
aplica solo las que faltan, sobre los datos existentes. Si una migración
fallara, el contenedor `migrate` termina con error y `app` ni siquiera
arranca — así nunca queda la plataforma corriendo contra una base a medio
migrar.

### Los datos de ejemplo no vuelven

El seed corre en cada arranque (para garantizar que siempre exista un
Administrador), pero **los datos de demostración se cargan solo en la primera
instalación**. Si la base ya tiene sectores, personas o tickets, el seed lo
detecta y no toca nada:

```
La plataforma ya tiene datos: se conservan tal cual (no se cargan datos de ejemplo).
```

Esto importa en producción: si un Administrador borra una categoría o un
sector de ejemplo, tiene que quedar borrado, no reaparecer en el próximo
reinicio.

### Procedimiento recomendado

1. Opción **6** → copia de seguridad (base + adjuntos + `.env`).
2. Copiar esa carpeta `backups/...` fuera de la máquina.
3. `git pull` (o reemplazar los archivos del ZIP nuevo, **menos** el `.env`).
4. Opción **1** → reconstruye, migra y levanta.
5. Opción **2** → confirmar que los 3 servicios están en verde.

Si algo saliera mal, la opción **7** restaura la copia del paso 1.

### Cómo funcionan las copias de seguridad (opciones 6, 7 y 8)

- **Copia (6)**: `pg_dump` completo de la base + `tar` de los adjuntos, en
  `backups/AAAA-MM-DD_HH-MM/`. La carpeta `backups/` está en `.gitignore`:
  contiene datos reales, no debe subirse nunca a un repositorio.

  **La configuración va aparte y cifrada.** Antes el `.env` se copiaba tal
  cual dentro de la misma carpeta, y ese archivo contiene la clave con la que
  se descifran las contraseñas de las casillas de correo. O sea que la carpeta
  guardaba a la vez los datos cifrados *y la llave para abrirlos*: quien se
  llevara el pendrive se llevaba todo. Ahora el instalador pide una contraseña
  y guarda `configuracion.env.cifrado` (AES-256, 200.000 iteraciones de
  derivación). Esa contraseña hay que guardarla **en otro lugar** que la
  copia: si las dos cosas viajan juntas, es como dejar la llave pegada en la
  puerta.

- **Restauración (7)**: si la copia trae la configuración cifrada, primero
  ofrece restaurarla (pide la contraseña y conserva el `.env` anterior como
  `.env.anterior-*`). Esto importa: **si la clave de correo no es la misma con
  la que se guardaron las casillas, esas credenciales quedan ilegibles** y hay
  que volver a cargarlas a mano — la plataforma lo dice con un mensaje claro
  en vez de un error genérico. Después detiene el backend (Postgres no permite
  borrar una base con conexiones abiertas), corta las sesiones remanentes,
  recrea la base, carga el dump con `ON_ERROR_STOP=1` (si una sola sentencia
  falla, corta y avisa en vez de dejar una restauración a medias), restaura
  los adjuntos y vuelve a encender. Al terminar informa **cuántos tickets
  quedaron en la base**, para que la confirmación sea un hecho verificable y
  no un mensaje de cortesía.

- **Copias automáticas (8)**: programa la copia en el `cron` del sistema,
  todos los días a las 2 o los domingos a las 2. Una copia que depende de que
  alguien se acuerde de hacerla no es una copia. Conserva las **últimas 14** y
  borra las anteriores, para que las copias no terminen llenando el disco que
  vinieron a proteger.

  La copia automática **no** incluye la configuración: cifrarla necesita que
  alguien escriba una contraseña, y guardarla sin cifrar sería dejar la llave
  de las casillas de correo tirada al lado de los datos. El `.env` se guarda a
  mano una vez, y después solo cuando cambia algo de correo.

  Aviso que el instalador repite a propósito: **esas copias quedan en el mismo
  disco**. Si el disco se rompe, se rompen con él. Hay que copiarlas cada tanto
  a otro lado.

### Liberar espacio (opción 9)

Borra **únicamente datos que ya no le sirven a nadie**:

| Qué se borra | Por qué es seguro |
|---|---|
| Sesiones vencidas | Son tokens muertos: la plataforma los rechaza igual. Nadie puede volver a usarlos. |
| Intentos de inicio de sesión viejos | Solo existen para contar fuerza bruta dentro de una ventana de minutos. |
| Avisos de la campanita ya leídos, de más de 90 días | Un aviso es un puntero a un ticket o mensaje que **sigue existiendo intacto**. |
| Avisos que nadie leyó en más de un año | Ídem: el ticket al que apuntan sigue estando. |
| El "visto" de publicaciones dadas de baja | Es el acuse de recibo de algo que ya no se muestra. |
| Archivos en disco sin ninguna fila que los referencie | Son **inalcanzables** desde la interfaz: no hay forma de abrirlos ni descargarlos. Pasa cuando el proceso se corta entre que se escribe el archivo y se guarda su registro. |

**Lo que NUNCA se toca, ni siquiera dado de baja**: tickets, mensajes,
conversaciones, imágenes, PDF, planillas, personas, equipos, sectores,
artículos y bitácora. El borrado de la plataforma es lógico (`deleted_at`) y
esos datos se conservan para siempre, porque un día alguien puede necesitar
consultarlos.

Los archivos huérfanos se borran con **doble verificación** (se consulta la
base otra vez justo antes de borrar) y solo si tienen más de 24 horas, para
que sea imposible pisar una subida en curso.

La misma rutina corre sola dentro de la plataforma cada 6 horas. La opción del
menú sirve para dispararla cuando uno quiere y, sobre todo, para **ver en
pantalla exactamente qué se eliminó**.

## Guía rápida para probar en una VM limpia

### Windows (VM limpia, sin Docker)

1. Copiar la carpeta del proyecto a la VM (o clonar el repo si la VM tiene
   git y acceso a internet).
2. Doble click en `install.bat` **sin** Docker Desktop instalado todavía:
   el instalador debe detectar la ausencia, mostrar el mensaje con el link
   oficial y los requisitos, y terminar ahí (código de salida 1) — **sin
   intentar instalar nada por su cuenta**. Esto es el comportamiento
   correcto, no un fallo.
3. Instalar Docker Desktop siguiendo el link que mostró el instalador,
   reiniciar si lo pide, abrir Docker Desktop y esperar a que quede listo.
4. Doble click en `install.bat` de nuevo: ahora debe pasar el chequeo de
   requisitos, preguntar por la configuración inicial, y levantar los 3
   contenedores.
5. Verificar en el navegador que `http://localhost:PUERTO` carga la
   pantalla de login.

### Linux (VM limpia, sin Docker)

1. Copiar o clonar el proyecto.
2. `chmod +x install.sh` si el permiso de ejecución no vino del clon (git
   normalmente lo preserva).
3. `./install.sh`: sin Docker instalado, debe ofrecer instalarlo con el
   script oficial y pedir confirmación explícita ("si"). Aceptar.
4. Al terminar la instalación de Docker, el script pide cerrar sesión y
   volver a entrar (o reiniciar) — es necesario para que el usuario quede
   en el grupo `docker` y pueda usar Docker sin `sudo`. Hacerlo.
5. `./install.sh` de nuevo: ahora debe levantar los 3 contenedores.
6. Verificar en el navegador (desde la misma VM o desde otra máquina de la
   misma red, usando la IP de la VM) que la plataforma carga.

### Qué mirar en ambos casos

- Que `install.log` (en la carpeta del proyecto) tenga el detalle completo
  de cada paso — es la primera fuente para diagnosticar cualquier
  diferencia entre Windows y Linux.
- Que el archivo `.env` generado tenga contraseñas distintas cada vez
  (no debería repetirse entre instalaciones).
- Que la opción 6 (resetear) realmente pida escribir "BORRAR" antes de
  destruir los datos, y que cancele si se escribe cualquier otra cosa.
- Que apagar Docker Desktop / detener el daemon de Docker en medio de una
  operación produzca el mensaje de diagnóstico correspondiente, no un
  error críptico.
