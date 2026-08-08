# Auditoría de seguridad

> Este documento no describe intenciones: describe **controles que se probaron
> contra la plataforma corriendo**. Cada línea de las tablas corresponde a una
> comprobación automatizada que se ejecuta antes de cada entrega. La batería
> completa son **46 controles** y hoy pasan los 46.
>
> Última ejecución: sobre la versión con Correo, Feed, Bases de conocimiento,
> tiempo real por WebSocket y compresión de imágenes.

---

## El criterio

Ninguna aplicación es inatacable, y prometer lo contrario sería mentir. Lo que
sí se puede hacer es **no dejar puertas fáciles**, y sobre todo diseñar de
manera que clases enteras de ataque no tengan por dónde entrar, en vez de
taparlas una por una.

Esa es la diferencia entre *mitigar* y *eliminar*, y aparece tres veces en esta
plataforma:

| Problema | Solución habitual (mitigar) | Lo que se hizo (eliminar) |
|---|---|---|
| XSS en contenido con formato | Guardar HTML y limpiarlo con una lista de permitidos | **No se guarda HTML.** El contenido son bloques con estructura conocida y el marcado lo arma el cliente escapando cada texto |
| Suscribirse a datos ajenos por WebSocket | Validar cada suscripción que pide el cliente | **No existe la suscripción.** El servidor calcula quién puede recibir cada evento y emite solo a esos |
| Ejecución desde un correo HTML | Confiar en que el sanitizador no tenga agujeros | **`iframe` sin `allow-scripts`.** La garantía la da el navegador, no el código |

En los tres casos, aunque hubiera un error en el código de limpieza, no habría
ejecución. Eso es lo que se busca en cada decisión.

---

## A · Autenticación y sesión

| Control | Cómo | Verificado |
|---|---|---|
| Contraseñas | bcrypt con sal por usuario. **Nunca se guardan reversibles** | La lista de usuarios no devuelve ningún hash |
| Sesión | Token opaco aleatorio; en la base solo vive su **hash SHA-256**. Un volcado de la base no permite suplantar a nadie | Token inventado → 401 |
| Cookie | `httpOnly` (JavaScript no la lee) + `SameSite=Strict` (no viaja desde otro sitio, lo que cierra el CSRF) + `Secure` cuando hay HTTPS | Comprobado en la cabecera `Set-Cookie` |
| Enumeración de usuarios | El mismo mensaje exista o no la cuenta | Los dos errores son idénticos |
| Fijación de sesión | Cada login emite un token nuevo | Dos logins seguidos → tokens distintos |
| Cierre de sesión | El token se borra del servidor, no solo del navegador | El token guardado deja de servir |
| Fuerza bruta | 10 intentos por IP cada 5 minutos | Se bloquea con 429 |
| Expiración | La sesión caduca y se renueva sola mientras se usa | — |

> **Detrás de un proxy hay que poner `TRUST_PROXY=true`.** Si no, el límite de
> intentos cuenta a toda la empresa como una sola IP y la undécima persona que
> entra queda bloqueada con la contraseña correcta. Está documentado en
> [deployment-empresa.md](deployment-empresa.md).

---

## B · Permisos y escalada de privilegios

Tres rangos: **Administrador**, **Supervisor** y **User**. Todo se valida en el
servidor: ocultar un botón no es un permiso.

| Control | Verificado |
|---|---|
| Un rango User no puede promoverse | 403 |
| Los endpoints de Administrador rechazan al resto | 5 de 5 probados → 403 |
| Un rango User no crea catálogos ni publica | 5 de 5 probados → 403 |
| No se puede forzar el autor de un ticket | El servidor lo pone, no el cliente |
| No se puede forzar código, estado ni identificador | Los campos que manda el cliente se descartan |

**Asignación masiva:** los esquemas de validación descartan cualquier campo que
no esté declarado. Mandar `role`, `createdById` o `id` en el cuerpo no tiene
efecto — se probó explícitamente.

---

## C · Acceso a datos ajenos (IDOR)

Es la falla más común en aplicaciones con roles: cambiar un identificador en la
URL y ver lo de otro. Se probó en cada módulo.

| Control | Verificado |
|---|---|
| Ticket de otra persona | 403 al leer y al modificar |
| Conversación ajena | 403 al leer y al escribir |
| **Un Administrador que no participa de un chat** | 403 — decisión de diseño: administra la plataforma, no lee las conversaciones |
| Adjunto ajeno | 403 |
| Publicación dirigida a otro sector | 403 en listar, abrir, comentar y reaccionar |
| Base de conocimiento sin permiso | **404, no 403** — quien no tiene acceso no debería poder deducir que existe probando identificadores |
| Casilla de correo ajena | 403 |
| Identificador inexistente | 404, sin revelar nada |

