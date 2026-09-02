export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, details);
  }

  static unauthorized(message = 'No autenticado.') {
    return new HttpError(401, message);
  }

  static forbidden(message = 'No autorizado para esta acción.') {
    return new HttpError(403, message);
  }

  static notFound(message = 'Recurso no encontrado.') {
    return new HttpError(404, message);
  }

  // 429: se usa para el freno de fuerza bruta que vive en la base de datos.
  static tooManyRequests(message: string) {
    return new HttpError(429, message);
  }

  static conflict(message: string) {
    return new HttpError(409, message);
  }
}
