import { AppError, ConflictError, ValidationError } from "../errors/appError.js";

/*
 * Traducción de errores de PostgreSQL de las cotizaciones a errores de aplicación. Las
 * restricciones de la migración quotes son la última barrera ante carreras (dos ediciones
 * simultáneas, un servicio o proyecto eliminado entre la validación y la escritura); aquí se
 * convierten en respuestas controladas sin exponer mensajes internos de PostgreSQL.
 */

export const QUOTE_VERSION_CONFLICT_MESSAGE =
  "Otro administrador modificó esta cotización. Recarga los datos antes de guardar.";

const VERSION_UNIQUE_CONSTRAINTS = new Set(["uq_quote_versions_current", "uq_quote_versions_quote_version"]);
const FOREIGN_KEY_FIELDS = Object.freeze({
  fk_quote_items_service: "items",
  fk_quote_items_service_version: "items",
  fk_quote_versions_client: "clientId",
  fk_quote_versions_project: "projectId",
});

/**
 * Convierte un error ocurrido durante una operación de cotizaciones en un error de aplicación.
 * Los errores de aplicación se devuelven sin cambios; los códigos PostgreSQL conocidos se
 * traducen y cualquier otro se propaga para que el middleware responda con un 500 genérico.
 *
 * @param {Error & { code?: string, constraint?: string }} error - Error capturado.
 * @returns {Error} Error de aplicación equivalente o el error original.
 */
export function translateQuoteError(error) {
  if (error instanceof AppError) return error;

  switch (error?.code) {
    case "23505":
      if (VERSION_UNIQUE_CONSTRAINTS.has(error.constraint)) {
        return new ConflictError("QUOTE_VERSION_CONFLICT", QUOTE_VERSION_CONFLICT_MESSAGE, error);
      }
      if (error.constraint === "uq_quote_items_version_service") {
        return new ValidationError(undefined, { items: "Cada servicio solo puede incluirse una vez." });
      }
      return new ConflictError("QUOTE_CONFLICT", "La cotización entra en conflicto con un registro existente.", error);
    case "23503":
      if (FOREIGN_KEY_FIELDS[error.constraint]) {
        return new ValidationError(undefined, { [FOREIGN_KEY_FIELDS[error.constraint]]: "Una referencia de la cotización ya no existe." });
      }
      return new ConflictError("QUOTE_REFERENCE_CONFLICT", "Una referencia de la cotización ya no está disponible.", error);
    case "23514":
      return new ValidationError("Los datos de la cotización no cumplen las reglas de cálculo.");
    case "55000":
      return new ConflictError("QUOTE_HISTORY_IMMUTABLE", "Las versiones registradas de una cotización no se pueden modificar.", error);
    case "40001":
    case "40P01":
      return new ConflictError("QUOTE_CONCURRENT_UPDATE", "La cotización se está modificando en este momento. Inténtalo de nuevo.", error);
    default:
      return error;
  }
}
