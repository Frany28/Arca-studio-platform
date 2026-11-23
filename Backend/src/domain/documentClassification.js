import { getSystemFolder, QUOTE_DOCUMENTS_FOLDER_KEY } from "./projectFolderCatalog.js";

// Clasificación documental del administrador de archivos. Dominio puro: decide la ubicación lógica
// (carpeta predeterminada por clave funcional estable) de un documento según su ORIGEN y su
// CATEGORÍA FUNCIONAL, nunca por su extensión (un PDF puede ser cotización, plano, acta o garantía).
//
// Ubicación lógica ≠ ubicación física: la carpeta solo agrupa el documento en el administrador
// (`files.folder_id`, o la carpeta virtual de las cotizaciones). El objeto sigue en su bucket y con su
// clave; cambiar de carpeta nunca traslada, copia ni reescribe el objeto ni sus versiones.
//
// Una ubicación solo se asigna cuando es comprobable. Lo que no puede determinarse con certeza
// (p. ej. la fase de una imagen o el tipo documental de un PDF antiguo) queda «pendiente de
// clasificación» con una sugerencia para revisión; nunca se asigna de forma arbitraria.

export const DOCUMENT_ORIGINS = Object.freeze({
  // Archivo subido a una carpeta elegida por el usuario (administrador o configuración del borrador).
  FOLDER_UPLOAD: "folder_upload",
  // Archivo anterior a las carpetas, sin ubicación registrada.
  LEGACY_UPLOAD: "legacy_upload",
  // PDF generado por Cotizaciones para una versión comercial.
  QUOTE_PDF: "quote_pdf",
  // Adjunto de la solicitud de proyecto de la que nació el proyecto (`origin_project_request_id`).
  REQUEST_ATTACHMENT: "request_attachment",
});

export const CLIENT_FILES_FOLDER_KEY = "client_files";

// Carpeta de la categoría funcional sin fase: solo es una SUGERENCIA para el reporte de pendientes.
// La fase (propuesta inicial, ejecución, resultado final...) o el tipo documental los decide una persona.
const SUGGESTED_KEY_BY_CATEGORY = Object.freeze({
  document: "documents",
  image: "renders.images",
  panorama: "renders.models",
  video: "renders.videos",
});

const PENDING_REASONS = Object.freeze({
  document: "DOCUMENT_TYPE_UNKNOWN",
  image: "IMAGE_STAGE_UNKNOWN",
  panorama: "PANORAMA_STAGE_UNKNOWN",
  video: "VIDEO_STAGE_UNKNOWN",
});

/**
 * Determina el origen de un archivo de proyecto a partir de lo registrado en `files`.
 *
 * @param {{ folderId?: number|null, originProjectRequestId?: number|null }} file - Archivo.
 * @returns {string} Uno de DOCUMENT_ORIGINS (sin cotizaciones, que no viven en `files`).
 */
export function resolveFileOrigin({ folderId = null, originProjectRequestId = null }) {
  if (folderId !== null && folderId !== undefined) return DOCUMENT_ORIGINS.FOLDER_UPLOAD;
  if (originProjectRequestId !== null && originProjectRequestId !== undefined) return DOCUMENT_ORIGINS.REQUEST_ATTACHMENT;
  return DOCUMENT_ORIGINS.LEGACY_UPLOAD;
}

/**
 * Resuelve la ubicación lógica de un documento.
 *
 * - Cotización: siempre «Documentos › Cotizaciones» (`documents.quotes`).
 * - Adjunto de la solicitud de origen: «Archivos del cliente» (`client_files`).
 * - Subida a una carpeta: la carpeta elegida, que ya es su clasificación (no se reubica).
 * - Archivo heredado sin carpeta: pendiente, con la carpeta de su categoría como sugerencia.
 *
 * @param {object} document - Documento.
 * @param {string} document.origin - Uno de DOCUMENT_ORIGINS.
 * @param {"document"|"image"|"video"|"panorama"|null} [document.fileCategory] - Categoría funcional.
 * @param {string|null} [document.folderKey] - Clave de la carpeta elegida (subidas a carpeta).
 * @returns {{ status: "classified"|"kept"|"pending", folderKey: string|null, suggestedKey: string|null, reason: string }}
 *   Ubicación: `classified` (asignable automáticamente), `kept` (ya ubicado por el usuario) o `pending`.
 */
export function resolveDocumentLocation({ fileCategory = null, folderKey = null, origin }) {
  switch (origin) {
    case DOCUMENT_ORIGINS.QUOTE_PDF:
      return { folderKey: QUOTE_DOCUMENTS_FOLDER_KEY, reason: "QUOTE_PDF", status: "classified", suggestedKey: null };
    case DOCUMENT_ORIGINS.REQUEST_ATTACHMENT:
      return { folderKey: CLIENT_FILES_FOLDER_KEY, reason: "REQUEST_ATTACHMENT", status: "classified", suggestedKey: null };
    case DOCUMENT_ORIGINS.FOLDER_UPLOAD:
      return { folderKey, reason: "CHOSEN_FOLDER", status: "kept", suggestedKey: null };
    case DOCUMENT_ORIGINS.LEGACY_UPLOAD:
      return {
        folderKey: null,
        reason: PENDING_REASONS[fileCategory] || "CATEGORY_UNKNOWN",
        status: "pending",
        suggestedKey: SUGGESTED_KEY_BY_CATEGORY[fileCategory] ?? null,
      };
    default:
      throw Object.assign(new Error(`Origen documental desconocido: ${origin}`), { code: "UNKNOWN_DOCUMENT_ORIGIN" });
  }
}

/**
 * Nombre legible de la sugerencia de un pendiente («Renders e imágenes › Imágenes»).
 *
 * @param {string|null} key - Clave sugerida.
 * @returns {string} Ruta del catálogo o cadena vacía.
 */
export function describeCatalogPath(key) {
  const names = [];
  for (let current = getSystemFolder(key); current; current = getSystemFolder(current.parentKey)) names.unshift(current.name);
  return names.join(" › ");
}
