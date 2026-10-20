import { AppError } from "../errors/appError.js";
import {
  changeServiceStatus,
  createService,
  getService,
  getServicesPage,
  updateService,
} from "../services/serviceCatalogService.js";

// Las lecturas no se guardan en caché: editar con una versión antigua provocaría conflictos 409.
const NO_STORE = "no-store";

/**
 * Devuelve una página del catálogo administrativo de servicios con su cursor siguiente.
 * Delega filtros y paginación en el servicio y responde con `{ services, nextCursor }`.
 *
 * @param {import("express").Request} req - Solicitud con la consulta validada.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getServices(req, res, next) {
  try {
    const page = await getServicesPage(req.validatedQuery);
    res.set("Cache-Control", NO_STORE).status(200).json(page);
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve un servicio del catálogo con su unidad de medida y versión vigente.
 * Responde 404 SERVICE_NOT_FOUND a través del middleware de errores cuando no existe.
 *
 * @param {import("express").Request} req - Solicitud con `params.serviceId` validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getServiceById(req, res, next) {
  try {
    const service = await getService(req.params.serviceId);
    res.set("Cache-Control", NO_STORE).status(200).json({ service });
  } catch (error) {
    next(error);
  }
}

/**
 * Crea un servicio y su versión inicial con el administrador autenticado como responsable.
 * Responde 201 con el servicio creado.
 *
 * @param {import("express").Request} req - Solicitud con el cuerpo validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function postService(req, res, next) {
  try {
    const service = await createService({ payload: req.body, user: req.user });
    res.status(201).json({ message: "Servicio creado correctamente.", service });
  } catch (error) {
    next(error);
  }
}

/**
 * Construye la respuesta común de una edición versionada, distinguiendo si hubo cambios.
 * Sin cambios efectivos se responde 200 con `changed: false` y la versión no aumenta.
 *
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {{ service: object, changed: boolean, changedFields: Array<string> }} result - Resultado del servicio.
 * @returns {void}
 */
function sendServiceUpdate(res, result) {
  res.status(200).json({
    changed: result.changed,
    changedFields: result.changedFields,
    message: result.changed ? "Servicio actualizado correctamente." : "No había cambios para guardar.",
    service: result.service,
  });
}

/**
 * Edita los campos autorizados de un servicio, incluida su tarifa de referencia.
 * Requiere `expectedVersion`; un conflicto de versión llega como 409 SERVICE_VERSION_CONFLICT.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function patchService(req, res, next) {
  try {
    sendServiceUpdate(res, await updateService({ payload: req.body, serviceId: req.params.serviceId, user: req.user }));
  } catch (error) {
    next(error);
  }
}

/**
 * Activa o desactiva un servicio mediante la misma edición versionada.
 * Responde igual que la edición general.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function patchServiceStatus(req, res, next) {
  try {
    sendServiceUpdate(res, await changeServiceStatus({ payload: req.body, serviceId: req.params.serviceId, user: req.user }));
  } catch (error) {
    next(error);
  }
}

/**
 * Rechaza la eliminación física de servicios con 405 e indica la alternativa (desactivar).
 * Los servicios se conservan para el historial y para cotizaciones futuras.
 *
 * @param {import("express").Request} _req - Solicitud HTTP (no se usa).
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega el error al middleware central.
 * @returns {void}
 */
export function rejectServiceDeletion(_req, res, next) {
  res.set("Allow", "GET, PATCH");
  next(new AppError({
    code: "SERVICE_DELETION_NOT_ALLOWED",
    message: "Los servicios no se eliminan; desactívalos para retirarlos del catálogo.",
    status: 405,
  }));
}
