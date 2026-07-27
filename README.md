# CIGST — Centro Integral de Gestión de Soporte Técnico

Plataforma interna para gestionar el soporte técnico de una empresa:
tickets, personas, equipamiento con historial de cambios, sectores, chat
interno con grupos y notificaciones — todo en un solo lugar, corriendo
**100% dentro de la red de la empresa**, sin depender de internet ni de
servicios externos.

![Centro de operaciones de CIGST](docs/img/centro-de-operaciones.png)

## Instalación en 3 pasos

1. **Descargar el proyecto** (clonar el repositorio o bajar el ZIP y
   descomprimirlo).
2. **Ejecutar el instalador**:
   - **Windows**: doble click en `install.bat`
   - **Linux / Mac**: en una terminal, `./install.sh`
3. **Elegir la opción 1** del menú y responder las preguntas (o apretar
   Enter para usar valores seguros por defecto). Al terminar, el instalador
   muestra la dirección para entrar, por ejemplo: `http://localhost:3000`

El mismo menú sirve después para el día a día: ver el estado, ver los logs,
reiniciar, detener o resetear la plataforma.

```
   1) Instalar / iniciar la plataforma
   2) Ver estado de los servicios
   3) Ver logs en vivo
   4) Reiniciar servicios
   5) Detener la plataforma
   6) Resetear todo (borra los datos)
   7) Salir
```

## Requisitos

Lo único que hace falta tener instalado es **Docker**:

- **Windows**: [Docker Desktop](https://www.docker.com/products/docker-desktop)
  — requiere Windows 10/11 de 64 bits con WSL2 (el instalador de Docker lo
  configura solo).
- **Linux**: Docker Engine — el instalador de CIGST ofrece instalarlo por
  vos (usa el script oficial de Docker), o podés hacerlo a mano siguiendo
  [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
- **Mac**: [Docker Desktop](https://www.docker.com/products/docker-desktop).

**No hace falta instalar nada más.** Ni Node.js, ni PostgreSQL, ni ninguna
otra dependencia: todo corre encapsulado dentro de Docker, sin tocar el
sistema operativo más allá de eso. Internet solo se usa una vez, durante la
instalación, para descargar las piezas; después la plataforma funciona
completamente offline dentro de la red interna.

## Primer ingreso

- Usuario: `admin`
- Contraseña: la que elegiste durante la instalación (o la generada
  automáticamente, guardada en el archivo `.env` de esta carpeta).

La plataforma arranca con un caso de ejemplo cargado (una persona, un
equipo, un ticket y un chat) para que puedas probar todo el circuito
enseguida.

## Problemas comunes

| Síntoma | Qué hacer |
| --- | --- |
| Docker Desktop no arranca (Windows) | Verificar que la virtualización esté activada en la BIOS/UEFI y que WSL2 esté habilitado. |
| `docker: permission denied` (Linux) | Cerrar sesión y volver a entrar después de instalar Docker (tu usuario entra al grupo `docker` recién ahí). |
| "El puerto ya está ocupado" | Editar `APP_PORT` en el archivo `.env` (por ejemplo `3001`) y volver a la opción 1 del menú. |
| Cualquier otro error del instalador | El detalle técnico completo queda en `install.log`, en esta misma carpeta. |

## Documentación

- **[Manual de uso](docs/guia-usuario.md)** — cómo se usa la plataforma
  día a día, paso a paso y con capturas de pantalla, pensado para cualquier
  persona (también disponible en [PDF](docs/Manual-de-uso-CIGST.pdf)).
- **[Arquitectura técnica](docs/arquitectura.md)** — stack, estructura del
  código, decisiones de diseño y notas de API.
- **[Modelo de datos](docs/base-de-datos.md)** — entidades, convenciones y
  cómo trabajar con migraciones.
- **[Seguridad](docs/seguridad.md)** — sesiones, permisos por rol,
  privacidad del chat, salud de dependencias y licencias.
