import { getRelativeTimeLabel } from "../../../utils/commentMappers.js";
import { decorateCommentForDisplay } from "../../../utils/commentDisplay.js";

export function toDrawerComment(comment, user, files = []) {
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
