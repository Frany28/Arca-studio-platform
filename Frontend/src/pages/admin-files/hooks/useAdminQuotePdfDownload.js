import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { saveBlobAsFile } from "../../../utils/saveBlobAsFile.js";

/**
 * Descarga el PDF almacenado de una versión de cotización por la ruta autenticada de Cotizaciones
 * (bytes originales verificados por el backend; nunca regenera). Una reserva impide descargas
 * simultáneas, el desmontaje cancela la petición y un fallo se comunica con `onError`. Si el visor
 * ya tiene los bytes de esa versión (`cached`), se guardan sin repetir HTTP.
 *
 * @param {{ onError: (message: string, name: string) => void }} params - Aviso de error.
 * @returns {{ downloadingKey: string|null, download: (document: Object, cached?: Blob|null) => Promise<void> }} Estado y acción.
 */
export function useAdminQuotePdfDownload({ onError }) {
  const [downloadingKey, setDownloadingKey] = useState(null);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  /**
   * Descarga la versión indicada.
   *
   * @param {{ quoteId: number, versionNumber: number, name: string }} document - Cotización, versión y nombre.
   * @param {Blob|null} [cached] - Bytes ya recibidos de esa versión.
   * @returns {Promise<void>}
   */
  async function download(document, cached = null) {
    if (cached) {
      saveBlobAsFile(cached, document.name);
      return;
    }
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setDownloadingKey(`${document.quoteId}:${document.versionNumber}`);
    try {
      const { blob, fileName } = await api.quotes.downloadQuotePdf({ quoteId: document.quoteId, signal: controller.signal, version: document.versionNumber });
      if (!controller.signal.aborted) saveBlobAsFile(blob, fileName || document.name);
    } catch (error) {
      if (controller.signal.aborted) return;
      onError(error?.message || "Inténtalo de nuevo.", document.name);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setDownloadingKey(null);
    }
  }

  return { download, downloadingKey };
}
