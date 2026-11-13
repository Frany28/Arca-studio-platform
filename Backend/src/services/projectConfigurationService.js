import { query, withTransaction } from "../config/db.js";
import {
  buildRequestReference,
  computeProgressFromStages,
  earliestStageStartDate,
  findMissingConfigurationRequirements,
} from "../domain/projectConfiguration.js";
import { normalizeProjectName } from "../domain/projectName.js";
import { PROJECT_STATUS } from "../domain/projectStatus.js";
import { findQuoteClient } from "../repositories/quoteParticipantRepository.js";
import { createDraftProject } from "./projectService.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import {
  deleteEmptyProjectFolder,
  finalizeProjectConfiguration,
  findProjectConfiguration,
  findProjectFolder,
  insertProjectFolder,
  listProjectConfigurationFiles,
  listProjectFolders,
  lockProjectForConfiguration,
  moveProjectFileToFolder,
  recordProjectRequestFirstContact,
  renameProjectFolder,
  replaceConfigurationAssignees,
  replaceProjectWarranties,
  replaceTrackingConfiguration,
  updateProjectGeneralConfiguration,
} from "../repositories/projectConfigurationRepository.js";

const MISSING_REQUIREMENT_MESSAGES = Object.freeze({
  assigneeIds: "Asigna al menos un responsable.",
  clientId: "El proyecto no tiene cliente.",
  constructionArea: "Indica el área de construcción.",
  generalArea: "Indica el área general.",
  location: "Indica la ubicación del proyecto.",
  name: "Escribe el nombre del proyecto.",
  projectType: "Selecciona el tipo de proyecto.",
  stages: "Agrega al menos una fase.",
  "stages.incomplete": "Completa nombre, estado y fechas de cada fase.",
  zoning: "Describe la zonificación.",
});

/**
 * Convierte un decimal o bigint de PostgreSQL a número y conserva null cuando falta, para que un
 * área no informada no se presente como cero.
 *
 * @param {unknown} value - Valor de la fila.
 * @returns {number|null} Número o null.
 */
function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Convierte la lectura del repositorio en el contrato público de la configuración: datos del
 * proyecto, responsables, fases, hitos, garantías, referencia de la solicitud de origen, requisitos
 * pendientes para finalizar y si todavía es editable (solo draft).
 *
 * @param {object} record - Resultado de `findProjectConfiguration`.
 * @returns {object} Configuración pública.
 */
function toConfiguration(record) {
  const { assignees, milestones, project, request, stages, warranties } = record;
  const configuration = {
    areaUnit: project.area_unit,
    assigneeIds: assignees.map((assignee) => assignee.id),
    assignees,
    client: { id: Number(project.client_id), name: project.client_name },
    clientId: Number(project.client_id),
    conditions: project.conditions,
    constructionArea: toNumber(project.construction_area),
    description: project.description,
    editable: project.status === PROJECT_STATUS.DRAFT,
    equipment: project.equipment,
    estimatedDeliveryDate: project.end_date ? new Date(project.end_date).toISOString().slice(0, 10) : null,
    formattedAddress: project.formatted_address,
    generalArea: toNumber(project.general_area),
    hasPlans: project.has_plans,
    id: Number(project.id),
    latitude: toNumber(project.location_latitude),
    location: project.location,
    longitude: toNumber(project.location_longitude),
    milestones,
    name: project.name,
    procedures: project.procedures,
    progress: computeProgressFromStages(stages),
    projectType: project.project_type,
    providerPlaceId: project.provider_place_id,
    request: buildRequestReference(request),
    stages,
    status: project.status,
    updatedAt: project.updated_at,
    warranties,
    zoning: project.zoning,
  };
  return { ...configuration, missingRequirements: findMissingConfigurationRequirements(configuration) };
}

/**
 * Lee la configuración vigente de un proyecto para el administrador.
 *
 * @param {number} projectId - Proyecto.
 * @returns {Promise<object>} Configuración pública.
 * @throws {NotFoundError} PROJECT_NOT_FOUND si no existe.
 */
