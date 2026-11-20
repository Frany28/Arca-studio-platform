import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { VERSION_HISTORY_PAGE_SIZE } from "../utils/adminFileReview.js";

const EMPTY = Object.freeze({ currentVersionId: null, error: "", fileKey: "", loading: false, loadingMore: false, nextCursor: null, versions: [] });
const HISTORY_ERROR = "No se pudo cargar el historial de versiones.";
// Límite máximo de una página del contrato (1–100).
const MAX_PAGE_SIZE = 100;

/**
 * Historial de versiones de un archivo, de la más reciente a la más antigua, por páginas: la
 * primera se lee al abrir y «Mostrar más versiones» añade la siguiente. Cambiar de archivo o
 * recargar (tras aprobar, rechazar o restaurar) aborta las lecturas en curso; una respuesta de otro
 * archivo o de una lectura anterior nunca sustituye a la vigente. Una recarga pide de una vez tantas
 * versiones como había visibles (más la nueva que pudo crear la operación, hasta 100), para no
 * devolver al usuario a la primera página.
 *
 * @param {{ projectId: number, fileId: number }|null} file - Archivo abierto (null no lee).
 * @returns {{ versions: Array<Object>, currentVersionId: number|null, loading: boolean, loadingMore: boolean,
 * error: string, hasMore: boolean, loadMore: () => Promise<void>, reload: () => void }} Historial y acciones.
 */
export function useAdminFileVersions(file) {
  const [state, setState] = useState(EMPTY);
  const [requestKey, setRequestKey] = useState(0);
  const moreRequest = useRef(null);
  // Versiones visibles al pedir una recarga; la lectura siguiente las vuelve a pedir juntas.
  const reloadSize = useRef(0);
  const projectId = file?.projectId ?? null;
  const fileId = file?.fileId ?? null;
  const fileKey = fileId ? `${projectId}:${fileId}:${requestKey}` : "";

  useEffect(() => {
    if (!fileKey) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    moreRequest.current?.abort();
    queueMicrotask(() => {
      if (!signal.aborted) setState((current) => ({ ...EMPTY, fileKey, loading: true, versions: current.fileKey.startsWith(`${projectId}:${fileId}:`) ? current.versions : [] }));
    });
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(VERSION_HISTORY_PAGE_SIZE, reloadSize.current + 1));
    reloadSize.current = 0;
    api.fileManager.listVersions({ fileId, limit, projectId, signal })
      .then((payload) => {
        if (signal.aborted) return;
        setState({ ...EMPTY, currentVersionId: payload?.currentVersionId ?? null, fileKey, nextCursor: payload?.nextCursor || null, versions: payload?.versions || [] });
      })
      .catch((error) => {
        if (signal.aborted || error?.name === "AbortError") return;
        setState({ ...EMPTY, error: error?.message || HISTORY_ERROR, fileKey });
      });
    return () => controller.abort();
  }, [fileId, fileKey, projectId]);

  /**
   * Añade la página siguiente; ignora clics repetidos y descarta la respuesta si cambió el archivo.
   *
   * @returns {Promise<void>}
   */
  async function loadMore() {
    if (!state.nextCursor || moreRequest.current || state.fileKey !== fileKey) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setState((current) => ({ ...current, loadingMore: true }));
    try {
      const payload = await api.fileManager.listVersions({ cursor: state.nextCursor, fileId, limit: VERSION_HISTORY_PAGE_SIZE, projectId, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState((current) => (current.fileKey !== fileKey ? current : {
        ...current,
        loadingMore: false,
        nextCursor: payload?.nextCursor || null,
        versions: [...current.versions, ...(payload?.versions || [])],
      }));
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") return;
      setState((current) => ({ ...current, error: error?.message || HISTORY_ERROR, loadingMore: false }));
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
    }
  }

  // Al recargar el mismo archivo se conservan las versiones ya mostradas mientras llega la lectura;
  // las de otro archivo nunca se muestran.
  const sameFile = Boolean(fileKey) && state.fileKey.startsWith(`${projectId}:${fileId}:`);
  const current = state.fileKey === fileKey ? state : sameFile ? { ...state, loading: true } : { ...EMPTY, loading: Boolean(fileKey) };
  return {
    currentVersionId: current.currentVersionId,
    error: current.error,
    hasMore: Boolean(current.nextCursor),
    loadMore,
    loading: current.loading,
    loadingMore: current.loadingMore,
    reload: () => {
      reloadSize.current = current.versions.length;
      setRequestKey((key) => key + 1);
    },
    versions: current.versions,
  };
}
