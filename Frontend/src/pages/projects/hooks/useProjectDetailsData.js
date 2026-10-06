import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../../api/http.js";
import { getProjectPath } from "../../../utils/projectRoutes.js";

/**
 * Inicializa el detalle con el proyecto proporcionado o carga proyecto y archivos desde la API.
 * Sin proyecto proporcionado usa el id num?rico positivo de ruta o env?a su slug;
 * una carga por ruta num?rica reemplaza la URL por la ruta del proyecto conservando la query.
 *
 * @param {Object} params - Proyecto opcional y contexto de la ruta.
 * @param {Function} params.navigate - Navegaci?n del router, usada para reemplazar la ruta num?rica.
 * @param {Object|null} params.providedProject - Proyecto inicial; su presencia evita la carga del efecto.
 * @param {string|undefined} params.routeProjectSlug - Id o slug recibido desde la ruta.
 * @param {URLSearchParams} params.searchParams - Query que se conserva al reemplazar la ruta.
 * @returns {Object} Proyecto, id resuelto, carga, error como texto, fecha de sincronizaci?n, setter y refreshProjectFiles.
 */
export default function useProjectDetailsData({
  navigate,
  providedProject,
  routeProjectSlug,
  searchParams,
}) {
  const parsedRouteProjectId = Number(routeProjectSlug);
  const routeUsesNumericProjectId =
    Number.isInteger(parsedRouteProjectId) && parsedRouteProjectId > 0;

  const initialProjectId = useMemo(
    () =>
      Number.isInteger(Number(providedProject?.id))
        ? Number(providedProject.id)
        : routeUsesNumericProjectId
          ? parsedRouteProjectId
          : null,
    [parsedRouteProjectId, providedProject, routeUsesNumericProjectId],
  );

  const [project, setProject] = useState(providedProject);
  const [projectError, setProjectError] = useState("");
  const [projectLoading, setProjectLoading] = useState(!providedProject);
  const [filesSynchronizedAt, setFilesSynchronizedAt] = useState(() =>
    providedProject ? new Date().toISOString() : null,
  );
  const [resolvedProjectId, setResolvedProjectId] = useState(initialProjectId);

  useEffect(() => {
    if (providedProject) {
      return undefined;
    }

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setProjectLoading(true);
      setProjectError("");
    });

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

  /**
   * Recarga el proyecto completo con sus archivos usando el id resuelto y fecha la sincronizaci?n.
   * Si falla conserva la vista sin publicar error; esta acci?n no usa la protecci?n isMounted del efecto.
   *
   * @returns {Promise<void>} Actualiza proyecto y fecha si la petici?n tiene ?xito; sin id no consulta.
   */
  const refreshProjectFiles = useCallback(async () => {
    if (!resolvedProjectId) {
      return;
    }

    try {
      const data = await api.projects.getByIdAllFiles({
        projectId: resolvedProjectId,
      });
      setProject(data.project || null);
      setFilesSynchronizedAt(new Date().toISOString());
    } catch {
      // Keep the current project visible if a background refresh fails.
    }
  }, [resolvedProjectId]);

  return {
    filesSynchronizedAt,
    project,
    projectError,
    projectLoading,
    refreshProjectFiles,
    resolvedProjectId,
    setProject,
  };
}
