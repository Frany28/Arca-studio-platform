import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import { describeOperationError } from "../utils/adminFileReview.js";

const LIST_ERROR = "No se pudieron cargar las garantías del proyecto.";

/**
 * Ids de las garantías a las que está vinculado un documento según la lectura del proyecto.
 *
 * @param {Array<Object>} warranties - Garantías con sus documentos.
 * @param {number} fileId - Documento.
 * @returns {number[]} Ids vinculados.
 */
function linkedIdsFrom(warranties, fileId) {
  return warranties.filter((warranty) => (warranty.documents || []).some((document) => document.fileId === fileId)).map((warranty) => warranty.id);
}

/**
 * Garantías vigentes del proyecto y vínculos de un documento (B8). Vincular y desvincular usan las
 * rutas del administrador; los vínculos mostrados son los que devuelve el backend
 * (`linkedWarrantyIds`), no una suposición local. Un conflicto que deja la vista desactualizada
 * (garantía retirada, vínculo inexistente) vuelve a leer la lista sin cerrar el diálogo. Cambiar de
 * documento o cerrar aborta la lectura en curso.
 *
 * @param {{ projectId: number, fileId: number }|null} file - Documento abierto (null no lee).
 * @returns {Object} Garantías, vínculos, estados y acciones (`toggle`, `reload`).
 */
export function useAdminFileWarranties(file) {
  const [state, setState] = useState({ error: "", fileKey: "", linkedIds: [], loading: false, warranties: [] });
  const [busyId, setBusyId] = useState(null);
  const [operation, setOperation] = useState({ error: "", message: "" });
  const [requestKey, setRequestKey] = useState(0);
  const projectId = file?.projectId ?? null;
  const fileId = file?.fileId ?? null;
  const fileKey = fileId ? `${projectId}:${fileId}:${requestKey}` : "";

  useEffect(() => {
    if (!fileKey) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    queueMicrotask(() => {
      if (!signal.aborted) setState((current) => ({ ...current, error: "", fileKey, loading: true }));
    });
    api.fileManager.listWarranties({ projectId, signal })
      .then((payload) => {
        if (signal.aborted) return;
        const warranties = payload?.warranties || [];
        setState({ error: "", fileKey, linkedIds: linkedIdsFrom(warranties, fileId), loading: false, warranties });
      })
      .catch((error) => {
        if (signal.aborted || error?.name === "AbortError") return;
        setState((current) => ({ ...current, error: error?.message || LIST_ERROR, fileKey, loading: false }));
      });
    return () => controller.abort();
  }, [fileId, fileKey, projectId]);

  /**
   * Vincula o desvincula el documento de una garantía. Una operación a la vez.
   *
   * @param {{ id: number, product?: string }} warranty - Garantía.
   * @returns {Promise<void>}
   */
  async function toggle(warranty) {
    if (busyId !== null || !fileId) return;
    const linked = current.linkedIds.includes(warranty.id);
    setBusyId(warranty.id);
    setOperation({ error: "", message: "" });
    try {
      const request = linked ? api.fileManager.unlinkWarrantyDocument : api.fileManager.linkWarrantyDocument;
      const result = await request({ fileId, projectId, warrantyId: warranty.id });
      setState((previous) => ({ ...previous, linkedIds: result?.linkedWarrantyIds ?? previous.linkedIds }));
      const label = warranty.product || "la garantía";
      let message;
      if (!linked) message = result?.changed === false ? `El documento ya estaba vinculado a ${label}.` : `Documento vinculado a ${label}.`;
      else message = `Documento desvinculado de ${label}. El vínculo se conserva en el historial.`;
      setOperation({ error: "", message });
    } catch (error) {
      const described = describeOperationError(error, linked ? "No se pudo desvincular el documento." : "No se pudo vincular el documento.");
      setOperation({ error: described.message, message: "" });
      if (described.stale) setRequestKey((key) => key + 1);
    } finally {
      setBusyId(null);
    }
  }

  const sameFile = Boolean(fileKey) && state.fileKey.startsWith(`${projectId}:${fileId}:`);
  const current = sameFile ? state : { error: "", linkedIds: [], loading: Boolean(fileKey), warranties: [] };
  return {
    busyId,
    error: current.error,
    linkedIds: current.linkedIds,
    loading: current.loading || (sameFile && state.fileKey !== fileKey),
    operation,
    reload: () => setRequestKey((key) => key + 1),
    toggle,
    warranties: current.warranties,
  };
}
