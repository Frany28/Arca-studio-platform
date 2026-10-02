import { useEffect, useMemo, useState } from "react";

import { useImageCommentNotifications } from "../../../components/ui/Gallery/useImageComments.js";
import {
  useProjectComments,
  useRecentProjectComments,
} from "../../../hooks/useProjectComments.js";
import { getProjectNamesById } from "../../../utils/commentDisplay.js";
import { getCommentNavigationParams } from "../../../utils/commentSelection.js";
import { getProjectPath } from "../../../utils/projectRoutes.js";

function mergeNotificationComments(comments) {
  const commentsById = new Map();

  comments.forEach((comment) => {
    if (comment?.id) {
      commentsById.set(String(comment.id), comment);
    }
  });

  return Array.from(commentsById.values());
}

export default function useHomeNotifications({
  commentProjectRows,
  navigate,
  ownedProjectRows,
  user,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const projectIds = useMemo(
    () => commentProjectRows.map((project) => project.id),
    [commentProjectRows],
  );
  const projectNamesById = useMemo(
    () => getProjectNamesById(commentProjectRows),
    [commentProjectRows],
  );

  const imageCommentNotifications = useImageCommentNotifications({
    projectIds,
    projectNamesById,
    refreshIntervalMs: isOpen ? 5000 : 15000,
  });

  const commentsProjectId = commentProjectRows[0]?.id ?? null;

  const {
    drawerComments: submittedDrawerComments,
    submitComment,
    refresh: refreshSubmittedComments,
    error: submittedCommentsError,
    loading: submittedCommentsLoading,
  } = useProjectComments({
    enabled: false,
    projectId: commentsProjectId,
    refreshIntervalMs: isOpen ? 5000 : 0,
    user,
  });

  const {
    drawerComments: recentProjectComments,
    error: recentProjectCommentsError,
    loading: recentProjectCommentsLoading,
    refresh: refreshRecentComments,
  } = useRecentProjectComments({
    enabled: commentProjectRows.length > 0,
    projectIds,
    projectNamesById,
    refreshIntervalMs: isOpen ? 5000 : 15000,
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

  const comments = useMemo(
    () =>
      mergeNotificationComments([
        ...drawerComments,
        ...imageCommentNotifications,
      ]),
    [drawerComments, imageCommentNotifications],
  );

  const error = recentProjectCommentsError || submittedCommentsError;
  const loading = recentProjectCommentsLoading || submittedCommentsLoading;

  useEffect(() => {
    if (isOpen) {
      refreshRecentComments?.();
      refreshSubmittedComments?.();
    }
  }, [isOpen, refreshRecentComments, refreshSubmittedComments]);

  const close = () => {
    setIsOpen(false);
  };

  const toggle = () => {
    setIsOpen((current) => !current);
  };

  const openActivity = (activity) => {
    if (!activity?.to) {
      return;
    }

    setIsOpen(false);
    navigate(activity.to);
  };

  const openComment = (comment) => {
    const params = getCommentNavigationParams(comment);

    setIsOpen(false);
    const targetProjectId = comment?.projectId || commentsProjectId;

    if (!targetProjectId) {
      return;
    }

    const targetProject = ownedProjectRows.find(
      (project) => project.id === Number(targetProjectId),
    );

    navigate(
      targetProject
        ? getProjectPath(targetProject, params.toString())
        : `/proyectos/${targetProjectId}?${params.toString()}`,
    );
  };

  return {
    close,
    comments,
    commentsProjectId,
    error,
    isOpen,
    loading,
    openActivity,
    openComment,
    submitComment,
    toggle,
  };
}
