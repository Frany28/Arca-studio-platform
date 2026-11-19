import { isProjectFileReviewEnabled } from "../config/projectFileReview.js";

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
