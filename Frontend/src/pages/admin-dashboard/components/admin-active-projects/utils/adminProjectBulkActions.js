import { isProjectFinalized } from "../../../../../utils/projectReadOnly.js";

/**
 * Reutiliza el cierre operativo compartido para las acciones administrativas de visibilidad.
 * @param {Object|null} project Proyecto seleccionado en el dashboard o Gestión.
 * @returns {boolean} Si el proyecto tiene el estado canónico de finalización o su alias temporal.
 */
export function isFinalizedProject(project) {
  return isProjectFinalized(project);
}

export function isArchivedProject(project) {
  return Boolean(
    project?.status === "archived"
      || project?.archived === true
      || project?.isArchived === true
      || project?.archivedAt
      || project?.deletedAt
      || project?.deleted_at,
  );
}

export function getBulkActionAvailability(selectedProjects) {
  const hasSelection = selectedProjects.length > 0;
  const allSelectedProjectsAreArchived =
    hasSelection && selectedProjects.every(isArchivedProject);
  const allSelectedProjectsAreUnarchived =
    hasSelection && selectedProjects.every((project) => !isArchivedProject(project));
  const selectedVisibility = Boolean(selectedProjects[0]?.isPublic);
  const allSelectedProjectsShareVisibility =
    hasSelection
    && selectedProjects.every(
      (project) => Boolean(project?.isPublic) === selectedVisibility,
    );

  return {
    canChangeVisibility:
      allSelectedProjectsAreUnarchived
      && allSelectedProjectsShareVisibility
      && selectedProjects.every(
        isFinalizedProject,
      ),
    canArchive: allSelectedProjectsAreUnarchived,
    canUnarchive: allSelectedProjectsAreArchived,
  };
}
