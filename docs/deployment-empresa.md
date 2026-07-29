# Puesta en producción en una empresa

> Documento para quien administra la infraestructura. Para instalar CIGST en un
> equipo tal cual viene, alcanza con [`instaladores.md`](instaladores.md): esto
> es lo adicional cuando se lo pone **detrás de un reverse proxy**.

CIGST funciona sin proxy: `docker compose up -d` deja la plataforma escuchando
en el puerto 3000 y con eso ya opera dentro de la red interna. El proxy se
agrega cuando se quiere HTTPS con certificado propio, un nombre lindo
(`soporte.empresa.local` en vez de `10.0.0.15:3000`) o publicar varias
aplicaciones en el mismo servidor.

---

## Lo primero: el WebSocket

Desde la versión con **tiempo real**, la plataforma abre una conexión
WebSocket en `/ws`. Los mensajes del chat, los cambios de estado de los tickets
y las notificaciones viajan por ahí.

> **Un proxy configurado "normal" corta esa conexión sin avisar.** No aparece
> un error rojo en pantalla: la plataforma se ve bien, se navega bien, pero los
> mensajes dejan de llegar solos y hay que recargar para ver novedades. Es el
> síntoma más difícil de diagnosticar, porque *todo lo demás funciona*.

El motivo es que un WebSocket empieza como un pedido HTTP común que pide
"ascender" a otro protocolo, con dos cabeceras: `Upgrade: websocket` y
`Connection: Upgrade`. `proxy_pass` **no las reenvía por defecto** — las
descarta, como hace con cualquier cabecera hop-by-hop. Sin ellas, el backend
nunca ve un pedido de upgrade y la conexión se queda en un HTTP común que
termina cerrándose.

---

## Configuración de nginx que sí funciona

```nginx
# Traduce el valor de Upgrade que manda el navegador al que hay que reenviar.
# Sin este mapa habría que reenviar "Connection: upgrade" siempre, y eso rompe
# los pedidos HTTP normales que comparten la misma conexión keep-alive.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream cigst {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 443 ssl;
    server_name soporte.empresa.local;

    ssl_certificate     /etc/nginx/ssl/soporte.crt;
    ssl_certificate_key /etc/nginx/ssl/soporte.key;

    # ---- Tiempo real: la conexión del chat y los tickets ----
    location /ws {
        proxy_pass http://cigst;
        proxy_http_version 1.1;

        # LAS DOS LÍNEAS IMPRESCINDIBLES. Sin ellas el socket no se establece.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Un WebSocket está callado la mayor parte del tiempo. Con el timeout
        # por defecto (60 s) nginx corta la conexión cada minuto y el navegador
        # reconecta una y otra vez. El servidor manda su propio ping cada 30 s,
        # así que 1 hora es holgado y las conexiones muertas igual se limpian.
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }

    # ---- Resto de la aplicación ----
    location / {
        proxy_pass http://cigst;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Los adjuntos son de hasta 10 MB, hasta 5 por vez. El límite por
        # defecto de nginx es 1 MB y rechaza la subida con un 413.
        client_max_body_size 60m;
    }
}

# Redirección de HTTP a HTTPS (opcional).
server {
    listen 80;
    server_name soporte.empresa.local;
    return 301 https://$host$request_uri;
}
```

### Comprobar que el WebSocket pasa

Desde cualquier equipo de la red, con la plataforma abierta: **F12 → pestaña
Red → filtro WS**. Tiene que aparecer una conexión a `/ws` con estado **101
Switching Protocols**. Si figura `200`, `400` o `502`, el proxy no está
reenviando el upgrade.

Desde la línea de comandos:

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://soporte.empresa.local/ws
```

- `HTTP/1.1 401 Unauthorized` → **el proxy está bien**. El 401 es correcto:
  falta la cookie de sesión, que es justamente lo que valida el servidor.
- `HTTP/1.1 200 OK` o una página HTML → el proxy **no** reenvía el upgrade:
  faltan las dos líneas `proxy_set_header`.
- `502 Bad Gateway` → el proxy no llega al backend (revisar el `upstream`).

---

## Con HTTPS: dos ajustes obligatorios

### 1. `COOKIE_SECURE=true` en el `.env`

Marca la cookie de sesión como `Secure` y activa HSTS. Sin esto la cookie viaja
también por HTTP.

> Al revés es igual de importante: **si NO hay HTTPS, `COOKIE_SECURE` tiene que
> quedar en `false`**. Con `true` sobre HTTP el navegador descarta la cookie y
> nadie puede iniciar sesión.

El cliente elige el esquema del socket solo (`wss://` sobre HTTPS, `ws://`
sobre HTTP): no hay nada que configurar de ese lado.

