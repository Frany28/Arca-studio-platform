import { useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { describeOperationError } from "../utils/adminFileReview.js";

const FALLBACKS = Object.freeze({
  approve: "Intenta aprobar la versión de nuevo.",
  reject: "Intenta rechazar la versión de nuevo.",
  restore: "No se pudo restaurar la versión. Inténtalo de nuevo.",
});

/**
 * Operaciones de revisión del visor: aprobar, rechazar con motivo y restaurar con motivo. Solo una
 * operación a la vez (`pending` indica cuál está en curso, para su etiqueta y para bloquear el
 * resto). Cada operación devuelve el resultado confirmado por la API o el error traducido; un
 * conflicto que deja la vista desactualizada llama a `onStale` para recargar tabla e historial sin
 * cerrar el visor.
 *
 * @param {Object} params - Efectos tras la respuesta.
 * @param {() => void} params.onStale - Recarga tras un conflicto de vista obsoleta.
 * @returns {{ pending: ""|"approve"|"reject"|"restore",
 * approve: Function, reject: Function, restore: Function }} Estado y operaciones.
 */
export function useAdminFileReviewOperations({ onStale }) {
  const [pending, setPending] = useState("");
  const inFlight = useRef(false);

  /**
   * Ejecuta una operación y traduce su error. Bloquea envíos simultáneos incluso antes del
   * próximo render, cuando los botones aún no se han deshabilitado.
   *
   * @param {"approve"|"reject"|"restore"} action - Operación.
   * @param {() => Promise<Object>} request - Petición.
   * @returns {Promise<{ ok: true, result: Object }|{ ok: false, message: string, fieldError: string }>} Resultado.
   */
  async function run(action, request) {
    if (inFlight.current) return { fieldError: "", message: "", ok: false };
    inFlight.current = true;
    setPending(action);
    try {
      return { ok: true, result: await request() };
    } catch (requestError) {
      const described = describeOperationError(requestError, FALLBACKS[action]);
      if (described.stale) onStale();
      return { fieldError: described.fieldError, message: described.message, ok: false };
    } finally {
      inFlight.current = false;
      setPending("");
    }
  }

  return {
    approve: (version) => run("approve", () => api.fileManager.approveVersion(version)),
    pending,
    reject: (version, reason) => run("reject", () => api.fileManager.rejectVersion({ ...version, reason })),
    restore: (version, changeNote) => run("restore", () => api.fileManager.restoreVersion({ ...version, changeNote })),
  };
}
