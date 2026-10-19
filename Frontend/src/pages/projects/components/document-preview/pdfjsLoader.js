import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let pdfjsModulePromise = null;

/**
 * Carga PDF.js bajo demanda y configura su worker una sola vez.
 * La promesa se comparte entre visores simultáneos para no repetir la descarga; si la importación
 * falla (por ejemplo, sin conexión) se descarta para que el siguiente intento vuelva a pedirla.
 *
 * @returns {Promise<typeof import("pdfjs-dist")>} Módulo de PDF.js listo para `getDocument`.
 */
export function loadPdfjs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist")
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        return pdfjs;
      })
      .catch((error) => {
        pdfjsModulePromise = null;
        throw error;
      });
  }

  return pdfjsModulePromise;
}