export async function getProjectConfiguration(projectId) {
  const record = await findProjectConfiguration(projectId);
  if (!record) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  return toConfiguration(record);
}

/**
 * Ejecuta una escritura de la configuración con el proyecto bloqueado y en estado draft, y
 * devuelve la configuración resultante leída en la misma transacción. Solo un borrador se
 * configura: un proyecto pending o posterior conserva sus reglas operativas actuales.
 *
 * @param {number} projectId - Proyecto.
 * @param {(client: import("pg").PoolClient, project: object) => Promise<void>} write - Escritura.
 * @returns {Promise<object>} Configuración pública actualizada.
 * @throws {NotFoundError|ConflictError} Si no existe o ya no es un borrador.
 */
async function writeDraftConfiguration(projectId, write) {
  return withTransaction(async (client) => {
    const project = await lockProjectForConfiguration(client, projectId);
    if (!project) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
    if (project.status !== PROJECT_STATUS.DRAFT) {
      throw new ConflictError("PROJECT_NOT_DRAFT", "Solo se puede configurar un proyecto en borrador.");
    }
    await write(client, project);
    return toConfiguration(await findProjectConfiguration(projectId, client));
  });
}

/**
 * Guarda «Información general» del borrador. No cambia su estado: guardar no habilita el proyecto.
 *
 * @param {{payload: object, projectId: number, user: {id: number}}} params - Datos validados.
 * @returns {Promise<object>} Configuración actualizada.
 * @throws {ValidationError} Si algún responsable no es un administrador o arquitecto activo.
 */
export async function saveProjectGeneralConfiguration({ payload, projectId, user }) {
  const { assigneeIds, ...general } = payload;
  return writeDraftConfiguration(projectId, async (client) => {
    await updateProjectGeneralConfiguration(client, projectId, general);
    const replaced = await replaceConfigurationAssignees(client, { assignedBy: user.id, assigneeIds, projectId });
    if (!replaced) {
      throw new ValidationError("Los datos enviados no son válidos.", {
        "body.assigneeIds": "Solo se pueden asignar administradores o arquitectos activos.",
      });
    }
  });
}

/**
 * Guarda «Seguimiento»: fases, hitos y entrega estimada, y recalcula el progreso desde las fases.
 *
 * @param {{payload: object, projectId: number}} params - Datos validados.
 * @returns {Promise<object>} Configuración actualizada.
 */
export async function saveProjectTrackingConfiguration({ payload, projectId }) {
  return writeDraftConfiguration(projectId, (client) => replaceTrackingConfiguration(client, {
    estimatedDeliveryDate: payload.estimatedDeliveryDate,
    milestones: payload.milestones,
    progress: computeProgressFromStages(payload.stages),
    projectId,
    stages: payload.stages,
  }));
}

/**
 * Guarda «Garantías» (opcionales) del borrador.
 *
 * @param {{payload: {warranties: object[]}, projectId: number, user: {id: number}}} params - Datos.
 * @returns {Promise<object>} Configuración actualizada.
 */
export async function saveProjectWarrantiesConfiguration({ payload, projectId, user }) {
  return writeDraftConfiguration(projectId, (client) => replaceProjectWarranties(client, {
    createdBy: user.id,
    projectId,
    warranties: payload.warranties,
  }));
}

/**
 * Confirma «Finalizar configuración»: con el proyecto bloqueado comprueba que sigue en draft y que
 * todos los requisitos obligatorios están completos; entonces lo pasa a pending con la fecha de
 * inicio de su primera fase, registra historial y auditoría y notifica al cliente. Es la única vía
 * draft → pending; no inicia el proyecto (in_process sigue siendo una acción aparte).
 *
 * @param {{projectId: number, user: {id: number}}} params - Proyecto y administrador.
 * @returns {Promise<object>} Configuración final (status pending, editable false).
 * @throws {ValidationError} Con un campo por requisito pendiente.
 */
