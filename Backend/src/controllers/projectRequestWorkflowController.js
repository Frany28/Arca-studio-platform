import {
  applyProjectRequestDecision,
  getAdminProjectRequestDetail,
  loadProjectRequestReviewQueue,
  submitProjectRequestReview,
} from "../services/projectRequestWorkflowService.js";
import { decodeCursor, parsePageLimit } from "../utils/pagination.js";

/**
 * Lista el valor de proyecto solicitud reviews respetando el alcance y la paginación solicitados.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function listProjectRequestReviews(req, res, next) {
  try {
    const query = req.validatedQuery || req.query;
    const page = await loadProjectRequestReviewQueue({
      cursor: decodeCursor(query.cursor),
      limit: parsePageLimit(query.limit),
      user: req.user,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ projectRequests: page.items, nextCursor: page.nextCursor });
  } catch (error) {
    next(error);
  }
}

/**
 * Responde el detalle administrativo de una solicitud enviada, identificado por su ID.
 * La ruta ya exige rol administrador; la respuesta es privada y no se almacena en caché.
 *
 * @param {import("express").Request} req - Solicitud HTTP con `params.projectRequestId` validado.
 * @param {import("express").Response} res - Respuesta HTTP con `{ projectRequest }`.
 * @param {Function} next - Función que entrega errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getAdminProjectRequest(req, res, next) {
  try {
    const projectRequest = await getAdminProjectRequestDetail({
      projectRequestId: req.params.projectRequestId,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ projectRequest });
  } catch (error) {
    next(error);
  }
}

/**
 * Procesa el valor de put proyecto solicitud review para completar la responsabilidad asignada al módulo.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function putProjectRequestReview(req, res, next) {
  try {
    const review = await submitProjectRequestReview({
      payload: req.body,
      projectRequestId: req.params.projectRequestId,
      user: req.user,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ review });
  } catch (error) {
    next(error);
  }
}

/**
 * Procesa el valor de patch proyecto solicitud decisión para completar la responsabilidad asignada al módulo.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function patchProjectRequestDecision(req, res, next) {
  try {
    const result = await applyProjectRequestDecision({
      payload: req.body,
      projectRequestId: req.params.projectRequestId,
      user: req.user,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      project: result.project,
      projectRequest: result.projectRequest,
    });
  } catch (error) {
    next(error);
  }
}
