import { useMemo, useRef, useState } from "react";
import { Edit2, Link21, Location } from "iconsax-react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";

import { useAuth } from "../auth/AuthContext.jsx";
import { getUserDisplay } from "../auth/userDisplay.js";
import Alert from "../components/ui/Alert/Alert.jsx";
import Button from "../components/ui/Button/Button.jsx";
import HintText from "../components/ui/HintText/HintText.jsx";
import NavigationBar from "../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../components/EnvironmentNotificationsDrawer.jsx";
import ProjectRequestCancelModal from "../components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx";
import ProjectLocationSuggestions from "../components/ui/ProjectRequestFlow/ProjectLocationSuggestions.jsx";
import ProjectRequestValidationStep from "../components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx";
import ResponsiveSideNavigation from "../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";
import useAddressSuggestions from "../hooks/useAddressSuggestions.js";
import { getProjectRequestFileErrors } from "../utils/projectRequestValidation.js";
import { hasApplicableProperty, requiresPropertyAvailability } from "../utils/projectRequestApplicability.js";
import { LEGACY_PROJECT_REQUEST_TYPES, PROJECT_REQUEST_OPTIONS } from "../utils/projectRequestOptions.js";
import { getProjectTypeLabel } from "../utils/projectTypeDisplay.js";
import ProjectRequestAttachmentsField from "./project-request/components/ProjectRequestAttachmentsField.jsx";
import ProjectRequestStandSection from "./project-request/components/ProjectRequestStandSection.jsx";
import ProjectRequestReceivedView from "./project-request/components/ProjectRequestReceivedView.jsx";
import useProjectRequestFiles from "./project-request/hooks/useProjectRequestFiles.js";
import useProjectRequestForm from "./project-request/hooks/useProjectRequestForm.js";
import useProjectRequestSubmission from "./project-request/hooks/useProjectRequestSubmission.js";
import useProjectRequestNavigation from "./project-request/hooks/useProjectRequestNavigation.js";
import useProjectRequestNotifications from "./project-request/hooks/useProjectRequestNotifications.js";
import {
  CheckboxField,
  ChoiceGroup,
  FormDivider,
  FormSection,
  LegalDocumentTypesField,
  SelectField,
  TextField,
} from "./project-request/components/ProjectRequestFormFields.jsx";
import {
  createUserSideNavigationItems,
  getDashboardPath,
} from "../utils/sideNavigationItems.js";


