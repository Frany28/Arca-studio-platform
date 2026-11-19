import { pool } from "../config/db.js";
import { isProjectFileReviewEnabled } from "../config/projectFileReview.js";
import { NotFoundError } from "../errors/appError.js";
import { canUserAccessCommentVersion } from "../repositories/projectCommentAudienceRepository.js";
import {
  createDocumentCommentRecord,
  listDocumentComments,
} from "../repositories/projectCommentRepository.js";

/**
 * Crea el comentario de documento con los datos validados recibidos.
 * El repositorio comprueba, con el proyecto bloqueado, el acceso al proyecto y (B6) a la versión.
 *
 * @param {object} input - Proyecto, archivo, versión, selección, texto y usuario.
 * @returns {Promise<object|null>} Comentario creado o null si el destino no es accesible.
 */
export function createDocumentComment(input) {
  return createDocumentCommentRecord(input);
}

/**
 * Obtiene los comentarios de una versión de documento. Con la revisión activada (B6) la versión
 * debe ser visible para el usuario, igual que su descarga; si no, responde como inexistente.
 *
 * @param {object} input - Proyecto, archivo, versión, cursor, límite y usuario.
 * @returns {Promise<{ items: object[], nextCursor: string|null }>} Página de comentarios.
 * @throws {NotFoundError} FILE_NOT_FOUND si la versión no es accesible con la revisión activada.
 */
export async function getDocumentComments(input) {
  if (isProjectFileReviewEnabled() && !(await canUserAccessCommentVersion(pool, input))) {
    throw new NotFoundError("FILE_NOT_FOUND", "No se encontro el archivo.");
  }
  return listDocumentComments(input);
}
