import { useEffect, useMemo, useRef } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import { useAdminRecentActivity } from "../hooks/useAdminRecentActivity.js";
import { useUserNotifications } from "../hooks/useUserNotifications.js";
import { getProjectPath } from "../utils/projectRoutes.js";
import { useEnvironmentComments } from "../hooks/useProjectComments.js";
import {
  getEnvironmentNotificationsPolicy,
  isAdministrator,
} from "../utils/observationAccess.js";
import NotificationsDrawer from "./ui/NotificationsDrawer.jsx";

/**
 * Expone `navigate` solo cuando el drawer está dentro de un Router (las páginas); fuera de él (p. ej.
 * fixtures aislados) no se monta y seleccionar una notificación solo la marca como leída.
 *
 * @param {{ navigateRef: { current: Function|null } }} props - Referencia que recibe `navigate`.
 * @returns {null} No pinta nada.
 */
function RouterNavigateBridge({ navigateRef }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigateRef.current = navigate;
    return () => {
      navigateRef.current = null;
    };
  }, [navigate, navigateRef]);
  return null;
}

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
  ...props
}) {
  const { user } = useAuth();
  const isAdmin = isAdministrator(user);
  const policy = getEnvironmentNotificationsPolicy(user, { activityOnly });
  const adminActivity = useAdminRecentActivity({
    enabled: open && isAdmin,
    user,
  });
  // Clientes y arquitectos: «Actividad Reciente» son sus notificaciones reales (/notifications), no
  // datos de ejemplo. Seleccionar una la marca como leída y, si el usuario aún puede abrir su
  // proyecto, lleva a él. El administrador conserva la actividad de auditoría.
  const inRouter = useInRouterContext();
  const navigateRef = useRef(null);
  const userNotifications = useUserNotifications({ enabled: open && !isAdmin && Boolean(user) });
  const handleNotificationSelect = (item) => {
    const notification = item?.notification;
    if (!notification) return;
    userNotifications.markRead(notification);
    if (notification.project) navigateRef.current?.(getProjectPath(notification.project));
  };
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
    <>
    {inRouter ? <RouterNavigateBridge navigateRef={navigateRef} /> : null}
    <NotificationsDrawer
      {...props}
      activityOnly={policy.activityOnly}
      open={open}
      recentActivity={isAdmin ? adminActivity.activity : userNotifications.items}
      recentActivityError={
        isAdmin ? adminActivity.error : userNotifications.error
      }
      recentActivityLoading={
        isAdmin ? adminActivity.loading : userNotifications.loading
      }
      onRefreshActivity={
        isAdmin ? adminActivity.refresh : userNotifications.refresh
      }
      onActivitySelect={isAdmin ? props.onActivitySelect : handleNotificationSelect}
      activityHasMore={!isAdmin && userNotifications.hasMore}
      activityLoadingMore={!isAdmin && userNotifications.loadingMore}
      onLoadMoreActivity={isAdmin ? undefined : userNotifications.loadMore}
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
    </>
  );
}

export default EnvironmentNotificationsDrawer;
