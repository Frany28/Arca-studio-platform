import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";

const SEARCH_DEBOUNCE_MS = 300;
const TREE_PAGE_SIZE = 20;
const FOLDER_RESULTS_LIMIT = 20;
const TREE_ERROR = "No se pudo cargar el árbol de proyectos.";
const FOLDER_SEARCH_ERROR = "No se pudieron buscar las carpetas.";

/**
 * Árbol «Proyectos» del administrador (Figma 3727:683873): proyectos con sus carpetas anidadas,
 * por páginas («Cargar más proyectos» añade la siguiente). La búsqueda «Buscar carpeta...» se
 * aplica tras una pausa a dos consultas: carpetas por nombre visible (con su ruta) y proyectos por
 * nombre o cliente. Cada lectura aborta la anterior.
 *
 * @param {{ enabled: boolean }} options - Solo lee cuando el administrador está disponible.
 * @returns {Object} Proyectos, carpetas encontradas, búsqueda, carga, errores y acciones.
 */
export function useAdminFilesTree({ enabled }) {
  const [projects, setProjects] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [folderResults, setFolderResults] = useState({ error: "", folders: [], loading: false });
  const [requestKey, setRequestKey] = useState(0);
  const moreRequest = useRef(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setAppliedSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    moreRequest.current?.abort();
    queueMicrotask(() => {
      if (signal.aborted) return;
      setLoading(true);
      setError("");
    });
    api.fileManager.getTree({ limit: TREE_PAGE_SIZE, search: appliedSearch || undefined, signal })
      .then((payload) => {
        if (signal.aborted) return;
        setProjects(payload?.projects || []);
        setNextCursor(payload?.nextCursor || null);
      })
      .catch((requestError) => {
        if (!signal.aborted && requestError?.name !== "AbortError") setError(requestError?.message || TREE_ERROR);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedSearch, enabled, requestKey]);

  useEffect(() => {
    if (!enabled || !appliedSearch) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    queueMicrotask(() => {
      if (!signal.aborted) setFolderResults((current) => ({ ...current, error: "", loading: true }));
    });
    api.fileManager.searchFolders({ limit: FOLDER_RESULTS_LIMIT, search: appliedSearch, signal })
      .then((payload) => {
        if (!signal.aborted) setFolderResults({ error: "", folders: payload?.folders || [], loading: false });
      })
      .catch((requestError) => {
        if (signal.aborted || requestError?.name === "AbortError") return;
        setFolderResults({ error: requestError?.message || FOLDER_SEARCH_ERROR, folders: [], loading: false });
      });
    return () => controller.abort();
  }, [appliedSearch, enabled, requestKey]);

  /**
   * Añade la página siguiente de proyectos; ignora clics repetidos mientras carga.
   *
   * @returns {Promise<void>}
   */
  async function loadMore() {
    if (!nextCursor || moreRequest.current) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    try {
      const payload = await api.fileManager.getTree({ cursor: nextCursor, limit: TREE_PAGE_SIZE, search: appliedSearch || undefined, signal: controller.signal });
      if (controller.signal.aborted) return;
      setProjects((current) => [...current, ...(payload?.projects || [])]);
      setNextCursor(payload?.nextCursor || null);
    } catch (requestError) {
      if (!controller.signal.aborted && requestError?.name !== "AbortError") setError(requestError?.message || TREE_ERROR);
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  /**
   * Sustituye las carpetas de un proyecto por las que devuelve la API tras crear, renombrar o
   * retirar una carpeta, sin volver a leer el árbol.
   *
   * @param {number} projectId - Proyecto.
   * @param {Array<Object>} folders - Carpetas del proyecto en preorden.
   * @returns {void}
   */
  function replaceProjectFolders(projectId, folders) {
    setProjects((current) => current.map((project) => (project.id === projectId ? { ...project, folders } : project)));
  }

  return {
    error,
    folderResults: appliedSearch ? folderResults : { error: "", folders: [], loading: false },
    hasMore: Boolean(nextCursor),
    loadMore,
    loading,
    loadingMore,
    projects,
    reload: () => setRequestKey((key) => key + 1),
    replaceProjectFolders,
    search: { applied: appliedSearch, query, setQuery },
  };
}
