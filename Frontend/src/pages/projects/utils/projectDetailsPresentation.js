import { api } from "../../../api/http.js";
import { decorateCommentForDisplay } from "../../../utils/commentDisplay.js";
import { getProjectTypeDisplay } from "../../../utils/projectTypeDisplay.js";

/**
 * Deriva cuatro etapas visuales usando umbrales de progreso 25, 50, 75 y 100.
 * Marca completadas las alcanzadas, activa la primera restante y deja las demás
 * pendientes; no consulta etapas reales ni limita el progreso recibido.
 *
 * @param {number} progressValue - Progreso numérico del proyecto.
 * @returns {Array} Etapas con estado y tono visual.
 */
function createProjectStages(progressValue) {
  const stages = [
    { id: "survey", threshold: 25, title: "Levantamiento" },
    { id: "design", threshold: 50, title: "Propuesta de Diseño" },
    { id: "execution", threshold: 75, title: "Ejecución" },
    { id: "handoff", threshold: 100, title: "Entrega Final" },
  ];
  const activeStageIndex = stages.findIndex(
    (stage) => progressValue < stage.threshold,
  );

  return stages.map((stage, index) => {
    if (progressValue >= stage.threshold) {
      return { ...stage, status: "Completado", tone: "completed" };
    }

    if (index === activeStageIndex) {
      return { ...stage, status: "En proceso", tone: "active" };
    }

    return { ...stage, status: "Pendiente", tone: "pending" };
  });
}

/**
 * Presenta tamaños de archivo en KB redondeados o MB con un decimal.
 * Bajo un MiB muestra al menos un KB; valores no convertibles a número finito usan vacío.
 *
 * @param {number|string|null} size - Bytes del archivo.
 * @returns {string} Tamaño visible.
 */
