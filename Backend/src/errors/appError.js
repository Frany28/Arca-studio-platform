import { isDatabaseUnavailableError } from "../config/databaseErrors.js";

export class AppError extends Error {
    /**
   * Inicializa el error de aplicación con su contrato público y causa original.
   * Conserva código, estado y campos para que el middleware construya la respuesta.
   *
   * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
   * @param {string} options.code - Valor de `options.code` requerido por esta operación.
   * @param {unknown} options.fields - Valor de `options.fields` requerido por esta operación.
   * @param {unknown} options.message - Valor de `options.message` requerido por esta operación.
   * @param {unknown} [options.status] - Valor de `options.status` requerido por esta operación.
   * @param {unknown} options.cause - Valor de `options.cause` requerido por esta operación.
   */
constructor({ code, fields, message, status = 500, cause }) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.fields = fields;
    this.status = status;
    this.publicMessage = message;
  }
}

export class ValidationError extends AppError {
    /**
   * Inicializa el error de aplicación con su contrato público y causa original.
   * Conserva código, estado y campos para que el middleware construya la respuesta.
   *
   * @param {unknown} [message] - Valor de `message` requerido por esta operación.
   * @param {unknown} fields - Valor de `fields` requerido por esta operación.
   */
constructor(message = "Los datos enviados no son válidos.", fields) {
    super({ code: "VALIDATION_ERROR", fields, message, status: 400 });
  }
}

export class NotFoundError extends AppError {
    /**
   * Inicializa el error de aplicación con su contrato público y causa original.
   * Conserva código, estado y campos para que el middleware construya la respuesta.
   *
   * @param {string} code - Valor de `code` requerido por esta operación.
   * @param {unknown} message - Valor de `message` requerido por esta operación.
   */
constructor(code, message) { super({ code, message, status: 404 }); }
}

export class ConflictError extends AppError {
    /**
   * Inicializa el error de aplicación con su contrato público y causa original.
   * Conserva código, estado y campos para que el middleware construya la respuesta.
   *
   * @param {string} code - Valor de `code` requerido por esta operación.
   * @param {unknown} message - Valor de `message` requerido por esta operación.
   * @param {Error} cause - Valor de `cause` requerido por esta operación.
   */
constructor(code, message, cause) { super({ code, message, status: 409, cause }); }
}

/**
 * Segundos que se indican en Retry-After cuando la base está saturada (P1-2).
 * Se lee al usarse y tolera la ausencia de `process`: el frontend importa este módulo a través de
 * los dominios compartidos (por ejemplo, quoteTotals.js) y en el navegador no existe `process`.
 *
 * @returns {number} Segundos de espera sugeridos.
 */
function databaseRetryAfterSeconds() {
  const configured = Number(globalThis.process?.env?.DATABASE_RETRY_AFTER_SECONDS);
  return configured > 0 ? Math.ceil(configured) : 5;
}

/**
 * Crea la respuesta controlada de saturación: 503 con Retry-After, sin detalles internos.
 * Mismo formato que el 503 del rate limiter (`code`, `message`, `retryAfter`).
 *
 * @param {Error} cause - Error original, conservado para los registros.
 * @returns {AppError} Error 503 con `retryAfter` en segundos.
 */
function createDatabaseUnavailableError(cause) {
  const error = new AppError({
    cause,
    code: "DATABASE_UNAVAILABLE",
    message: "El servicio está temporalmente saturado. Intenta de nuevo en unos segundos.",
    status: 503,
  });
  error.retryAfter = databaseRetryAfterSeconds();
  return error;
}

/**
 * Normaliza el valor de error para mantener un formato interno consistente.
 * Preserva el contrato de error que procesa el middleware global.
 *
 * @param {Error} error - Error que debe evaluarse o traducirse.
 * @returns {unknown} Resultado producido por la operación.
 */
export function normalizeError(error) {
  if (error instanceof AppError) return error;
  if (isDatabaseUnavailableError(error)) return createDatabaseUnavailableError(error);
  if (error?.status && error?.publicMessage) return new AppError({ code: error.code || "REQUEST_ERROR", message: error.publicMessage, status: error.status, cause: error });
  if (error?.code === "23505") return new ConflictError("RESOURCE_CONFLICT", "El recurso ya existe o fue modificado simultáneamente.", error);
  if (error?.type === "entity.too.large") return new AppError({ code: "PAYLOAD_TOO_LARGE", message: "El contenido supera el tamaño permitido.", status: 413, cause: error });
  return new AppError({ code: error?.code || "INTERNAL_SERVER_ERROR", message: "Ocurrió un error inesperado.", status: error?.status || 500, cause: error });
}
