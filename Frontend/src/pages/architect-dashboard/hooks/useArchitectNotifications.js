import { mergeNotificationComments } from "../../../utils/mergeNotificationComments.js";
import { useEffect, useMemo } from "react";
import { useImageCommentNotifications } from "../../../components/ui/Gallery/useImageComments.js";
import {
  useProjectComments,
  useRecentProjectComments,
} from "../../../hooks/useProjectComments.js";
import { getProjectNamesById } from "../../../utils/commentDisplay.js";

export function useArchitectNotifications({ user, isNotificationsDrawerOpen, commentProjectRows }) {
  const imageCommentNotifications = useImageCommentNotifications({
    projectIds: commentProjectRows.map((project) => project.id),
    projectNamesById: getProjectNamesById(commentProjectRows),
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
  });

  const commentsProjectId = commentProjectRows[0]?.id ?? null;

  const {
    drawerComments: submittedDrawerComments,
    submitComment,
    refresh: refreshSubmittedComments,
  } = useProjectComments({
    enabled: false,
    projectId: commentsProjectId,
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 0,
    user,
  });

  const {
    drawerComments: recentProjectComments,
    error: recentProjectCommentsError,
    loading: recentProjectCommentsLoading,
    refresh: refreshRecentComments,
  } = useRecentProjectComments({
    enabled: commentProjectRows.length > 0,
    projectIds: commentProjectRows.map((project) => project.id),
    projectNamesById: getProjectNamesById(commentProjectRows),
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
    user,
  });

  const drawerComments = useMemo(() => {
    const commentsById = new Map();

    [...recentProjectComments, ...submittedDrawerComments].forEach(
      (comment) => {
        commentsById.set(String(comment.id), comment);
      },
    );

    return Array.from(commentsById.values());
  }, [recentProjectComments, submittedDrawerComments]);

  const drawerCommentsError = recentProjectCommentsError;

  const drawerCommentsLoading = recentProjectCommentsLoading;

  const notificationComments = useMemo(
    () => mergeNotificationComments([...drawerComments, ...imageCommentNotifications]),
    [drawerComments, imageCommentNotifications],
  );

  useEffect(() => {
    if (isNotificationsDrawerOpen) {
      refreshRecentComments?.();
      refreshSubmittedComments?.();
    }
  }, [
    isNotificationsDrawerOpen,
    refreshRecentComments,
    refreshSubmittedComments,
  ]);

  return {
    commentsProjectId,
    submitComment,
    drawerCommentsError,
    drawerCommentsLoading,
    notificationComments,
  };
}