---

## D · Inyección y contenido

| Vector | Cómo se cierra | Verificado |
|---|---|---|
| SQL | Prisma parametriza todas las consultas; no hay SQL armado por concatenación | 3 cargas clásicas: no rompen ni alteran nada |
| XSS en la interfaz | Todo texto de usuario pasa por `esc()`. No hay un solo `innerHTML` con contenido de persona | El marcado vuelve literal, no se ejecuta |
| XSS en contenido con formato | **No se guarda HTML**: bloques con estructura conocida | Tipo de bloque inventado → 400 |
| XSS al pegar desde Excel | Del HTML pegado se extraen **solo** filas y celdas, leyendo `textContent` sobre un documento inerte | Tabla con marcado malicioso → se pega solo el texto |
| Enlaces `javascript:`, `data:`, `vbscript:` | Solo se admite `http://` y `https://`, validado en el servidor **y otra vez** al renderizar | Los tres rechazados con 400 |
| Path traversal en adjuntos | El nombre en disco lo genera el servidor (UUID). El nombre original **nunca** llega al sistema de archivos | `../../../etc/passwd.csv` → guardado con nombre generado |
| Archivo disfrazado | Se leen los **bytes reales** del archivo, no la extensión ni lo que declara el navegador | HTML renombrado `.png` → rechazado |
| Ejecutable subido como documento | Lista blanca de tipos, comprobada por firma binaria | Rechazado |

---

## E · Cabeceras y transporte

| Cabecera | Estado |
|---|---|
| `Content-Security-Policy` | Presente, con `script-src 'self'` — sin scripts externos ni inline |
| `X-Content-Type-Options: nosniff` | Presente |
| `X-Frame-Options` | Presente — la plataforma no se puede embeber en otro sitio |
| `Referrer-Policy: no-referrer` | Presente |
| `Cross-Origin-Resource-Policy` | Presente |
| `X-Powered-By` | **Ausente** — no se revela con qué está hecha |
| HSTS y `upgrade-insecure-requests` | Solo cuando hay HTTPS real (`COOKIE_SECURE=true`); activarlos sobre HTTP simple rompería la carga |

---

## F · Límites de tráfico

Cuatro capas, cada una con su motivo:

| Qué | Límite | Por qué |
|---|---|---|
| Login | 10 por IP cada 5 min | Fuerza bruta |
| Mensajes de chat | 30 por persona por minuto | Flood |
| **Mensajes por WebSocket** | 30 por persona por minuto | `express-rate-limit` es middleware HTTP y **no ve un byte** del socket; sin este límite, mandar por socket sería la forma de esquivarlo |
| Frames de WebSocket | 240 por persona por minuto | Un cliente enloquecido no consume CPU del servidor |
| Subida de archivos | 40 por persona cada 10 min | Cada subida consume disco, no solo CPU |
| Operaciones de correo | 90 por persona por minuto | Cada una abre una conexión a un servidor de afuera |
| **Envío de correo** | 30 por persona cada 10 min | Un envío masivo deja la casilla de la empresa marcada como spam en todos lados |
| Resto de la API | 600 por persona cada 5 min | Red de contención general |

---

## G · Tiempo real (WebSocket)

El WebSocket es una superficie aparte: **por ahí no pasa ningún middleware de
Express**, así que nada de lo anterior se hereda. Todo está reimplementado.

| Control | Verificado |
|---|---|
| Conectarse sin sesión | Sin cookie → 401; cookie inventada → 401; otra ruta → 404 |
| Recibir datos ajenos | **El cliente no puede suscribirse a nada.** El servidor calcula la audiencia contra la base y emite solo a esos usuarios | Con 4 usuarios en paralelo: un Supervisor no recibe chats ajenos, un rango User no recibe tickets de otro |
| Escribir donde no corresponde | Pasa por el **mismo service** que el endpoint HTTP | Intento desde un cliente manipulado → rechazado |
| Seguir conectado tras cerrar sesión | El logout corta ese socket en el acto (las otras sesiones del mismo usuario siguen) | Cierre inmediato, código 4001 |
| Seguir conectado tras ser desactivado | Desactivar, eliminar o cambiar la contraseña corta **todas** sus conexiones | Cierre inmediato |
| Sesión que caduca con el socket abierto | El heartbeat revalida contra la base cada 30 s, sin depender de que algún camino de código avise | Sesión borrada por SQL directo → socket cerrado en menos de 40 s |
| Agotar memoria | `maxPayload` de 64 KB y techo de 400 conexiones | Frame de 200 KB → conexión cortada |
| Conexiones fantasma | Ping/pong cada 30 s del servidor + sonda de vida en el cliente | Con la red caída el navegador deja el socket en `OPEN`: la sonda lo detecta |

