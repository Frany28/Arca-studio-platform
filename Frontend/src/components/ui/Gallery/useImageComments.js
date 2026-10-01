import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../../api/http.js";
import { useAuth } from "../../../auth/AuthContext.jsx";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import { decorateCommentForDisplay } from "../../../utils/commentDisplay.js";
import { getVideoObservationTiming } from "../../../utils/videoObservation.js";

const LEGACY_STORAGE_KEY = "arca.image-comments.v1";
const MULTIMEDIA_COMMENT_TYPES = new Set(["image", "video", "panorama", "document"]);

function getImageKey(item) {
  return String(item?.id ?? item?.image ?? item?.title ?? "image");
}

function stripResourceLinks(value) {
  if (Array.isArray(value)) {
    return value.map(stripResourceLinks);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["src", "imageSrc", "url", "fileUrl"].includes(key))
      .map(([key, item]) => [key, stripResourceLinks(item)]),
  );
}

function normalizePanoramaSelection(selection, commentType) {
  if (commentType !== "panorama" || selection?.kind !== "viewer3d-point") return selection;
  const position = selection.viewerPoint?.modelPosition;
  const x = Number(position?.x);
  const y = Number(position?.y);
  const z = Number(position?.z);
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) return selection;
  return {
    ...selection,
    yaw: Math.atan2(x, -z) * 180 / Math.PI,
    pitch: Math.asin(Math.min(Math.max(y / length, -1), 1)) * 180 / Math.PI,
  };
}

function getCommentFileId(comment) {
  const candidates = [comment?.fileId, comment?.targetId, comment?.image?.id, comment?.selection?.image?.id];
  for (const candidate of candidates) {
    const match = String(candidate || "").match(/(?:project-file-)?(\d+)$/);
    if (match) return Number(match[1]);
  }
  return null;
}

function clearLegacyStoredComments() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore blocked localStorage; the database remains the source of truth.
  }
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

function decorateComment(comment, user, projectNamesById = {}) {
  const selection = comment.selection || null;
  const fileId = getCommentFileId(comment);
  const protectedImageSrc =
    fileId && comment.projectId
      ? api.projects.getFileContentUrl({
          fileId,
          projectId: comment.projectId,
          versionId: comment.fileVersionId,
        })
      : null;
  const videoTiming = getVideoObservationTiming(selection);
  const pointNumber =
    comment.commentType === "panorama"
      ? Number(comment.pointNumber ?? comment.targetMetadata?.pointNumber) ||
        null
      : null;
  const imageFromSelection = selection?.image || null;
  const image = comment.image || imageFromSelection
    ? {
        ...(imageFromSelection || {}),
        ...(comment.image || {}),
        src:
          comment.image?.src ||
          imageFromSelection?.src ||
          selection?.imageSrc ||
          protectedImageSrc ||
          null,
      }
    : null;

  return {
    ...comment,
    ...decorateCommentForDisplay(comment, user, projectNamesById),
    image,
    imageComment: MULTIMEDIA_COMMENT_TYPES.has(comment.commentType),
    fileId: comment.fileId,
    fileType: comment.fileType,
    imageId: comment.targetId || comment.imageId,
    message: comment.message ?? comment.content,
    pointNumber,
    timestamp: getRelativeTimeLabel(comment.createdAt) || comment.timestamp,
    ...videoTiming,
  };
}

function withFallbackPointNumbers(comments) {
  const nextPointNumbersByTarget = new Map();
  const pointNumbersByRootId = new Map();

  const getTargetKey = (comment) =>
    `${comment.commentType || "image"}:${comment.targetId || comment.imageId || "target"}`;

  comments.forEach((comment) => {
    if (
      comment.commentType !== "panorama" ||
      comment.parentCommentId ||
      !comment.selection
    ) {
      return;
    }

    const targetKey = getTargetKey(comment);
    const nextPointNumber = nextPointNumbersByTarget.get(targetKey) || 1;
    const pointNumber = comment.pointNumber || nextPointNumber;
    pointNumbersByRootId.set(String(comment.id), pointNumber);
    nextPointNumbersByTarget.set(
      targetKey,
      Math.max(nextPointNumber, pointNumber + 1),
    );
  });

  return comments.map((comment) => {
    if (comment.commentType !== "panorama" || comment.pointNumber) {
      return comment;
    }

    const parentPointNumber = comment.parentCommentId
      ? pointNumbersByRootId.get(String(comment.parentCommentId))
      : null;

    if (parentPointNumber) {
      return {
        ...comment,
        pointNumber: parentPointNumber,
      };
    }

    if (!comment.parentCommentId && comment.selection) {
      return {
        ...comment,
        pointNumber: pointNumbersByRootId.get(String(comment.id)) || null,
      };
    }

    return comment;
  });
}

function normalizeProjectId(projectId) {
  const numericProjectId = Number(projectId);

  return Number.isInteger(numericProjectId) && numericProjectId > 0
    ? numericProjectId
    : null;
}

