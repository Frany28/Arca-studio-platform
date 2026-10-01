import { ProjectRequestForm } from "./project-request/components/ProjectRequestForm.jsx";
import { useProjectRequestForm } from "./project-request/hooks/useProjectRequestForm.js";
import { FormDivider } from "./project-request/components/ProjectRequestSection.jsx";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { useRecentProjects } from "../auth/RecentProjectsContext.jsx";
import { getUserDisplay } from "../auth/userDisplay.js";
import Alert from "../components/ui/Alert/Alert.jsx";
import { useImageCommentNotifications } from "../components/ui/Gallery/useImageComments.js";
import NavigationBar from "../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../components/EnvironmentNotificationsDrawer.jsx";
import ProjectRequestCancelModal from "../components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx";
import ProjectRequestValidationStep from "../components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx";
import SideNavigation from "../components/ui/SideNavigation/SideNavigation.jsx";
import SideOverlayDrawer from "../components/ui/SideOverlayDrawer.jsx";
import { useRecentProjectComments } from "../hooks/useProjectComments.js";
import { getProjectNamesById } from "../utils/commentDisplay.js";
import { getProjectPath } from "../utils/projectRoutes.js";
import { getCommentNavigationParams } from "../utils/commentSelection.js";
import ProjectRequestReceivedView from "./project-request/components/ProjectRequestReceivedView.jsx";
import {
  createUserSideNavigationItems,
  getDashboardPath,
} from "../utils/sideNavigationItems.js";

