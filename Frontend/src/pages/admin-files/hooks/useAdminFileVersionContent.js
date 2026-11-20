import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import { openPdfDocument } from "../../../components/document-viewer/pdfDocumentLoader.js";

const IDLE = Object.freeze({ blob: null, data: null, documentProxy: null, error: "", fileName: null, key: "", pageCount: 1, size: 0, status: "idle" });
// Visores que necesitan los bytes de la versión; imagen, vídeo y panorámica cargan por URL.
const BYTE_VIEWERS = new Set(["pdf", "docx", "xlsx"]);

/**
 * Descarga la versión mostrada cuando su visor necesita los bytes (PDF, DOCX y XLSX) y abre los PDF
 * con PDF.js. La clave es la versión: ver otra versión del historial aborta la descarga anterior y
 * destruye su documento, de modo que una respuesta lenta nunca sustituye a la versión mostrada.
 * Conserva el Blob para descargar exactamente lo mostrado sin repetir HTTP; cerrar lo libera.
 *
 * @param {{ projectId: number, fileId: number, versionId: number }|null} version - Versión mostrada (null cierra).
 * @param {string} kind - Tipo de visor (getViewerKind).
 * @returns {{ status: "idle"|"loading"|"ready"|"error", blob: Blob|null, fileName: string|null, data: ArrayBuffer|null,
 * documentProxy: Object|null, pageCount: number, size: number, error: string, retry: () => void }} Estado y reintento.
 */
export function useAdminFileVersionContent(version, kind) {
  const [state, setState] = useState(IDLE);
  const [attempt, setAttempt] = useState(0);
  const needsBytes = Boolean(version) && BYTE_VIEWERS.has(kind);
  const projectId = version?.projectId ?? null;
  const fileId = version?.fileId ?? null;
  const versionId = version?.versionId ?? null;
  const key = needsBytes ? `${projectId}:${fileId}:${versionId}:${kind}:${attempt}` : "";

  useEffect(() => {
    if (!key) return undefined;
    // Abortar cancela la descarga y destruye el documento de PDF.js (openPdfDocument).
    const controller = new AbortController();
    const { signal } = controller;
    queueMicrotask(() => {
      if (!signal.aborted) setState({ ...IDLE, key, status: "loading" });
    });
    api.fileManager.downloadVersion({ fileId, projectId, signal, versionId })
      .then(async ({ blob, fileName }) => {
        const data = await blob.arrayBuffer();
        const documentProxy = kind === "pdf" ? await openPdfDocument(data, signal) : null;
        if (signal.aborted) return;
        setState({ blob, data, documentProxy, error: "", fileName, key, pageCount: documentProxy?.numPages || 1, size: blob.size, status: "ready" });
      })
      .catch((error) => {
        if (signal.aborted || error?.name === "AbortError") return;
        setState({ ...IDLE, error: error?.message || "No se pudo cargar el archivo.", key, status: "error" });
      });
    return () => controller.abort();
    // `key` resume proyecto, archivo, versión, visor y reintento.
  }, [fileId, key, kind, projectId, versionId]);

  // Un estado de otra versión nunca se muestra: hasta que llegue el nuevo, se carga.
  const current = state.key === key ? state : { ...IDLE, status: needsBytes ? "loading" : "idle" };
  return { ...current, retry: () => setAttempt((value) => value + 1) };
}
