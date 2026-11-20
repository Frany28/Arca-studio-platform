import { isProjectFileReviewEnabled, withProjectFileReviewState } from "../config/projectFileReview.js";
import { resolveProjectFileReviewActivation } from "../services/projectFileReviewActivationService.js";

/**
 * Fija la activación efectiva antes de ejecutar cualquier ruta de la API.
 * Rutas y consultas comparten un contexto asíncrono estable, incluso con peticiones concurrentes.
 *
 * @param {import("express").Request} _req - Solicitud HTTP.
 * @param {import("express").Response} _res - Respuesta HTTP.
 * @param {Function} next - Continuación o propagación del error centralizado.
 * @returns {Promise<void>} Finalización de la comprobación de dependencias.
 */
export async function loadProjectFileReviewActivation(_req, _res, next) {
  try {
    const enabled = await resolveProjectFileReviewActivation();
    withProjectFileReviewState(enabled, next);
  } catch (error) {
    next(error);
  }
}

/**
 * Habilita las rutas de versiones y revisión solo con la activación coordinada encendida.
 * Apagada, responde exactamente como una ruta inexistente (404 API_ROUTE_NOT_FOUND), antes de la
 * autenticación, para que el backend se comporte como antes de existir estas rutas.
 *
 * @param {import("express").Request} _req - Solicitud HTTP.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con la cadena de la ruta.
 * @returns {void}
 */
export function requireProjectFileReviewEnabled(_req, res, next) {
  if (isProjectFileReviewEnabled()) {
    next();
    return;
  }
  res.status(404).json({ code: "API_ROUTE_NOT_FOUND", message: "Ruta de API no encontrada." });
}
