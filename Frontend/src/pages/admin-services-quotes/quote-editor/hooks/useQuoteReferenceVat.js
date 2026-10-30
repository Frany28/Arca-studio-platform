import { useEffect, useState } from "react";

import { api } from "../../../../api/http.js";
import { resolveQuoteReferenceVat } from "../../../../../../Backend/src/domain/quoteReferenceVat.js";

const LOADING = Object.freeze({ configured: null, status: "loading" });

/**
 * IVA referencial que se aplicará al guardar la cotización, con la misma regla que el backend
 * (`resolveQuoteReferenceVat`): una cotización guardada con IVA conserva su tasa; una nueva, o una
 * guardada cuando la tasa estaba pendiente, usa la tasa configurada, que se lee una vez con
 * `GET /admin/quotes/reference-vat`. Si la cotización ya tiene su tasa no hace falta esperar la
 * lectura. `retry` repite una lectura fallida.
 *
 * @param {{enabled: boolean, rate: string|null}|null|undefined} stored - IVA guardado de la versión editada.
 * @returns {{status: "loading"|"error"|"pending"|"ready", referenceVat: {enabled: boolean, rate: string|null}|null,
 *   retry: () => void}} Estado: «pending» sin tasa configurada; `referenceVat` solo en «ready».
 */
export function useQuoteReferenceVat(stored) {
  const [state, setState] = useState(LOADING);
  const [requestKey, setRequestKey] = useState(0);
  const keepsStoredRate = Boolean(stored?.enabled);

  useEffect(() => {
    if (keepsStoredRate) return undefined;
    const controller = new AbortController();
    api.quotes.getReferenceVat({ signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setState({ configured: payload?.referenceVat ?? null, status: "loaded" });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setState({ configured: null, status: "error" });
      });
    return () => controller.abort();
  }, [keepsStoredRate, requestKey]);

  const retry = () => {
    setState(LOADING);
    setRequestKey((key) => key + 1);
  };
  if (keepsStoredRate) return { referenceVat: { enabled: true, rate: stored.rate }, retry, status: "ready" };
  if (state.status !== "loaded" || !state.configured) return { referenceVat: null, retry, status: state.status === "loaded" ? "error" : state.status };
  const referenceVat = resolveQuoteReferenceVat({ configured: state.configured, stored });
  return { referenceVat: referenceVat.enabled ? referenceVat : null, retry, status: referenceVat.enabled ? "ready" : "pending" };
}
