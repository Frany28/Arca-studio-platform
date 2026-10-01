import { api } from "../../../api/http.js";

export function useAdminProjectBulkActions({ setProjects, setAdminMetricsRequestKey, setAdminOverviewRequestKey }) {
  const handleProjectBulkAction = async ({ action, projects: selectedProjects }) => {
    const isPublic = action === "change_visibility"
      ? !selectedProjects.every((project) => project.isPublic)
      : undefined;
    const data = await api.admin.updateProjects({
      action,
      isPublic,
      projectIds: selectedProjects.map((project) => Number(project.id)),
    });
    const updatedProjects = new Map(
      (data.projects || []).map((project) => [Number(project.id), project]),
    );

    setProjects((currentProjects) =>
      currentProjects.map((project) => {
        const updatedProject = updatedProjects.get(Number(project.id));
        return updatedProject ? { ...project, ...updatedProject } : project;
      }),
    );
    setAdminMetricsRequestKey((current) => current + 1);
    setAdminOverviewRequestKey((current) => current + 1);

    return data;
  };

return { handleProjectBulkAction };
}
