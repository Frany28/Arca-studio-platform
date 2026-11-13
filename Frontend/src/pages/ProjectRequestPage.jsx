import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import { getUserDisplay } from "../auth/userDisplay.js";
import Button from "../components/ui/Button/Button.jsx";
import ProjectRequestCancelModal from "../components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx";
import ProjectRequestValidationStep from "../components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx";
import useAddressSuggestions from "../hooks/useAddressSuggestions.js";
import { useInvalidFieldFocus } from "../hooks/useInvalidFieldFocus.js";
import ProjectRequestRequiredAlert from "./project-request/components/ProjectRequestRequiredAlert.jsx";
import ProjectRequestFormHeader from "./project-request/components/ProjectRequestFormHeader.jsx";
import ProjectRequestFormSections from "./project-request/components/ProjectRequestFormSections.jsx";
import ProjectRequestPageShell from "./project-request/components/ProjectRequestPageShell.jsx";
import useProjectRequestDraft from "./project-request/hooks/useProjectRequestDraft.js";
import useProjectRequestFiles from "./project-request/hooks/useProjectRequestFiles.js";
import useProjectRequestForm from "./project-request/hooks/useProjectRequestForm.js";
import useProjectRequestSubmission, { VERIFICATION_MODES } from "./project-request/hooks/useProjectRequestSubmission.js";
import useProjectRequestNavigation from "./project-request/hooks/useProjectRequestNavigation.js";
import useProjectRequestNotifications from "./project-request/hooks/useProjectRequestNotifications.js";
import { FormDivider } from "./project-request/components/ProjectRequestFormFields.jsx";
import { getClientProjectRequestPath } from "../utils/projectRequestRoutes.js";
import { PROJECT_REQUEST_FOOTER_CLASS_NAME } from "./project-request/utils/projectRequestLayout.js";


