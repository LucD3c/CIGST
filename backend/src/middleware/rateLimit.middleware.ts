import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// Freno de flood en el inicio de sesion, por direccion de red.
//
// Ojo con este limite: antes contaba TODOS los pedidos de login, incluidos los
// que salian bien, con un tope de 10 cada 5 minutos por IP. En una oficina
// donde todos salen por el mismo router -o detras de un proxy inverso- eso
// significa que la persona numero 11 que llega a la manania no puede entrar,
// aunque escriba bien su contrasena. Se detecto en la prueba de carga: de 70
// ingresos simultaneos entraban 10 y los otros 60 recibian un 429.
//
// Correccion: los ingresos EXITOSOS ya no consumen presupuesto
// (skipSuccessfulRequests). Solo cuentan los fallidos, que son los unicos que
// tiene sentido limitar. El tope se sube a 30 fallos, porque este limitador es
// apenas un cortafuegos contra un flood: la defensa real contra fuerza bruta es
// el freno por cuenta guardado en la base de datos (auth.intentos.ts), que
// bloquea a los 8 fallos de una misma cuenta y sobrevive a los reinicios.
export const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  // 200 es a proposito un numero alto: este limitador quedo reducido a un
  // cortafuegos contra una inundacion de pedidos, NO es la defensa contra
  // fuerza bruta. Cuenta al entrar el pedido y descuenta al salir, asi que una
  // rafaga simultanea legitima -setenta personas entrando a las 8 de la
  // maniana, o un solo navegador reintentando- lo dispara aunque todas las
  // contrasenas sean correctas. Eso fue exactamente lo que paso en la prueba
  // de carga.
  //
  // La defensa REAL contra fuerza bruta vive en auth.intentos.ts, contra la
  // base de datos, y es mas estricta de lo que era esto:
  //   - 8 fallos sobre una misma cuenta la bloquean 15 minutos, venga el
  //     ataque de donde venga (antes no habia ningun limite por cuenta);
  //   - 30 fallos desde una misma direccion de red la bloquean 15 minutos;
  //   - y ninguno de los dos se borra al reiniciar el contenedor, cosa que
  //     antes alcanzaba para poner los contadores en cero.
  limit: 200,
  skipSuccessfulRequests: true,
  // Solo cuenta una contrasena equivocada (401). Sin esto, los propios 429 del
  // limitador se contaban como fallos y realimentaban el bloqueo: una vez
  // disparado, cada reintento lo estiraba y no se soltaba mas. Un 400 por un
  // formulario mal armado o un 503 de la base tampoco tienen por que gastar el
  // presupuesto de nadie.
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos desde esta red. Esperá unos minutos e intentá nuevamente.' },
});

// Limita el envio de mensajes de chat por usuario (no por IP: varios
// empleados de la misma oficina comparten salida a internet). Generoso para
// una conversacion real, suficiente para frenar un flood/script.
export const chatMessageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Estás enviando mensajes demasiado rápido. Esperá unos segundos e intentá nuevamente.' },
});

// Subida de archivos: mas acotado que el limite general porque cada pedido
// consume disco, no solo CPU. 40 subidas por usuario cada 10 minutos cubre
// de sobra el uso real (adjuntar unas capturas a un ticket o a un chat) y
// frena que un script llene el volumen de uploads.
export const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Estás subiendo archivos demasiado rápido. Esperá unos minutos e intentá nuevamente.' },
});

// Defensa en profundidad para el resto de la API: no reemplaza a los limites
// especificos de arriba (login, chat), es una red de contencion general para
// que ninguna cuenta -sea por script, error de cliente o mal uso- pueda
// saturar el servidor a fuerza de pedidos. El limite es generoso a proposito:
// la navegacion habitual queda comoda muy por debajo. Ojo: NO cubre el
// WebSocket, que no pasa por middleware de Express — ese trafico lo limita
// `realtime/realtime.rateLimit.ts`.
export const apiRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Demasiadas solicitudes. Esperá unos minutos e intentá nuevamente.' },
});
