import { getProjectWarranties, linkWarrantyDocument, unlinkWarrantyDocument } from "../services/projectWarrantyService.js";

// Garantías y documentos vinculados (Fase 1.2, B8). Solo traduce HTTP; las reglas viven en
// services/projectWarrantyService.js. Respuestas privadas y sin almacenamiento: dependen del usuario y
// de las autorizaciones vigentes de cada documento.

/**
 * Crea un manejador que responde con el resultado del servicio y entrega los errores al middleware.
 * Marca la respuesta como privada y sin almacenamiento.
 *
 * @param {(req: import("express").Request) => Promise<object>} run - Llamada al servicio.
 * @returns {import("express").RequestHandler} Manejador.
 */
function respond(run) {
  return async function projectWarrantyHandler(req, res, next) {
    try {
      const body = await run(req);
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json(body);
    } catch (error) {
      next(error);
    }
  };
}

export const getProjectWarrantiesHandler = respond((req) => getProjectWarranties({ projectId: req.params.projectId, user: req.user }));
export const putWarrantyDocumentLink = respond((req) => linkWarrantyDocument({ ...req.params, user: req.user }));
export const deleteWarrantyDocumentLink = respond((req) => unlinkWarrantyDocument({ ...req.params, user: req.user }));
