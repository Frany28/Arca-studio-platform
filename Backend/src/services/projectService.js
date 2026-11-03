import {
  findProjectDetailByPublicSlugForUser,
  findProjectDetailForUser,
  findDirectProjectStateForUser,
  findProjectStateById,
  listProjectsForUser,
  updateProjectVisibility,
} from "../repositories/projectRepository.js";
import { insertDraftProject, reserveProjectId } from "../repositories/projectDraftRepository.js";
import { findExistingProjectNameForClient } from "../repositories/projectRequestRepository.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import { ConflictError } from "../errors/appError.js";
import { PROJECT_STATUS } from "../domain/projectStatus.js";
import { slugifyProjectName } from "../utils/projectSlug.js";
import {
  assertMutableProjectState,
  assertOperationallyMutableProjectState,
  assertProjectPublicationState,
} from "./projectMutationPolicy.js";

export const PROJECT_NAME_ALREADY_EXISTS = "PROJECT_NAME_ALREADY_EXISTS";
// projects.public_slug es VARCHAR(160): la parte derivada del nombre deja sitio al sufijo «-<id>».
const DRAFT_SLUG_BASE_MAX_LENGTH = 140;

/**
 * Comprueba el valor de proyecto mutable y rechaza la operación cuando no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {object} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} [options.findProjectState] - Valor de `options.findProjectState` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function assertProjectMutable(
  projectId,
  { findProjectState = findProjectStateById } = {},
) {
  const project = await findProjectState(projectId);
  return assertMutableProjectState(project);
}

/**
 * Comprueba el valor de proyecto operationally mutable y rechaza la operación cuando no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {object} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} [options.findProjectState] - Valor de `options.findProjectState` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function assertProjectOperationallyMutable(
  projectId,
  { findProjectState = findProjectStateById } = {},
) {
  const project = await findProjectState(projectId);
  return assertOperationallyMutableProjectState(project);
}

/**
 * Cambia la visibilidad solo de proyectos finalizados que tengan acceso directo autorizado.
 * Comprueba el cierre operativo y delega una escritura PostgreSQL que vuelve a exigir finished.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {boolean} options.isPublic - Valor de `options.isPublic` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function changeProjectPublication({ isPublic, projectId, user }) {
  const project = await findDirectProjectStateForUser(projectId, user);
  assertProjectPublicationState(project);
  return updateProjectVisibility(projectId, isPublic, user);
}

/**
 * Lista los proyectos accesibles respetando el alcance y la paginación solicitados.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.cursor] - Valor de `options.cursor` requerido por esta operación.
 * @param {number} options.limit - Valor de `options.limit` requerido por esta operación.
 * @param {unknown} options.scope - Valor de `options.scope` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function listProjects({ cursor = null, limit, scope, user }) {
  return listProjectsForUser(user, {
    cursor,
    directOnly: scope === "owned",
    limit,
  });
}

/**
 * Obtiene el detalle del proyecto para que el flujo llamador pueda continuar.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.fileCursor] - Valor de `options.fileCursor` requerido por esta operación.
 * @param {number} options.fileLimit - Valor de `options.fileLimit` requerido por esta operación.
 * @param {unknown} options.projectIdentifier - Valor de `options.projectIdentifier` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function getProjectDetail({
  fileCursor = null,
  fileLimit,
  projectIdentifier,
  user,
}) {
  const numericProjectId = Number(projectIdentifier);
  const usesNumericProjectId =
    Number.isInteger(numericProjectId) && numericProjectId > 0;
  const options = { fileCursor, fileLimit };

  return usesNumericProjectId
    ? findProjectDetailForUser(numericProjectId, user, options)
    : findProjectDetailByPublicSlugForUser(projectIdentifier, user, options);
}

/**
 * Crea un proyecto draft dentro de la transacción de una cotización: comprueba que el cliente no
 * tenga ya un proyecto no cancelado ni una solicitud activa con ese nombre (la misma regla que las
 * solicitudes), reserva el id, genera su identificador público y registra la auditoría. El llamador
 * debe haber bloqueado el cliente y validado su disponibilidad; si la transacción falla después,
 * el proyecto se revierte con ella.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} options - Datos del proyecto.
 * @param {number} options.clientId - Cliente registrado y disponible.
 * @param {string} options.name - Nombre normalizado y validado (normalizeProjectName).
 * @param {number} options.userId - Administrador que guarda la cotización.
 * @param {number} options.quoteId - Cotización que origina el proyecto (auditoría).
 * @returns {Promise<{ id: number, name: string }>} Proyecto draft creado.
 * @throws {ConflictError} PROJECT_NAME_ALREADY_EXISTS si el nombre ya existe en un proyecto o
 *   en una solicitud activa del cliente.
 */
export async function createDraftProject(client, { clientId, name, quoteId, userId }) {
  const existing = await findExistingProjectNameForClient(clientId, name, { executor: client });
  if (existing) {
    throw new ConflictError(
      PROJECT_NAME_ALREADY_EXISTS,
      existing.source === "project"
        ? `Ya existe el proyecto «${existing.name}» para este cliente. Selecciónalo en las sugerencias.`
        : "Hay una solicitud de proyecto activa con este nombre para el cliente.",
    );
  }

  const id = await reserveProjectId(client);
  const publicSlug = `${slugifyProjectName(name).slice(0, DRAFT_SLUG_BASE_MAX_LENGTH).replace(/-+$/, "")}-${id}`;
  const project = await insertDraftProject(client, { clientId, id, name, publicSlug, userId });
  await insertAuditLog({
    action: "project.create_from_quote",
    description: "Proyecto draft creado al guardar una cotización",
    entityId: project.id,
    entityType: "project",
    newValues: { clientId, name: project.name, quoteId, status: PROJECT_STATUS.DRAFT },
    userId,
  }, client);
  return project;
}
