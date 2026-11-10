import {
  createSupportRequestForUser,
  findSupportRequestForUpload,
} from "../repositories/supportRepository.js";
import { runUpload, uploadPolicies } from "../services/fileUploadService.js";
import { uploadSupportAttachment } from "../services/supportFileService.js";

const MAX_SUPPORT_SUBJECT_LENGTH = 150;
const MAX_SUPPORT_DESCRIPTION_LENGTH = 5000;
// Tipos que ofrece el formulario de soporte (SupportPanel). Antes se aceptaba cualquier texto hasta el
// límite del cuerpo JSON (100 KB) por solicitud; el valor vacío se sigue admitiendo por compatibilidad.
const SUPPORT_ISSUE_TYPES = new Set(["platform-error", "access-account", "files-documents", "guarantees", "other"]);
/**
 * Crea la solicitud de soporte con los datos validados recibidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function createSupportRequest(req, res, next) {
  try {
    const subject = String(req.body?.subject || "").trim();
    const description = String(req.body?.description || "").trim();
    const issueType = String(req.body?.issueType || "").trim();

    if (!subject || subject.length > MAX_SUPPORT_SUBJECT_LENGTH) {
      res.status(400).json({
        code: "INVALID_SUPPORT_SUBJECT",
        message: `El asunto es obligatorio y no puede superar ${MAX_SUPPORT_SUBJECT_LENGTH} caracteres.`,
      });
      return;
    }

    if (!description || description.length > MAX_SUPPORT_DESCRIPTION_LENGTH) {
      res.status(400).json({
        code: "INVALID_SUPPORT_DESCRIPTION",
        message: `La descripcion es obligatoria y no puede superar ${MAX_SUPPORT_DESCRIPTION_LENGTH} caracteres.`,
      });
      return;
    }

    if (issueType && !SUPPORT_ISSUE_TYPES.has(issueType)) {
      res.status(400).json({
        code: "INVALID_SUPPORT_ISSUE_TYPE",
        message: "El tipo de incidencia no es válido.",
      });
      return;
    }

    const supportRequest = await createSupportRequestForUser({
      description,
      issueType,
      subject,
      user: req.user,
    });

    res.status(201).json({ supportRequest });
  } catch (error) {
    next(error);
  }
}

/**
 * Carga el adjunto de la solicitud de soporte coordinando la persistencia y el almacenamiento.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function uploadSupportRequestAttachment(req, res, next) {
  try {
    const supportRequestId = Number(req.params.supportRequestId);

    if (!Number.isInteger(supportRequestId) || supportRequestId <= 0) {
      res.status(400).json({
        code: "INVALID_SUPPORT_REQUEST_ID",
        message: "La solicitud de soporte no es valida.",
      });
      return;
    }

    const supportRequest = await findSupportRequestForUpload(
      supportRequestId,
      req.user,
    );

    if (!supportRequest) {
      res.status(404).json({
        code: "SUPPORT_REQUEST_NOT_FOUND",
        message: "No se encontro la solicitud de soporte.",
      });
      return;
    }

    const file = await runUpload({ req, policy: uploadPolicies.document,     /**
     * Procesa el valor de operation para completar la responsabilidad asignada al módulo.
     * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
     *
     * @param {unknown} upload - Valor de `upload` requerido por esta operación.
     * @returns {void} Finalización de la operación.
     */
operation: (upload) => uploadSupportAttachment({ supportRequestId, upload, user: req.user }) });

    res.status(201).json({ file });
  } catch (error) {
    next(error);
  }
}
