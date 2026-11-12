import { useEffect, useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import { openPdfDocument } from "../../../../components/document-viewer/pdfDocumentLoader.js";

const IDLE = Object.freeze({ blob: null, documentProxy: null, error: "", key: "", pageCount: 1, size: 0, status: "idle" });
// Respuestas del PDF almacenado que la recuperación idempotente puede resolver: generación fallida
// o pendiente y objeto perdido. Un error de integridad requiere revisión y nunca se reintenta solo.
const AUTO_RECOVERABLE_PDF_CODES = new Set(["QUOTE_PDF_ERROR", "QUOTE_PDF_PENDING", "QUOTE_PDF_MISSING"]);

/**
 * Descarga y abre con PDF.js el documento de la versión vigente de una cotización mientras el
 * visor está abierto. La clave incluye la versión: una edición posterior descarga el documento
 * almacenado. Si el documento no está disponible (`AUTO_RECOVERABLE_PDF_CODES`), solicita una vez
 * su recuperación (`POST /pdf/retry`, idempotente: no crea versiones ni cambia la cotización) y
 * vuelve a descargarlo; así una generación fallida al guardar se repara al abrir el visor. Si
 * vuelve a fallar se muestra el error con Reintentar, sin bucles. Cerrar el visor o
 * cambiar de cotización aborta la descarga y destruye el documento anterior, de modo que una
 * respuesta lenta nunca sustituye a la cotización mostrada. Conserva el Blob mientras está
 * abierto para guardar exactamente el PDF mostrado sin repetir HTTP; al cerrar lo libera.
 *
 * @param {Object|null} quote - Cotización abierta (`id`, `currentVersion`) o null.
 * @returns {{status: "idle"|"loading"|"ready"|"error", documentProxy: Object|null, pageCount: number,
 * blob: Blob|null, size: number, error: string, retry: () => void}} Estado del documento y reintento.
 */
export function useQuotePdfDocument(quote) {
  const [state, setState] = useState(IDLE);
  const [retryState, setRetryState] = useState({ documentKey: "", attempt: 0 });
  const retryRequested = useRef(null);
  const quoteId = quote?.id ?? null;
  const version = quote?.currentVersion;
  const documentKey = quote ? `${quote.id}:${quote.currentVersion}` : "";
  const attempt = retryState.documentKey === documentKey ? retryState.attempt : 0;
  const key = documentKey ? `${documentKey}:${attempt}` : "";

  useEffect(() => {
    // Abortar cancela la descarga y destruye el documento de PDF.js (openPdfDocument).
    const controller = new AbortController();
    const { signal } = controller;
    const recover = retryRequested.current === `${quoteId}:${version}`;
    retryRequested.current = null;

    queueMicrotask(() => {
      if (!signal.aborted) setState({ ...IDLE, key, status: quoteId === null ? "idle" : "loading" });
    });
    if (quoteId === null) return () => controller.abort();
    const download = () => api.quotes.getQuotePdf({ quoteId, signal, version });
    const recoverAndDownload = () => api.quotes.retryQuotePdf({ quoteId, signal, version }).then(download);
    const request = recover
      ? recoverAndDownload()
      : download().catch((error) => {
        if (signal.aborted || !AUTO_RECOVERABLE_PDF_CODES.has(error?.code)) throw error;
        return recoverAndDownload();
      });
    request
      .then(async (blob) => {
        const documentProxy = await openPdfDocument(await blob.arrayBuffer(), signal);
        if (signal.aborted) return;
        setState({ blob, documentProxy, error: "", key, pageCount: documentProxy.numPages || 1, size: blob.size, status: "ready" });
      })
      .catch((error) => {
        if (signal.aborted || error?.name === "AbortError") return;
        setState({ ...IDLE, error: error?.message || "No se pudo cargar el documento.", key, status: "error" });
      });

    return () => controller.abort();
    // `key` resume la cotización, su versión y el reintento; el objeto `quote` puede cambiar de identidad.
  }, [attempt, key, quoteId, version]);

  // Un estado de otra cotización o versión nunca se muestra: hasta que llegue el nuevo, se carga.
  const current = state.key === key ? state : { ...IDLE, status: quote ? "loading" : "idle" };
  return { ...current, retry: () => {
    retryRequested.current = documentKey;
    setRetryState({ documentKey, attempt: attempt + 1 });
  } };
}
