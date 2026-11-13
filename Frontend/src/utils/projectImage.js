import { api } from "../api/http.js";

/**
 * Prioriza la portada servida por la API cuando existen proyecto e imageFileId.
 * Incluye imageFileVersionId en la construcción de URL; sin esos IDs usa image o null.
 * Solo construye la referencia, sin hacer una petición.
 *
 * @param {Object|null} project - Proyecto con referencia de portada o imagen directa.
 * @returns {string|null} Fuente de imagen del proyecto.
 */
export function getProjectImageSource(project) {
  if (project?.imageFileId && project?.id) {
    return api.projects.getFileContentUrl({
      fileId: project.imageFileId,
      projectId: project.id,
      versionId: project.imageFileVersionId,
    });
  }
  return project?.image || null;
}

/**
 * Miniatura de una solicitud del listado del cliente (`imageFileId`). Una solicitud convertida con
 * proyecto lee la imagen desde el proyecto: al aprobar, sus adjuntos pasan a ser archivos del
 * proyecto y la portada cambia sola cuando se suben imágenes nuevas. Antes de aprobarse se lee del
 * endpoint de adjuntos de la solicitud. Sin imagen devuelve null (placeholder de `ProjectImage`).
 * Solo construye la referencia, sin hacer una petición.
 *
 * @param {{id: number, status?: string, convertedProjectId?: number|null, imageFileId?: number|null,
 *   imageFileVersionId?: number|null}|null} projectRequest - Solicitud del listado.
 * @returns {string|null} URL autenticada de la imagen o null.
 */
export function getProjectRequestImageSource(projectRequest) {
  const fileId = projectRequest?.imageFileId;
  if (!fileId || !projectRequest?.id) return null;
  // Mientras el proyecto es un borrador interno, la imagen se sirve por la ruta de la solicitud.
  if (projectRequest.status === "converted" && projectRequest.convertedProjectId && projectRequest.convertedProjectAvailable) {
    return api.projects.getFileContentUrl({
      fileId,
      projectId: projectRequest.convertedProjectId,
      versionId: projectRequest.imageFileVersionId,
    });
  }
  return api.projectRequests.getFileContentUrl({ fileId, projectRequestId: projectRequest.id });
}
