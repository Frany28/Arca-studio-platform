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
