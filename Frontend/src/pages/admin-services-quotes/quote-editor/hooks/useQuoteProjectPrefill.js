import { useEffect, useState } from "react";

import { api } from "../../../../api/http.js";
import { draftFromProject } from "../utils/quoteDraft.js";

const EMPTY = Object.freeze({ draft: null, error: null, projectId: null });

/**
 * Borrador inicial de «Nueva cotización» para un proyecto existente (`?proyecto=`): lee el
 * proyecto con `GET /projects/:id` (sin paginar archivos más allá de uno, porque solo se usan
 * nombre y cliente) y lo traduce a cliente + proyecto del borrador. No crea la cotización ni
 * cambia el proyecto: el administrador completa los conceptos y guarda con el flujo existente.
 *
 * Sin caché: cada apertura lee el proyecto vigente. Cambiar de proyecto o desmontar aborta la
 * lectura anterior y un resultado de otro proyecto nunca se devuelve.
 *
 * @param {string|null} projectId - Proyecto a precargar; null no lee nada.
 * @returns {{draft: Object|null, loading: boolean, error: {message: string, status?: number}|null,
 *   notFound: boolean, reload: () => void}} Estado de la lectura y borrador resultante.
 */
export function useQuoteProjectPrefill(projectId) {
  const [state, setState] = useState(EMPTY);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    if (projectId === null) return undefined;
    const controller = new AbortController();
    api.projects.getById({ filesLimit: 1, projectId, signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const draft = draftFromProject(payload?.project);
        setState(draft
          ? { draft, error: null, projectId }
          : { draft: null, error: { message: "El proyecto no indica su cliente.", status: 404 }, projectId });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setState({
          draft: null,
          error: { message: error?.message || "No se pudo cargar el proyecto.", status: error?.status },
          projectId,
        });
      });
    return () => controller.abort();
  }, [projectId, requestKey]);

  const current = state.projectId === projectId ? state : EMPTY;
  return {
    draft: current.draft,
    error: current.error,
    loading: projectId !== null && current.projectId !== projectId,
    notFound: current.error?.status === 404,
    reload: () => {
      setState(EMPTY);
      setRequestKey((key) => key + 1);
    },
  };
}
