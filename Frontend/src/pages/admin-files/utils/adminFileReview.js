// Reglas de presentación de U2 (visor, revisión, historial, restauración y garantías). Funciones
// puras: deciden el visor de cada versión, redactan los avisos a partir de lo que confirma la API y
// traducen sus conflictos. El backend sigue siendo la autoridad de cada regla.

// Límites del contrato (docs/API_CONTRACT.md, B4): motivo de rechazo 1–500 y de restauración 1–255.
export const REJECT_REASON_MAX_LENGTH = 500;
export const RESTORE_NOTE_MAX_LENGTH = 255;
// Versiones por página del historial («Mostrar más versiones»).
export const VERSION_HISTORY_PAGE_SIZE = 10;
// Sección funcional de «Documentos › Garantías» y sus subcarpetas (catálogo de carpetas).
const WARRANTY_SECTION = "warranties";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

/**
 * Elige el visor de una versión: PDF, DOCX y XLSX con los visores de documentos; imágenes, vídeos
 * y panorámicas (categoría `panorama` del archivo) con su visor; el resto no tiene vista previa.
 *
 * @param {{ extension?: string|null, contentType?: string|null, fileCategory?: string|null }} file - Versión o elemento.
 * @returns {"pdf"|"docx"|"xlsx"|"image"|"panorama"|"video"|"unsupported"} Tipo de visor.
 */
