/**
 * Alterna la selección comparando IDs como texto.
 * Seleccionar de nuevo la misma referencia devuelve null para deseleccionarla.
 *
 * @param {string|number|null} currentCommentId - Selección actual.
 * @param {string|number|null} selectedCommentId - Referencia elegida.
 * @returns {string|number|null} Nueva selección.
 */
export function getToggledCommentId(currentCommentId, selectedCommentId) {
  return String(currentCommentId) === String(selectedCommentId)
    ? null
    : selectedCommentId;
}

/**
 * Construye el destino de una observación dentro del proyecto.
 * Documentos usan tab documents y fileId; los demás usan renders. Si no se añade
 * fileId puede añadir imageId, y conserva commentId cuando está presente.
 *
 * @param {Object|null} comment - Observación con tipo y referencias de recurso.
 * @returns {URLSearchParams} Parámetros para abrir pestaña, recurso y comentario.
 */
export function getCommentNavigationParams(comment) {
  const isDocument = comment?.commentType === "document";
  const params = new URLSearchParams({ tab: isDocument ? "documents" : "renders" });

  if (isDocument && comment?.fileId) {
    params.set("fileId", String(comment.fileId));
  } else if (comment?.imageId) {
    params.set("imageId", String(comment.imageId));
  }

  if (comment?.id) {
    params.set("commentId", String(comment.id));
  }

  return params;
}