function isMatchingTarget(comment, { commentType, targetId }) {
  return (
    comment.commentType === commentType && String(comment.targetId) === targetId
  );
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

function sortCommentsByCreatedAt(comments) {
  return [...comments].sort(
    (left, right) =>
      new Date(left.createdAt || 0).getTime() -
      new Date(right.createdAt || 0).getTime(),
  );
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

  return sortCommentsByCreatedAt(Array.from(commentsById.values()));
}

function useProjectCommentRows(projectIds, { refreshIntervalMs = 0 } = {}) {
  const [comments, setComments] = useState([]);

  useEffect(() => {
    clearLegacyStoredComments();

    if (projectIds.length === 0) {
      queueMicrotask(() => setComments([]));
      return undefined;
    }

    let isMounted = true;

    Promise.all(
      projectIds.map((projectId) => api.projects.listAllComments({ projectId })),
    )
      .then((responses) => {
        if (isMounted) {
          setComments(
            responses.flatMap((data) =>
              Array.isArray(data.comments) ? data.comments : [],
            ),
          );
        }
      })
      .catch(() => {
        if (isMounted) {
          setComments([]);
        }
      });

    const unsubscribers = projectIds.map((projectId) =>
      api.projects.subscribeToEvents({
        projectId,
        onCommentCreated: (comment) => {
          if (isMounted) {
            setComments((current) => upsertCommentById(current, comment));
          }
        },
      }),
    );
    const refreshIntervalId =
      refreshIntervalMs > 0
        ? window.setInterval(() => {
            Promise.all(
              projectIds.map((projectId) =>
                api.projects.listAllComments({ projectId }),
              ),
            )
              .then((responses) => {
                if (isMounted) {
                  setComments((current) =>
                    mergeCommentsById(
                      current,
                      responses.flatMap((data) =>
                        Array.isArray(data.comments) ? data.comments : [],
                      ),
                    ),
                  );
                }
              })
              .catch(() => {});
          }, refreshIntervalMs)
        : null;

    return () => {
      isMounted = false;
      if (refreshIntervalId) {
        window.clearInterval(refreshIntervalId);
      }
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [projectIds, refreshIntervalMs]);

  return [comments, setComments];
}

export function getCommentImageKey(item) {
  return getImageKey(item);
}

export function getStoredImageComments() {
  clearLegacyStoredComments();
  return {};
}

export function useImageComments(item, { commentType = "image", projectId } = {}) {
  const { user } = useAuth();
  const { readOnly } = useProjectReadOnly();
  const imageKey = useMemo(() => getImageKey(item), [item]);
  const resolvedProjectId = normalizeProjectId(projectId);
  const projectIds = useMemo(
    () => (resolvedProjectId ? [resolvedProjectId] : []),
    [resolvedProjectId],
  );
  const [projectComments, setProjectComments] = useProjectCommentRows(projectIds);

  const comments = useMemo(
    () =>
      withFallbackPointNumbers(
        projectComments
          .filter((comment) =>
            isMatchingTarget(comment, { commentType, targetId: imageKey }),
          )
          .map((comment) => decorateComment(comment, user)),
      ),
    [commentType, imageKey, projectComments, user],
  );

  const addComment = useCallback(
    async ({ message, parentCommentId = null, selection = null }) => {
      if (!resolvedProjectId || readOnly) {
        return null;
      }

      const data = await api.projects.createComment({
        commentType,
        content: message,
        image: {
          id: imageKey,
          title: item?.title ?? item?.label ?? "Imagen",
        },
        parentCommentId,
        projectId: resolvedProjectId,
        selection: stripResourceLinks(normalizePanoramaSelection(selection, commentType)),
        targetId: imageKey,
      });

      const comment = data?.comment || null;

      if (comment) {
        setProjectComments((current) => upsertCommentById(current, comment));
      }

      return comment;
    },
    [
      commentType,
      imageKey,
      item?.label,
      item?.title,
      resolvedProjectId,
      readOnly,
      setProjectComments,
    ],
  );

  return {
    addComment,
    comments,
  };
}

export function useImageCommentNotifications({
  projectIds = [],
  projectNamesById = {},
  refreshIntervalMs = 0,
} = {}) {
  const { user } = useAuth();
  const projectIdsKey = useMemo(
    () =>
      [
        ...new Set(
          projectIds
            .map(normalizeProjectId)
            .filter((projectId) => Number.isInteger(projectId)),
        ),
      ].join(","),
    [projectIds],
  );
  const normalizedProjectIds = useMemo(
    () =>
      projectIdsKey
        ? projectIdsKey.split(",").map((projectId) => Number(projectId))
        : [],
    [projectIdsKey],
  );
  const [comments] = useProjectCommentRows(normalizedProjectIds, {
    refreshIntervalMs,
  });

  return useMemo(() => {
    return withFallbackPointNumbers(
      comments
        .filter((comment) => MULTIMEDIA_COMMENT_TYPES.has(comment.commentType))
        .sort((left, right) => {
          return (
            new Date(left.createdAt || 0).getTime() -
            new Date(right.createdAt || 0).getTime()
          );
        })
        .map((comment) => decorateComment(comment, user, projectNamesById)),
    ).sort((left, right) => {
        return (
          new Date(right.createdAt || 0).getTime() -
          new Date(left.createdAt || 0).getTime()
        );
      });
  }, [comments, projectNamesById, user]);
}
