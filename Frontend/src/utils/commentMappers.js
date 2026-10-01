import { decorateCommentForDisplay } from "./commentDisplay.js";

export function getRelativeTimeLabel(value) {
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

export function toDrawerComment(comment, user, projectNamesById = {}) {
  const commentType = comment.commentType || "general";
  const isEnvironmentComment = comment.scope === "environment";
  const commentId = isEnvironmentComment
    ? `environment:${comment.id}`
    : comment.id;
  const parentCommentId = comment.parentCommentId
    ? isEnvironmentComment
      ? `environment:${comment.parentCommentId}`
      : comment.parentCommentId
    : null;

  return {
    ...decorateCommentForDisplay(comment, user, projectNamesById),
    commentType,
    fileId: comment.fileId,
    fileType: comment.fileType,
    fileVersionId: comment.fileVersionId,
    id: commentId,
    image: comment.image,
    imageComment: ["image", "panorama", "video", "document"].includes(commentType),
    imageId: comment.targetId || comment.imageId,
    message: comment.content,
    pointNumber:
      commentType === "panorama"
        ? Number(comment.pointNumber ?? comment.targetMetadata?.pointNumber) ||
          null
        : null,
    createdAt: comment.createdAt,
    parentCommentId,
    projectId: comment.projectId,
    selection: comment.selection,
    targetId: comment.targetId,
    timestamp: getRelativeTimeLabel(comment.createdAt),
    type: comment.type,
  };
}

export function getEnvironmentCommentId(value) {
  const normalizedValue = String(value || "");
  const numericValue = Number(
    normalizedValue.startsWith("environment:")
      ? normalizedValue.slice("environment:".length)
      : normalizedValue,
  );

  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : null;
}

export function normalizeProjectIds(projectIds = []) {
  return [
    ...new Set(
      projectIds
        .map((projectId) => Number(projectId))
        .filter((projectId) => Number.isInteger(projectId) && projectId > 0),
    ),
  ];
}