export default function ProjectRequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  // Solicitud con la que se inicia el formulario: un borrador, una solicitud devuelta para
  // corregirla o una rechazada cuyos datos se reutilizan en una solicitud nueva.
  const initialRequest = location.state?.initialRequest || null;
  // Un borrador o una solicitud devuelta se recuperan con sus adjuntos guardados en el backend.
  const recoveryRequestId = ["draft", "changes_requested"].includes(initialRequest?.status) ? initialRequest.id : null;
  const [showRequiredAlert, setShowRequiredAlert] = useState(false);
  const notifications = useProjectRequestNotifications({
    navigate,
    user,
  });
  const resetRequestFlow = () => {
    resetFormState();
    clearLocationSuggestions();
    resetFiles();
    resetSubmission();
  };
  const {
    cancelRequestAction,
    confirmRequestAction,
    isRequestActionModalOpen,
    isSidebarExpanded,
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
    setNotificationsOpen: notifications.setOpen,
    setShowRequiredAlert,
  });
  const formState = useProjectRequestForm({
    initialRequest,
    setShowRequiredAlert,
  });
  const {
    applyLocationSuggestion,
    currentFieldErrors,
    form,
    hasAttemptedSubmit,
    resetFormState,
    validateForSubmit,
  } = formState;
  const formRef = useRef(null);
  const focusInvalidField = useInvalidFieldFocus({ getContainer: () => formRef.current });
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
  // Borrador único compartido por los adjuntos (subida automática) y el envío.
  const draft = useProjectRequestDraft({ form, initialRequest });
  const {
    closeValidation,
    codeStatus,
    isSubmitting,
    isValidationModalOpen,
    openValidation,
    resendCode,
    resetSubmission,
    setValidationCode,
    submitError,
    submitValidation,
    validationCode,
    verificationMode,
  } = useProjectRequestSubmission({
    draft,
    // La solicitud enviada se consulta en su ruta persistente: el estado se lee del backend por
    // id, así que sigue disponible al recargar, volver del dashboard o iniciar sesión de nuevo.
    onSubmitted: (projectRequest) => {
      navigate(getClientProjectRequestPath(projectRequest.id), { replace: true });
    },
  });
  const {
    allowRemoteRemoval,
    attachmentsError,
    attachmentsLoading,
    fileErrors,
    files,
    getSubmitFileErrors,
    getTransferBlockReason,
    handleFilesChange,
    reloadAttachments,
    removeFile,
    resetFiles,
    retryFile,
    setFileErrors,
  } = useProjectRequestFiles({
    currentFieldErrors,
    draft,
    hasAttemptedSubmit,
    recoveryRequestId,
    setShowRequiredAlert,
  });
  const selectLocationSuggestion = (suggestion) => {
    applyLocationSuggestion(suggestion, fileErrors);
    clearLocationSuggestions();
  };
  const handleFrontendSubmit = () => {
    const nextFileErrors = getSubmitFileErrors();
    setFileErrors(nextFileErrors);

    if (validateForSubmit(nextFileErrors)) {
      focusInvalidField();
      return;
    }

    openValidation();
  };
  // Los adjuntos ya se subieron al seleccionarlos: el envío solo se bloquea si alguno sigue sin guardar.
  const handleValidationSubmit = (code) => {
    submitValidation(code, { blockedReason: getTransferBlockReason() });
  };

  return (
    <ProjectRequestPageShell
      currentUser={currentUser}
      isSidebarExpanded={isSidebarExpanded}
      notifications={notifications}
      onItemSelect={requestNavigation}
      onLogoutClick={requestLogout}
      onNewOpportunityClick={() => navigate("/solicitudes/nueva")}
      onSidebarExpandedChange={setIsSidebarExpanded}
      overlays={(
        <>
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
            codeStatus={codeStatus}
            onCodeChange={setValidationCode}
            onResendCode={resendCode}
            isSubmitting={isSubmitting}
            submitError={submitError}
            testMode={verificationMode === VERIFICATION_MODES.test}
            onClose={closeValidation}
            onPrevious={closeValidation}
            onNext={handleValidationSubmit}
          />

          <ProjectRequestRequiredAlert visible={showRequiredAlert} onDismiss={() => setShowRequiredAlert(false)} />
        </>
      )}
    >
            <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
            <ProjectRequestFormHeader
              title="Solicitud de proyecto"
              subtitle="Cada proyecto merece ser el correcto."
              aside={<>Tiempo estimado<br />3–5 minutos</>}
            />

            <FormDivider />

            <form ref={formRef} noValidate className="flex w-full flex-col items-center gap-[48px]" onSubmit={(event) => { event.preventDefault(); handleFrontendSubmit(); }}>
              <ProjectRequestFormSections
                attachments={{
                  allowRemoteRemoval,
                  disabled: isSubmitting,
                  files,
                  loadingPersisted: attachmentsLoading,
                  onFilesSelected: handleFilesChange,
                  onRemove: removeFile,
                  onRetry: retryFile,
                  onRetryPersisted: reloadAttachments,
                  persistedError: attachmentsError,
                }}
                fileErrors={fileErrors}
                formState={formState}
                locationSearch={{
                  error: locationSuggestionsError,
                  hasSearched: hasSearchedLocation,
                  isSearching: isLocationSearching,
                  onSelect: selectLocationSuggestion,
                  suggestions: locationSuggestions,
                }}
              />

              <FormDivider />

              <div className="w-full max-w-[850px]">
                <p className="text-[16px] leading-[19px] tracking-[-0.5px] text-[var(--color-text-100)]">Al enviar este formulario, nuestro equipo revisará la información y se pondrá en contacto contigo en un plazo aproximado de 24–48 horas.</p>
              </div>
              <footer className={PROJECT_REQUEST_FOOTER_CLASS_NAME}>
                <Button theme="Primary" type="Outline" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto" onClick={requestReset}>Limpiar formulario</Button>
                <Button disabled={isSubmitting} theme="Primary" type="Solid" htmlType="submit" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto">{isSubmitting ? "Enviando" : "Enviar"}</Button>
              </footer>
            </form>
            </div>
    </ProjectRequestPageShell>
  );
}
