import {
  getProjectRequestForAdminEdit,
  updateProjectRequestAsAdmin,
} from "../services/projectRequestAdminEditService.js";

/**
 * Responde la solicitud en su forma editable para precargar el formulario administrativo.
 * La ruta ya exige rol administrador; la respuesta es privada y no se almacena en caché.
 *
 * @param {import("express").Request} req - Solicitud HTTP con `params.projectRequestId` validado.
 * @param {import("express").Response} res - Respuesta HTTP con `{ projectRequest }`.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finaliza al responder.
 */
export async function getAdminProjectRequestForm(req, res, next) {
  try {
    const projectRequest = await getProjectRequestForAdminEdit({ projectRequestId: req.params.projectRequestId });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ projectRequest });
  } catch (error) {
    next(error);
  }
}

/**
 * Guarda la edición administrativa de las respuestas de una solicitud y responde la versión
 * resultante con los nombres de los campos cambiados. No altera el estado de la solicitud.
 *
 * @param {import("express").Request} req - Solicitud HTTP con cuerpo y parámetros validados.
 * @param {import("express").Response} res - Respuesta HTTP con `{ changedFields, projectRequest }`.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finaliza al responder.
 */
export async function putAdminProjectRequestForm(req, res, next) {
  try {
    const result = await updateProjectRequestAsAdmin({
      payload: req.body,
      projectRequestId: req.params.projectRequestId,
      user: req.user,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
