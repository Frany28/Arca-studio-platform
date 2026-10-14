import { api } from "../api/http.js";

const PDF_MIME_TYPE = "application/pdf";

/**
 * Indica si un adjunto de solicitud es un PDF, a partir del tipo MIME que devuelve la API.
 * Los PDF se muestran en el visor integrado; el backend los sirve como descarga (hallazgo B-1).
 *
 * @param {{ fileType?: string|null }|null} file - Adjunto con `fileType` en formato MIME.
 * @returns {boolean} true si el adjunto es un PDF.
 */
export function isPdfAttachment(file) {
  return String(file?.fileType || "").split(";")[0].trim().toLowerCase() === PDF_MIME_TYPE;
}

/**
 * Adapta un adjunto de solicitud al documento que espera ProjectDocumentViewerModal.
 * El visor deduce el tipo por extensión (`fileType`) o MIME (`mimeType`) y descarga `fileUrl` con fetch.
 *
 * @param {{ id: number, name?: string, fileType?: string|null }} file - Adjunto de la solicitud.
 * @param {number|string} projectRequestId - Solicitud a la que pertenece el adjunto.
 * @returns {{ id: number, name: string, fileType: string, mimeType: string, fileUrl: string }} Documento para el visor.
 */
export function toAttachmentViewerDocument(file, projectRequestId) {
  return {
    fileType: "pdf",
    fileUrl: api.projectRequests.getFileContentUrl({ fileId: file.id, projectRequestId }),
    id: file.id,
    mimeType: PDF_MIME_TYPE,
    name: file.name || "Archivo",
  };
}
