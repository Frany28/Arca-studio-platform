import {
  createFileManagerFolder,
  deleteFileManagerFolder,
  getFileManagerMetrics,
  getFileManagerTree,
  listFileManagerTab,
  renameFileManagerFolder,
  searchFolders,
} from "../services/fileManagerService.js";

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