export async function finalizeProjectDraftConfiguration({ projectId, user }) {
  return writeDraftConfiguration(projectId, async (client) => {
    const current = toConfiguration(await findProjectConfiguration(projectId, client));
    if (current.missingRequirements.length) {
      throw new ValidationError(
        "Completa la información obligatoria antes de finalizar la configuración.",
        Object.fromEntries(current.missingRequirements.map((code) => [code, MISSING_REQUIREMENT_MESSAGES[code] || "Requerido."])),
      );
    }
    await finalizeProjectConfiguration(client, {
      changedBy: user.id,
      projectId,
      startDate: earliestStageStartDate(current.stages),
    });
  });
}

/**
 * Modo creación de «Nuevo proyecto»: crea un borrador mínimo (cliente y nombre) que se completa
 * con la misma configuración que un borrador aprobado. Reutiliza `createDraftProject` (unicidad de
 * nombre por cliente, slug, auditoría) y comprueba el cliente con FOR SHARE en la transacción.
 *
 * @param {{clientId: number, name: string, user: {id: number}}} params - Cliente y nombre validados.
 * @returns {Promise<{projectId: number}>} Proyecto draft creado.
 * @throws {ValidationError} Si el cliente no existe o no está disponible.
 * @throws {ConflictError} PROJECT_NAME_ALREADY_EXISTS si el nombre ya se usa para ese cliente.
 */
export async function createManualDraftProject({ clientId, name, user }) {
  return withTransaction(async (client) => {
    const owner = await findQuoteClient(clientId, client, true);
    if (!owner?.isAvailable) {
      throw new ValidationError("Los datos enviados no son válidos.", { "body.clientId": "Selecciona un cliente disponible." });
    }
    const project = await createDraftProject(client, { clientId, name: normalizeProjectName(name), origin: "manual", userId: user.id });
    return { projectId: project.id };
  });
}

/**
 * Registra el primer contacto real con el cliente de una solicitud aprobada (idempotente).
 *
 * @param {{projectRequestId: number, user: {id: number}}} params - Solicitud y administrador.
 * @returns {Promise<{firstContactAt: string, alreadyRecorded: boolean}>} Fecha registrada.
 * @throws {NotFoundError|ConflictError} Si no existe o no está aprobada.
 */
export async function recordFirstContact({ projectRequestId, user }) {
  const result = await recordProjectRequestFirstContact({ projectRequestId, userId: user.id });
  if (result.outcome === "not_found") throw new NotFoundError("PROJECT_REQUEST_NOT_FOUND", "Solicitud no encontrada.");
  if (result.outcome === "invalid_state") {
    throw new ConflictError("PROJECT_REQUEST_INVALID_STATE", "Solo se registra el primer contacto de una solicitud aprobada.");
  }
  return { alreadyRecorded: result.outcome === "already_recorded", firstContactAt: result.firstContactAt };
}

/**
 * Traduce el nombre repetido entre carpetas hermanas (índice uq_project_folders_sibling_name) a
 * un error de validación del campo; cualquier otro error se propaga sin cambios.
 *
 * @param {Error & {code?: string, constraint?: string}} error - Error de PostgreSQL.
 * @returns {never} Siempre lanza.
 * @throws {ValidationError|Error} El error traducido o el original.
 */
function rethrowFolderError(error) {
  if (error?.code === "23505" && error.constraint === "uq_project_folders_sibling_name") {
    throw new ValidationError("Los datos enviados no son válidos.", { "body.name": "Ya existe una carpeta con ese nombre en esta ubicación." });
  }
  throw error;
}

/**
 * Lista carpetas y archivos del borrador para «Gestión de archivos».
 *
 * @param {number} projectId - Proyecto.
 * @returns {Promise<{folders: object[], files: object[]}>} Árbol plano y archivos.
 * @throws {NotFoundError} Si el proyecto no existe.
 */
export async function getProjectConfigurationFiles(projectId) {
  const record = await findProjectConfiguration(projectId);
  if (!record) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  const [folders, files] = await Promise.all([listProjectFolders(projectId), listProjectConfigurationFiles(projectId)]);
  return { files, folders };
}

/**
 * Crea una carpeta (en la raíz o dentro de otra del mismo proyecto) en un borrador.
 *
 * @param {{name: string, parentId: number|null, projectId: number, user: {id: number}}} params - Carpeta.
 * @returns {Promise<object>} Carpeta creada.
 */
