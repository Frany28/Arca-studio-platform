import {
  applyAdminProjectBulkAction,
  getAdminDashboardMetrics,
  getAdminDashboardOverview,
  listAdminAssignees,
  replaceProjectAssignees,
  replaceProjectRequestAssignees,
} from "../repositories/adminDashboardRepository.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import { assertProjectOperationallyMutable } from "./projectService.js";

/**
 * Carga las métricas del panel administrativo y deja el resultado disponible para el flujo actual.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
export function loadAdminDashboardMetrics() {
  return getAdminDashboardMetrics();
}

/**
 * Carga el resumen del panel administrativo y deja el resultado disponible para el flujo actual.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
export function loadAdminDashboardOverview() {
  return getAdminDashboardOverview();
}

/**
 * Carga los responsables disponibles para administración y deja el resultado disponible para el flujo actual.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
export function loadAdminAssignees() {
  return listAdminAssignees();
}

/**
 * Coordina las acciones administrativas de visibilidad, archivo y recuperación de proyectos.
 * Traduce resultados transaccionales a errores públicos y exige finished para cambiar visibilidad.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.action - Valor de `options.action` requerido por esta operación.
 * @param {boolean} options.isPublic - Valor de `options.isPublic` requerido por esta operación.
 * @param {Array<unknown>} options.projectIds - Valor de `options.projectIds` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function manageAdminProjects({ action, isPublic, projectIds, userId }) {
  const result = await applyAdminProjectBulkAction({
    action,
    isPublic,
    projectIds,
    userId,
  });

  if (result.outcome === "not_found") {
    throw new NotFoundError(
      "PROJECT_NOT_FOUND",
      "Uno o varios proyectos no existen.",
    );
  }

  if (result.outcome === "visibility_requires_finished") {
    throw new ValidationError(
      "La visibilidad solo puede cambiarse en proyectos finalizados.",
      { projectIds: "Incluye al menos un proyecto no finalizado o archivado." },
    );
  }

  if (result.outcome === "unarchive_requires_archived") {
    throw new ValidationError(
      "Solo se pueden desarchivar proyectos archivados.",
      { projectIds: "Incluye al menos un proyecto que no esta archivado." },
    );
  }

  return result.projects;
}

/**
 * Comprueba el valor de assignment result y rechaza la operación cuando no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} result - Valor de `result` requerido por esta operación.
 * @param {string} notFoundCode - Valor de `notFoundCode` requerido por esta operación.
 * @param {unknown} notFoundMessage - Valor de `notFoundMessage` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
function assertAssignmentResult(result, notFoundCode, notFoundMessage) {
  if (!result.targetExists) {
    throw new NotFoundError(notFoundCode, notFoundMessage);
  }

  if (!result.allEligible) {
    throw new ValidationError(
      "Solo se pueden asignar usuarios activos con rol de empleado.",
      { assigneeIds: "Incluye al menos un usuario no elegible." },
    );
  }

  return result.assignees;
}

/**
 * Procesa el valor de assign employees to proyecto para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {Array<unknown>} options.assigneeIds - Valor de `options.assigneeIds` requerido por esta operación.
 * @param {unknown} options.assignedBy - Valor de `options.assignedBy` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function assignEmployeesToProject({
  assigneeIds,
  assignedBy,
  projectId,
}) {
  await assertProjectOperationallyMutable(projectId);
  const result = await replaceProjectAssignees({
    assigneeIds,
    assignedBy,
    projectId,
  });

  return assertAssignmentResult(
    result,
    "PROJECT_NOT_FOUND",
    "Proyecto no encontrado.",
  );
}

/**
 * Procesa el valor de assign employees to proyecto solicitud para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {Array<unknown>} options.assigneeIds - Valor de `options.assigneeIds` requerido por esta operación.
 * @param {unknown} options.assignedBy - Valor de `options.assignedBy` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function assignEmployeesToProjectRequest({
  assigneeIds,
  assignedBy,
  projectRequestId,
}) {
  const result = await replaceProjectRequestAssignees({
    assigneeIds,
    assignedBy,
    projectRequestId,
  });

  if (!result.targetExists) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "Solicitud de proyecto no encontrada.",
    );
  }
  if (!result.mutable) {
    throw new ConflictError(
      "PROJECT_REQUEST_CLOSED",
      "Los responsables solo pueden cambiarse durante la verificación o revisión.",
    );
  }
  if (!result.allEligible) {
    throw new ValidationError(
      "Solo se pueden asignar administradores o arquitectos activos.",
      { assigneeIds: "Incluye al menos un usuario no elegible." },
    );
  }
  if (!result.assignmentAllowed) {
    throw new ValidationError(
      "Una solicitud en revisión debe conservar al menos un arquitecto asignado.",
      { assigneeIds: "Selecciona al menos un arquitecto." },
    );
  }

  return result.assignees;
}
