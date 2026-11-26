// Reglas de carga de U3 alineadas con el backend (services/fileUploadService.js, política `document`,
// y la regla confirmada de la portada en domain/projectFolderCatalog.js). El backend vuelve a validar
// todo: estas reglas solo evitan transferir lo que se rechazaría y explican el motivo antes.

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_NAME_MAX_LENGTH = 150;
// Motivo del reemplazo (B4): obligatorio y de hasta 255 caracteres.
export const CHANGE_NOTE_MAX_LENGTH = 255;

const TYPE_BY_EXTENSION = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
const COVER_EXTENSIONS = Object.freeze(["jpeg", "jpg", "png"]);

/**
 * Extensión en minúsculas de un nombre de archivo.
 *
 * @param {string} name - Nombre.
 * @returns {string} Extensión sin punto o cadena vacía.
 */
export function getUploadExtension(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot > 0 && dot < normalized.length - 1 ? normalized.slice(dot + 1) : "";
}

/**
 * Formatos que admite una carpeta: la portada, solo JPG o PNG; el resto de carpetas y la raíz,
 * todos los de la subida de documentos (D14 resuelta: la ubicación no restringe el formato).
 *
 * @param {{ systemKey?: string|null }|null} folder - Carpeta destino.
 * @returns {string[]} Extensiones admitidas.
 */
export function getAcceptedExtensions(folder) {
  return folder?.systemKey === "cover" ? [...COVER_EXTENSIONS] : Object.keys(TYPE_BY_EXTENSION);
}

/**
 * Valor de `accept` del selector de archivos.
 *
 * @param {{ systemKey?: string|null }|null} folder - Carpeta destino.
 * @returns {string} Extensiones con punto separadas por comas.
 */
export function getUploadAccept(folder) {
  return getAcceptedExtensions(folder).map((extension) => `.${extension}`).join(",");
}

/**
 * Texto de formatos bajo la zona de carga (Figma: «Formatos JPEG, PNG, PDF, hasta 50 MB.»).
 *
 * @param {{ systemKey?: string|null }|null} folder - Carpeta destino.
 * @returns {string} Texto.
 */
export function getFormatsLabel(folder) {
  if (folder?.systemKey === "cover") return "Una sola imagen JPEG o PNG, hasta 50 MB.";
  return "Formatos PDF, DOCX, XLSX, JPEG, PNG y MP4, hasta 50 MB.";
}

/**
 * Valida un archivo antes de transferirlo: nombre, formato (extensión y tipo), tamaño y, si se
 * indican, los nombres que ya existen en la selección.
 *
 * @param {File} file - Archivo elegido.
 * @param {Object} [options] - Carpeta destino y nombres ya elegidos.
 * @param {{ systemKey?: string|null }|null} [options.folder] - Carpeta destino.
 * @param {string[]} [options.takenNames] - Nombres ya seleccionados (sin distinguir mayúsculas).
 * @returns {string} Motivo del rechazo o cadena vacía si es válido.
 */
export function validateUploadFile(file, { folder = null, takenNames = [] } = {}) {
  const name = String(file?.name || "").trim();
  if (!name || name.length > UPLOAD_NAME_MAX_LENGTH) return `El nombre del archivo debe tener entre 1 y ${UPLOAD_NAME_MAX_LENGTH} caracteres.`;
  if (takenNames.some((taken) => taken.toLowerCase() === name.toLowerCase())) return "Ese archivo ya está seleccionado.";
  const extension = getUploadExtension(name);
  const accepted = getAcceptedExtensions(folder);
  if (!accepted.includes(extension) || (file.type && TYPE_BY_EXTENSION[extension] !== file.type)) {
    return folder?.systemKey === "cover" ? "La portada solo admite imágenes JPEG o PNG." : "Formato no admitido. Usa PDF, DOCX, XLSX, JPEG, PNG o MP4.";
  }
  if (!file.size) return "El archivo está vacío.";
  if (file.size > UPLOAD_MAX_BYTES) return "El archivo supera el tamaño máximo de 50 MB.";
  return "";
}

