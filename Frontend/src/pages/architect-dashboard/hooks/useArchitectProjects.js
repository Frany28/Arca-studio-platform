import { toProjectRow } from "../utils/architectProjectPresentation.js";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../api/http.js";
import { groupProjectsByStatus } from "../../../utils/projectStatusGroups.js";

export function useArchitectProjects({ empty, user, currentUser }) {
  const [projects, setProjects] = useState([]);

  const [projectsError, setProjectsError] = useState("");

  const [projectsLoading, setProjectsLoading] = useState(!empty);

  const [projectsRequestKey, setProjectsRequestKey] = useState(0);

  const projectRows = useMemo(
    () => projects.map((project) => toProjectRow(project, user)),
    [projects, user],
  );

  const commentProjectRows = useMemo(
    () =>
      currentUser.roleCode === "admin"
        ? []
        : projectRows.filter((project) => project.editable),
    [currentUser.roleCode, projectRows],
  );

  const projectGroups = useMemo(
    () => groupProjectsByStatus(projectRows),
    [projectRows],
  );

  const upcomingDeliveries = useMemo(
    () =>
      [...projectRows]
        .filter(
          (project) =>
            !["archived", "completed", "cancelled"].includes(project.status),
        )
        .sort((first, second) => {
          const firstDate = first.endDate
            ? new Date(first.endDate).getTime()
            : Number.POSITIVE_INFINITY;
          const secondDate = second.endDate
            ? new Date(second.endDate).getTime()
            : Number.POSITIVE_INFINITY;

          return firstDate - secondDate;
        })
        .slice(0, 3),
    [projectRows],
  );

  useEffect(() => {
    let isMounted = true;

    if (empty) {
      return () => {
        isMounted = false;
      };
    }

    queueMicrotask(() => {
      if (isMounted) {
        setProjectsLoading(true);
        setProjectsError("");
      }
    });

    if (!user) {
      queueMicrotask(() => {
        if (isMounted) setProjectsLoading(false);
      });
      return () => {
        isMounted = false;
      };
    }

    api.projects
      .listAll()
      .then((data) => {
        if (isMounted) {
          setProjects(data.projects || []);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProjects([]);
          setProjectsError("No se pudieron cargar los proyectos.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setProjectsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [empty, projectsRequestKey, user]);

  const handlePublicationChange = async (project) => {
    if (project.status === "archived") return;
    const nextIsPublic = !project.isPublic;
    const data = await api.projects.updatePublication({
      isPublic: nextIsPublic,
      projectId: project.id,
    });

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) =>
        currentProject.id === project.id ? data.project : currentProject,
      ),
    );
  };

  const handleProjectAssigneesChange = async (project, assignees) => {
    const data = await api.admin.updateProjectAssignees({
      assigneeIds: assignees.map((assignee) => Number(assignee.id)),
      projectId: project.id,
    });

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) =>
        currentProject.id === project.id
          ? {
              ...currentProject,
              assignees: data.assignees || [],
              assignedArchitect: data.assignees?.[0] || null,
              assignedArchitects: data.assignees || [],
            }
          : currentProject,
      ),
    );
  };

  return {
    setProjects,
    projectsError,
    projectsLoading,
    setProjectsRequestKey,
    projectRows,
    commentProjectRows,
    projectGroups,
    upcomingDeliveries,
    handlePublicationChange,
    handleProjectAssigneesChange,
  };
}
