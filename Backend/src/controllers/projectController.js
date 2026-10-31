import {
  changeProjectPublication,
  getProjectDetail as getProjectDetailService,
  listProjects,
} from "../services/projectService.js";
import { getAssignedArchitectProfilePhoto } from "../services/profilePhotoService.js";
import { decodeCursor, parsePageLimit } from "../utils/pagination.js";
import { streamStoredObject } from "../utils/streamResponse.js";

/**
 * Obtiene el valor de my proyectos para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function getMyProjects(req, res, next) {
  try {
    const query = req.validatedQuery || req.query;
    const limit = parsePageLimit(query?.limit);
    const cursor = decodeCursor(query?.cursor);
    if (query?.cursor && !cursor) return res.status(400).json({ code: "INVALID_CURSOR", message: "Cursor inválido." });
    const page = await listProjects({
      cursor,
      limit,
      scope: query?.scope,
      user: req.user,
    });

    res.status(200).json({
      projects: page.items,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene el detalle del proyecto para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getProjectDetail(req, res, next) {
  try {
    const projectIdentifier = String(req.params?.projectId || "").trim();
    const query = req.validatedQuery || req.query;
    const fileCursor = decodeCursor(query?.filesCursor);

    if (query?.filesCursor && !fileCursor) {
      res.status(400).json({ code: "INVALID_CURSOR", message: "Cursor de archivos inválido." });
      return;
    }

    const project = await getProjectDetailService({
      fileCursor,
      fileLimit: parsePageLimit(query?.filesLimit),
      projectIdentifier,
      user: req.user,
    });

    if (!project) {
      res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        message: "Proyecto no encontrado.",
      });
      return;
    }

    res.status(200).json({
      project,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Transmite la foto de perfil del arquitecto asignado sin cargar el contenido completo en memoria.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function streamAssignedArchitectProfilePhoto(req, res, next) {
  try {
    const photo = await getAssignedArchitectProfilePhoto({
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
 * Actualiza el valor de proyecto publication conservando las reglas de acceso e integridad.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function updateProjectPublication(req, res, next) {
  try {
    const projectId = Number(req.params?.projectId);
    const isPublic = req.body?.isPublic;

    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({
        code: "INVALID_PROJECT_ID",
        message: "Proyecto invalido.",
      });
      return;
    }

    if (typeof isPublic !== "boolean") {
      res.status(400).json({
        code: "INVALID_PUBLICATION_STATE",
        message: "isPublic debe ser true o false.",
      });
      return;
    }

    const project = await changeProjectPublication({
      isPublic,
      projectId,
      user: req.user,
    });

    if (!project) {
      res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        message: "Proyecto no encontrado.",
      });
      return;
    }

    res.status(200).json({
      project,
    });
  } catch (error) {
    next(error);
  }
}