export default function ProjectRequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const mobileNavigation = useMobileNavigationDrawer();
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
  const resetRequestFlow = () => {
    resetFormState();
    clearLocationSuggestions();
    resetFiles();
    resetSubmission();
  };
  const {
    cancelRequestAction,
    collapseSidebar,
    confirmRequestAction,
    expandSidebar,
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
    updateLandStatus,
    updateLegalDocumentationStatus,
    updateLocation,
    validateForSubmit,
  } = useProjectRequestForm({
    initialRequest,
    setShowRequiredAlert,
  });
  // Estado derivado: en Stand publicitario el inmueble no aplica; en otros tipos la sección
  // legal depende de la respuesta sobre el terreno.
  const showLandStatusQuestion = requiresPropertyAvailability(form.projectType);
  const showPropertyLegalSection = hasApplicableProperty(form);
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
    files,
    handleFilesChange,
    removeFile,
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
  const selectLocationSuggestion = (suggestion) => {
    applyLocationSuggestion(suggestion, fileErrors);
    clearLocationSuggestions();
  };
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
  const handleValidationSubmit = (code) => {
    submitValidation(code, { files, updateFileItem });
  };
  // El drawer móvil se monta en portal: el contenedor oculto en móvil no lo afecta.
  const sidebar = (
    <ResponsiveSideNavigation
      mobileOpen={mobileNavigation.isOpen}
      onMobileClose={mobileNavigation.close}
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
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
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
            <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
            <header className="flex w-full max-w-[850px] flex-wrap items-end justify-between gap-x-[24px] gap-y-[16px]">
              <div className="min-w-0">
                <h1 className="text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">Solicitud de proyecto</h1>
                <p className="mt-[4px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">Cada proyecto merece ser el correcto.</p>
              </div>
              <p className="hidden shrink-0 text-right text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)] min-[480px]:block">Tiempo estimado<br />3–5 minutos</p>
            </header>

            <FormDivider />

            <form ref={formRef} noValidate className="flex w-full flex-col items-center gap-[48px]" onSubmit={(event) => { event.preventDefault(); handleFrontendSubmit(); }}>
              <FormSection title="Detalles del proyecto" description="Cuéntanos qué deseas desarrollar. Esta información nos ayudará a comprender el alcance, los objetivos y las características generales de tu proyecto antes de la primera reunión.">
                <TextField error={hasAttemptedSubmit ? fieldErrors.projectName : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectName)} label="Nombre del proyecto" icon={Edit2} placeholder='Ej. “Apto. Noventa y Uno”' value={form.projectName} onChange={update("projectName", fileErrors)} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.projectType : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectType)} label="Tipo de proyecto" value={form.projectType} onChange={update("projectType", fileErrors)} options={PROJECT_REQUEST_OPTIONS.projectType} selectedLabel={LEGACY_PROJECT_REQUEST_TYPES.includes(form.projectType) ? getProjectTypeLabel(form.projectType) : ""} />
                {LEGACY_PROJECT_REQUEST_TYPES.includes(form.projectType) ? <HintText hintText="Tipo histórico conservado. Puedes mantenerlo o elegir un tipo vigente." className="w-full" /> : null}
                <TextField
                  error={hasAttemptedSubmit ? fieldErrors.location : ""}
                  invalid={hasAttemptedSubmit && Boolean(fieldErrors.location)}
                  label="Ubicación del proyecto"
                  icon={Location}
                  placeholder='Ej. “Maracaibo, Estado Zulia.”'
                  value={form.location}
                  onFocus={() => setIsLocationInputFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsLocationInputFocused(false), 120);
                  }}
                  onChange={(event) => updateLocation(event, fileErrors)}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={
                    isLocationInputFocused && locationSuggestions.length > 0
                  }
                  containerClassName="relative z-20"
                  supportingContent={
                    isLocationSearching ? (
                      <HintText
                        state="Default"
                        hintText="Buscando direcciones..."
                        className="w-full"
                        role="status"
                      />
                    ) : locationSuggestionsError ? (
                      <HintText
                        state="Error"
                        hintText={locationSuggestionsError}
                        className="w-full"
                        role="alert"
                      />
                    ) : hasSearchedLocation && locationSuggestions.length === 0 ? (
                      <HintText
                        state="Default"
                        hintText="No encontramos coincidencias. Puedes escribir una dirección más específica o continuar con la dirección manual."
                        className="w-full"
                        role="status"
                      />
                    ) : null
                  }
                >
                  {isLocationInputFocused && locationSuggestions.length ? (
                    <ProjectLocationSuggestions
                      suggestions={locationSuggestions}
                      onSelect={selectLocationSuggestion}
                    />
                  ) : null}
                </TextField>
                <TextField error={hasAttemptedSubmit ? fieldErrors.description : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.description)} label="Descripción del proyecto" multiline minLength={30} maxLength={100} placeholder="Describe brevemente qué quieres lograr, dónde está el inmueble, y cualquier detalle relevante." value={form.description} onChange={update("description", fileErrors)} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.projectSize : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectSize)} label="Tamaño aproximado del proyecto" optional value={form.projectSize} onChange={update("projectSize", fileErrors)} options={PROJECT_REQUEST_OPTIONS.projectSize} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.developmentMode : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.developmentMode)} label="¿Cómo desea desarrollar el proyecto?" info value={form.developmentMode} onChange={update("developmentMode", fileErrors)} options={PROJECT_REQUEST_OPTIONS.developmentMode} />
                {showLandStatusQuestion ? (
                  <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.landStatus : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.landStatus)} label="¿Tiene terreno o inmueble disponible?" value={form.landStatus} onChange={(status) => updateLandStatus(status, fileErrors)} options={PROJECT_REQUEST_OPTIONS.landStatus} />
                ) : null}
              </FormSection>

              <ProjectRequestStandSection form={form} fieldErrors={fieldErrors} hasAttemptedSubmit={hasAttemptedSubmit} update={update} fileErrors={fileErrors} />

              {/* Solo aplica con inmueble aplicable y disponible: se desmonta (no se oculta con CSS)
              y useProjectRequestForm restablece sus valores al cambiar el tipo o la respuesta. */}
              {showPropertyLegalSection ? (
                <>
                  <FormDivider />

                  <FormSection title="Documentación legal del inmueble" description="Por favor, proporciona detalles sobre el estado legal de la propiedad que deseas intervenir. Esta información es crucial para evaluar la viabilidad del proyecto y asegurarnos de que se cumplan todos los requisitos legales antes de proceder.">
                    <SelectField error={hasAttemptedSubmit ? fieldErrors.legalDocumentationStatus : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.legalDocumentationStatus)} label="¿Cuenta con documentación que acredite la situación legal del inmueble?" value={form.legalDocumentationStatus} onChange={(status) => updateLegalDocumentationStatus(status, fileErrors)} options={PROJECT_REQUEST_OPTIONS.legalDocumentationStatus} />
                    <LegalDocumentTypesField error={hasAttemptedSubmit ? fieldErrors.legalDocumentTypes : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.legalDocumentTypes)} value={form.legalDocumentTypes} onChange={update("legalDocumentTypes", fileErrors)} disabled={form.legalDocumentationStatus !== "available"} />
                    <div className="flex w-full flex-col gap-[8px]">
                      <SelectField error={hasAttemptedSubmit ? fieldErrors.multipleOwners : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.multipleOwners)} label="¿El inmueble tiene más de un propietario?" value={form.multipleOwners} onChange={update("multipleOwners", fileErrors)} options={PROJECT_REQUEST_OPTIONS.multipleOwners} />
                      <HintText state="Default" hintText="La documentación podrá ser presentada posteriormente durante la reunión inicial." className="w-full" />
                    </div>
                    <div className="border-t border-[var(--color-neutral-200)] pt-[12px]">
                      <CheckboxField label="¿Dispone de planos del lugar?" value={form.hasBlueprints} onChange={update("hasBlueprints", fileErrors)} />
                    </div>
                  </FormSection>
                </>
              ) : null}

              <FormDivider />

              <FormSection title="Viabilidad financiera" description="Conocer el presupuesto y la disponibilidad del capital nos permite proponerte soluciones acordes.">
                <SelectField error={hasAttemptedSubmit ? fieldErrors.investmentRange : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.investmentRange)} label="Rango de inversión estimado" value={form.investmentRange} onChange={update("investmentRange", fileErrors)} options={PROJECT_REQUEST_OPTIONS.investmentRange} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.capitalAvailability : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.capitalAvailability)} label="Disponibilidad del capital" value={form.capitalAvailability} onChange={update("capitalAvailability", fileErrors)} options={PROJECT_REQUEST_OPTIONS.capitalAvailability} />
              </FormSection>

              <FormDivider />

              <FormSection title="Compatibilidad" description="Estas preguntas nos ayudan a conocer tus expectativas, tiempos y experiencia previa para ofrecerte un proceso de trabajo más personalizado y eficiente.">
                <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.startTime : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.startTime)} label="¿Cuándo espera iniciar el proyecto?" value={form.startTime} onChange={update("startTime", fileErrors)} options={PROJECT_REQUEST_OPTIONS.startTime} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.decisionMaker : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.decisionMaker)} label="¿Quién toma la decisión final del proyecto?" optional value={form.decisionMaker} onChange={update("decisionMaker", fileErrors)} options={PROJECT_REQUEST_OPTIONS.decisionMaker} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.quality : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.quality)} label="Expectativa de estilo / nivel de calidad" optional info value={form.quality} onChange={update("quality", fileErrors)} options={PROJECT_REQUEST_OPTIONS.quality} />
                <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.experience : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.experience)} label="¿Ha trabajado con un arquitecto o diseñador antes?" optional value={form.experience} onChange={update("experience", fileErrors)} options={PROJECT_REQUEST_OPTIONS.experience} />
              </FormSection>

              <FormDivider />

              <FormSection title="Referencias" description="Comparte imágenes, enlaces o cualquier material de referencia que represente tu visión del proyecto. Esto nos ayudará a comprender mejor el estilo, la atmósfera y los acabados que deseas lograr.">
                <ProjectRequestAttachmentsField
                  disabled={isSubmitting}
                  fileErrors={fileErrors}
                  files={files}
                  onFilesSelected={handleFilesChange}
                  onRemove={removeFile}
                />
                <TextField error={hasAttemptedSubmit ? fieldErrors.referenceLink : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.referenceLink)} label="Link de referencia (Pinterest, web, etc.)" optional icon={Link21} placeholder='Ej. “https://es.pinterest.com/pin”' value={form.referenceLink} onChange={update("referenceLink", fileErrors)} />
              </FormSection>

              <FormDivider />

              <div className="w-full max-w-[850px]">
                <p className="text-[16px] leading-[19px] tracking-[-0.5px] text-[var(--color-text-100)]">Al enviar este formulario, nuestro equipo revisará la información y se pondrá en contacto contigo en un plazo aproximado de 24–48 horas.</p>
              </div>
              <footer className="flex w-full max-w-[850px] flex-col-reverse gap-[8px] min-[480px]:flex-row min-[480px]:justify-end">
                <Button theme="Primary" type="Outline" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto" onClick={requestReset}>Limpiar formulario</Button>
                <Button disabled={isSubmitting} theme="Primary" type="Solid" htmlType="submit" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto">{isSubmitting ? "Enviando" : "Enviar"}</Button>
              </footer>
            </form>
            </div>
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
