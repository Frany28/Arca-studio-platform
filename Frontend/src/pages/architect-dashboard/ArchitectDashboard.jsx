import { useEffect, useMemo, useState } from "react";

import { api } from "../../api/http.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import { useImageCommentNotifications } from "../../components/ui/Gallery/useImageComments.js";
import {
  useProjectComments,
  useRecentProjectComments,
} from "../../hooks/useProjectComments.js";
import { getProjectNamesById } from "../../utils/commentDisplay.js";
import { getProjectPath } from "../../utils/projectRoutes.js";
import { getCommentNavigationParams } from "../../utils/commentSelection.js";
import { ARCHITECT_DRAWER_RECENT_ACTIVITY } from "./architectDashboardData.js";
import ArchitectProjectGroup from "./components/ArchitectProjectGroup.jsx";
import ProjectRequestReviewQueue from "./components/ProjectRequestReviewQueue.jsx";
import ProjectRequestWorkflowModal from "./components/ProjectRequestWorkflowModal.jsx";
import { useDashboardProjects } from "./hooks/useDashboardProjects.js";

import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import { useProjectRequestWorkflow } from "../../hooks/useProjectRequestWorkflow.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import { submitArchitectRequestReview } from "./utils/architectRequestReview.js";

/**
 * Combina las observaciones del drawer conservando una entrada por ID estable.
 * Mantiene el orden actual y descarta elementos sin identificador usable.
 * @param {Array} comments - Observaciones generales y de recursos de proyecto.
 * @returns {Array} Observaciones deduplicadas para el drawer.
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

/**
 * Compone revisión técnica, proyectos, publicación y observaciones del arquitecto.
 * Mantiene los lectores y callbacks existentes y utiliza únicamente el workflow de revisión.
 *
 * @param {Object} props - Opciones del escenario de dashboard.
 * @param {boolean} [props.empty=false] - Conserva los estados vacíos sin cargar datos.
 * @returns {import("react").ReactElement} Dashboard del arquitecto dentro del layout compartido.
 */
function ArchitectDashboard({ empty = false }) {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [projectsRequestKey] = useState(0);
  const {
    projectsError,
    projectsLoading,
    projectRows,
    projectGroups,
    setProjects,
  } = useDashboardProjects({ empty, user, projectsRequestKey });
  const navigation = useDashboardNavigation({ projectRows, roleCode: currentUser.roleCode });
  const { navigate, isNotificationsDrawerOpen, setIsNotificationsDrawerOpen, handleActivitySelect } = navigation;
  const { reviewQueue, workflow } = useProjectRequestWorkflow({
    enabled: currentUser.roleCode === "architect" && !empty,
    empty,
    scopeKey: currentUser.roleCode,
    submitOperation: submitArchitectRequestReview,
  });
  const canManagePublication =
    user?.permissionCodes?.includes("projects.publish");

  const commentProjectRows = useMemo(
    () =>
      projectRows.filter((project) => project.editable),
    [projectRows],
  );
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

  const handleNotificationsToggle = () => {
    const willOpen = !isNotificationsDrawerOpen;
    setIsNotificationsDrawerOpen(willOpen);
  };

  /**
   * Cierra el drawer y navega al proyecto y referencia de la observación elegida.
   * Conserva el fallback al primer proyecto accesible y las rutas actuales.
   * @param {Object} comment - Observación con proyecto y selección opcional.
   * @returns {void} Programa cierre y navegación cuando existe proyecto.
   */
  const openImageComment = (comment) => {
    const params = getCommentNavigationParams(comment);

    setIsNotificationsDrawerOpen(false);
    const targetProjectId = comment?.projectId || commentProjectRows[0]?.id;

    if (targetProjectId) {
      const targetProject = projectRows.find(
        (project) => project.id === Number(targetProjectId),
      );

      navigate(
        targetProject
          ? getProjectPath(targetProject, params.toString())
          : `/proyectos/${targetProjectId}?${params.toString()}`,
      );
    }
  };

  /**
   * Alterna la publicación del proyecto salvo que esté archivado.
   * Reemplaza la fila con la respuesta confirmada y conserva la propagación de errores.
   * @param {Object} project - Proyecto cuyo estado de publicación se modifica.
   * @returns {Promise<void>} Completa el guardado y la reconciliación local.
   * @throws {Error} Propaga fallos al control de publicación existente.
   */
  const handlePublicationChange = async (project) => {
    if (project.status === "archived") return;
    const nextIsPublic = !project.isPublic;
    const data = await api.projects.updatePublication({
      isPublic: nextIsPublic,
      projectId: project.id,
    });

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) =>
        currentProject.id === project.id ? data.project : currentProject,
      ),
    );
  };

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      onNotificationsToggle={handleNotificationsToggle}
    >
      <ProjectRequestReviewQueue
        error={reviewQueue.error}
        loading={reviewQueue.loading}
        requests={reviewQueue.requests}
        onOpen={workflow.open}
        onRetry={reviewQueue.retry}
      />
      {projectsLoading ? (
        <div className="mx-auto flex min-h-[360px] w-full max-w-[1200px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
          <Loader
            preset="projectRow"
            count={3}
            label="Cargando proyectos"
          />
        </div>
      ) : projectsError ? (
        <div className="mx-auto flex w-full max-w-[1200px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
          <p className="text-body-3 text-[var(--color-danger-100)]">
            {projectsError}
          </p>
        </div>
      ) : (empty || !projectRows.length) ? (
        <div className="mx-auto flex w-full max-w-[1200px] flex-1 items-center justify-center px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
          <EmptyState
            title="Tu espacio de proyectos está listo"
            description="Aquí podrás visualizar y dar seguimiento a tus proyectos."
            secondaryActionLabel="Añadir"
            primaryActionLabel="Actualizar"
            size="S"
            showFeaturedIcon
            showActions
            showSecondaryAction
            className="max-w-[360px]"
          />
        </div>
      ) : (
        <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col gap-[48px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
          {projectGroups.map((group) => (
            <ArchitectProjectGroup
              key={group.id}
              canManagePublication={canManagePublication}
              group={group}
              onPublicationChange={handlePublicationChange}
            />
          ))}
        </div>
      )}

      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        comments={notificationComments}
        commentsError={drawerCommentsError}
        commentsLoading={drawerCommentsLoading}
        recentActivity={ARCHITECT_DRAWER_RECENT_ACTIVITY}
        onActivitySelect={handleActivitySelect}
        onCommentSelect={openImageComment}
        onSubmitComment={commentsProjectId ? submitComment : undefined}
      />
      <ProjectRequestWorkflowModal
        key={workflow.selectedRequest?.id || "closed-request-workflow"}
        error={workflow.error}
        mode="review"
        open={Boolean(workflow.selectedRequest)}
        projectRequest={workflow.selectedRequest}
        submitting={workflow.submitting}
        onClose={workflow.close}
        onSubmit={workflow.submit}
      />
    </InternalDashboardLayout>
  );
}

export default ArchitectDashboard;
