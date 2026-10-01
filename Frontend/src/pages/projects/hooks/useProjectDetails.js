import { useCallback, useEffect, useState } from "react";
import { api } from "../../../api/http.js";
import { getProjectPath } from "../../../utils/projectRoutes.js";

export function useProjectDetails({
  providedProject,
  navigate,
  routeProjectSlug,
  searchParams,
}) {
  const parsedRouteProjectId = Number(routeProjectSlug);

  const routeUsesNumericProjectId =
    Number.isInteger(parsedRouteProjectId) && parsedRouteProjectId > 0;

  const initialProjectId = Number.isInteger(Number(providedProject?.id))
    ? Number(providedProject.id)
    : routeUsesNumericProjectId
      ? parsedRouteProjectId
      : null;

  const [project, setProject] = useState(providedProject);

  const [projectError, setProjectError] = useState("");

  const [projectLoading, setProjectLoading] = useState(!providedProject);

  const [filesSynchronizedAt, setFilesSynchronizedAt] = useState(() =>
    providedProject ? new Date().toISOString() : null,
  );

  const [resolvedProjectId, setResolvedProjectId] = useState(initialProjectId);

  useEffect(() => {
    if (providedProject) {
      if (!providedProject && !initialProjectId) {
        setProjectError("El identificador del proyecto no es válido.");
        setProjectLoading(false);
      }
      return undefined;
    }

    let isMounted = true;
    setProjectLoading(true);
    setProjectError("");

    if (!initialProjectId) {
      api.projects
        .getByIdAllFiles({ projectId: routeProjectSlug })
        .then((data) => {
          if (!isMounted || !data?.project) {
            return;
          }

          setProject(data.project);
          setFilesSynchronizedAt(new Date().toISOString());
          setResolvedProjectId(data.project.id);
        })
        .catch((error) => {
          if (isMounted) {
            setProject(null);
            setResolvedProjectId(null);
            setProjectError(
              error.message || "No se pudo cargar la informacion del proyecto.",
            );
          }
        })
        .finally(() => {
          if (isMounted) {
            setProjectLoading(false);
          }
        });

      return () => {
        isMounted = false;
      };
    }

    api.projects
      .getByIdAllFiles({ projectId: initialProjectId })
      .then((data) => {
        if (isMounted) {
          const nextProject = data.project || null;
          setProject(nextProject);
          setFilesSynchronizedAt(new Date().toISOString());
          setResolvedProjectId(nextProject?.id || initialProjectId);

          if (routeUsesNumericProjectId && nextProject) {
            navigate(getProjectPath(nextProject, searchParams.toString()), {
              replace: true,
            });
          }
        }
      })
      .catch((error) => {
        if (isMounted) {
          setProject(null);
          setProjectError(
            error.message || "No se pudo cargar la información del proyecto.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setProjectLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [
    initialProjectId,
    navigate,
    providedProject,
    routeProjectSlug,
    routeUsesNumericProjectId,
    searchParams,
  ]);

  const refreshProjectFiles = useCallback(async () => {
    if (!resolvedProjectId) {
      return;
    }

    try {
      const data = await api.projects.getByIdAllFiles({ projectId: resolvedProjectId });
      setProject(data.project || null);
      setFilesSynchronizedAt(new Date().toISOString());
    } catch {
      // Keep the current project visible if a background refresh fails.
    }
  }, [resolvedProjectId]);

  return {
    project,
    projectError,
    projectLoading,
    filesSynchronizedAt,
    resolvedProjectId,
    refreshProjectFiles,
  };
}