// Respuestas de la API que no mejoran al repetir la carga: se muestran sin reintento.
const FINAL_UPLOAD_ERRORS = Object.freeze({
  DUPLICATE_PROJECT_FILE: "Ya existe un archivo con ese nombre en esta carpeta. No se reemplazó nada: cancela o usa «Reemplazar archivo» en ese archivo para subir una versión nueva.",
  FILE_TOO_LARGE: "El archivo supera el tamaño máximo que admite el servidor.",
  FILE_VERSION_PENDING_REVIEW: "El archivo ya tiene una versión pendiente de revisión. Revísala antes de subir otra.",
  FILE_VERSIONING_UNAVAILABLE: "Este archivo heredado todavía no admite versiones.",
  PROJECT_ARCHIVED: "El proyecto está archivado: no admite archivos nuevos.",
  PROJECT_DRAFT: "El proyecto todavía es un borrador: sus archivos se reemplazan desde su configuración.",
  PROJECT_FINALIZED: "El proyecto está finalizado: no admite archivos nuevos.",
  PROJECT_FOLDER_FILE_TYPE_NOT_ACCEPTED: "La portada solo admite imágenes JPEG o PNG.",
  PROJECT_FOLDER_FULL: "La portada admite una sola imagen: reemplaza la existente.",
  PROJECT_FOLDER_NOT_FOUND: "La carpeta ya no existe. Elige otra carpeta.",
  UNSUPPORTED_FILE_TYPE: "Formato no admitido. Usa PDF, DOCX, XLSX, JPEG, PNG o MP4.",
});

/**
 * Traduce el error de una carga. `retryable` indica si conviene ofrecer «Intenta de nuevo» (red,
 * servidor no disponible); `uncertain` indica que la carga pudo registrarse aunque la respuesta no
 * llegó (fallo de red o cancelación tras enviar los datos) y hay que reconciliar con lo guardado.
 *
 * El nombre lógico es único por carpeta (la raíz incluida): un homónimo en el destino responde
 * DUPLICATE_PROJECT_FILE y, con `location`, el mensaje nombra esa ubicación. Nunca se reemplaza: el
 * usuario cancela o usa «Reemplazar archivo» sobre el existente.
 *
 * @param {Object} error - Error de uploadRawFile (`code`, `status`, `message`).
 * @param {{ location?: string }} [context] - Ubicación destino legible («Proyecto › Ruta» o la raíz).
 * @returns {{ message: string, retryable: boolean, uncertain: boolean, cancelled: boolean, fieldError: string }} Diagnóstico.
 */
export function describeUploadError(error, { location = "" } = {}) {
  const code = error?.code || "";
  const fields = error?.fields || {};
  const fieldError = fields["headers.x-change-note"] || "";
  if (code === "UPLOAD_ABORTED") return { cancelled: true, fieldError: "", message: "Carga cancelada.", retryable: true, uncertain: true };
  if (code === "DUPLICATE_PROJECT_FILE" && location) {
    return {
      cancelled: false,
      fieldError: "",
      message: `Ya existe un archivo con ese nombre en ${location}. No se reemplazó nada: cancela o usa «Reemplazar archivo» en ese archivo para subir una versión nueva.`,
      retryable: false,
      uncertain: false,
    };
  }
  if (FINAL_UPLOAD_ERRORS[code]) return { cancelled: false, fieldError: "", message: FINAL_UPLOAD_ERRORS[code], retryable: false, uncertain: false };
  if (fieldError) return { cancelled: false, fieldError: Array.isArray(fieldError) ? fieldError[0] : fieldError, message: "", retryable: false, uncertain: false };
  const network = code === "NETWORK_ERROR" || !error?.status;
  const serverDown = Number(error?.status) >= 500;
  return {
    cancelled: false,
    fieldError: "",
    message: network ? "Se perdió la conexión durante la carga." : error?.message || "No se pudo subir el archivo.",
    retryable: network || serverDown || Number(error?.status) === 429,
    uncertain: network,
  };
}

/**
 * Aviso de una carga confirmada: deja claro que queda pendiente de revisión.
 *
 * @param {"upload"|"replace"} kind - Operación.
 * @param {{ name: string, location?: string, versionNumber?: number }} result - Datos confirmados.
 * @returns {{ title: string, description: string }} Textos.
 */
export function describeUploadResult(kind, result) {
  if (kind === "replace") {
    return {
      description: `Se creó la V${result.versionNumber} de «${result.name}». Queda pendiente de revisión: la versión vigente no cambia hasta aprobarla.`,
      title: "Versión subida",
    };
  }
  return {
    description: `«${result.name}» se subió a ${result.location}. Queda pendiente de revisión en «Pendientes por aprobación».`,
    title: "Archivo subido",
  };
}
