import {
  createFileManagerFolder,
  deleteFileManagerFolder,
  getFileManagerMetrics,
  getFileManagerTree,
  listFileManagerTab,
  renameFileManagerFolder,
  searchFolders,
} from "../services/fileManagerService.js";
import { assertFileManagerUploadTarget, storeFileManagerFile } from "../services/fileManagerUploadService.js";
import { runUpload, uploadPolicies } from "../services/fileUploadService.js";

// Administrador de archivos (Fase 1.2, B7). Solo traduce HTTP; las reglas viven en
// services/fileManagerService.js. Las lecturas no se guardan en caché compartida: dependen del
// estado de revisión, que cambia con cada aprobación.

/**
 * Crea un manejador que responde con el resultado del servicio y entrega los errores al middleware.
 * Marca la respuesta como privada y sin almacenamiento: son datos internos y cambiantes.
 *
 * @param {(req: import("express").Request) => Promise<object>} run - Llamada al servicio.
 * @param {number} [status] - Estado HTTP de éxito.
 * @returns {import("express").RequestHandler} Manejador.
 */
function respond(run, status = 200) {
  return async function fileManagerHandler(req, res, next) {
    try {
      const body = await run(req);
      res.setHeader("Cache-Control", "private, no-store");
      res.status(status).json(body);
    } catch (error) {
      next(error);
    }
  };
}

export const getFileManagerMetricsHandler = respond((req) => getFileManagerMetrics(req.validatedQuery));
export const getFileManagerTreeHandler = respond((req) => getFileManagerTree(req.validatedQuery));
export const searchFileManagerFoldersHandler = respond((req) => searchFolders(req.validatedQuery));
export const getFileManagerItemsHandler = respond((req) => listFileManagerTab(req.validatedQuery));
export const postFileManagerFolder = respond((req) => createFileManagerFolder({ ...req.body, projectId: req.params.projectId, user: req.user }), 201);
export const patchFileManagerFolder = respond((req) => renameFileManagerFolder({
  folderId: req.params.folderId, name: req.body.name, projectId: req.params.projectId, user: req.user,
}));
export const deleteFileManagerFolderHandler = respond((req) => deleteFileManagerFolder({
  folderId: req.params.folderId, projectId: req.params.projectId, user: req.user,
}));

/**
 * Sube un archivo nuevo a una carpeta del proyecto (U3). Comprueba proyecto y carpeta antes de leer
 * el contenido y reutiliza la carga de documentos (formatos, límites, firma y compensación). La v1
 * nace pendiente de revisión; un nombre ya usado en el proyecto responde 409 DUPLICATE_PROJECT_FILE.
 *
 * @param {import("express").Request} req - Solicitud con `projectId` y `folderId` validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Middleware de errores.
 * @returns {Promise<void>} 201 `{file}`.
 */
export async function postFileManagerFile(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    const folderId = Number(req.validatedQuery.folderId);
    await assertFileManagerUploadTarget({ folderId, projectId, user: req.user });
    /**
     * Registra la carga validada en la carpeta destino.
     * La regla de la carpeta se repite con el proyecto bloqueado.
     *
     * @param {object} upload - Contenido, tipo, nombre y tamaño.
     * @returns {Promise<object>} Archivo registrado.
     */
    function storeInFolder(upload) {
      return storeFileManagerFile({ folderId, projectId, upload, user: req.user });
    }
    const file = await runUpload({ operation: storeInFolder, policy: uploadPolicies.document, req });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(201).json({ file });
  } catch (error) {
    if (error.code === "DUPLICATE_PROJECT_FILE" || error.code === "23505") {
      res.status(409).json({ code: "DUPLICATE_PROJECT_FILE", message: "Ese archivo ya existe en este proyecto." });
      return;
    }
    next(error);
  }
}
