import { useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import { normalizeServerFields, toQuotePayload } from "../utils/quoteDraft.js";

/**
 * Traduce un error de la API al estado del formulario: los 400 con `fields` se muestran junto a
 * su campo; un 409 de versión o un 404 se explican sin perder el borrador; el resto (red, 5xx)
 * queda como error general. El mensaje del servidor se conserva para no ocultar la causa.
 *
 * @param {Error & {status?: number, code?: string, fields?: Object}} error - Error de apiRequest.
 * @returns {{fieldErrors: Record<string, string>, formError: string, conflict: boolean, notFound: boolean}} Estado.
 */
export function describeQuoteSubmitError(error) {
  const fieldErrors = error?.status === 400 ? normalizeServerFields(error.fields) : {};
  return {
    conflict: error?.code === "QUOTE_VERSION_CONFLICT",
    fieldErrors,
    formError: Object.keys(fieldErrors).length ? "" : error?.message || "No se pudo guardar la cotización. Inténtalo de nuevo.",
    notFound: error?.status === 404,
  };
}

/**
 * Guarda el borrador como cotización nueva (POST) o como versión nueva (PATCH con
 * `expectedVersion`). Una petición en curso bloquea otra equivalente aunque se pulse dos veces
 * antes de re-renderizar, para no crear registros duplicados. Nada se da por guardado hasta
 * recibir la respuesta del servidor.
 *
 * @param {Object} params - Modo del formulario.
 * @param {"create"|"edit"} params.mode - Alta o edición.
 * @param {number|null} params.quoteId - Cotización editada.
 * @param {number|null} params.expectedVersion - Versión leída al abrir la edición.
 * @returns {{submit: (draft: Object) => Promise<Object|null>, submitting: boolean, result: Object, clearFieldError: (path: string) => void}}
 * Acción de guardado, estado y errores.
 */
export function useQuoteSubmit({ expectedVersion, mode, quoteId }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ conflict: false, fieldErrors: {}, formError: "", notFound: false });
  const inFlightRef = useRef(false);

  /**
   * Envía el borrador. Devuelve la respuesta de la API o null si falló o ya había un envío.
   *
   * @param {Object} draft - Borrador validado.
   * @returns {Promise<Object|null>} Respuesta (`{quote}` o `{changed, quote}`) o null.
   */
  async function submit(draft) {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setSubmitting(true);
    setResult({ conflict: false, fieldErrors: {}, formError: "", notFound: false });
    try {
      const payload = toQuotePayload(draft);
      return mode === "edit"
        ? await api.quotes.updateQuote({ payload: { ...payload, expectedVersion }, quoteId })
        : await api.quotes.createQuote(payload);
    } catch (error) {
      setResult(describeQuoteSubmitError(error));
      return null;
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return {
    clearFieldError: (path) => setResult((current) => {
      if (!current.fieldErrors[path]) return current;
      const fieldErrors = { ...current.fieldErrors };
      delete fieldErrors[path];
      return { ...current, fieldErrors };
    }),
    result,
    submit,
    submitting,
  };
}