export async function createProjectFolder({ name, parentId, projectId, user }) {
  try {
    return await withTransaction(async (client) => {
      const project = await lockProjectForConfiguration(client, projectId);
      if (!project) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
      if (project.status !== PROJECT_STATUS.DRAFT) throw new ConflictError("PROJECT_NOT_DRAFT", "Solo se puede configurar un proyecto en borrador.");
      if (parentId && !(await findProjectFolder(client, projectId, parentId))) {
        throw new ValidationError("Los datos enviados no son válidos.", { "body.parentId": "La carpeta superior no existe." });
      }
      return insertProjectFolder(client, { createdBy: user.id, name, parentId, projectId });
    });
  } catch (error) {
    return rethrowFolderError(error);
  }
}

/**
 * Renombra una carpeta de un borrador.
 *
 * @param {{folderId: number, name: string, projectId: number}} params - Carpeta y nombre.
 * @returns {Promise<{folders: object[]}>} Carpetas actualizadas.
 */
export async function updateProjectFolder({ folderId, name, projectId }) {
  try {
    await writeDraftConfiguration(projectId, async (client) => {
      if (!(await renameProjectFolder(client, { folderId, name, projectId }))) {
        throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "Carpeta no encontrada.");
      }
    });
  } catch (error) {
    rethrowFolderError(error);
  }
  return { folders: await listProjectFolders(projectId) };
}

/**
 * Elimina una carpeta vacía de un borrador; con contenido responde 409 PROJECT_FOLDER_NOT_EMPTY.
 *
 * @param {{folderId: number, projectId: number}} params - Carpeta.
 * @returns {Promise<{folders: object[]}>} Carpetas restantes.
 */
export async function deleteProjectFolder({ folderId, projectId }) {
  await writeDraftConfiguration(projectId, async (client) => {
    const outcome = await deleteEmptyProjectFolder(client, { folderId, projectId });
    if (outcome === "not_found") throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "Carpeta no encontrada.");
    if (outcome === "not_empty") throw new ConflictError("PROJECT_FOLDER_NOT_EMPTY", "La carpeta tiene archivos o subcarpetas.");
  });
  return { folders: await listProjectFolders(projectId) };
}

/**
 * Mueve un archivo del borrador a una carpeta del mismo proyecto o a la raíz.
 *
 * @param {{fileId: number, folderId: number|null, projectId: number}} params - Archivo y destino.
 * @returns {Promise<{files: object[], folders: object[]}>} Archivos y carpetas actualizados.
 */
export async function moveProjectFile({ fileId, folderId, projectId }) {
  await writeDraftConfiguration(projectId, async (client) => {
    if (folderId && !(await findProjectFolder(client, projectId, folderId))) {
      throw new ValidationError("Los datos enviados no son válidos.", { "body.folderId": "La carpeta no existe." });
    }
    if (!(await moveProjectFileToFolder(client, { fileId, folderId, projectId }))) {
      throw new NotFoundError("FILE_NOT_FOUND", "Archivo no encontrado.");
    }
  });
  return getProjectConfigurationFiles(projectId);
}

/**
 * Comprueba antes de transferir que el proyecto es un borrador y que la carpeta destino existe.
 * El registro del archivo lo repite con el proyecto bloqueado.
 *
 * @param {{folderId: number|null, projectId: number}} params - Proyecto y carpeta.
 * @returns {Promise<void>} Finaliza si el destino es válido.
 */
export async function assertDraftUploadTarget({ folderId, projectId }) {
  const record = await findProjectConfiguration(projectId);
  if (!record) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  if (record.project.status !== PROJECT_STATUS.DRAFT) throw new ConflictError("PROJECT_NOT_DRAFT", "Solo se puede configurar un proyecto en borrador.");
  if (folderId && !(await findProjectFolder({ query }, projectId, folderId))) {
    throw new ValidationError("Los datos enviados no son válidos.", { "query.folderId": "La carpeta no existe." });
  }
}
