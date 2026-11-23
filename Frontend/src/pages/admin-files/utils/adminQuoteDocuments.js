// PDF de cotizaciones dentro del administrador de archivos. Funciones puras. Los documentos se
// muestran en «Documentos» de su proyecto, pero siguen perteneciendo a Cotizaciones: su historial
// es el de las versiones comerciales, se leen con la API de Cotizaciones y se modifican allí (no se
// reemplazan, restauran ni revisan desde el administrador).

// Estados de quote_pdf_documents (Backend/src/domain/quotePdfDocument.js) y textos de cada fallo.
const ERROR_LABELS = Object.freeze({
  QUOTE_PDF_GENERATION_ERROR: "Error de generación del PDF",
  QUOTE_PDF_INTEGRITY_ERROR: "El PDF almacenado no coincide con su versión: requiere revisión",
  QUOTE_PDF_LAYOUT_UNSUPPORTED: "Error de generación del PDF",
  QUOTE_PDF_MISSING: "PDF no encontrado en el almacenamiento",
  QUOTE_PDF_STORAGE_ERROR: "Error de almacenamiento del PDF",
  QUOTE_PDF_STORAGE_PRIVATE_REQUIRED: "Error de almacenamiento del PDF: falta configurar el almacenamiento privado",
  QUOTE_PDF_TIMEOUT: "Error de almacenamiento del PDF",
  QUOTE_PDF_TOO_LARGE: "Error de generación del PDF",
});

export const QUOTE_REPLACE_REASON = "Los PDF de cotizaciones se generan desde Cotizaciones: edita la cotización para crear una versión nueva.";

/**
 * Indica si una fila del administrador es el PDF de una cotización (`source: "quote"`).
 *
 * @param {{ source?: string }|null|undefined} item - Fila (FileManagerItem).
 * @returns {boolean} true si es una cotización.
 */
export function isQuoteItem(item) {
  return item?.source === "quote";
}

/**
 * Clave estable de una fila: los ids de versión de archivos y de cotizaciones son series distintas.
 *
 * @param {{ source?: string, versionId: number }} item - Fila.
 * @returns {string} «file:40» o «quote:40».
 */
export function getAdminFileItemKey(item) {
  return `${isQuoteItem(item) ? "quote" : "file"}:${item.versionId}`;
}

/**
 * Describe la disponibilidad del PDF de una cotización. Solo un PDF disponible se descarga; uno
 * pendiente o con error se informa (nunca se muestra un documento ficticio) y el visor intenta una
 * única recuperación idempotente al abrirlo, salvo los errores de integridad.
 *
 * @param {{ status?: string, errorCode?: string|null }|null|undefined} pdf - Estado del documento.
 * @returns {{ available: boolean, label: string }} Disponibilidad y texto del estado («» si está disponible).
 */
export function describeQuotePdfStatus(pdf) {
  if (pdf?.status === "available") return { available: true, label: "" };
  if (pdf?.status === "error") return { available: false, label: ERROR_LABELS[pdf.errorCode] || "PDF no disponible" };
  return { available: false, label: "PDF en preparación" };
}

/**
 * Convierte una versión del historial de PDF (GET /admin/quotes/:id/pdf/versions) en la forma que
 * usa el drawer «Historial de versiones». El id es el número de versión (único en la cotización).
 *
 * @param {Object} version - Versión de la API.
 * @returns {Object} Versión del drawer, con `note` si el PDF no está disponible.
 */
export function toQuoteHistoryVersion(version) {
  const status = describeQuotePdfStatus(version.pdf);
  return {
    createdAt: version.createdAt,
    extension: "pdf",
    fileName: version.pdf?.fileName || "",
    id: version.versionNumber,
    isCurrent: Boolean(version.isCurrent),
    note: status.label,
    pdf: version.pdf,
    size: version.pdf?.size ?? null,
    uploadedBy: version.createdBy,
    versionNumber: version.versionNumber,
  };
}

/**
 * Acciones de una versión de cotización en el drawer: ver y descargar (solo si su PDF está
 * disponible). No hay «Restaurar versión»: cambiar la versión vigente es una edición comercial.
 *
 * @param {{ pdf?: Object }} version - Versión del drawer.
 * @returns {Array<Object>} Elementos de ActionMenu.
 */
export function getQuoteVersionActions(version) {
  const status = describeQuotePdfStatus(version.pdf);
  return [
    { id: "view", label: "Ver" },
    { disabled: !status.available, hint: status.label || undefined, id: "download", label: "Descargar", separated: true },
  ];
}