export default function ProjectRequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const viewRequest = location.state?.viewRequest || null;
  const initialRequest = location.state?.initialRequest || viewRequest;

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);

  const {
    form,
    setForm,
    files,
    fieldErrors,
    fileErrors,
    hasAttemptedSubmit,
    showRequiredAlert,
    setShowRequiredAlert,
    isValidationModalOpen,
    setIsValidationModalOpen,
    validationCode,
    setValidationCode,
    isRequestReceived,
    setIsRequestReceived,
    receivedRequest,
    isSubmitting,
    submitError,
    isLocationInputFocused,
    setIsLocationInputFocused,
    fileInputRef,
    formRef,
    locationSuggestionsError,
    hasSearchedLocation,
    isLocationSearching,
    locationSuggestions,
    update,
    updateLegalDocumentationStatus,
    updateLocation,
    selectLocationSuggestion,
    resetForm,
    handleFilesChange,
    handleFrontendSubmit,
    handleValidationSubmit,
  } = useProjectRequestForm({ viewRequest, initialRequest, setIsSidebarExpanded });
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] = useState(false);
  const [pendingRequestAction, setPendingRequestAction] = useState(null);
  const [isRequestActionModalOpen, setIsRequestActionModalOpen] = useState(false);

  const navigationItems = useMemo(
    () => createUserSideNavigationItems([], currentUser.roleCode),
    [currentUser.roleCode],
  );
  const { projects: recentProjects } = useRecentProjects();
  const notificationProjectIds = useMemo(
    () => recentProjects.map((project) => project.id),
    [recentProjects],
  );
  const projectNamesById = useMemo(
    () => getProjectNamesById(recentProjects),
    [recentProjects],
  );
  const imageCommentNotifications = useImageCommentNotifications({
    projectIds: notificationProjectIds,
    projectNamesById,
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
  });
  const {
    drawerComments: recentProjectComments,
    error: recentProjectCommentsError,
    loading: recentProjectCommentsLoading,
    refresh: refreshRecentComments,
  } = useRecentProjectComments({
    enabled: notificationProjectIds.length > 0,
    projectIds: notificationProjectIds,
    projectNamesById,
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
    user,
  });
  const notificationComments = useMemo(() => {
    const commentsById = new Map();

    [...recentProjectComments, ...imageCommentNotifications].forEach((comment) => {
      if (comment?.id !== undefined && comment?.id !== null) {
        commentsById.set(String(comment.id), comment);
      }
    });

    return Array.from(commentsById.values());
  }, [imageCommentNotifications, recentProjectComments]);

  useEffect(() => {
    if (isNotificationsDrawerOpen) {
      refreshRecentComments?.();
    }
  }, [isNotificationsDrawerOpen, refreshRecentComments]);

  const performSideNavigation = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item.id === "dashboard") navigate(getDashboardPath(currentUser.roleCode));
    if (item.id === "requests") navigate("/solicitudes");
    if (item.id === "more-projects") navigate("/proyectos");
    if (item.id === "settings") navigate("/configuraciones");
  };
  const handleNavigation = (item) => {
    if (!item) {
      return;
    }

    setShowRequiredAlert(false);
    setIsNotificationsDrawerOpen(false);
    setIsMobileNavigationOpen(false);
    setPendingRequestAction({ type: "navigate", item });
    setIsRequestActionModalOpen(true);
  };
  const requestLogout = () => {
    setShowRequiredAlert(false);
    setIsNotificationsDrawerOpen(false);
    setIsMobileNavigationOpen(false);
    setPendingRequestAction({ type: "logout" });
    setIsRequestActionModalOpen(true);
  };
  const cancelRequestAction = () => {
    setIsRequestActionModalOpen(false);
  };
  const confirmRequestAction = () => {
    const action = pendingRequestAction;
    setIsRequestActionModalOpen(false);

    if (action?.type === "clear") {
      resetForm();
      return;
    }

    if (action?.type === "logout") {
      logout();
      navigate("/");
      return;
    }

    if (action?.type === "navigate") {
      performSideNavigation(action.item);
    }
  };
  const openImageComment = (comment) => {
    const targetProjectId = comment?.projectId;

    if (!targetProjectId) {
      return;
    }

    const params = getCommentNavigationParams(comment);

    const targetProject = recentProjects.find(
      (project) => String(project.id) === String(targetProjectId),
    );

    setIsNotificationsDrawerOpen(false);
    navigate(
      targetProject
        ? getProjectPath(targetProject, params.toString())
        : `/proyectos/${targetProjectId}?${params.toString()}`,
    );
  };

  const requestFormReset = () => {
    setShowRequiredAlert(false);
    setPendingRequestAction({ type: "clear" });
    setIsRequestActionModalOpen(true);
  };

  const sidebar = (
    <SideNavigation
      activeItemId="requests"
      expanded={isSidebarExpanded}
      items={navigationItems}
      userName={currentUser.name}
      userEmail={currentUser.email}
      userAvatarSrc={currentUser.profilePhotoUrl}
      onExpandedChange={setIsSidebarExpanded}
      onItemSelect={handleNavigation}
      onNewOpportunityClick={() => navigate("/solicitudes/nueva")}
      onLogoutClick={requestLogout}
    />
  );

  return (
    <main className="min-h-screen bg-[var(--color-neutral-bg)]">
      <div className="flex min-h-screen items-stretch">
        <div
          className={clsx(
            "hidden shrink-0 min-[768px]:block",
            isSidebarExpanded &&
              "min-[768px]:[&>aside]:!w-[234px] min-[1024px]:[&>aside]:!w-[312px]",
          )}
        >
          {sidebar}
        </div>
        <div className="min-w-0 flex-1">
          <NavigationBar
            onMenuClick={() => setIsMobileNavigationOpen(true)}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={() => setIsNotificationsDrawerOpen((current) => !current)}
          />

          {isRequestReceived ? (
            <ProjectRequestReceivedView
              compatibility={receivedRequest?.compatibility}
              projectRequest={receivedRequest}
              onViewRequest={() => {
                setIsRequestReceived(false);
                setIsSidebarExpanded(true);
              }}
              onBackToDashboard={() => navigate(getDashboardPath(currentUser.roleCode))}
            />
          ) : (
            <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
            <header className="flex w-full max-w-[850px] flex-wrap items-end justify-between gap-x-[24px] gap-y-[16px]">
              <div className="min-w-0">
                <h1 className="text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">Solicitud de proyecto</h1>
                <p className="mt-[4px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">Cada proyecto merece ser el correcto.</p>
              </div>
              <p className="hidden shrink-0 text-right text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)] min-[480px]:block">Tiempo estimado<br />3–5 minutos</p>
            </header>

            <FormDivider />

            <ProjectRequestForm
              form={form}
              setForm={setForm}
              files={files}
              fieldErrors={fieldErrors}
              fileErrors={fileErrors}
              hasAttemptedSubmit={hasAttemptedSubmit}
              isSubmitting={isSubmitting}
              isLocationInputFocused={isLocationInputFocused}
              setIsLocationInputFocused={setIsLocationInputFocused}
              fileInputRef={fileInputRef}
              formRef={formRef}
              locationSuggestionsError={locationSuggestionsError}
              hasSearchedLocation={hasSearchedLocation}
              isLocationSearching={isLocationSearching}
              locationSuggestions={locationSuggestions}
              update={update}
              updateLegalDocumentationStatus={updateLegalDocumentationStatus}
              updateLocation={updateLocation}
              selectLocationSuggestion={selectLocationSuggestion}
              handleFilesChange={handleFilesChange}
              handleFrontendSubmit={handleFrontendSubmit}
              requestFormReset={requestFormReset}
            />
            </div>
          )}

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={notificationComments}
            commentsError={recentProjectCommentsError}
            commentsLoading={recentProjectCommentsLoading}
            recentActivity={[]}
            recentActivityLoading={false}
            onCommentSelect={openImageComment}
          />
        </div>
      </div>

      <SideOverlayDrawer open={isMobileNavigationOpen} onClose={() => setIsMobileNavigationOpen(false)} side="left" widthClassName="w-[min(312px,calc(100vw-32px))]" className="z-[80] min-[768px]:hidden" panelClassName="rounded-none">
        <SideNavigation {...sidebar.props} expanded onItemSelect={(item) => { setIsMobileNavigationOpen(false); handleNavigation(item); }} />
      </SideOverlayDrawer>

      <ProjectRequestCancelModal
        open={isRequestActionModalOpen}
        onCancel={cancelRequestAction}
        onConfirm={confirmRequestAction}
        title={pendingRequestAction?.type === "clear" ? "¿Deseas limpiar el formulario?" : undefined}
        description={pendingRequestAction?.type === "clear" ? "Esta acción eliminará toda la información ingresada en el formulario." : undefined}
        primaryActionLabel={pendingRequestAction?.type === "clear" ? "Limpiar" : undefined}
        ariaLabel={pendingRequestAction?.type === "clear" ? "Confirmar limpieza del formulario" : undefined}
      />

      <ProjectRequestValidationStep
        open={isValidationModalOpen}
        code={validationCode}
        onCodeChange={setValidationCode}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onClose={() => { if (!isSubmitting) setIsValidationModalOpen(false); }}
        onPrevious={() => { if (!isSubmitting) setIsValidationModalOpen(false); }}
        onNext={handleValidationSubmit}
      />

      <div className="pointer-events-none fixed bottom-0 right-0 z-[90] flex w-full max-w-[722.615px] p-[16px] min-[480px]:p-[24px]">
        <Alert
          id="project-request-required-alert"
          visible={showRequiredAlert}
          theme="Danger"
          layout="Box"
          title="Por favor, proporcione la información necesaria."
          description="Revisa los campos señalados y los archivos seleccionados antes de continuar."
          showActions={false}
          showCloseButton
          onDismiss={() => setShowRequiredAlert(false)}
          aria-label="Campos obligatorios incompletos"
          className="pointer-events-auto"
        />
      </div>
    </main>
  );
}
