import {
  createProjectRequest as createProjectRequestService,
  submitProjectRequest as submitProjectRequestService,
  updateProjectRequest as updateProjectRequestService,
} from "../services/projectRequestService.js";
import {
  getUserProjectRequest,
  listUserProjectRequests,
} from "../services/projectRequestQueryService.js";
import { issueProjectRequestVerificationCode } from "../services/projectRequestVerificationService.js";
import { decodeCursor, parsePageLimit } from "../utils/pagination.js";

/**
 * Lista las solicitudes de proyecto respetando el alcance y la paginación solicitados.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function listProjectRequests(req, res, next) {
  try {
    const query = req.validatedQuery || req.query;
    const page = await listUserProjectRequests({
      cursor: decodeCursor(query.cursor),
      limit: parsePageLimit(query.limit),
      user: req.user,
    });
    res.status(200).json({ projectRequests: page.items, nextCursor: page.nextCursor });
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve una solicitud propia del cliente con sus adjuntos para la vista de consulta.
 * Coordina la solicitud HTTP y delega en el servicio la comprobación de propiedad.
 *
 * @param {import("express").Request} req - Solicitud HTTP con el identificador validado.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getProjectRequest(req, res, next) {
  try {
    const projectRequest = await getUserProjectRequest({
      projectRequestId: req.params.projectRequestId,
      user: req.user,
    });
    res.status(200).json({ projectRequest });
  } catch (error) {
    next(error);
  }
}

/**
 * Crea la solicitud de proyecto con los datos validados recibidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function createProjectRequest(req, res, next) {
  try {
    const projectRequest = await createProjectRequestService({
      payload: req.body,
      user: req.user,
    });
    res.status(201).json({ projectRequest });
  } catch (error) {
    next(error);
  }
}

/**
 * Actualiza la solicitud de proyecto conservando las reglas de acceso e integridad.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function updateProjectRequest(req, res, next) {
  try {
    const projectRequest = await updateProjectRequestService({
      payload: req.body,
      projectRequestId: req.params.projectRequestId,
      user: req.user,
    });
    res.status(200).json({ projectRequest });
  } catch (error) {
    next(error);
  }
}

/**
 * Envía la solicitud de proyecto después de validar el estado y las reglas aplicables.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function submitProjectRequest(req, res, next) {
  try {
    const projectRequest = await submitProjectRequestService({
      projectRequestId: req.params.projectRequestId,
      user: req.user,
      verificationCode: req.body.verificationCode,
    });
    res.status(200).json({ projectRequest });
  } catch (error) {
    next(error);
  }
}

/**
 * Emite y envía por correo el código de validación del envío de una solicitud propia.
 * Coordina la solicitud HTTP y delega en el servicio las reglas de estado, reenvío y correo.
 *
 * @param {import("express").Request} req - Solicitud HTTP con el identificador validado.
 * @param {import("express").Response} res - Respuesta HTTP con vencimiento y próximo reenvío.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function requestProjectRequestVerificationCode(req, res, next) {
  try {
    const verification = await issueProjectRequestVerificationCode({
      projectRequestId: req.params.projectRequestId,
      user: req.user,
    });
    res.status(201).json({ verification });
  } catch (error) {
    next(error);
  }
}