export function getViewerKind(file) {
  const extension = String(file?.extension || "").replace(/^\./, "").toLowerCase();
  const contentType = String(file?.contentType || "").toLowerCase();
  if (extension === "pdf" || contentType === "application/pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (extension === "xlsx") return "xlsx";
  if (IMAGE_EXTENSIONS.has(extension) || contentType.startsWith("image/")) {
    return file?.fileCategory === "panorama" ? "panorama" : "image";
  }
  if (VIDEO_EXTENSIONS.has(extension) || contentType.startsWith("video/")) return "video";
  return "unsupported";
}

// Tipos que se ven en el escenario de galería de Proyectos (a toda la altura junto al drawer) en
// lugar del modal de documentos de 790 px.
const MEDIA_VIEWER_KINDS = Object.freeze(["image", "video", "panorama"]);

/**
 * Indica si un tipo de visor se presenta como medio (imagen, vídeo o panorámica).
 *
 * @param {string} kind - Tipo de getViewerKind.
 * @returns {boolean} true para el escenario de galería.
 */
export function isMediaViewerKind(kind) {
  return MEDIA_VIEWER_KINDS.includes(kind);
}

/**
 * Indica si un documento puede respaldar garantías: debe estar en «Documentos › Garantías» o en
 * una de sus subcarpetas (B8); el backend lo vuelve a comprobar al vincular.
 *
 * @param {{ folder?: { section?: string|null }|null }} item - Elemento del administrador.
 * @returns {boolean} true si se ofrece «Garantías».
 */
export function canLinkWarranties(item) {
  return item?.folder?.section === WARRANTY_SECTION;
}

// Estados que el historial nombra junto a la versión porque Figma (3934:182047) solo dibuja aprobadas.
const LABELED_HISTORY_STATUSES = Object.freeze(["pending", "rejected"]);

/**
 * Etiqueta de una versión en el drawer del historial (Figma 3934:182047): «Versión actual» para la
 * vigente y «V3» para el resto. Las pendientes y rechazadas añaden su estado («V5 · Pendiente de
 * revisión»), que Figma no dibuja pero el administrador necesita para decidir.
 *
 * @param {{ versionNumber: number, isCurrent: boolean, review?: { status?: string } }} version - Versión.
 * @returns {string} Etiqueta.
 */
export function formatVersionLabel(version) {
  const base = version.isCurrent ? "Versión actual" : `V${version.versionNumber}`;
  const status = version.review?.status;
  return LABELED_HISTORY_STATUSES.includes(status) ? `${base} · ${formatReviewStatus(status)}` : base;
}

/**
 * Línea adicional de una versión del historial, solo cuando hay algo que contar: el motivo del
 * rechazo, el origen de una restauración («Restaurada desde V2», si esa versión está cargada) y el
 * motivo del cambio de un reemplazo o una restauración.
 *
 * @param {Object} version - Versión del historial.
 * @param {Array<Object>} versions - Versiones cargadas (para resolver el número de la de origen).
 * @returns {string} Texto o cadena vacía.
 */
export function describeVersionNote(version, versions) {
  if (version.review?.status === "rejected" && version.review?.reason) return `Motivo del rechazo: ${version.review.reason}`;
  const parts = [];
  if (version.restoredFromVersionId) {
    const source = (versions || []).find((candidate) => candidate.id === version.restoredFromVersionId);
    parts.push(source ? `Restaurada desde V${source.versionNumber}` : "Restaurada desde una versión anterior");
  }
  if (version.changeNote) parts.push(`Motivo: ${version.changeNote}`);
  return parts.join(" · ");
}

/**
 * Indica en la cabecera del visor qué versión se muestra cuando no es la vigente aprobada (ver una
 * versión anterior, una pendiente o una rechazada); con la vigente, la cabecera queda como Figma.
 *
 * @param {{ versionNumber: number, isCurrent?: boolean, review?: { status?: string } }} version - Versión mostrada.
 * @returns {string} «V3 · Aprobada» o cadena vacía.
 */
export function formatDisplayedVersionSuffix(version) {
  const status = version.review?.status;
  if (version.isCurrent && (status === "approved" || status === "legacy" || !status)) return "";
  return `V${version.versionNumber} · ${formatReviewStatus(status)}`;
}

const REVIEW_STATUS_LABELS = Object.freeze({
  approved: "Aprobada",
  legacy: "Heredada",
  pending: "Pendiente de revisión",
  rejected: "Rechazada",
});

/**
 * Estado de revisión legible.
 *
 * @param {string|null|undefined} status - Estado de la API.
 * @returns {string} Texto.
 */
export function formatReviewStatus(status) {
  return REVIEW_STATUS_LABELS[status] || REVIEW_STATUS_LABELS.legacy;
}

/**
 * Indica si una versión del historial puede restaurarse según B4: cualquier versión aprobada,
 * incluida la vigente (regla PR2), siempre que el archivo no tenga otra versión pendiente (PR1:
 * una sola pendiente por archivo). El motivo lo exige el diálogo y lo vuelve a validar la API.
 *
 * @param {Object} version - Versión del historial.
 * @param {Array<Object>} versions - Versiones cargadas del archivo.
 * @returns {{ allowed: boolean, reason: string }} Resultado y motivo si no procede.
 */
export function getRestoreAvailability(version, versions) {
  if (version.review?.status !== "approved") return { allowed: false, reason: "Solo se pueden restaurar versiones aprobadas." };
  if ((versions || []).some((candidate) => candidate.review?.status === "pending")) {
    return { allowed: false, reason: "El archivo ya tiene una versión pendiente de revisión." };
  }
  return { allowed: true, reason: "" };
}

/**
 * Indica si un archivo admite una versión nueva (B4, U3): no los heredados (sin versiones hasta su
 * conversión) ni los que ya tienen una pendiente (PR1). El motivo lo exige el diálogo y la API.
 *
 * @param {{ review?: { status?: string } }} version - Versión mostrada o fila de la tabla.
 * @param {Array<Object>} versions - Versiones conocidas del archivo (vacío si no se cargaron).
 * @returns {{ allowed: boolean, reason: string }} Resultado y motivo si no procede.
 */
export function getReplaceAvailability(version, versions) {
  if (version?.review?.status === "legacy") return { allowed: false, reason: "Este archivo heredado todavía no admite versiones." };
  if (version?.review?.status === "pending" || (versions || []).some((candidate) => candidate.review?.status === "pending")) {
    return { allowed: false, reason: "El archivo ya tiene una versión pendiente de revisión." };
  }
  return { allowed: true, reason: "" };
}

/**
 * Textos de la alerta que aparece cuando la API confirma una revisión. La aprobación hace
 * vigente la versión según los permisos del proyecto; compartirla es una acción aparte.
 *
 * @param {"approve"|"reject"} action - Acción confirmada.
 * @returns {{ title: string, description: string }} Textos de la alerta.
 */
export function describeReviewResult(action) {
  if (action === "approve") {
    return {
      description: "El archivo fue aprobado y está disponible según los permisos del proyecto.",
      title: "Archivo aprobado correctamente",
    };
  }
  return {
    description: "El motivo del rechazo quedó guardado en el historial de versiones.",
    title: "Archivo rechazado correctamente",
  };
}

/**
 * Explica, antes de confirmar, qué hará la restauración: la versión nueva (siguiente número del
 * historial cargado, cuyo primer elemento es la más reciente) con el contenido de la elegida, que
 * las anteriores se conservan y que queda pendiente de revisión sin cambiar la vigente.
 *
 * @param {{ versionNumber: number }} source - Versión que se restaura.
 * @param {Array<{ versionNumber: number }>} versions - Versiones cargadas del archivo.
 * @returns {string} Texto del diálogo.
 */
export function describeRestorePlan(source, versions) {
  const next = Math.max(Number(source.versionNumber), ...(versions || []).map((version) => Number(version.versionNumber))) + 1;
  return `Se creará la V${next} con el contenido de la V${source.versionNumber}. Las versiones anteriores se conservan y la nueva quedará pendiente de revisión; la versión vigente no cambia hasta aprobarla.`;
}

/**
 * Texto del aviso de una restauración confirmada: la versión nueva queda pendiente de revisión.
 *
 * @param {{ versionNumber: number, review?: { status: string } }} version - Versión creada.
 * @param {{ versionNumber: number }} source - Versión restaurada.
 * @returns {string} Descripción.
 */
export function describeRestoreResult(version, source) {
  const status = version?.review?.status === "pending" ? "queda pendiente de revisión" : `queda ${formatReviewStatus(version?.review?.status).toLowerCase()}`;
  return `Se creó la V${version?.versionNumber} a partir de la V${source?.versionNumber}, que se conserva en el historial. La nueva versión ${status}.`;
}

// Conflictos y respuestas obsoletas del contrato (B4 y B8). `stale` indica que la vista quedó
// desactualizada: se recargan tabla e historial sin cerrar lo que el usuario estaba viendo.
const OPERATION_ERRORS = Object.freeze({
  FORBIDDEN: { message: "No tienes permisos para realizar esta operación.", stale: false },
  FILE_DECISION_PENDING: { message: "El archivo está archivado y su tratamiento sigue pendiente de decisión.", stale: false },
  FILE_NOT_ACTIVE: { message: "El archivo ya no está activo.", stale: true },
  FILE_NOT_FOUND: { message: "El archivo ya no está disponible.", stale: true },
  FILE_VERSION_CONFLICT: { message: "Otra operación cambió el archivo al mismo tiempo. Se actualizó la información.", stale: true },
  FILE_VERSION_NOT_APPROVED: { message: "Solo se pueden restaurar versiones aprobadas.", stale: true },
  FILE_VERSION_NOT_FOUND: { message: "La versión ya no está disponible.", stale: true },
  FILE_VERSION_NOT_PENDING: { message: "Esta versión ya fue revisada. Se actualizó la información.", stale: true },
  FILE_VERSION_OBJECT_MISSING: { message: "El contenido de esa versión no está disponible en el almacenamiento: no se puede restaurar.", stale: false },
  FILE_STORAGE_UNAVAILABLE: { message: "No se pudo comprobar el contenido de la versión. Inténtalo de nuevo.", stale: false },
  FILE_VERSION_PENDING_REVIEW: { message: "El archivo ya tiene una versión pendiente de revisión. Revísala antes de restaurar otra.", stale: true },
  FILE_VERSIONING_UNAVAILABLE: { message: "Este archivo heredado todavía no admite versiones.", stale: false },
  PROJECT_ARCHIVED: { message: "El proyecto está archivado: sus archivos no se pueden modificar.", stale: false },
  PROJECT_DRAFT: { message: "El proyecto todavía es un borrador: esta operación no está disponible.", stale: false },
  PROJECT_FINALIZED: { message: "El proyecto está finalizado: sus archivos no se pueden modificar.", stale: false },
  WARRANTY_DOCUMENT_LINK_NOT_FOUND: { message: "El documento ya no estaba vinculado a esa garantía. Se actualizó la información.", stale: true },
  WARRANTY_DOCUMENT_OUTSIDE_FOLDER: { message: "El documento debe estar en «Documentos › Garantías» o en una de sus subcarpetas.", stale: false },
  WARRANTY_NOT_FOUND: { message: "La garantía ya no existe. Se actualizó la información.", stale: true },
  WARRANTY_RETIRED: { message: "La garantía fue retirada. Se actualizó la información.", stale: true },
});

/**
 * Traduce un error de las operaciones de U2 a un mensaje y, si lo hay, al error de un campo
 * (`body.reason` o `body.changeNote`).
 *
 * @param {Object} error - Error de apiRequest (`status`, `code`, `message`, `fields`).
 * @param {string} fallback - Mensaje por defecto.
 * @returns {{ message: string, fieldError: string, stale: boolean }} Mensajes y si hay que recargar.
 */
export function describeOperationError(error, fallback) {
  const fields = error?.code === "VALIDATION_ERROR" ? error.fields || {} : {};
  const field = fields["body.reason"] || fields["body.changeNote"] || fields.reason || fields.changeNote || "";
  const known = OPERATION_ERRORS[error?.code];
  return {
    fieldError: Array.isArray(field) ? field[0] || "" : field,
    message: known?.message || fallback,
    stale: Boolean(known?.stale),
  };
}