---

## H · Correo

La función que más cambia el perfil de riesgo, y por eso la que más controles
tiene. **No abre ningún puerto ni recibe correo de internet**: se conecta hacia
afuera al proveedor, como cualquier programa de correo de escritorio.

| Riesgo | Cómo se cierra | Verificado |
|---|---|---|
| Guardar contraseñas de casilla | AES-256-GCM con la clave en el `.env`, **nunca en la base**. GCM además autentica: si alguien edita el cifrado, el descifrado falla en vez de devolver basura. Cada cifrado con su propio nonce | Sin la clave, el correo queda **desactivado** — falla cerrado, sin clave por defecto |
| Usar la plataforma para sondear la red (SSRF) | Se **resuelve el nombre** antes de conectar: no alcanza con mirar el texto, `correo.empresa.com` puede resolver a `127.0.0.1`. Se rechazan direcciones privadas, loopback y enlace local. Se revalida **en cada conexión**, no solo al guardar | 7 rangos internos rechazados, incluida `169.254.169.254` (metadatos de nube) |
| Apuntar a algo que no es correo | Puertos limitados a los de IMAP/SMTP | 22, 80, 3306, 5432 y 6379 rechazados |
| Servidor interno legítimo | Se habilita con una casilla explícita que marca un Administrador | Decisión consciente, no accidente |
| Que cualquiera configure servidores | Exclusivo del Administrador | 403 para el resto |
| Que un Administrador lea correo ajeno | El acceso es del dueño de la casilla, o de quien tenga acceso si es compartida | Mismo criterio que el chat |
| Ejecutar código desde un correo HTML | `iframe sandbox` **sin `allow-scripts`** + CSP propia + limpieza previa | El navegador registra `Blocked script execution in 'about:srcdoc'` |
| Píxeles de seguimiento | Imágenes remotas bloqueadas por defecto | Delatan que se abrió el correo, la IP y la hora |
| Malware en un adjunto | Siempre se descargan, nunca se muestran en la página, y con `nosniff` | — |
| Filtrar credenciales | Ninguna respuesta devuelve la contraseña ni el cifrado; en los registros la dirección va enmascarada | Verificado buscando en las respuestas |

---

## I · Negación de servicio y consumo

| Control | Verificado |
|---|---|
| Cuerpo de petición enorme | 413 |
| Demasiados bloques de contenido | 400 (tope de 60) |
| Tabla desmedida | 400 (tope de 200 filas × 12 columnas) |
| Archivo demasiado grande | 10 MB por archivo, 5 por vez |
| Disco por imágenes | Se comprimen en el navegador: **11 veces menos** |
| Adjuntos que quedaron sueltos | Se borran solos a las 24 h |
| Conexiones de correo abiertas | Techo de 30, se cierran a los 90 s de ocio |
| Conexiones de tiempo real | Techo de 400 |

---

## J · Infraestructura

| Control | Estado |
|---|---|
| Contenedor de la aplicación | Usuario **no root**, sistema de archivos **de solo lectura**, `no-new-privileges` |
| Base de datos | No expone puerto hacia afuera: solo la alcanza la aplicación por la red interna de Docker |
| Secretos | En el `.env`, que está fuera del repositorio (verificado) |
| Versiones | Node, PostgreSQL y las imágenes están **fijadas**: actualizar es una decisión, no un efecto colateral |
| Dependencias | `npm audit` en **0 vulnerabilidades**. Se verifican también las licencias antes de sumar una librería |

---

## Lo que NO cubre esta auditoría

Ser honesto sobre los límites es parte de la seguridad:

- **La red donde corre.** Si alguien ya está dentro de la red interna y puede
  ver el tráfico, un despliegue sin HTTPS es legible. Para eso está el
  [reverse proxy con certificado](deployment-empresa.md).
- **Los equipos de los usuarios.** Una sesión abierta en una PC sin bloqueo de
  pantalla es una sesión disponible para quien pase.
- **Las contraseñas que elige la gente.** El sistema exige un mínimo, no lee la
  mente.
- **Quien tiene acceso legítimo.** Un Administrador puede hacer daño; para eso
  está el historial de cambios, no la prevención.
- **Las copias de seguridad.** Son volcados en texto plano. Con el `.env` al
  lado, permiten descifrar las credenciales de correo. Hay que guardarlas con
  el mismo cuidado que el servidor.
- **Auditorías externas.** Esto lo escribió y lo probó quien construyó la
  plataforma. Una revisión independiente vería cosas distintas.

---

## Cómo se vuelve a correr

La batería está automatizada y se ejecuta antes de cada entrega, junto con el
resto de las pruebas. No es un documento que se escribe una vez: es una salida
que se regenera.
