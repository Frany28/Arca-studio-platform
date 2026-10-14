// Cabeceras de seguridad para servir archivos de proyectos y solicitudes (hallazgo B-1).
//
// La CSP de una respuesta solo se aplica cuando el archivo se abre como documento
// (pestaña nueva o iframe); <img>, <video> y fetch() la ignoran. Por eso estas
// políticas protegen la apertura directa sin afectar a la galería, el visor
// panorámico ni las vistas previas, que cargan los archivos como recursos.
//
// Decisiones medidas en Chrome 155 y Edge 155 (14/10/2026):
// - Imágenes: la política estricta con `sandbox` las muestra igual en pestaña y en iframe.
// - Video: `sandbox` impide reproducirlo al abrirlo directamente; se usa la política
//   estricta sin `sandbox`.
// - DOCX/XLSX: el navegador los descarga; `sandbox` no lo impide.
// - PDF de proyectos y de adjuntos de solicitudes: solo se visualizan dentro de ARCA Studio
//   (fetch + PDF.js en ProjectDocumentViewerModal), que no aplica Content-Disposition ni la CSP
//   del recurso. Se sirven como `attachment` con la política estricta y `sandbox`: abrir la URL
//   directamente descarga el archivo y nunca lo interpreta el navegador. Comprobado con los
//   visores reales en Frontend/tests/browser/projectPdfViewer.test.js.
// - Cualquier tipo fuera de la lista (p. ej. text/html en metadatos del almacenamiento) se
//   entrega como descarga `application/octet-stream` y nunca se interpreta en el navegador.

const SANDBOXED_INLINE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const UNSANDBOXED_INLINE_TYPES = new Set(["video/mp4"]);
const PDF_TYPE = "application/pdf";
const FORCED_DOWNLOAD_TYPE = "application/octet-stream";

/**
 * Normaliza un tipo MIME eliminando parámetros y mayúsculas.
 * Así `Image/PNG; charset=x` y `image/png` reciben la misma política.
 *
 * @param {string|null|undefined} value - Tipo MIME recibido del almacenamiento o de la base.
 * @returns {string} Tipo normalizado, o cadena vacía.
 */
function normalizeContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

/**
 * Construye la política CSP estricta para archivos servidos por la API.
 * Solo permite mostrar el propio recurso y estilos internos del visor del navegador.
 *
 * @param {Array<string>} frameAncestors - Orígenes autorizados a incrustar el archivo.
 * @param {boolean} sandbox - Si se añade la directiva `sandbox`.
 * @returns {string} Valor de la cabecera Content-Security-Policy.
 */
function buildStrictPolicy(frameAncestors, sandbox) {
  const directives = [
    "default-src 'none'",
    "img-src 'self'",
    "media-src 'self'",
    "style-src 'unsafe-inline'",
    `frame-ancestors ${["'self'", ...frameAncestors].join(" ")}`,
  ];
  if (sandbox) directives.push("sandbox");
  return directives.join("; ");
}

/**
 * Decide tipo de contenido, disposición y CSP de una respuesta de archivo.
 * Los tipos permitidos reciben la política medida para cada uno; los PDF (visibles solo en el visor
 * integrado) y cualquier tipo fuera de la lista se entregan como descarga con `sandbox`.
 *
 * @param {object} options - Datos de la respuesta.
 * @param {string|null} options.contentType - Tipo MIME efectivo (almacenamiento o base).
 * @param {Array<string>} [options.frameAncestors] - Orígenes del frontend que pueden incrustar archivos.
 * @returns {{ contentType: string, disposition: "inline"|"attachment", contentSecurityPolicy: string }} Cabeceras a aplicar.
 */
export function getFileResponseSecurity({ contentType, frameAncestors = [] }) {
  const type = normalizeContentType(contentType);

  if (type === PDF_TYPE) {
    return { contentSecurityPolicy: buildStrictPolicy(frameAncestors, true), contentType: type, disposition: "attachment" };
  }
  if (UNSANDBOXED_INLINE_TYPES.has(type)) {
    return { contentSecurityPolicy: buildStrictPolicy(frameAncestors, false), contentType: type, disposition: "inline" };
  }
  if (SANDBOXED_INLINE_TYPES.has(type)) {
    return { contentSecurityPolicy: buildStrictPolicy(frameAncestors, true), contentType: type, disposition: "inline" };
  }
  return { contentSecurityPolicy: buildStrictPolicy(frameAncestors, true), contentType: FORCED_DOWNLOAD_TYPE, disposition: "attachment" };
}
