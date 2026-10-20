import { AppError } from "../errors/appError.js";
import {
  changeDenominationStatus,
  createDenomination,
  getDenomination,
  getDenominationsPage,
  getMeasurementUnits,
  updateDenomination,
} from "../services/measurementUnitService.js";

// Las lecturas no se guardan en caché: el estado y el uso de las unidades cambian por edición directa.
const NO_STORE = "no-store";

/**
 * Devuelve las unidades base para el Dropdown de formularios administrativos.
 * Responde `{ measurementUnits }`; las inactivas solo con `includeInactive=true`.
 *
 * @param {import("express").Request} req - Solicitud con la consulta validada.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getBaseUnits(req, res, next) {
  try {
    const result = await getMeasurementUnits(req.validatedQuery);
    res.set("Cache-Control", NO_STORE).status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve una página de denominaciones con su cursor siguiente.
 * Responde `{ unitDenominations, nextCursor }`.
 *
 * @param {import("express").Request} req - Solicitud con la consulta validada.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getDenominations(req, res, next) {
  try {
    const page = await getDenominationsPage(req.validatedQuery);
    res.set("Cache-Control", NO_STORE).status(200).json(page);
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve una denominación con su unidad base, etiqueta y uso por servicios activos.
 * Responde 404 MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND a través del middleware de errores.
 *
 * @param {import("express").Request} req - Solicitud con `params.denominationId` validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getDenominationById(req, res, next) {
  try {
    const unitDenomination = await getDenomination(req.params.denominationId);
    res.set("Cache-Control", NO_STORE).status(200).json({ unitDenomination });
  } catch (error) {
    next(error);
  }
}

/**
 * Crea una denominación personalizada (formulario "Nueva unidad de medida").
 * Responde 201 con la denominación y su etiqueta compuesta.
 *
 * @param {import("express").Request} req - Solicitud con el cuerpo validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function postDenomination(req, res, next) {
  try {
    const unitDenomination = await createDenomination({ payload: req.body, user: req.user });
    res.status(201).json({ message: "Unidad de medida creada correctamente.", unitDenomination });
  } catch (error) {
    next(error);
  }
}

/**
 * Construye la respuesta común de una modificación de denominación.
 * Distingue con `changed` si hubo un cambio efectivo o si no había nada que guardar.
 *
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {{ unitDenomination: object, changed: boolean }} result - Resultado del servicio.
 * @returns {void}
 */
function sendDenominationUpdate(res, result) {
  res.status(200).json({
    changed: result.changed,
    message: result.changed ? "Unidad de medida actualizada correctamente." : "No había cambios para guardar.",
    unitDenomination: result.unitDenomination,
  });
}

/**
 * Edita el texto de una denominación; 409 MEASUREMENT_UNIT_IN_USE si la usan servicios activos.
 * La respuesta indica con `changed` si hubo un cambio efectivo.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function patchDenomination(req, res, next) {
  try {
    sendDenominationUpdate(res, await updateDenomination({ denominationId: req.params.denominationId, payload: req.body, user: req.user }));
  } catch (error) {
    next(error);
  }
}

/**
 * Activa o desactiva una denominación sin eliminarla.
 * Responde igual que la edición de texto.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function patchDenominationStatus(req, res, next) {
  try {
    sendDenominationUpdate(res, await changeDenominationStatus({ denominationId: req.params.denominationId, payload: req.body, user: req.user }));
  } catch (error) {
    next(error);
  }
}

/**
 * Rechaza cualquier escritura sobre las unidades base con 405: en esta fase el catálogo base
 * solo se amplía mediante cargas de datos autorizadas, no desde la API.
 *
 * @param {import("express").Request} _req - Solicitud HTTP (no se usa).
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega el error al middleware central.
 * @returns {void}
 */
export function rejectBaseUnitWrite(_req, res, next) {
  res.set("Allow", "GET");
  next(new AppError({
    code: "MEASUREMENT_UNIT_READ_ONLY",
    message: "Las unidades base son de solo lectura; crea una denominación personalizada.",
    status: 405,
  }));
}

/**
 * Rechaza la eliminación física de denominaciones con 405 e indica la alternativa.
 * Se conservan para el historial de servicios y cotizaciones.
 *
 * @param {import("express").Request} _req - Solicitud HTTP (no se usa).
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega el error al middleware central.
 * @returns {void}
 */
export function rejectDenominationDeletion(_req, res, next) {
  res.set("Allow", "GET, PATCH");
  next(new AppError({
    code: "MEASUREMENT_UNIT_DELETION_NOT_ALLOWED",
    message: "Las unidades de medida no se eliminan; desactívalas para retirarlas.",
    status: 405,
  }));
}
