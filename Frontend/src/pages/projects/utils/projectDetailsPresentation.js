import { api } from "../../../api/http.js";
import { decorateCommentForDisplay } from "../../../utils/commentDisplay.js";
import { getProjectTypeDisplay } from "../../../utils/projectTypeDisplay.js";

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

function upsertCommentById(comments, comment) {
  if (!comment?.id) {
    return comments;
  }

  const exists = comments.some((current) => current.id === comment.id);

  return exists
    ? comments.map((current) => (current.id === comment.id ? comment : current))
    : [...comments, comment];
}

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
