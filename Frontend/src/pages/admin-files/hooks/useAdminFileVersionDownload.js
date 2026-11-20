import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { saveBlobAsFile } from "../../../utils/saveBlobAsFile.js";

/**
 * Descarga de una versión concreta con el nombre que indica el servidor (Content-Disposition). Una
 * reserva inmediata impide descargas simultáneas, el desmontaje cancela la petición y un fallo se
 * comunica con `onError`. Si el visor ya tiene los bytes de esa versión (`cached`), se guardan sin
 * repetir HTTP.
 *
 * @param {Object} params - Aviso de error.
 * @param {(message: string, name: string) => void} params.onError - Comunica un fallo.
 * @returns {{ downloadingVersionId: number|null, download: (version: Object, cached?: {blob: Blob, fileName: string|null}) => Promise<void> }} Estado y acción.
 */
export function useAdminFileVersionDownload({ onError }) {
  const [downloadingVersionId, setDownloadingVersionId] = useState(null);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  /**
   * Descarga la versión indicada.
   *
   * @param {{ projectId: number, fileId: number, versionId: number, name: string }} version - Versión.
   * @param {{ blob: Blob, fileName: string|null }|null} [cached] - Bytes ya recibidos de esa versión.
   * @returns {Promise<void>}
   */
  async function download(version, cached = null) {
    if (cached?.blob) {
      saveBlobAsFile(cached.blob, cached.fileName || version.name);
      return;
    }
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setDownloadingVersionId(version.versionId);
    try {
      const { blob, fileName } = await api.fileManager.downloadVersion({ ...version, signal: controller.signal });
      if (!controller.signal.aborted) saveBlobAsFile(blob, fileName || version.name);
    } catch (error) {
      if (controller.signal.aborted) return;
      onError(error?.message || "Inténtalo de nuevo.", version.name);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setDownloadingVersionId(null);
    }
  }

  return { download, downloadingVersionId };
}
