import { loadPdfjs } from "./pdfjsLoader.js";

/**
 * Crea el error que identifica una carga cancelada, con el mismo nombre que usa `fetch` al
 * abortar: los consumidores ya lo descartan sin mostrarlo.
 *
 * @returns {DOMException} Error de aborto.
 */
function createAbortError() {
  return new DOMException("La carga del documento se canceló.", "AbortError");
}

/**
 * Descarga un archivo de documento (URL firmada o pública) como bytes para los visores de
 * proyectos. Una respuesta no correcta se rechaza con `DOCUMENT_LOAD_FAILED`, el código que
 * los visores traducen a su mensaje.
 *
 * @param {string} source - URL del archivo.
 * @param {AbortSignal} signal - Cancela la descarga al cerrar el visor o cambiar de documento.
 * @returns {Promise<ArrayBuffer>} Contenido del archivo.
 * @throws {Error} `DOCUMENT_LOAD_FAILED` o el error de red/aborto de `fetch`.
 */
export async function fetchDocumentBytes(source, signal) {
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error("DOCUMENT_LOAD_FAILED");
  return response.arrayBuffer();
}

/**
 * Abre bytes de un PDF con PDF.js (cargado bajo demanda) atado a la vida del visor:
 *
 * - Si la señal ya se abortó al terminar de cargar PDF.js, no crea una tarea que nadie destruiría.
 * - Abortar la señal destruye la tarea de PDF.js, también después de abierto el documento: el
 *   consumidor aborta al cerrar el visor o al cambiar de documento y así libera el worker.
 * - Una carga abortada se rechaza con `AbortError`, de modo que una respuesta lenta nunca llega a
 *   sustituir al documento vigente.
 *
 * @param {ArrayBuffer|Uint8Array} bytes - Contenido del PDF.
 * @param {AbortSignal} signal - Vida del visor que muestra el documento.
 * @returns {Promise<Object>} Documento de PDF.js (`numPages`, `getPage`…).
 * @throws {DOMException|Error} `AbortError` si se canceló o el error de PDF.js si el archivo no es válido.
 */
export async function openPdfDocument(bytes, signal) {
  const { getDocument } = await loadPdfjs();
  if (signal.aborted) throw createAbortError();
  const loadingTask = getDocument({ data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) });
  signal.addEventListener("abort", () => loadingTask.destroy(), { once: true });
  try {
    const documentProxy = await loadingTask.promise;
    if (signal.aborted) throw createAbortError();
    return documentProxy;
  } catch (error) {
    if (signal.aborted) throw createAbortError();
    throw error;
  }
}