### 2. `TRUST_PROXY=true`

**Esto es importante y es fácil de pasar por alto.** Sin ello, Express ve todos
los pedidos como si vinieran de una sola IP: la del proxy.

Los límites de tráfico que protegen el login se cuentan **por IP**: 10 intentos
cada 5 minutos. Detrás de un proxy mal configurado, esos 10 intentos se
reparten entre *toda la empresa* — la undécima persona que entra a la mañana
queda bloqueada aunque haya escrito bien su contraseña, y en el registro figura
la IP del proxy en vez de la del equipo real.

Con `TRUST_PROXY=true`, Express lee `X-Forwarded-For` (que el bloque de arriba ya
manda) y cada usuario vuelve a contar por separado.

```env
COOKIE_SECURE=true
TRUST_PROXY=true
```

> `TRUST_PROXY=true` **sin** un proxy real delante es un riesgo al revés:
> cualquiera podría mandar una cabecera `X-Forwarded-For` inventada y evadir el
> límite de intentos de login. Se activa cuando el proxy existe, no antes.

---

## Apache, en vez de nginx

```apache
<VirtualHost *:443>
    ServerName soporte.empresa.local

    SSLEngine on
    SSLCertificateFile    /etc/ssl/certs/soporte.crt
    SSLCertificateKeyFile /etc/ssl/private/soporte.key

    # Requiere: a2enmod proxy proxy_http proxy_wstunnel rewrite
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule ^/ws(.*) ws://127.0.0.1:3000/ws$1 [P,L]

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    RequestHeader set X-Forwarded-Proto "https"
    LimitRequestBody 62914560
</VirtualHost>
```

El módulo `proxy_wstunnel` es el equivalente de las dos cabeceras de nginx: sin
él, Apache tampoco reenvía el upgrade.

---

## Cuántos usuarios aguanta

Medido con 50 conexiones simultáneas y tráfico real de chat y tickets, sobre el
contenedor tal como se distribuye:

| | |
|---|---|
| Conexiones abiertas | 50 de 50, en 198 ms |
| Entrega de un mensaje | 15 ms promedio, 23 ms máximo |
| CPU en régimen | por debajo del 2 % |
| RAM del contenedor | 41 MB |
| Errores en el registro | ninguno |

El diseño es de **un solo proceso Node**, y a esta escala eso sobra: no hace
falta Redis ni un broker de mensajes para compartir estado entre instancias,
porque no hay varias instancias. El techo por configuración son 400 conexiones
simultáneas (`MAX_CONNECTIONS` en `realtime.server.ts`).

Si alguna vez hiciera falta correr **más de una instancia** detrás del proxy,
ahí sí habría que cambiar dos cosas: fijar la sesión al mismo proceso
(`ip_hash` en nginx) o mover el registro de conexiones a algo compartido. No es
el caso hoy y agregarlo ahora sería complejidad sin uso.

---

## Cosas que se rompen y no son obvias

| Síntoma | Causa | Solución |
|---|---|---|
| Todo anda pero los mensajes no llegan solos | El proxy no reenvía el upgrade | Las dos líneas `proxy_set_header` de arriba |
| El chat se corta y reconecta cada minuto | `proxy_read_timeout` por defecto (60 s) | Subirlo a `3600s` |
| Nadie puede iniciar sesión | `COOKIE_SECURE=true` sin HTTPS | Ponerlo en `false`, o terminar de configurar el certificado |
| "Demasiados intentos" para gente que nunca falló | Falta `TRUST_PROXY=true` | Agregarlo al `.env` |
| Los adjuntos fallan con 413 | `client_max_body_size` por defecto (1 MB) | `client_max_body_size 60m` |
| El socket abre y cierra en bucle | Dos instancias detrás del proxy sin `ip_hash` | Dejar una sola instancia |
