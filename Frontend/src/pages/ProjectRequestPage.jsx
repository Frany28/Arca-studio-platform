import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";

import { useAuth } from "../auth/AuthContext.jsx";
import { getUserDisplay } from "../auth/userDisplay.js";
import Alert from "../components/ui/Alert/Alert.jsx";
import NavigationBar from "../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../components/EnvironmentNotificationsDrawer.jsx";
import ProjectRequestCancelModal from "../components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx";
import ProjectRequestValidationStep from "../components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx";
import SideNavigation from "../components/ui/SideNavigation/SideNavigation.jsx";
import SideOverlayDrawer from "../components/ui/SideOverlayDrawer.jsx";
import useAddressSuggestions from "../hooks/useAddressSuggestions.js";
import { getProjectRequestFileErrors } from "../utils/projectRequestValidation.js";
import ProjectRequestFormView from "./project-request/components/ProjectRequestFormView.jsx";
import ProjectRequestReceivedView from "./project-request/components/ProjectRequestReceivedView.jsx";
import useProjectRequestFiles from "./project-request/hooks/useProjectRequestFiles.js";
import useProjectRequestForm from "./project-request/hooks/useProjectRequestForm.js";
import useProjectRequestSubmission from "./project-request/hooks/useProjectRequestSubmission.js";
import useProjectRequestNavigation from "./project-request/hooks/useProjectRequestNavigation.js";
import useProjectRequestNotifications from "./project-request/hooks/useProjectRequestNotifications.js";
import {
  createUserSideNavigationItems,
  getDashboardPath,
} from "../utils/sideNavigationItems.js";


/**
 * Coordina el flujo cliente de creación, corrección y consulta de solicitudes.
 * Mantiene en un único punto la navegación, validación, subida de archivos,
 * notificaciones y envío; la presentación extensa del formulario vive en
 * ProjectRequestFormView para evitar mezclar reglas de flujo con markup.
 *
 * @returns {import("react").ReactElement} Página autenticada de solicitud de proyecto.
 */
