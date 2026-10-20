import { AppError, ConflictError, ValidationError } from "../errors/appError.js";

/*
 * Traducción de errores de PostgreSQL del catálogo de servicios a errores de aplicación.
 * Las restricciones de la migración service_catalog son la última barrera ante carreras
 * (dos altas con el mismo código, dos ediciones simultáneas); aquí se convierten en
 * respuestas controladas sin exponer mensajes internos de PostgreSQL.
 */

export const SERVICE_VERSION_CONFLICT_MESSAGE =
  "Otro administrador modificó este servicio. Recarga los datos antes de guardar.";

const UNIT_FOREIGN_KEYS = new Set(["fk_services_measurement_unit", "fk_service_versions_measurement_unit"]);
const VERSION_UNIQUE_CONSTRAINTS = new Set(["uq_service_versions_current", "uq_service_versions_service_version"]);

/**
 * Convierte un error ocurrido durante una operación del catálogo en un error de aplicación.
 * Los errores de aplicación se devuelven sin cambios; los códigos PostgreSQL conocidos se
 * traducen y cualquier otro se propaga para que el middleware responda con un 500 genérico.
 *
 * @param {Error & { code?: string, constraint?: string }} error - Error capturado.
 * @returns {Error} Error de aplicación equivalente o el error original.
 */
export function translateServiceCatalogError(error) {
  if (error instanceof AppError) return error;

  switch (error?.code) {
    case "23505":
      if (error.constraint === "uq_services_code") {
        return new ConflictError("SERVICE_CODE_ALREADY_EXISTS", "Ya existe un servicio con ese código.", error);
      }
      if (VERSION_UNIQUE_CONSTRAINTS.has(error.constraint)) {
        return new ConflictError("SERVICE_VERSION_CONFLICT", SERVICE_VERSION_CONFLICT_MESSAGE, error);
      }
      return new ConflictError("SERVICE_CONFLICT", "El servicio entra en conflicto con un registro existente.", error);
    case "23503":
      if (UNIT_FOREIGN_KEYS.has(error.constraint)) {
        return new ValidationError(undefined, { measurementUnitId: "La unidad de medida no existe." });
      }
      return new ConflictError("SERVICE_REFERENCE_CONFLICT", "Una referencia del servicio ya no está disponible.", error);
    case "23001":
      return new ConflictError("SERVICE_REFERENCE_CONFLICT", "El servicio o su unidad tienen referencias que impiden la operación.", error);
    case "23514":
      return new ValidationError("Los datos del servicio no cumplen las reglas del catálogo.");
    case "55000":
      return new ConflictError("SERVICE_HISTORY_IMMUTABLE", "Las versiones registradas de un servicio no se pueden modificar.", error);
    case "40001":
    case "40P01":
      return new ConflictError("SERVICE_CONCURRENT_UPDATE", "El servicio se está modificando en este momento. Inténtalo de nuevo.", error);
    default:
      return error;
  }
}

/**
 * Crea el error para una versión inexistente: un servicio sin versión vigente indica datos
 * inconsistentes y no debe editarse hasta revisarlo.
 *
 * @returns {AppError} Error 409 SERVICE_VERSION_MISSING.
 */
export function missingServiceVersionError() {
  return new AppError({
    code: "SERVICE_VERSION_MISSING",
    message: "El servicio no tiene una versión vigente registrada.",
    status: 409,
  });
}
