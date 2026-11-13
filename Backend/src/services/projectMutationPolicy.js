import { ConflictError, NotFoundError } from "../errors/appError.js";
import { PROJECT_DRAFT_READ_ONLY_MESSAGE, PROJECT_STATUS, isProjectFinalized } from "../domain/projectStatus.js";

/**
 * Comprueba el valor de mutable proyecto state y rechaza la operación cuando no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} project - Valor de `project` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export function assertMutableProjectState(project) {
  if (!project) {
    throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  }

  if (project.status === "archived") {
    throw new ConflictError(
      "PROJECT_ARCHIVED",
      "Desarchiva el proyecto antes de realizar cambios.",
    );
  }

  return project;
}

/**
 * Impide cambios operativos (archivos, comentarios, responsables) en proyectos draft, archivados
 * o finalizados con finished. Reconoce el alias histórico de finalización y conserva los códigos
 * de conflicto existentes; un draft responde 409 PROJECT_DRAFT.
 *
 * Con `allowDraft` admite un draft: solo lo usan operaciones administrativas que preparan el
 * borrador (subir archivos y asignar encargados); los comentarios siguen rechazándolo.
 *
 * @param {unknown} project - Valor de `project` requerido por esta operación.
 * @param {{allowDraft?: boolean}} [options] - Admite un draft (solo administración).
 * @returns {unknown} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export function assertOperationallyMutableProjectState(project, { allowDraft = false } = {}) {
  const mutableProject = assertMutableProjectState(project);

  if (mutableProject.status === PROJECT_STATUS.DRAFT && !allowDraft) {
    throw new ConflictError("PROJECT_DRAFT", PROJECT_DRAFT_READ_ONLY_MESSAGE);
  }

  if (isProjectFinalized(mutableProject.status)) {
    throw new ConflictError(
      "PROJECT_FINALIZED",
      "El proyecto finalizado es de solo lectura.",
    );
  }

  return mutableProject;
}

/**
 * Exige un proyecto finalizado y accesible para modificar su visibilidad pública.
 * Rechaza primero proyectos ausentes o archivados; no sustituye la autorización del endpoint.
 *
 * @param {object|null} project - Estado del proyecto obtenido tras comprobar el acceso directo.
 * @returns {object} Proyecto elegible para publicación u ocultación.
 * @throws {NotFoundError|ConflictError} Si falta el proyecto, está archivado o no ha finalizado.
 */
export function assertProjectPublicationState(project) {
  const mutableProject = assertMutableProjectState(project);
  if (!isProjectFinalized(mutableProject.status)) {
    throw new ConflictError(
      "PROJECT_NOT_FINISHED",
      "La visibilidad solo puede cambiarse en proyectos finalizados.",
    );
  }
  return mutableProject;
}
