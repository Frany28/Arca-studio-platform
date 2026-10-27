import { useEffect, useState } from "react";

import { api } from "../../../../api/http.js";
import { loadPdfjs } from "../../../../components/document-viewer/pdfjsLoader.js";

const IDLE = Object.freeze({ documentProxy: null, error: "", key: "", pageCount: 1, size: 0, status: "idle" });

/**
 * Zona horaria del navegador para que la fecha impresa coincida con la del listado.
 *
 * @returns {string|undefined} Zona IANA o undefined si el navegador no la expone.
 */
export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Descarga y abre con PDF.js el documento de la versión vigente de una cotización mientras el
 * visor está abierto. La clave incluye la versión: una edición posterior descarga el documento
 * nuevo y la caché HTTP (ETag) evita repetir la generación si no cambió. Cerrar el visor o
 * cambiar de cotización aborta la descarga y destruye el documento anterior, de modo que una
 * respuesta lenta nunca sustituye a la cotización mostrada.
 *
 * @param {Object|null} quote - Cotización abierta (`id`, `currentVersion`) o null.
 * @returns {{status: "idle"|"loading"|"ready"|"error", documentProxy: Object|null, pageCount: number,
 * size: number, error: string, retry: () => void}} Estado del documento y reintento.
 */
export function useQuotePdfDocument(quote) {
  const [state, setState] = useState(IDLE);
  const [attempt, setAttempt] = useState(0);
  const quoteId = quote?.id ?? null;
  const key = quote ? `${quote.id}:${quote.currentVersion}:${attempt}` : "";

  useEffect(() => {
    if (quoteId === null) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    let loadingTask = null;
    let documentProxy = null;

    queueMicrotask(() => {
      if (!cancelled) setState({ ...IDLE, key, status: "loading" });
    });
    api.quotes.getQuotePdf({ quoteId, signal: controller.signal, timeZone: getBrowserTimeZone() })
      .then(async (blob) => {
        const { getDocument } = await loadPdfjs();
        // Si el visor se cerró durante la descarga de PDF.js, no crear una tarea que nadie destruirá.
        if (cancelled) return;
        loadingTask = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        documentProxy = await loadingTask.promise;
        if (cancelled) return;
        setState({ documentProxy, error: "", key, pageCount: documentProxy.numPages || 1, size: blob.size, status: "ready" });
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") return;
        setState({ ...IDLE, error: error?.message || "No se pudo cargar el documento.", key, status: "error" });
      });

    return () => {
      cancelled = true;
      controller.abort();
      loadingTask?.destroy();
    };
    // `key` resume la cotización, su versión y el reintento; el objeto `quote` puede cambiar de identidad.
  }, [key, quoteId]);

  // Un estado de otra cotización o versión nunca se muestra: hasta que llegue el nuevo, se carga.
  const current = state.key === key ? state : { ...IDLE, status: quote ? "loading" : "idle" };
  return { ...current, retry: () => setAttempt((value) => value + 1) };
}
