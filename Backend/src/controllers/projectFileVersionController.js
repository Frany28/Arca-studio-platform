import { ValidationError } from "../errors/appError.js";
import { runProjectUpload } from "../services/fileUploadService.js";
import {
  listProjectFileVersions,
  replaceProjectFileVersion,
  restoreProjectFileVersion,
  reviewProjectFileVersion,
} from "../services/projectFileVersionService.js";

// Rutas de versiones y revisión de archivos de proyecto (Fase 1.2, B4). Solo traducen HTTP; las
// reglas viven en services/projectFileVersionService.js. Solo se alcanzan con la activación
// coordinada encendida (middlewares/projectFileReview.js).

/**
 * Lee el motivo del cambio de la cabecera X-Change-Note, codificado como componente de URL para
 * admitir tildes en una subida binaria. Una codificación inválida es un error de validación.
 *
 * @param {import("express").Request} req - Solicitud HTTP.
 * @returns {string} Motivo decodificado (puede estar vacío; el dominio decide si es válido).
 * @throws {ValidationError} Si la cabecera no está bien codificada.
 */
function readChangeNoteHeader(req) {
  const raw = req.get("x-change-note") ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ValidationError(undefined, { "headers.x-change-note": "El motivo del cambio no está bien codificado." });
  }
}

/**
 * Devuelve el historial de versiones visibles de un archivo, con cursor.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y consulta validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getProjectFileVersions(req, res, next) {
  try {
    const page = await listProjectFileVersions({
      cursor: req.validatedQuery?.cursor,
      fileId: req.params.fileId,
      limit: req.validatedQuery?.limit,
      projectId: req.params.projectId,
      user: req.user,
    });
    res.status(200).json(page);
  } catch (error) {
    next(error);
  }
}

/**
 * Sube una versión nueva de un archivo (reemplazo), que queda pendiente de revisión.
 * El contenido llega en binario, como la subida, y el motivo en la cabecera X-Change-Note.
 *
 * @param {import("express").Request} req - Solicitud con el contenido y los parámetros validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function postProjectFileVersion(req, res, next) {
  try {
    const changeNote = readChangeNoteHeader(req);
    const version = await runProjectUpload({
      /**
       * Registra la versión con el contenido ya validado por la política de subida.
       *
       * @param {object} upload - Contenido, tipo, nombre y tamaño.
       * @returns {Promise<object>} Versión creada.
       */
      operation: (upload) => replaceProjectFileVersion({
        changeNote,
        fileId: req.params.fileId,
        projectId: req.params.projectId,
        upload,
        user: req.user,
      }),
      req,
    });
    res.status(201).json({ version });
  } catch (error) {
    next(error);
  }
}

/**
 * Restaura una versión aprobada como versión nueva pendiente.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function postProjectFileVersionRestore(req, res, next) {
  try {
    const version = await restoreProjectFileVersion({
      changeNote: req.body.changeNote,
      fileId: req.params.fileId,
      projectId: req.params.projectId,
      user: req.user,
      versionId: req.params.versionId,
    });
    res.status(201).json({ version });
  } catch (error) {
    next(error);
  }
}

/**
 * Aprueba una versión pendiente (solo el administrador). No la comparte con el cliente.
 *
 * @param {import("express").Request} req - Solicitud con parámetros validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function postProjectFileVersionApproval(req, res, next) {
  try {
    const result = await reviewProjectFileVersion({
      action: "approve",
      fileId: req.params.fileId,
      projectId: req.params.projectId,
      user: req.user,
      versionId: req.params.versionId,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Rechaza una versión pendiente con su motivo (solo el administrador).
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Entrega los errores al middleware central.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function postProjectFileVersionRejection(req, res, next) {
  try {
    const result = await reviewProjectFileVersion({
      action: "reject",
      fileId: req.params.fileId,
      projectId: req.params.projectId,
      reason: req.body.reason,
      user: req.user,
      versionId: req.params.versionId,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
