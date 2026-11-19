import { publishProjectAccessChanged } from "../services/projectCommentEvents.js";
import {
  getProjectFileAudiences,
  grantProjectFileAudience,
  revokeProjectFileAudience,
} from "../services/projectFileAudienceService.js";

// Rutas de audiencias de archivos de proyecto (Fase 1.2, B5). Solo traducen HTTP; las reglas viven
// en services/projectFileAudienceService.js. Solo el administrador las alcanza y solo con la
// activación coordinada encendida. Tras un cambio confirmado se avisa a los streams SSE (B6).

/**
 * Devuelve las autorizaciones activas y el historial de audiencias de un archivo.
 * Solo el administrador; el cliente consulta sus archivos por las rutas de lectura.
 *
 * @param {import("express").Request} req - Solicitud con parámetros validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getProjectFileAudienceState(req, res, next) {
  try {
    res.status(200).json(await getProjectFileAudiences({ fileId: req.params.fileId, projectId: req.params.projectId, user: req.user }));
  } catch (error) {
    next(error);
  }
}

/**
 * Autoriza una versión aprobada para el cliente propietario o el escaparate.
 * Responde 200 tanto si cambia como si ya estaba autorizada (`changed` lo indica); si cambia, tras
 * confirmar avisa a los streams del proyecto con `project.access.changed`.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function putProjectFileAudience(req, res, next) {
  try {
    const state = await grantProjectFileAudience({
      audience: req.params.audience,
      fileId: req.params.fileId,
      projectId: req.params.projectId,
      user: req.user,
      versionId: req.body.versionId,
    });
    res.status(200).json(state);
    if (state.changed) void publishProjectAccessChanged({ projectId: req.params.projectId });
  } catch (error) {
    next(error);
  }
}

/**
 * Retira el acceso de una audiencia cerrando su autorización activa como revocada.
 * La autorización queda en el historial; tras confirmar se avisa a los streams del proyecto.
 *
 * @param {import("express").Request} req - Solicitud con parámetros validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function deleteProjectFileAudience(req, res, next) {
  try {
    const state = await revokeProjectFileAudience({
      audience: req.params.audience,
      fileId: req.params.fileId,
      projectId: req.params.projectId,
      user: req.user,
    });
    res.status(200).json(state);
    void publishProjectAccessChanged({ projectId: req.params.projectId });
  } catch (error) {
    next(error);
  }
}