function formatFileSize(size) {
  if (!Number.isFinite(Number(size))) {
    return "";
  }

  const bytes = Number(size);

  if (bytes < 1024 * 1024) {
    return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Actualiza por ID estricto o añade una observación, sin mutar la colección.
 * Entradas sin ID se ignoran; no equipara IDs numéricos y textuales.
 *
 * @param {Array} comments - Observaciones actuales.
 * @param {Object|null} comment - Observación entrante.
 * @returns {Array} Lista resultante.
 */
function upsertCommentById(comments, comment) {
  if (!comment?.id) {
    return comments;
  }

  const exists = comments.some((current) => current.id === comment.id);

  return exists
    ? comments.map((current) => (current.id === comment.id ? comment : current))
    : [...comments, comment];
}

/**
 * Une observaciones por ID convertido a texto, priorizando la lectura nueva.
 * Conserva filas anteriores ausentes en la lectura y ordena por createdAt ascendente.
 *
 * @param {Array} currentComments - Observaciones existentes.
 * @param {Array} nextComments - Observaciones nuevas.
 * @returns {Array} Unión ordenada sin IDs repetidos.
 */
function mergeCommentsById(currentComments, nextComments) {
  const commentsById = new Map();

  currentComments.forEach((comment) => {
    if (comment?.id) {
      commentsById.set(String(comment.id), comment);
    }
  });

  nextComments.forEach((comment) => {
    if (comment?.id) {
      commentsById.set(String(comment.id), comment);
    }
  });

  return Array.from(commentsById.values()).sort(
    (left, right) =>
      new Date(left.createdAt || 0).getTime() -
      new Date(right.createdAt || 0).getTime(),
  );
}

/**
 * Deduplica notificaciones por ID textual conservando la última observación de cada ID.
 * Ignora entradas sin ID y mantiene el orden de primera inserción, sin ordenar por fecha.
 *
 * @param {Array} comments - Observaciones candidatas.
 * @returns {Array} Observaciones únicas para notificaciones.
 */
function mergeNotificationComments(comments) {
  const commentsById = new Map();

  comments.forEach((comment) => {
    if (comment?.id) {
      commentsById.set(String(comment.id), comment);
    }
  });

  return Array.from(commentsById.values());
}

function isImageFile(file) {
  const fileType = String(file?.fileType || "").toLowerCase();
  const extension = String(file?.extension || "").toLowerCase();

  return fileType.startsWith("image/") || ["jpeg", "jpg", "png", "webp"].includes(extension);
}

function isVideoFile(file) {
  const fileType = String(file?.fileType || "").toLowerCase();
  const extension = String(file?.extension || "").toLowerCase();

  return fileType.startsWith("video/") || ["mp4", "webm", "mov"].includes(extension);
}

function isPanoramaFile(file) {
  return file?.fileCategory === "panorama";
}

/**
 * Formatea una fecha de archivo en es-ES con día, mes abreviado y año.
 * Usa la zona local y devuelve vacío si no hay valor; no captura fechas inválidas.
 *
 * @param {string|number|null} value - Fecha recibida para el archivo.
 * @returns {string} Fecha visible o vacío.
 * @throws {RangeError} Si un valor presente produce una fecha inválida.
 */
function formatFileDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * Adapta un archivo para galerías y construye su URL con la versión actual.
 * Prioriza título sobre nombre y autor de carga sobre responsable, cliente o ARCA Studio;
 * solo asigna image o video según MIME/extensión. Sin IDs la URL queda en null.
 *
 * @param {Object} file - Archivo recibido de la API.
 * @param {Object} options - Contexto de presentación.
 * @param {Object} options.project - Proyecto con ID y datos de autores alternativos.
 * @returns {Object} Recurso de galería con referencias, fecha, tamaño y autor.
 */
function toMediaFileItem(file, { project }) {
  const title = file.title || file.name || "Archivo";
  const uploadedAt = formatFileDate(file.createdAt);
  const contentUrl =
    project?.id && file.id
      ? api.projects.getFileContentUrl({
          fileId: file.id,
          projectId: project.id,
          versionId: file.currentVersionId,
        })
      : null;

  return {
    author:
      file.uploadedBy?.name ||
      project.assignedArchitect?.name ||
      project.client?.name ||
      "ARCA Studio",
    authorAvatarSrc: null,
    extension: file.extension,
    fileType: file.fileType,
    fileUrl: contentUrl,
    fileId: file.id,
    currentVersionId: file.currentVersionId,
    id: file.id,
    image: isImageFile(file) ? contentUrl : null,
    label: title,
    fileCategory: file.fileCategory,
    size: formatFileSize(file.size),
    title,
    uploadedAt,
    video: isVideoFile(file) ? contentUrl : null,
  };
}

/**
 * Extiende el proyecto con categoría, progreso, etapas, galerías y documentos.
 * Galerías exigen available; renders excluyen panoramas y estas usan fileCategory.
 * Documentos excluyen imágenes y videos sin filtrar available. Construye URLs
 * versionadas y normaliza tamaños y fechas; conserva el resto de los campos del proyecto.
 *
 * @param {Object} project - Proyecto con archivos y recentDocuments de la API.
 * @returns {Object} Modelo para la página de detalles con galerías y documentos.
 */
function toProjectPresentation(project) {
  const progressValue = Number(project?.progress) || 0;
  const projectFiles = project?.files || [];
  const imageFiles = projectFiles.filter((file) => isImageFile(file) && !isPanoramaFile(file));
  const renderGallery = imageFiles
    .filter((file) => file.available)
    .map((file) => toMediaFileItem(file, { project }));
  const videoGallery = projectFiles
    .filter((file) => isVideoFile(file) && file.available)
    .map((file) => toMediaFileItem(file, { project }));
  const panoramaGallery = projectFiles
    .filter((file) => isPanoramaFile(file) && file.available)
    .map((file) => toMediaFileItem(file, { project }));
  /**
   * Adapta documentos completos y recientes con la misma referencia versionada.
   * Usa FILE para extensión ausente y ARCA Studio para autor ausente; conserva
   * file.title como nombre sin sustituirlo y no filtra disponibilidad.
   *
   * @param {Object} file - Documento de la API en el ámbito del proyecto actual.
   * @returns {Object} Datos para cards documentales con URL, fecha y tamaño.
   */
  const toDocumentItem = (file) => {
      const contentUrl =
        project?.id && file.id
          ? api.projects.getFileContentUrl({
              fileId: file.id,
              projectId: project.id,
              versionId: file.currentVersionId,
            })
          : null;

      return {
        createdAt: file.createdAt,
        currentVersionId: file.currentVersionId,
        fileType: String(file.extension || "FILE").toUpperCase(),
        fileUrl: contentUrl,
        id: file.id,
        name: file.title,
        owner: file.uploadedBy?.name || "ARCA Studio",
        ownerAvatarSrc: null,
        size: formatFileSize(file.size),
        uploadedAt: formatFileDate(file.createdAt),
      };
    };
  const documents = projectFiles
    .filter((file) => !isImageFile(file) && !isVideoFile(file))
    .map(toDocumentItem);
  const recentDocuments = (project?.recentDocuments || []).map(toDocumentItem);

  return {
    ...project,
    category: getProjectTypeDisplay(project?.projectType),
    progressValue,
    stages: createProjectStages(progressValue),
    title: project?.name || "Proyecto",
    documents,
    recentDocuments,
    panoramaGallery,
    renderGallery,
    videoGallery,
  };
}

function getRelativeTimeLabel(value) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMinutes = Math.max(Math.floor(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Ahora";
  }

  if (diffMinutes < 60) {
    return `Hace ${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  }

  const diffDays = Math.floor(diffHours / 24);

  return `Hace ${diffDays} ${diffDays === 1 ? "dia" : "dias"}`;
}

/**
 * Adapta una observación al drawer de detalles conservando referencias al recurso.
 * Para documentos busca extensión por fileId y usa FILE si no encuentra archivo;
 * resuelve autor, tipo, punto de panorámica y fecha relativa sin renumerar IDs.
 *
 * @param {Object} comment - Observación de la API.
 * @param {Object|null} user - Usuario actual para decorar autor.
 * @param {Array} [files=[]] - Archivos del proyecto para resolver extensión documental.
 * @returns {Object} Observación de presentación con datos para navegar al recurso.
 */
function toDrawerComment(comment, user, files = []) {
  const commentType = comment.commentType || "general";
  const documentFile = commentType === "document"
    ? files.find((file) => String(file.id) === String(comment.fileId))
    : null;

  return {
    ...decorateCommentForDisplay(comment, user),
    commentType,
    id: comment.id,
    image: comment.image,
    fileId: comment.fileId,
    fileType: String(documentFile?.extension || "FILE").toUpperCase(),
    imageComment: ["image", "panorama", "video", "document"].includes(commentType),
    imageId: comment.targetId || comment.imageId,
    message: comment.content,
    pointNumber:
      commentType === "panorama"
        ? Number(comment.pointNumber ?? comment.targetMetadata?.pointNumber) ||
          null
        : null,
    createdAt: comment.createdAt,
    parentCommentId: comment.parentCommentId,
    projectId: comment.projectId,
    selection: comment.selection,
    targetId: comment.targetId,
    timestamp: getRelativeTimeLabel(comment.createdAt),
    type: comment.type,
  };
}

export {
  mergeCommentsById,
  mergeNotificationComments,
  toDrawerComment,
  toProjectPresentation,
  upsertCommentById,
};
