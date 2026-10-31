import {
  canAccessProjectComments,
  createProjectCommentRecord,
  listProjectComments,
} from "../repositories/projectCommentRepository.js";
import { getProjectCommentAuthorProfilePhoto } from "../services/profilePhotoService.js";
import {
  publishProjectEvent,
  subscribeToProjectEvents,
  assertProjectEventCapacity,
} from "../services/projectEvents.js";
import { decodeCursor, parsePageLimit } from "../utils/pagination.js";
import { sanitizeCommentMetadata } from "../utils/commentMetadata.js";
import {
  createDocumentComment,
  getDocumentComments,
} from "../services/documentCommentService.js";
import { assertProjectOperationallyMutable } from "../services/projectService.js";
import { streamStoredObject } from "../utils/streamResponse.js";

const COMMENT_CONTENT_MAX_LENGTH = 2000;
const ALLOWED_COMMENT_TYPES = new Set(["general", "image", "video", "panorama", "document"]);

/**
 * Interpreta el valor de proyecto id y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @returns {unknown} Resultado producido por la operación.
 */
function parseProjectId(req) {
  const projectId = Number(req.params.projectId);

  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
}

/**
 * Interpreta el valor de parent comentario id y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function parseParentCommentId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parentCommentId = Number(value);

  return Number.isInteger(parentCommentId) && parentCommentId > 0
    ? parentCommentId
    : Number.NaN;
}

/**
 * Interpreta el valor de comentario tipo y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function parseCommentType(value) {
  const commentType = String(value || "general").trim();

  return ALLOWED_COMMENT_TYPES.has(commentType) ? commentType : null;
}

/**
 * Interpreta el valor de target id y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function parseTargetId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value).trim() || null;
}

/**
 * Interpreta el valor de plain objeto y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function parsePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/**
 * Obtiene los comentarios del proyecto para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function getProjectComments(req, res, next) {
  try {
    const projectId = parseProjectId(req);

    if (!projectId) {
      res.status(400).json({
        code: "INVALID_PROJECT_ID",
        message: "Proyecto invalido.",
      });
      return;
    }

    const canAccess = await canAccessProjectComments(projectId, req.user);

    if (!canAccess) {
      res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        message: "Proyecto no encontrado.",
      });
      return;
    }

    const query = req.validatedQuery || req.query;
    const cursor = decodeCursor(query?.cursor);
    if (query?.cursor && !cursor) return res.status(400).json({ code: "INVALID_CURSOR", message: "Cursor inválido." });
    const page = await listProjectComments(projectId, req.user, { cursor, limit: parsePageLimit(query?.limit) });

    // syncCursor (aditivo, P1-1): permite al cliente pedir solo los comentarios nuevos con la paginación existente.
    res.status(200).json({ comments: page.items, nextCursor: page.nextCursor, syncCursor: page.syncCursor });
  } catch (error) {
    next(error);
  }
}

/**
 * Transmite la foto del autor del comentario de proyecto sin cargar el contenido completo en memoria.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function streamProjectCommentAuthorProfilePhoto(req, res, next) {
  try {
    const photo = await getProjectCommentAuthorProfilePhoto({
      authorUserId: req.params.userId,
      projectId: req.params.projectId,
      user: req.user,
    });

    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("Cache-Control", "private, max-age=60, must-revalidate");
    if (photo.contentLength !== undefined) {
      res.setHeader("Content-Length", String(photo.contentLength));
    }
    res.status(200);
    await streamStoredObject(photo.body, res, "profile_photo");
  } catch (error) {
    next(error);
  }
}

/**
 * Crea el comentario del proyecto con los datos validados recibidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function createProjectComment(req, res, next) {
  try {
    const projectId = parseProjectId(req);

    if (!projectId) {
      res.status(400).json({
        code: "INVALID_PROJECT_ID",
        message: "Proyecto invalido.",
      });
      return;
    }

    const canAccess = await canAccessProjectComments(projectId, req.user);

    if (!canAccess) {
      res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        message: "Proyecto no encontrado.",
      });
      return;
    }

    await assertProjectOperationallyMutable(projectId);

    const content = String(req.body?.content || "").trim();
    const parentCommentId = parseParentCommentId(req.body?.parentCommentId);
    const commentType = parseCommentType(req.body?.commentType);
    const targetId = parseTargetId(req.body?.targetId);
    const image = sanitizeCommentMetadata(parsePlainObject(req.body?.image));
    const selection = sanitizeCommentMetadata(parsePlainObject(req.body?.selection));
    const fileId = Number(req.body?.fileId);
    const fileVersionId = Number(req.body?.fileVersionId);

    if (!commentType) {
      res.status(400).json({
        code: "INVALID_COMMENT_TYPE",
        message: "El tipo de observación no es válido.",
      });
      return;
    }

    if (
      !parentCommentId &&
      !["general", "document"].includes(commentType) &&
      !targetId
    ) {
      res.status(400).json({
        code: "COMMENT_TARGET_REQUIRED",
        message: "La observación necesita un recurso asociado.",
      });
      return;
    }

    if (!content) {
      res.status(400).json({
        code: "COMMENT_CONTENT_REQUIRED",
        message: "Escribe una observación.",
      });
      return;
    }

    if (content.length > COMMENT_CONTENT_MAX_LENGTH) {
      res.status(400).json({
        code: "COMMENT_CONTENT_TOO_LONG",
        message: `La observación no puede superar ${COMMENT_CONTENT_MAX_LENGTH} caracteres.`,
      });
      return;
    }

    if (Number.isNaN(parentCommentId)) {
      res.status(400).json({
        code: "INVALID_PARENT_COMMENT_ID",
        message: "La observación a responder no es válida.",
      });
      return;
    }

    const comment = commentType === "document"
      ? await createDocumentComment({
          content,
          fileId,
          fileVersionId,
          parentCommentId,
          projectId,
          selection,
          user: req.user,
        })
      : await createProjectCommentRecord({
      commentType,
      content,
      parentCommentId,
      projectId,
      targetId,
      targetMetadata:
        commentType === "general"
          ? null
          : {
              image,
              selection,
            },
      user: req.user,
        });

    if (!comment) {
      res.status(404).json({
        code: "PROJECT_OR_COMMENT_NOT_FOUND",
        message: "No se encontró el proyecto o la observación a responder.",
      });
      return;
    }

    if (commentType !== "document") {
      publishProjectEvent({
        eventName: "project.comment.created",
        payload: { comment },
        projectId,
      });
    }

    res.status(201).json({ comment });
  } catch (error) {
    if (error.code === "23505") {
      res.status(409).json({ code: "COMMENT_CONFLICT", message: "Otra observación fue creada simultáneamente. Intenta de nuevo." });
      return;
    }
    next(error);
  }
}

/**
 * Obtiene el valor de proyecto documento comentarios para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getProjectDocumentComments(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    const fileId = Number(req.params.fileId);
    const query = req.validatedQuery || req.query;
    const fileVersionId = Number(query.fileVersionId);
    const cursor = decodeCursor(query.cursor);
    const page = await getDocumentComments({
      cursor,
      fileId,
      fileVersionId,
      limit: parsePageLimit(query.limit),
      projectId,
      user: req.user,
    });
    res.status(200).json({ comments: page.items, nextCursor: page.nextCursor });
  } catch (error) {
    next(error);
  }
}

/**
 * Transmite el valor de proyecto comentario events sin cargar el contenido completo en memoria.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function streamProjectCommentEvents(req, res, next) {
  try {
    const projectId = parseProjectId(req);

    if (!projectId) {
      res.status(400).json({
        code: "INVALID_PROJECT_ID",
        message: "Proyecto invalido.",
      });
      return;
    }

    const canAccess = await canAccessProjectComments(projectId, req.user);

    if (!canAccess) {
      res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        message: "Proyecto no encontrado.",
      });
      return;
    }

    try {
      assertProjectEventCapacity({ projectId, userId: req.user.id });
    } catch (error) {
      if (error.code === "SSE_CONNECTION_LIMIT") {
        res.setHeader("Retry-After", "30");
        res.status(429).json({ code: error.code, message: "Límite de conexiones en tiempo real alcanzado." });
        return;
      }
      throw error;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let unsubscribe;
    try {
      unsubscribe = subscribeToProjectEvents({ projectId, response: res, userId: req.user.id });
    } catch (error) {
      if (error.code === "SSE_CONNECTION_LIMIT") {
        res.end();
        return;
      }
      throw error;
    }

    req.on("close", unsubscribe);
  } catch (error) {
    next(error);
  }
}
