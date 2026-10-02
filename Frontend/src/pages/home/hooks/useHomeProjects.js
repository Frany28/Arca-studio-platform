import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { getProjectAssigneeAvatar } from "../../../utils/projectAssigneeDisplay.js";
import { getProjectImageSource } from "../../../utils/projectImage.js";
import { isProjectOperationallyReadOnly } from "../../../utils/projectReadOnly.js";
import { groupProjectsByStatus } from "../../../utils/projectStatusGroups.js";

function getProjectAssigneeAvatars(project) {
  const assigneeAvatar = getProjectAssigneeAvatar(project);
  return assigneeAvatar ? [assigneeAvatar] : [];
}

function toProjectRow(project) {
  return {
    ...project,
    assigneeAvatars: getProjectAssigneeAvatars(project),
    image: getProjectImageSource(project),
    title: project.name,
  };
}

export default function useHomeProjects({ user }) {
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(true);
  const projectsRequestIdRef = useRef(0);

  const projectRows = useMemo(
    () => projects.map((project) => toProjectRow(project)),
    [projects],
  );

  const ownedProjectRows = useMemo(
    () =>
      projectRows.filter((project) => project.client?.id === user?.clientId),
    [projectRows, user?.clientId],
  );

  const commentProjectRows = useMemo(
    () =>
      ownedProjectRows.filter(
        (project) => !isProjectOperationallyReadOnly(project),
      ),
    [ownedProjectRows],
  );

  const publicProjectRows = useMemo(
    () =>
      projectRows.filter(
        (project) => project.isPublic && project.client?.id !== user?.clientId,
      ),
    [projectRows, user?.clientId],
  );

  const projectGroups = useMemo(
    () => groupProjectsByStatus(ownedProjectRows),
    [ownedProjectRows],
  );

  const loadProjects = useCallback(async () => {
    const requestId = projectsRequestIdRef.current + 1;
    projectsRequestIdRef.current = requestId;
    setProjectsLoading(true);
    setProjectsError("");

    if (!user) {
      setProjects([]);
      setProjectsLoading(false);
      return;
    }

    try {
      const data = await api.projects.listAll();
      if (projectsRequestIdRef.current === requestId) {
        setProjects(data.projects || []);
      }
    } catch {
      if (projectsRequestIdRef.current === requestId) {
        setProjects([]);
        setProjectsError("No se pudieron cargar los proyectos.");
      }
    } finally {
      if (projectsRequestIdRef.current === requestId) {
        setProjectsLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    loadProjects();

    return () => {
      projectsRequestIdRef.current += 1;
    };
  }, [loadProjects]);

  return {
    commentProjectRows,
    loadProjects,
    ownedProjectRows,
    projectGroups,
    projectsError,
    projectsLoading,
    publicProjectRows,
  };
}
