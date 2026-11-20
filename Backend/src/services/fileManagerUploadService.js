import { getFileExtension } from "../config/storage.js";
import { evaluateManagedUpload, resolveManagedFileCategory } from "../domain/fileManagerUpload.js";
import { ConflictError, NotFoundError } from "../errors/appError.js";
import { findFolderUploadTarget } from "../repositories/fileManagerRepository.js";
import { findProjectForFileUpload, uploadProjectFile } from "../repositories/fileRepository.js";
import { assertProjectOperationallyMutable } from "./projectService.js";

// Subida desde el administrador de archivos (Fase 1.2, U3): un archivo nuevo dentro de una carpeta
// del proyecto. Reutiliza la carga de proyectos (firma, límites, streaming, registro con la v1
// pendiente y compensación del objeto si no llega a registrarse) y añade la carpeta destino, la
// regla confirmada de la portada y la categoría de las panorámicas.

const RULE_ERRORS = Object.freeze({
  FILE_TYPE_NOT_ACCEPTED: ["PROJECT_FOLDER_FILE_TYPE_NOT_ACCEPTED", "Esta carpeta solo admite imágenes JPG o PNG."],
  FOLDER_FULL: ["PROJECT_FOLDER_FULL", "Esta carpeta ya tiene el máximo de archivos."],
  FOLDER_FULL_REPLACE_EXISTING: ["PROJECT_FOLDER_FULL", "La portada admite una sola imagen: reemplaza la existente."],
});

/**
 * Lee el destino de la carga: clave propia, clasificación heredada y archivos activos.
 * Lanza 404 si la carpeta no pertenece al proyecto o fue retirada.
 *
 * @param {{ projectId: number, folderId: number }} request - Proyecto y carpeta.
 * @param {{ query: Function }} [executor] - Cliente o pool.
 * @returns {Promise<{ systemKey: string|null, classificationKey: string|null, fileCount: number }>} Destino.
 * @throws {NotFoundError} PROJECT_FOLDER_NOT_FOUND.
 */
async function readTarget(request, executor) {
  const target = await findFolderUploadTarget(request, executor);
  if (!target) throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "Carpeta no encontrada.");
  return target;
}

/**
 * Aplica la regla de contenido de la carpeta a la extensión subida.
 * Solo la portada tiene reglas confirmadas; el resto de carpetas depende de D14 y admite la carga.
 *
 * @param {Object} target - Destino leído.
 * @param {string} extension - Extensión del archivo.
 * @returns {void}
 * @throws {ConflictError} PROJECT_FOLDER_FILE_TYPE_NOT_ACCEPTED o PROJECT_FOLDER_FULL.
 */
function assertTargetAccepts(target, extension) {
  const verdict = evaluateManagedUpload(target, extension);
  if (verdict.allowed) return;
  const [code, message] = RULE_ERRORS[verdict.reason] || ["PROJECT_FOLDER_UPLOAD_NOT_ALLOWED", "Esta carpeta no admite el archivo."];
  throw new ConflictError(code, message);
}

/**
 * Comprueba antes de transferir que el proyecto admite cargas del administrador (también un draft,
 * que prepara él) y que la carpeta existe, para no recibir el contenido de una carga imposible.
 *
 * @param {{ projectId: number, folderId: number, user: object }} request - Destino y administrador.
 * @returns {Promise<void>}
 * @throws {NotFoundError|ConflictError} 404 PROJECT_NOT_FOUND / PROJECT_FOLDER_NOT_FOUND; 409 de solo lectura.
 */
export async function assertFileManagerUploadTarget({ folderId, projectId, user }) {
  if (!(await findProjectForFileUpload(projectId, user))) throw new NotFoundError("PROJECT_NOT_FOUND", "No se encontro el proyecto.");
  await assertProjectOperationallyMutable(projectId, { allowDraft: true });
  await readTarget({ folderId, projectId });
}

/**
 * Registra la carga preparada en la carpeta. La regla de contenido se comprueba antes de leer el
 * cuerpo y de nuevo con el proyecto bloqueado (dos cargas simultáneas a la portada no la llenan dos
 * veces); si falla tras la transferencia, `storeThenRecord` elimina el objeto no registrado.
 *
 * @param {{ projectId: number, folderId: number, upload: object, user: object }} request - Carga validada.
 * @returns {Promise<object>} Archivo registrado con su v1 pendiente (`reviewStatus`, `versionId`).
 * @throws {ConflictError|NotFoundError} Reglas de carpeta, duplicados y estados de solo lectura.
 */
export async function storeFileManagerFile({ folderId, projectId, upload, user }) {
  const extension = getFileExtension(String(upload.originalName || ""));
  const target = await readTarget({ folderId, projectId });
  assertTargetAccepts(target, extension);
  /**
   * Categoría del archivo según el formato y la carpeta destino.
   * Las imágenes de «Panorámicas» se registran como panorámicas.
   *
   * @param {string} fileType - Tipo MIME normalizado.
   * @returns {string} Categoría.
   */
  function resolveFileCategory(fileType) {
    return resolveManagedFileCategory(target.classificationKey, fileType);
  }
  /**
   * Repite la regla de la carpeta con el proyecto bloqueado por la transacción de registro.
   * Si falla, la carga se rechaza y su objeto se compensa.
   *
   * @param {object} client - Cliente de la transacción.
   * @returns {Promise<void>}
   */
  async function verifyTarget(client) {
    assertTargetAccepts(await readTarget({ folderId, projectId }, client), extension);
  }
  return uploadProjectFile({ ...upload, configuringDraft: true, folderId, projectId, resolveFileCategory, reviewRequired: true, user, verifyTarget });
}
