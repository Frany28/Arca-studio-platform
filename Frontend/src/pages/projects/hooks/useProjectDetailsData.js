import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { getProjectPath, getProjectSlug } from "../../../utils/projectRoutes.js";

// Parámetros de enlace profundo que nombran un archivo del proyecto (documento o multimedia).
const FOCUSED_FILE_PARAMS = ["fileId", "imageId"];

/**
 * Indica si la ruta nombra el proyecto ya cargado: por id con ruta numérica o por su slug.
 *
 * @param {Object|null} project - Proyecto cargado.
 * @param {number|null} routeProjectId - Id numérico de la ruta, o null si la ruta usa slug.
 * @param {string|undefined} routeProjectSlug - Id o slug recibido desde la ruta.
 * @returns {boolean} true si no hace falta volver a pedir el proyecto.
 */
function routeNamesLoadedProject(project, routeProjectId, routeProjectSlug) {
  if (!project) return false;
  return routeProjectId
    ? Number(project.id) === routeProjectId
    : getProjectSlug(project) === routeProjectSlug;
}

/**
 * Devuelve el id de archivo que pide el enlace profundo si todavía no está entre los archivos cargados.
 *
 * @param {Object|null} project - Proyecto cargado con sus archivos.
 * @param {URLSearchParams} searchParams - Query actual.
 * @returns {string|null} Id numérico ausente, o null si no hay que resolver nada.
 */
function getMissingFocusedFileId(project, searchParams) {
  if (!project) return null;
  for (const param of FOCUSED_FILE_PARAMS) {
    const fileId = searchParams.get(param);
    // Solo los ids numéricos nombran archivos reales; las galerías de ejemplo usan otras claves.
    if (fileId && /^\d+$/.test(fileId)) {
      const loaded = (project.files || []).some((file) => String(file.id) === fileId);
      return loaded ? null : fileId;
    }
  }
  return null;
}

