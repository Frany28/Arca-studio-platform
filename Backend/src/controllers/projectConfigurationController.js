import { uploadProjectFile } from "../repositories/fileRepository.js";
import { runUpload, uploadPolicies } from "../services/fileUploadService.js";
import {
  assertDraftUploadTarget,
  createManualDraftProject,
  createProjectFolder,
  deleteProjectFolder,
  finalizeProjectDraftConfiguration,
  getProjectConfiguration,
  getProjectConfigurationFiles,
  moveProjectFile,
  recordFirstContact,
  saveProjectGeneralConfiguration,
  saveProjectTrackingConfiguration,
  saveProjectWarrantiesConfiguration,
  updateProjectFolder,
} from "../services/projectConfigurationService.js";

const NO_STORE = "private, no-store";

/**
 * Responde una lectura o escritura de la configuración sin caché compartida: el contenido es
 * administrativo y cambia con cada guardado.
 *
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {number} status - Estado HTTP.
 * @param {object} body - Cuerpo JSON.
 * @returns {void}
 */
function sendPrivate(res, status, body) {
  res.set("Cache-Control", NO_STORE).status(status).json(body);
}

/**
 * Crea un controlador que delega en el servicio y responde con la clave indicada. Centraliza el
 * envío de errores al middleware para los handlers de la configuración.
 *
 * @param {(req: import("express").Request) => Promise<object>} run - Operación del servicio.
 * @param {number} [status=200] - Estado HTTP del éxito.
 * @returns {import("express").RequestHandler} Controlador Express.
 */
function handle(run, status = 200) {
  return async (req, res, next) => {
    try {
      sendPrivate(res, status, await run(req));
    } catch (error) {
      next(error);
    }
  };
}

export const postDraftProject = handle((req) => createManualDraftProject({ ...req.body, user: req.user }), 201);

export const getConfiguration = handle(async (req) => ({ configuration: await getProjectConfiguration(req.params.projectId) }));

export const putGeneralConfiguration = handle(async (req) => ({
  configuration: await saveProjectGeneralConfiguration({ payload: req.body, projectId: req.params.projectId, user: req.user }),
}));

export const putTrackingConfiguration = handle(async (req) => ({
  configuration: await saveProjectTrackingConfiguration({ payload: req.body, projectId: req.params.projectId }),
}));

export const putWarrantiesConfiguration = handle(async (req) => ({
  configuration: await saveProjectWarrantiesConfiguration({ payload: req.body, projectId: req.params.projectId, user: req.user }),
}));

export const postFinalizeConfiguration = handle(async (req) => ({
  configuration: await finalizeProjectDraftConfiguration({ projectId: req.params.projectId, user: req.user }),
}));

export const getConfigurationFiles = handle((req) => getProjectConfigurationFiles(req.params.projectId));

export const postProjectFolder = handle(async (req) => ({
  folder: await createProjectFolder({ ...req.body, projectId: req.params.projectId, user: req.user }),
}), 201);

export const patchProjectFolder = handle((req) => updateProjectFolder({ folderId: req.params.folderId, name: req.body.name, projectId: req.params.projectId }));

export const deleteProjectFolderById = handle((req) => deleteProjectFolder({ folderId: req.params.folderId, projectId: req.params.projectId }));

export const patchProjectFileFolder = handle((req) => moveProjectFile({ fileId: req.params.fileId, folderId: req.body.folderId, projectId: req.params.projectId }));

export const postFirstContact = handle(async (req) => recordFirstContact({ projectRequestId: req.params.projectRequestId, user: req.user }));

/**
 * Sube un archivo a un proyecto draft desde la configuración, opcionalmente dentro de una carpeta.
 * Comprueba el borrador y la carpeta antes de transferir y reutiliza la carga existente (firma,
 * límites, streaming y compensación), que repite las comprobaciones con el proyecto bloqueado.
 *
 * @param {import("express").Request} req - Solicitud con `projectId` y `folderId` opcional.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Middleware de errores.
 * @returns {Promise<void>} 201 con el archivo; 409 DUPLICATE_PROJECT_FILE si el nombre ya existe.
 */
export async function postConfigurationFile(req, res, next) {
  try {
    const projectId = req.params.projectId;
    const folderId = req.validatedQuery?.folderId ?? null;
    await assertDraftUploadTarget({ folderId, projectId });
    /**
     * Registra la carga preparada en el borrador, en la carpeta indicada. La única escritura de
     * archivos admitida en draft es esta configuración administrativa.
     *
     * @param {object} upload - Carga validada por runUpload.
     * @returns {Promise<object>} Archivo registrado.
     */
    function storeDraftFile(upload) {
      return uploadProjectFile({ ...upload, configuringDraft: true, folderId, projectId, user: req.user });
    }
    const file = await runUpload({ operation: storeDraftFile, policy: uploadPolicies.document, req });
    sendPrivate(res, 201, { file });
  } catch (error) {
    if (error.code === "DUPLICATE_PROJECT_FILE" || error.code === "23505") {
      sendPrivate(res, 409, { code: "DUPLICATE_PROJECT_FILE", message: "Ese archivo ya existe en este proyecto." });
      return;
    }
    next(error);
  }
}
