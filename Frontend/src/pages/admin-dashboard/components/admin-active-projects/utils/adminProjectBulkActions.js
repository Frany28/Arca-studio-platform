const FINALIZED_PROJECT_STATUSES = new Set(["completed", "finished"]);

export function isFinalizedProject(project) {
  return FINALIZED_PROJECT_STATUSES.has(project?.status);
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
