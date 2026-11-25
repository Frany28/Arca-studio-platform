// PDF de cotizaciones dentro del administrador de archivos. Funciones puras. Los documentos se
// muestran en «Documentos» de su proyecto, pero siguen perteneciendo a Cotizaciones: su historial
// es el de las versiones comerciales y se leen con la API de Cotizaciones. No se reemplazan ni
// revisan aquí; sí se restauran con la restauración comercial (POST /admin/quotes/:id/versions/:n/restore),
// que crea una versión nueva vigente sin aprobación posterior (no es el flujo de archivos generales).

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

/** Longitud máxima del motivo de una restauración comercial (Backend: QUOTE_RESTORE_REASON_MAX_LENGTH). */
export const QUOTE_RESTORE_REASON_MAX_LENGTH = 500;

const CURRENT_VERSION_REASON = "Esta es la versión vigente.";

// Errores de la restauración comercial (docs/API_CONTRACT.md). `stale`: la vista quedó desactualizada
// y se recarga el historial sin cerrar el visor.
const RESTORE_ERRORS = Object.freeze({
  QUOTE_NOT_FOUND: { message: "La cotización ya no está disponible.", stale: true },
  QUOTE_RESTORE_NO_CHANGES: { stale: false },
  QUOTE_RESTORE_REFERENCE_UNAVAILABLE: { stale: false },
  QUOTE_RESTORE_REQUEST_REUSED: { message: "Este envío ya restauró otra versión. Cierra el diálogo y vuelve a intentarlo.", stale: true },
  QUOTE_RESTORE_SOURCE_CURRENT: { message: "La versión seleccionada ya es la vigente. Se actualizó el historial.", stale: true },
  QUOTE_VERSION_CONFLICT: { message: "Otro administrador modificó la cotización. Se actualizó el historial: revisa la versión vigente antes de restaurar.", stale: true },
  QUOTE_VERSION_NOT_FOUND: { message: "La versión seleccionada ya no existe. Se actualizó el historial.", stale: true },
});

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
  const origin = version.restoredFrom ? `Restaurada desde V${version.restoredFrom.versionNumber}: ${version.restoredFrom.reason}` : "";
  return {
    createdAt: version.createdAt,
    extension: "pdf",
    fileName: version.pdf?.fileName || "",
    id: version.versionNumber,
    isCurrent: Boolean(version.isCurrent),
    note: [origin, status.label].filter(Boolean).join(" · "),
    pdf: version.pdf,
    restoredFrom: version.restoredFrom ?? null,
    size: version.pdf?.size ?? null,
    uploadedBy: version.createdBy,
    versionNumber: version.versionNumber,
  };
}

/**
 * Acciones de una versión de cotización en el drawer: ver, restaurar (cualquier versión histórica,
 * con independencia del estado de su PDF, porque se restauran los datos comerciales y se genera un
 * PDF nuevo) y descargar (solo si su PDF está disponible). La vigente no se restaura.
 *
 * @param {{ isCurrent?: boolean, pdf?: Object }} version - Versión del drawer.
 * @returns {Array<Object>} Elementos de ActionMenu.
 */
export function getQuoteVersionActions(version) {
  const status = describeQuotePdfStatus(version.pdf);
  const isCurrent = Boolean(version.isCurrent);
  return [
    { id: "view", label: "Ver" },
    { disabled: isCurrent, hint: isCurrent ? CURRENT_VERSION_REASON : undefined, id: "restore", label: "Restaurar versión", separated: true },
    { disabled: !status.available, hint: status.label || undefined, id: "download", label: "Descargar", separated: true },
  ];
}

/**
 * Explica antes de confirmar qué hará la restauración comercial: la versión que se creará, los
 * datos que recupera y que se conserva el historial. No requiere aprobación posterior.
 *
 * @param {{ versionNumber: number }} source - Versión histórica elegida.
 * @param {number} currentVersionNumber - Versión vigente leída en el historial.
 * @returns {string} Descripción para el diálogo del motivo.
 */
export function describeQuoteRestorePlan(source, currentVersionNumber) {
  return `Se creará la V${currentVersionNumber + 1} con los datos comerciales de la V${source.versionNumber}: cliente, proyecto, servicios, cantidades, unidades, tarifas, totales y observaciones. `
    + "Quedará como versión vigente con su propio PDF; las versiones anteriores y sus PDF se conservan sin cambios.";
}

/**
 * Texto del aviso de una restauración confirmada, con el estado del PDF nuevo: si no quedó
 * disponible se indica (el visor intentará recuperarlo al mostrarlo); nunca se declara disponible.
 *
 * @param {{ currentVersion: number, pdf?: Object }} quote - Cotización devuelta por la API.
 * @param {{ versionNumber: number }} source - Versión restaurada.
 * @returns {{ title: string, description: string }} Aviso (la restauración se confirmó en ambos casos).
 */
export function describeQuoteRestoreResult(quote, source) {
  const base = `Se creó la V${quote.currentVersion} a partir de la V${source.versionNumber} y es la versión vigente. El historial se conserva.`;
  const status = describeQuotePdfStatus(quote.pdf);
  if (status.available) return { description: `${base} Su PDF está disponible.`, title: "Versión restaurada" };
  return { description: `${base} ${status.label}: se intentará recuperar al abrirlo.`, title: "Versión restaurada; PDF no disponible" };
}

/**
 * Traduce un error de la restauración comercial a un mensaje, el error del motivo (si lo hay) y si
 * hay que recargar el historial. Los conflictos de referencias usan la explicación del servidor,
 * que nombra el cliente, proyecto o servicio que ya no está disponible.
 *
 * @param {Object} error - Error de apiRequest (`code`, `message`, `fields`).
 * @returns {{ message: string, fieldError: string, stale: boolean }} Mensajes y recarga.
 */
export function describeQuoteRestoreError(error) {
  const fields = error?.fields || {};
  const field = fields["body.reason"] || fields.reason || "";
  const known = RESTORE_ERRORS[error?.code];
  return {
    fieldError: Array.isArray(field) ? field[0] || "" : field,
    message: known?.message || error?.message || "No se pudo restaurar la versión.",
    stale: Boolean(known?.stale),
  };
}
