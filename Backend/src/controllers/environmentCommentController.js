import {
  addEnvironmentComment,
  getEnvironmentComments,
} from "../services/environmentCommentService.js";
import { getEnvironmentCommentAuthorProfilePhoto } from "../services/profilePhotoService.js";
import { decodeCursor, parsePageLimit } from "../utils/pagination.js";
import { streamStoredObject } from "../utils/streamResponse.js";

/**
 * Lista los comentarios de entorno respetando el alcance y la paginación solicitados.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function listEnvironmentComments(req, res, next) {
  try {
    const query = req.validatedQuery || req.query;
    const page = await getEnvironmentComments({
      cursor: decodeCursor(query?.cursor),
      limit: parsePageLimit(query?.limit),
      user: req.user,
    });

    res.status(200).json({
      comments: page.items,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Crea el comentario de entorno con los datos validados recibidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function createEnvironmentComment(req, res, next) {
  try {
    const comment = await addEnvironmentComment({
      content: req.body.content,
      parentCommentId: req.body.parentCommentId ?? null,
      user: req.user,
    });

    res.status(201).json({ comment });
  } catch (error) {
    next(error);
  }
}

/**
 * Transmite la foto del autor del comentario de entorno sin cargar el contenido completo en memoria.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function streamEnvironmentCommentAuthorProfilePhoto(
  req,
  res,
  next,
) {
  try {
    const photo = await getEnvironmentCommentAuthorProfilePhoto({
      authorUserId: req.params.userId,
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
