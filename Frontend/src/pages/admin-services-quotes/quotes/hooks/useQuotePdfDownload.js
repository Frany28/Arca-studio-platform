import { useEffect, useRef, useState } from "react";

import { saveBlobAsFile } from "../../../../utils/saveBlobAsFile.js";

/**
 * Guarda exactamente el PDF recibido por la ruta autenticada, sin otra transferencia ni regeneración.
 * Bloquea clics repetidos durante la entrega al navegador y descarta estado al cambiar de documento.
 *
 * @param {{blob: Blob|null, fileName: string, documentKey: string}} options - Documento abierto.
 * @returns {{download: Function, downloading: boolean, error: string}} Acción y resultado local.
 */
export function useQuotePdfDownload({ blob, documentKey, fileName }) {
  const active = useRef(null);
  const [state, setState] = useState({ key: "", downloading: false, error: "" });
  useEffect(() => () => {
    clearTimeout(active.current?.timer);
    active.current = null;
  }, [documentKey]);

  /**
   * Entrega el Blob validado al navegador e informa los fallos de creación de su URL temporal.
   * Mantiene una reserva breve para impedir dos entregas por clics consecutivos.
   *
   * @returns {void} Descarga iniciada o error local visible.
   */
  function download() {
    if (!blob || active.current) return;
    const operation = { timer: null };
    active.current = operation;
    setState({ key: documentKey, downloading: true, error: "" });
    try {
      saveBlobAsFile(blob, fileName);
      operation.timer = setTimeout(() => {
        active.current = null;
        setState({ key: documentKey, downloading: false, error: "" });
      }, 500);
    } catch (error) {
      active.current = null;
      setState({ key: documentKey, downloading: false, error: error?.message || "No se pudo iniciar la descarga. Inténtalo de nuevo." });
    }
  }

  return { download, downloading: state.key === documentKey && state.downloading, error: state.key === documentKey ? state.error : "" };
}
