import { AppError, NotFoundError } from "../errors/appError.js";
import { listProjectRequestFiles } from "../repositories/fileRepository.js";
import {
  findProjectRequestOwnedByUser,
  listProjectRequestsForUser,
} from "../repositories/projectRequestRepository.js";
import { toPublicProjectRequest } from "./projectRequestService.js";

/**
 * Lista el valor de usuario proyecto solicitudes respetando el alcance y la paginación solicitados.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.cursor - Valor de `options.cursor` requerido por esta operación.
 * @param {number} options.limit - Valor de `options.limit` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function listUserProjectRequests({ cursor, limit, user }) {
  assertClientUser(user);

  const page = await listProjectRequestsForUser(user, { cursor, limit });
  return { ...page, items: page.items.map(toPublicProjectRequest) };
}

/**
 * Rechaza la consulta cuando el usuario autenticado no está vinculado a un cliente.
 * Centraliza la regla compartida por el listado y el detalle de solicitudes propias.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {void}
 * @throws {AppError} CLIENT_REQUIRED cuando el usuario no es cliente.
 */
function assertClientUser(user) {
  if (!user?.clientId) {
    throw new AppError({
      code: "CLIENT_REQUIRED",
      message: "Solo los clientes pueden consultar solicitudes de proyecto.",
      status: 403,
    });
  }
}

/**
 * Obtiene una solicitud propia del cliente con sus adjuntos persistidos para consultarla.
 * Lee PostgreSQL solo después de comprobar la propiedad; una solicitud ajena o eliminada
 * se responde como inexistente para no revelar su existencia.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {number|string} options.projectRequestId - Solicitud solicitada.
 * @param {unknown} options.user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<object>} Solicitud pública con `files` (id, nombre, tipo, tamaño y fecha).
 * @throws {AppError} CLIENT_REQUIRED o PROJECT_REQUEST_NOT_FOUND.
 */
export async function getUserProjectRequest({ projectRequestId, user }) {
  assertClientUser(user);

  const record = await findProjectRequestOwnedByUser(projectRequestId, user);
  if (!record) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "No se encontró la solicitud de proyecto.",
    );
  }

  const files = await listProjectRequestFiles(record.id);
  return { ...toPublicProjectRequest(record), files };
}
