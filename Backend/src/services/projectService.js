import {
  findProjectDetailByPublicSlugForUser,
  findProjectDetailForUser,
  findDirectProjectStateForUser,
  findProjectStateById,
  listProjectsForUser,
  updateProjectVisibility,
} from "../repositories/projectRepository.js";
import {
  assertMutableProjectState,
  assertOperationallyMutableProjectState,
  assertProjectPublicationState,
} from "./projectMutationPolicy.js";

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