export default function ProjectRequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const viewRequest = location.state?.viewRequest || null;
  const initialRequest = location.state?.initialRequest || viewRequest;
  const [showRequiredAlert, setShowRequiredAlert] = useState(false);
  const {
    close: closeNotifications,
    comments: notificationComments,
    error: recentProjectCommentsError,
    isOpen: isNotificationsDrawerOpen,
    loading: recentProjectCommentsLoading,
    openComment: openImageComment,
    setOpen: setIsNotificationsDrawerOpen,
    toggle: toggleNotifications,
  } = useProjectRequestNotifications({
    navigate,
    user,
  });
  /**
   * Restablece todos los estados que pertenecen a una solicitud editable.
   * Se ejecuta únicamente después de la confirmación coordinada por navegación.
   *
   * @returns {void}
   */
  const resetRequestFlow = () => {
    resetFormState();
    clearLocationSuggestions();
    resetFiles();
    resetSubmission();
  };
  const {
    cancelRequestAction,
    closeMobileNavigation,
    collapseSidebar,
    confirmRequestAction,
    expandSidebar,
    handleMobileExpandedChange,
    isMobileNavigationOpen,
    isRequestActionModalOpen,
    isSidebarExpanded,
    openMobileNavigation,
    pendingRequestAction,
    requestLogout,
    requestNavigation,
    requestReset,
    setIsSidebarExpanded,
  } = useProjectRequestNavigation({
    logout,
    navigate,
    onReset: resetRequestFlow,
    roleCode: currentUser.roleCode,
    setNotificationsOpen: setIsNotificationsDrawerOpen,
    setShowRequiredAlert,
  });
  const {
    applyLocationSuggestion,
    currentFieldErrors,
    fieldErrors,
    form,
    hasAttemptedSubmit,
    isLocationInputFocused,
    resetFormState,
    setIsLocationInputFocused,
    update,
    updateLegalDocumentationStatus,
    updateLocation,
    validateForSubmit,
  } = useProjectRequestForm({
    initialRequest,
    setShowRequiredAlert,
  });
  const formRef = useRef(null);
  const {
    clear: clearLocationSuggestions,
    error: locationSuggestionsError,
    hasSearched: hasSearchedLocation,
    isSearching: isLocationSearching,
    suggestions: locationSuggestions,
  } = useAddressSuggestions({
    query: form.location,
    selected:
      form.locationLatitude !== null && form.locationLatitude !== undefined,
  });
  const {
    closeValidation,
    draftId,
    isRequestReceived,
    isSubmitting,
    isValidationModalOpen,
    openValidation,
    receivedRequest,
    resetSubmission,
    setValidationCode,
    showRequestForm,
    submitError,
    submitValidation,
    validationCode,
  } = useProjectRequestSubmission({
    form,
    initialRequest,
    onSubmitted: () => {
      collapseSidebar();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    viewRequest,
  });
  const {
    fileErrors,
    fileInputRef,
    files,
    handleFilesChange,
    resetFiles,
    setFileErrors,
    updateFileItem,
  } = useProjectRequestFiles({
    currentFieldErrors,
    draftId,
    hasAttemptedSubmit,
    setShowRequiredAlert,
  });
  const navigationItems = useMemo(
    () => createUserSideNavigationItems([], currentUser.roleCode),
    [currentUser.roleCode],
  );
  /**
   * Aplica una dirección seleccionada y cierra la lista de sugerencias.
   *
   * @param {Object} suggestion - Resultado de geocodificación elegido por el usuario.
   * @returns {void}
   */
  const selectLocationSuggestion = (suggestion) => {
    applyLocationSuggestion(suggestion, fileErrors);
    clearLocationSuggestions();
  };
  /**
   * Ejecuta la validación local antes de abrir el paso de verificación.
   * Si encuentra errores, desplaza y enfoca el primer control inválido sin enviar.
   *
   * @returns {void}
   */
  const handleFrontendSubmit = () => {
    const nextFileErrors = getProjectRequestFileErrors(files);
    setFileErrors(nextFileErrors);

    if (validateForSubmit(nextFileErrors)) {
      window.requestAnimationFrame(() => {
        const invalidField = formRef.current?.querySelector('[aria-invalid="true"]');
        const focusTarget = invalidField?.matches("input, textarea, button")
          ? invalidField
          : invalidField?.querySelector("input, textarea, button");

        invalidField?.scrollIntoView({ behavior: "smooth", block: "center" });
        focusTarget?.focus({ preventScroll: true });
      });

      return;
    }

    openValidation();
  };
  /**
   * Delega el código temporal y los archivos al flujo de envío resistente a reintentos.
   *
   * @param {string} code - Código temporal introducido en el paso de validación.
   * @returns {void}
   */
  const handleValidationSubmit = (code) => {
    submitValidation(code, { files, updateFileItem });
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
      onItemSelect={requestNavigation}
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
            onMenuClick={openMobileNavigation}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={toggleNotifications}
          />

          {isRequestReceived ? (
            <ProjectRequestReceivedView
              compatibility={receivedRequest?.compatibility}
              projectRequest={receivedRequest}
              onViewRequest={() => {
                showRequestForm();
                expandSidebar();
              }}
              onBackToDashboard={() => navigate(getDashboardPath(currentUser.roleCode))}
            />
          ) : (
            <ProjectRequestFormView
              fieldErrors={fieldErrors}
              fileErrors={fileErrors}
              fileInputRef={fileInputRef}
              files={files}
              form={form}
              formRef={formRef}
              handleFilesChange={handleFilesChange}
              handleFrontendSubmit={handleFrontendSubmit}
              hasAttemptedSubmit={hasAttemptedSubmit}
              hasSearchedLocation={hasSearchedLocation}
              isLocationInputFocused={isLocationInputFocused}
              isLocationSearching={isLocationSearching}
              isSubmitting={isSubmitting}
              locationSuggestions={locationSuggestions}
              locationSuggestionsError={locationSuggestionsError}
              requestReset={requestReset}
              selectLocationSuggestion={selectLocationSuggestion}
              setIsLocationInputFocused={setIsLocationInputFocused}
              update={update}
              updateLegalDocumentationStatus={updateLegalDocumentationStatus}
              updateLocation={updateLocation}
            />
          )}

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={closeNotifications}
            comments={notificationComments}
            commentsError={recentProjectCommentsError}
            commentsLoading={recentProjectCommentsLoading}
            recentActivity={[]}
            recentActivityLoading={false}
            onCommentSelect={openImageComment}
          />
        </div>
      </div>

      <SideOverlayDrawer open={isMobileNavigationOpen} onClose={closeMobileNavigation} side="left" widthClassName="w-[min(312px,calc(100vw-32px))]" className="z-[80] min-[768px]:hidden" panelClassName="rounded-none">
        <SideNavigation
          {...sidebar.props}
          expanded={isMobileNavigationOpen}
          onExpandedChange={handleMobileExpandedChange}
          onItemSelect={requestNavigation}
        />
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
        onClose={closeValidation}
        onPrevious={closeValidation}
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