/**
 * Inicializa el detalle con el proyecto proporcionado o carga proyecto y archivos desde la API.
 * Sin proyecto proporcionado usa el id num?rico positivo de ruta o env?a su slug;
 * una carga por ruta num?rica reemplaza la URL por la ruta del proyecto conservando la query.
 * Solo vuelve a pedir el proyecto cuando la ruta nombra otro proyecto: los cambios de query
 * (pestaña, comentario, archivo enfocado) conservan el proyecto cargado. Un enlace profundo a un
 * archivo que aún no está cargado provoca una sola recarga en segundo plano por archivo.
 *
 * @param {Object} params - Proyecto opcional y contexto de la ruta.
 * @param {Function} params.navigate - Navegaci?n del router, usada para reemplazar la ruta num?rica.
 * @param {Object|null} params.providedProject - Proyecto inicial; su presencia evita la carga del efecto.
 * @param {string|undefined} params.routeProjectSlug - Id o slug recibido desde la ruta.
 * @param {URLSearchParams} params.searchParams - Query que se conserva al reemplazar la ruta.
 * @returns {Object} Proyecto, id resuelto, carga, error como texto, fecha de sincronizaci?n, setter,
 * refreshProjectFiles y retryProjectLoad (repite la carga por ruta tras un error).
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
  // Intentos de carga por ruta: «Reintentar» lo incrementa para repetir la carga tras un error.
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Último proyecto aplicado y query vigente: la carga los consulta sin depender de ellos, para que
  // un cambio de query no la repita.
  const projectRef = useRef(providedProject);
  const searchParamsRef = useRef(searchParams);
  // Cada carga por ruta invalida las recargas en curso; cada recarga invalida las anteriores.
  const routeLoadSequenceRef = useRef(0);
  const refreshSequenceRef = useRef(0);
  // Archivos de enlaces profundos ya buscados con una recarga, como `${projectId}:${fileId}`.
  const resolvedFocusRef = useRef(new Set());

  useEffect(() => {
    projectRef.current = project;
    searchParamsRef.current = searchParams;
  }, [project, searchParams]);

  useEffect(() => {
    if (providedProject) {
      return undefined;
    }

    let isMounted = true;
    const loadedProject = projectRef.current;

    if (routeNamesLoadedProject(loadedProject, initialProjectId, routeProjectSlug)) {
      // Misma ruta del proyecto visible (p. ej. la redirección de la ruta numérica a su slug).
      if (routeUsesNumericProjectId) {
        navigate(getProjectPath(loadedProject, searchParamsRef.current.toString()), {
          replace: true,
        });
      }
      queueMicrotask(() => {
        if (isMounted) setProjectLoading(false);
      });
      return () => {
        isMounted = false;
      };
    }

    routeLoadSequenceRef.current += 1;
    queueMicrotask(() => {
      if (!isMounted) return;
      setProjectLoading(true);
      setProjectError("");
    });

    api.projects
      .getByIdAllFiles({ projectId: initialProjectId || routeProjectSlug })
      .then((data) => {
        if (!isMounted) return;
        const nextProject = data?.project || null;
        if (!initialProjectId && !nextProject) return;

        projectRef.current = nextProject;
        setProject(nextProject);
        setFilesSynchronizedAt(new Date().toISOString());
        setResolvedProjectId(nextProject?.id || initialProjectId);

        if (routeUsesNumericProjectId && nextProject) {
          navigate(getProjectPath(nextProject, searchParamsRef.current.toString()), {
            replace: true,
          });
        }
      })
      .catch((error) => {
        if (!isMounted) return;
        projectRef.current = null;
        setProject(null);
        if (!initialProjectId) setResolvedProjectId(null);
        setProjectError(
          error.message || "No se pudo cargar la información del proyecto.",
        );
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
    loadAttempt,
  ]);

  /**
   * Repite la carga del proyecto de la ruta; tras un error no hay proyecto cargado y vuelve a pedirlo.
   *
   * @returns {void}
   */
  const retryProjectLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  /**
   * Recarga el proyecto completo con sus archivos usando el id resuelto y fecha la sincronizaci?n.
   * Si falla conserva la vista sin publicar error. Descarta su respuesta si mientras tanto empezó
   * otra recarga, una carga por ruta o se muestra otro proyecto.
   *
   * @returns {Promise<void>} Actualiza proyecto y fecha si la petici?n tiene ?xito; sin id no consulta.
   */
  const refreshProjectFiles = useCallback(async () => {
    if (!resolvedProjectId) {
      return;
    }

    refreshSequenceRef.current += 1;
    const refreshSequence = refreshSequenceRef.current;
    const routeLoadSequence = routeLoadSequenceRef.current;

    try {
      const data = await api.projects.getByIdAllFiles({
        projectId: resolvedProjectId,
      });
      const isCurrent =
        refreshSequence === refreshSequenceRef.current &&
        routeLoadSequence === routeLoadSequenceRef.current &&
        Number(projectRef.current?.id) === Number(resolvedProjectId);
      if (!isCurrent) return;

      projectRef.current = data.project || null;
      setProject(data.project || null);
      setFilesSynchronizedAt(new Date().toISOString());
    } catch {
      // Keep the current project visible if a background refresh fails.
    }
  }, [resolvedProjectId]);

  // Un enlace profundo a un archivo subido después de la carga (p. ej. desde una notificación)
  // recarga una vez los archivos; si sigue ausente, el panel muestra su estado habitual.
  const missingFocusedFileId = projectLoading
    ? null
    : getMissingFocusedFileId(providedProject ? null : project, searchParams);

  useEffect(() => {
    if (!missingFocusedFileId || !project?.id) return;
    const focusKey = `${project.id}:${missingFocusedFileId}`;
    if (resolvedFocusRef.current.has(focusKey)) return;
    resolvedFocusRef.current.add(focusKey);
    queueMicrotask(() => {
      refreshProjectFiles();
    });
  }, [missingFocusedFileId, project?.id, refreshProjectFiles]);

  return {
    filesSynchronizedAt,
    project,
    projectError,
    projectLoading,
    refreshProjectFiles,
    resolvedProjectId,
    retryProjectLoad,
    setProject,
  };
}
