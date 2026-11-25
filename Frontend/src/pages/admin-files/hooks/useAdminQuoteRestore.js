import { useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { describeQuoteRestoreError } from "../utils/adminQuoteDocuments.js";

/**
 * Restauración comercial de una versión de cotización desde el visor del administrador de archivos.
 *
 * - `open(version)` prepara el diálogo del motivo con un `requestId` propio: los reintentos del
 *   mismo diálogo (p. ej. tras un fallo de red cuya respuesta se perdió) reutilizan el identificador
 *   y el servidor devuelve la versión ya creada en lugar de crear otra.
 * - `submit(reason)` envía la versión vigente leída al abrir (`expectedVersion`). Un conflicto que deja
 *   la vista desactualizada llama a `onStale` (recargar historial) sin cerrar el diálogo; como el
 *   administrador ya vio el aviso, el siguiente envío usa la versión vigente recargada.
 * - Solo admite un envío a la vez; la respuesta confirmada se entrega a `onRestored`.
 *
 * @param {Object} params - Cotización, versión vigente y efectos.
 * @param {number} params.quoteId - Cotización abierta.
 * @param {number|null} params.currentVersionNumber - Versión vigente según el historial (null mientras carga).
 * @param {(result: { quote: Object, source: Object }) => void} params.onRestored - Restauración confirmada.
 * @param {() => void} params.onStale - Recarga tras un conflicto de vista obsoleta.
 * @returns {{ target: Object|null, open: (version: Object) => void, close: () => void,
 *   submit: (reason: string) => Promise<{ ok: boolean, message?: string, fieldError?: string }> }} Estado y acciones.
 */
export function useAdminQuoteRestore({ currentVersionNumber, onRestored, onStale, quoteId }) {
  const [target, setTarget] = useState(null);
  const inFlight = useRef(false);

  /**
   * Envía la restauración del destino abierto y traduce el resultado para el diálogo del motivo.
   *
   * @param {string} reason - Motivo recortado.
   * @returns {Promise<{ ok: boolean, message?: string, fieldError?: string }>} Resultado.
   */
  async function submit(reason) {
    if (!target || inFlight.current) return { ok: false };
    const expectedVersion = target.expectedVersion ?? currentVersionNumber;
    if (!expectedVersion) return { message: "Espera a que se cargue el historial de versiones.", ok: false };
    inFlight.current = true;
    try {
      const payload = await api.quotes.restoreQuoteVersion({
        expectedVersion,
        quoteId,
        reason,
        requestId: target.requestId,
        versionNumber: target.version.versionNumber,
      });
      setTarget(null);
      onRestored({ quote: payload.quote, source: target.version });
      return { ok: true };
    } catch (error) {
      const described = describeQuoteRestoreError(error);
      if (described.stale) {
        setTarget((current) => (current ? { ...current, expectedVersion: null } : current));
        onStale();
      }
      return { fieldError: described.fieldError, message: described.message, ok: false };
    } finally {
      inFlight.current = false;
    }
  }

  return {
    close: () => {
      if (!inFlight.current) setTarget(null);
    },
    open: (version) => {
      if (version.isCurrent || !currentVersionNumber) return;
      setTarget({ expectedVersion: currentVersionNumber, requestId: crypto.randomUUID(), version });
    },
    submit,
    target,
  };
}
