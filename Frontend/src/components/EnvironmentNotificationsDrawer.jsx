import { useMemo } from "react";

import { useAuth } from "../auth/AuthContext.jsx";
import { useAdminRecentActivity } from "../hooks/useAdminRecentActivity.js";
import { useEnvironmentComments } from "../hooks/useProjectComments.js";
import {
  getEnvironmentNotificationsPolicy,
  isAdministrator,
} from "../utils/observationAccess.js";
import NotificationsDrawer from "./ui/NotificationsDrawer.jsx";

function mergeDrawerComments(environmentComments, projectComments) {
  const commentsById = new Map();

  [...environmentComments, ...projectComments].forEach((comment) => {
    if (comment?.id !== undefined && comment?.id !== null) {
      commentsById.set(String(comment.id), comment);
    }
  });

  return Array.from(commentsById.values());
}

function EnvironmentNotificationsDrawer({
  activityOnly = false,
  comments = [],
  commentsError = "",
  commentsLoading = false,
  onRefreshComments,
  onSubmitComment,
  open = false,
  recentActivity = [],
  recentActivityError = "",
  recentActivityLoading = false,
  onRefreshActivity,
  ...props
}) {
  const { user } = useAuth();
  const isAdmin = isAdministrator(user);
  const policy = getEnvironmentNotificationsPolicy(user, { activityOnly });
  const adminActivity = useAdminRecentActivity({
    enabled: open && isAdmin,
    user,
  });
  const {
    drawerComments: environmentComments,
    readError: environmentCommentsError,
    loading: environmentCommentsLoading,
    refresh: refreshEnvironmentComments,
    submitComment: submitEnvironmentComment,
  } = useEnvironmentComments({
    enabled: open && policy.observationsAllowed,
    refreshIntervalMs: open ? 15000 : 0,
    user,
  });
  const mergedComments = useMemo(
    () => policy.observationsAllowed
      ? mergeDrawerComments(environmentComments, comments)
      : [],
    [comments, environmentComments, policy.observationsAllowed],
  );

  return (
    <NotificationsDrawer
      {...props}
      activityOnly={policy.activityOnly}
      open={open}
      recentActivity={isAdmin ? adminActivity.activity : recentActivity}
      recentActivityError={
        isAdmin ? adminActivity.error : recentActivityError
      }
      recentActivityLoading={
        isAdmin ? adminActivity.loading : recentActivityLoading
      }
      onRefreshActivity={
        isAdmin ? adminActivity.refresh : onRefreshActivity
      }
      comments={mergedComments}
      commentsError={
        policy.observationsAllowed
          ? environmentCommentsError || commentsError
          : ""
      }
      commentsLoading={
        policy.observationsAllowed
          ? environmentCommentsLoading || commentsLoading
          : false
      }
      onRefreshComments={
        policy.observationsAllowed
          ? () => Promise.all([
              refreshEnvironmentComments(),
              onRefreshComments?.(),
            ])
          : undefined
      }
      onSubmitComment={policy.observationsAllowed ? onSubmitComment : undefined}
      onSubmitEnvironmentComment={
        policy.observationsAllowed ? submitEnvironmentComment : undefined
      }
    />
  );
}

export default EnvironmentNotificationsDrawer;
