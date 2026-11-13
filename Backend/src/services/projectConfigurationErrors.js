import { AppError, ConflictError, ValidationError } from "../errors/appError.js";

const CHECK_FIELDS = Object.freeze({
  chk_projects_dates: { "body.estimatedDeliveryDate": "La entrega estimada no puede ser anterior al inicio del proyecto." },
  chk_project_warranties_dates: { "body.warranties": "Las fechas deben ser inicio ≤ servicio ≤ finalización." },
  chk_project_warranties_text: { "body.warranties": "Completa producto, modelo y código de cada garantía." },
  chk_project_folders_name: { "body.name": "El nombre de la carpeta debe tener entre 1 y 120 caracteres." },
  chk_projects_configuration_text_length: Object.fromEntries(
    ["zoning", "procedures", "conditions", "equipment"].map((field) => [`body.${field}`, "El texto debe tener como máximo 4000 caracteres."]),
  ),
});

/**
 * Traduce fallos conocidos de PostgreSQL de la configuración a errores públicos estables.
 * Conserva errores de aplicación y propaga los desconocidos al middleware central sin copiar mensajes internos.
 *
 * @param {Error & {code?: string, constraint?: string}} error - Fallo de la escritura o del COMMIT.
 * @returns {Error} Error público equivalente o el error original.
 */
export function translateProjectConfigurationError(error) {
  if (error instanceof AppError) return error;
  switch (error?.code) {
    case "23514":
      if (Object.hasOwn(CHECK_FIELDS, error.constraint)) return new ValidationError(undefined, CHECK_FIELDS[error.constraint]);
      return error;
    case "22007":
    case "22008":
      return new ValidationError("Las fechas deben existir en el calendario y usar el formato AAAA-MM-DD.");
    case "23505":
      if (error.constraint === "uq_project_folders_sibling_name") {
        return new ValidationError(undefined, { "body.name": "Ya existe una carpeta con ese nombre en esta ubicación." });
      }
      return error;
    case "23503":
      return new ConflictError("PROJECT_CONFIGURATION_CONFLICT", "Una referencia del proyecto ya no está disponible. Recarga los datos antes de guardar.", error);
    case "40001":
    case "40P01":
      return new ConflictError("PROJECT_CONFIGURATION_CONFLICT", "El proyecto se está modificando en este momento. Reintenta la operación.", error);
    default:
      return error;
  }
}
