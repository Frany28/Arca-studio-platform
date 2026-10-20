import { AppError, ConflictError, ValidationError } from "../errors/appError.js";

/*
 * Traducción de errores de PostgreSQL de las denominaciones de unidades a errores de
 * aplicación. Los índices únicos y las claves foráneas de la migración
 * measurement_unit_denominations son la última barrera ante carreras (dos altas equivalentes
 * simultáneas); aquí se convierten en respuestas controladas sin exponer PostgreSQL.
 */

export const DENOMINATION_DUPLICATE_MESSAGE = "Ya existe una denominación equivalente para esa unidad de medida.";

/**
 * Convierte un error ocurrido durante una operación de denominaciones en un error de aplicación.
 * Los errores de aplicación se devuelven sin cambios; los códigos PostgreSQL conocidos se
 * traducen y cualquier otro se propaga para que el middleware responda con un 500 genérico.
 *
 * @param {Error & { code?: string, constraint?: string }} error - Error capturado.
 * @returns {Error} Error de aplicación equivalente o el error original.
 */
export function translateMeasurementUnitError(error) {
  if (error instanceof AppError) return error;

  switch (error?.code) {
    case "23505":
      if (error.constraint === "uq_measurement_unit_denominations_key") {
        return new ConflictError("MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", DENOMINATION_DUPLICATE_MESSAGE, error);
      }
      return new ConflictError("MEASUREMENT_UNIT_CONFLICT", "La unidad de medida entra en conflicto con un registro existente.", error);
    case "23503":
      if (error.constraint === "fk_measurement_unit_denominations_unit") {
        return new ValidationError(undefined, { measurementUnitId: "La unidad de medida no existe." });
      }
      return new ConflictError("MEASUREMENT_UNIT_REFERENCE_CONFLICT", "Una referencia de la unidad de medida ya no está disponible.", error);
    case "23001":
      return new ConflictError("MEASUREMENT_UNIT_REFERENCE_CONFLICT", "La unidad de medida tiene referencias que impiden la operación.", error);
    case "23514":
      return new ValidationError("Los datos de la unidad de medida no cumplen las reglas del catálogo.");
    case "55000":
      return new ConflictError("MEASUREMENT_UNIT_BASE_IMMUTABLE", "La unidad base de una denominación no se puede modificar.", error);
    case "40001":
    case "40P01":
      return new ConflictError("MEASUREMENT_UNIT_CONCURRENT_UPDATE", "La unidad de medida se está modificando en este momento. Inténtalo de nuevo.", error);
    default:
      return error;
  }
}
