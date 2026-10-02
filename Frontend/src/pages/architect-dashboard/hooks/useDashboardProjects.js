import { useEffect, useMemo, useState } from "react";

import { api } from "../../../api/http.js";
import { getProjectImageSource } from "../../../utils/projectImage.js";
import { getProjectAssigneeAvatar } from "../../../utils/projectAssigneeDisplay.js";
import { groupProjectsByStatus } from "../../../utils/projectStatusGroups.js";
import { isProjectOperationallyReadOnly } from "../../../utils/projectReadOnly.js";

function toProjectRow(project, user) {
  const assigneeAvatar = getProjectAssigneeAvatar(project);
  const isAssignedEmployee = (project.assignees || project.assignedArchitects || []).some(
    (assignee) => Number(assignee.id) === Number(user?.id),
  );

  return {
    ...project,
    assigneeAvatars: assigneeAvatar ? [assigneeAvatar] : [],
    editable:
      !isProjectOperationallyReadOnly(project) && (
        user?.role === "admin" ||
        project.assignedArchitect?.id === user?.id ||
        isAssignedEmployee
      ),
    image: getProjectImageSource(project),
    title: project.name,
  };
}

export function useDashboardProjects({ empty, user, projectsRequestKey }) {
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(!empty);

  const projectRows = useMemo(
    () => projects.map((project) => toProjectRow(project, user)),
    [projects, user],
  );
  const projectGroups = useMemo(
    () => groupProjectsByStatus(projectRows),
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

  return {
    projects,
    projectsError,
    projectsLoading,
    projectRows,
    projectGroups,
    setProjects,
  };
}
