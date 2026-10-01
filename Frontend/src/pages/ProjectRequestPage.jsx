import Input from "../components/ui/Input/Input.jsx";
import TextArea from "../components/ui/TextArea/TextArea.jsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown2, CloudPlus, Edit2, InfoCircle, Link21, Location } from "iconsax-react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";

import { useAuth } from "../auth/AuthContext.jsx";
import { api } from "../api/http.js";
import { useRecentProjects } from "../auth/RecentProjectsContext.jsx";
import { getUserDisplay } from "../auth/userDisplay.js";
import Alert from "../components/ui/Alert/Alert.jsx";
import Button from "../components/ui/Button/Button.jsx";
import Checkbox from "../components/ui/Checkbox/Checkbox.jsx";
import DropdownMenu from "../components/ui/DropdownMenu/DropdownMenu.jsx";
import HintText from "../components/ui/HintText/HintText.jsx";
import { useImageCommentNotifications } from "../components/ui/Gallery/useImageComments.js";
import NavigationBar from "../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../components/EnvironmentNotificationsDrawer.jsx";
import ProjectRequestCancelModal from "../components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx";
import ProjectLocationSuggestions from "../components/ui/ProjectRequestFlow/ProjectLocationSuggestions.jsx";
import ProjectRequestValidationStep from "../components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx";
import SideNavigation from "../components/ui/SideNavigation/SideNavigation.jsx";
import SideOverlayDrawer from "../components/ui/SideOverlayDrawer.jsx";
import useAddressSuggestions from "../hooks/useAddressSuggestions.js";
import { useRecentProjectComments } from "../hooks/useProjectComments.js";
import { getProjectNamesById } from "../utils/commentDisplay.js";
import {
  buildProjectRequestPayload,
  getProjectRequestFieldErrors,
  getProjectRequestFileErrors,
} from "../utils/projectRequestValidation.js";
import { PROJECT_REQUEST_OPTIONS } from "../utils/projectRequestOptions.js";
import { getProjectPath } from "../utils/projectRoutes.js";
import { getCommentNavigationParams } from "../utils/commentSelection.js";
import ProjectRequestReceivedView from "./project-request/components/ProjectRequestReceivedView.jsx";
import {
  createUserSideNavigationItems,
  getDashboardPath,
} from "../utils/sideNavigationItems.js";

const INITIAL_FORM = {
  projectName: "",
  projectType: "",
  location: "",
  locationFormattedAddress: "",
  locationLatitude: null,
  locationLongitude: null,
  locationProviderPlaceId: null,
  description: "",
  projectSize: "",
  developmentMode: "",
  landStatus: "",
  legalDocumentationStatus: "",
  legalDocumentTypes: [],
  multipleOwners: "",
  investmentRange: "",
  capitalAvailability: "",
  startTime: "",
  decisionMaker: "",
  quality: "",
  experience: "",
  hasBlueprints: "Indeterminate",
  referenceLink: "",
};

function FieldLabel({ asSpan = false, children, optional = false, info = false, ...props }) {
  const content = (
    <>
      {children}{optional ? null : <span aria-hidden="true">*</span>}
      {info ? <InfoCircle size="18" color="currentColor" aria-hidden="true" /> : null}
    </>
  );
  const className = "flex items-center gap-[2px] text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)]";

  return asSpan
    ? <span {...props} className={className}>{content}</span>
    : <label {...props} className={className}>{content}</label>;
}

function TextField({ children, containerClassName, error = "", icon: Icon, inputRef, invalid = false, label, multiline = false, optional = false, supportingContent, ...props }) {
  const controlClass = `w-full rounded-[8px] border bg-[var(--color-neutral-100)] px-[12px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)] outline-none transition focus:ring-2 placeholder:text-[var(--color-text-100)] ${invalid ? "border-[var(--color-danger-100)] focus:border-[var(--color-danger-100)] focus:ring-[var(--color-danger-10)]" : "border-[var(--color-neutral-200)] focus:border-[var(--color-primary-300)] focus:ring-[var(--color-primary-10)]"}`;

  return (
    <div className={clsx("flex w-full flex-col gap-[8px]", containerClassName)}>
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <div className="relative flex w-full">
        {Icon ? <Icon className="absolute left-[12px] top-[8px] size-[20px] text-[var(--color-text-100)]" aria-hidden="true" /> : null}
        {multiline ? (
          <TextArea presentation="control" inputRef={inputRef} className={`${controlClass} block min-h-[130px] resize-y py-[12px] ${Icon ? "pl-[40px]" : ""}`} required={!optional} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} {...props} />
        ) : (
          <Input presentation="control" inputRef={inputRef} className={`${controlClass} block h-[36px] ${Icon ? "pl-[40px]" : ""}`} required={!optional} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} {...props} />
        )}
        {children}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
      {supportingContent}
    </div>
  );
}

function SelectField({ error = "", invalid = false, label, value, onChange, options, optional = false, info = false, placeholder = "Selecciona una opción" }) {
  const [isOpen, setIsOpen] = useState(false);
  const items = options.map((option) => ({
    id: option.value,
    label: option.label,
    supportingText: "",
    type: "Text",
  }));

  return (
    <div className="flex w-full flex-col gap-[8px]">
      <FieldLabel optional={optional} info={info}>{label}</FieldLabel>
      <DropdownMenu
        type="Text"
        label={options.find((option) => option.value === value)?.label || placeholder}
        supportingText=""
        items={items}
        selectedItemId={value}
        open={isOpen}
        onOpenChange={setIsOpen}
        onItemSelect={(item) => {
          onChange(item.id);
          setIsOpen(false);
        }}
        interactive
        triggerHeightClassName="h-[37px]"
        triggerWrapperClassName={invalid ? "!border-[var(--color-danger-100)]" : undefined}
        className="w-full max-w-none"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-errormessage={invalid ? "project-request-required-alert" : undefined}
        aria-required={!optional}
      />
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}

function ChoiceGroup({ error = "", invalid = false, label, value, options, onChange, info = false, optional = false, orientation = "horizontal" }) {
  const labelId = useId();

  return (
    <div role="group" aria-labelledby={labelId} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} aria-required={!optional} className="flex w-full flex-col gap-[8px]">
      <FieldLabel asSpan id={labelId} info={info} optional={optional}>{label}</FieldLabel>
      <div className={orientation === "vertical" ? "flex flex-col items-start gap-[8px]" : "flex flex-wrap gap-[8px]"}>
        {options.map((option) => (
          <Button layout="content"
            key={option.value}
            htmlType="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`${orientation === "vertical" && value === option.value ? "h-[33px] py-[7px]" : "h-[36px] py-[8px]"} rounded-[8px] border px-[12px] text-[14px] font-medium leading-[17px] tracking-[-0.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] ${value === option.value ? "border-transparent bg-[var(--color-neutral-200)] text-[var(--color-text-300)]" : invalid ? "border-[var(--color-danger-100)] bg-transparent text-[var(--color-text-100)]" : "border-[var(--color-neutral-200)] bg-transparent text-[var(--color-text-100)] hover:border-[var(--color-neutral-300)] hover:text-[var(--color-text-300)]"}`}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}

function CheckboxField({ label, value, onChange }) {
  return (
    <div className="flex h-[41px] w-full items-center justify-between gap-[16px]">
      <FieldLabel optional>{label}</FieldLabel>
      <Checkbox
        checked={value}
        size="S"
        interactive
        aria-label={label}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function LegalDocumentTypesField({ error = "", invalid = false, value, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredDocumentType, setHoveredDocumentType] = useState(null);
  const selectedValues = Array.isArray(value) ? value : [];
  const selectedLabels = PROJECT_REQUEST_OPTIONS.legalDocumentTypes
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);

  const toggleDocument = (documentType) => {
    const nextValues = selectedValues.includes(documentType)
      ? selectedValues.filter((valueToKeep) => valueToKeep !== documentType)
      : [...selectedValues, documentType];
    onChange(nextValues);
  };

  return (
    <div className="flex w-full flex-col gap-[8px]">
      <FieldLabel>Documentación disponible</FieldLabel>
      <div className="relative w-full">
        <Button layout="content"
          htmlType="button"
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          onClick={() => {
            setIsOpen((current) => !current);
            setHoveredDocumentType(null);
          }}
          className={clsx(
            "flex h-[37px] w-full items-center justify-between gap-[8px] rounded-[12px] border bg-[var(--color-neutral-100)] px-[12px] text-left text-[14px] text-[var(--color-text-300)] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] disabled:cursor-not-allowed disabled:opacity-60",
            invalid ? "border-[var(--color-danger-100)]" : "border-[var(--color-neutral-200)]",
          )}
        >
          <span className="truncate">
            {selectedLabels.length ? selectedLabels.join(", ") : "Selecciona la documentación"}
          </span>
          <ArrowDown2
            size="18"
            color="currentColor"
            aria-hidden="true"
            className={clsx("shrink-0 transition-transform", isOpen && "rotate-180")}
          />
        </Button>
        {isOpen && !disabled ? (
          <div
            role="listbox"
            aria-multiselectable="true"
            className="mt-[4px] flex w-full flex-col gap-[4px] rounded-[12px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[6px] shadow-[var(--shadow-e1)]"
          >
            {PROJECT_REQUEST_OPTIONS.legalDocumentTypes.map((option) => {
              const selected = selectedValues.includes(option.value);
              return (
                <Button layout="content"
                  key={option.value}
                  htmlType="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => toggleDocument(option.value)}
                  onMouseEnter={() => setHoveredDocumentType(option.value)}
                  onMouseLeave={() => setHoveredDocumentType(null)}
                  className={clsx(
                    "flex min-h-[32px] w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[6px] text-left text-[14px] text-[var(--color-text-300)] hover:bg-[var(--color-neutral-200)] focus-visible:bg-[var(--color-neutral-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
                    selected && "bg-[var(--color-neutral-200)]",
                  )}
                >
                  <Checkbox
                    checked={selected ? "Yes" : "No"}
                    size="S"
                    state={hoveredDocumentType === option.value ? "Hover" : undefined}
                  />
                  <span>{option.label}</span>
                </Button>
              );
            })}
          </div>
        ) : null}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}

function FormDivider() {
  return (
    <div aria-hidden="true" className="relative h-0 w-full">
      <span className="absolute inset-x-0 top-0 h-px bg-[var(--color-neutral-200)]" />
    </div>
  );
}

function FormSection({ title, description, children, fieldsVariant = "stacked" }) {
  const fieldsClassName = fieldsVariant === "responsive-grid"
    ? "flex min-w-[214.5px] flex-1 flex-wrap items-start gap-[16px] [&>*]:min-w-[214.5px] [&>*]:basis-[214.5px] [&>*]:grow"
    : "flex w-full min-w-0 max-w-[445px] flex-col gap-[16px] min-[480px]:w-[445px]";

  return (
    <section className="flex w-full max-w-[850px] flex-wrap content-start items-start gap-[48px]">
      <div className="flex w-full min-w-0 flex-col gap-[16px] text-[var(--color-text-200)] min-[480px]:min-w-[300px] min-[480px]:w-[350px]">
        <h2 className="text-[16px] font-bold leading-[19px] tracking-[-0.5px]">{title}</h2>
        <p className="text-[14px] leading-[17px] tracking-[-0.5px]">{description}</p>
      </div>
      <div className={fieldsClassName}>{children}</div>
    </section>
  );
}

function toFileItems(fileList) {
  return Array.from(fileList || []).map((file, index) => ({
    error: "",
    file,
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    progress: 0,
    status: "pending",
  }));
}

export default function ProjectRequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const viewRequest = location.state?.viewRequest || null;
  const initialRequest = location.state?.initialRequest || viewRequest;
  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    projectName: initialRequest?.projectName || "",
    projectType: initialRequest?.projectType || INITIAL_FORM.projectType,
    location: initialRequest?.location || "",
    locationFormattedAddress: initialRequest?.formattedAddress || "",
    locationLatitude: initialRequest?.locationCoordinates?.latitude ?? null,
    locationLongitude: initialRequest?.locationCoordinates?.longitude ?? null,
    locationProviderPlaceId: initialRequest?.providerPlaceId || null,
    description: initialRequest?.description || "",
    projectSize: initialRequest?.projectSize || "",
    developmentMode: initialRequest?.developmentMode || "",
    landStatus: initialRequest?.landStatus || "",
    legalDocumentationStatus: initialRequest?.legalDocumentationStatus || "",
    legalDocumentTypes: initialRequest?.legalDocumentTypes || [],
    multipleOwners:
      initialRequest?.hasMultipleOwners === true
        ? "yes"
        : initialRequest?.hasMultipleOwners === false
          ? "no"
          : "",
    investmentRange: initialRequest?.investmentRange || "",
    capitalAvailability: initialRequest?.capitalAvailability || "",
    startTime: initialRequest?.startTime || "",
    decisionMaker: initialRequest?.decisionMaker || "",
    quality: initialRequest?.quality || "",
    experience: initialRequest?.experience || "",
    hasBlueprints:
      initialRequest?.hasPlans === true
        ? "Yes"
        : initialRequest?.hasPlans === false
          ? "No"
          : "Indeterminate",
    referenceLink: initialRequest?.referenceLink || "",
  }));
  const [files, setFiles] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [fileErrors, setFileErrors] = useState([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [showRequiredAlert, setShowRequiredAlert] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] = useState(false);
  const [pendingRequestAction, setPendingRequestAction] = useState(null);
  const [isRequestActionModalOpen, setIsRequestActionModalOpen] = useState(false);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [validationCode, setValidationCode] = useState("");
  const [isRequestReceived, setIsRequestReceived] = useState(Boolean(viewRequest));
  const [receivedRequest, setReceivedRequest] = useState(viewRequest);
  const [draftId, setDraftId] = useState(
    initialRequest?.status === "changes_requested" ? initialRequest.id : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isLocationInputFocused, setIsLocationInputFocused] = useState(false);
  const fileInputRef = useRef(null);
  const formRef = useRef(null);
  const submissionIdRef = useRef(null);
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
  const currentFieldErrors = useMemo(
    () => getProjectRequestFieldErrors(form),
    [form],
  );
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

  const update = (field) => (eventOrValue) => {
    const value = eventOrValue?.target ? eventOrValue.target.value : eventOrValue;
    const nextForm = { ...form, [field]: value };

    setForm(nextForm);

    if (hasAttemptedSubmit) {
      const nextErrors = getProjectRequestFieldErrors(nextForm);
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length === 0 && fileErrors.length === 0) setShowRequiredAlert(false);
    }
  };
  const updateLegalDocumentationStatus = (status) => {
    const nextForm = {
      ...form,
      legalDocumentationStatus: status,
      legalDocumentTypes: status === "available" ? form.legalDocumentTypes : [],
    };
    setForm(nextForm);
    if (hasAttemptedSubmit) {
      const nextErrors = getProjectRequestFieldErrors(nextForm);
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length === 0 && fileErrors.length === 0) {
        setShowRequiredAlert(false);
      }
    }
  };
  const updateLocation = (event) => {
    const value = event.target.value;
    const nextForm = {
      ...form,
      location: value,
      locationFormattedAddress: "",
      locationLatitude: null,
      locationLongitude: null,
      locationProviderPlaceId: null,
    };

    setIsLocationInputFocused(true);
    setForm(nextForm);

    if (
      hasAttemptedSubmit &&
      Object.keys(getProjectRequestFieldErrors(nextForm)).length === 0 &&
      fileErrors.length === 0
    ) {
      setShowRequiredAlert(false);
    }
    if (hasAttemptedSubmit) setFieldErrors(getProjectRequestFieldErrors(nextForm));
  };
  const selectLocationSuggestion = (suggestion) => {
    const nextForm = {
      ...form,
      location: suggestion.formattedAddress,
      locationFormattedAddress: suggestion.formattedAddress,
      locationLatitude: suggestion.latitude,
      locationLongitude: suggestion.longitude,
      locationProviderPlaceId: suggestion.placeId,
    };
    setForm(nextForm);
    if (hasAttemptedSubmit) {
      const nextErrors = getProjectRequestFieldErrors(nextForm);
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length === 0 && fileErrors.length === 0) setShowRequiredAlert(false);
    }
    clearLocationSuggestions();
    setIsLocationInputFocused(false);
  };
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
  const resetForm = () => {
    setForm(INITIAL_FORM);
    clearLocationSuggestions();
    setIsLocationInputFocused(false);
    setFiles([]);
    setFieldErrors({});
    setFileErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setHasAttemptedSubmit(false);
    setShowRequiredAlert(false);
    setIsValidationModalOpen(false);
    setValidationCode("");
    setIsRequestReceived(false);
    setReceivedRequest(null);
    setDraftId(null);
    setSubmitError("");
    submissionIdRef.current = null;
  };
  const requestFormReset = () => {
    setShowRequiredAlert(false);
    setPendingRequestAction({ type: "clear" });
    setIsRequestActionModalOpen(true);
  };
  const handleFilesChange = (fileList) => {
    if (draftId) {
      setFileErrors(["Ya existe un borrador en proceso. Reintenta el envío antes de cambiar los archivos."]);
      return;
    }
    const nextFiles = toFileItems(fileList);
    const nextErrors = getProjectRequestFileErrors(nextFiles);
    setFiles(nextFiles);
    setFileErrors(nextErrors);
    if (hasAttemptedSubmit && nextErrors.length === 0 && Object.keys(currentFieldErrors).length === 0) {
      setShowRequiredAlert(false);
    }
  };
  const updateFileItem = (id, values) => {
    setFiles((current) => current.map((item) => (item.id === id ? { ...item, ...values } : item)));
  };
  const handleFrontendSubmit = () => {
    setHasAttemptedSubmit(true);
    const nextFieldErrors = getProjectRequestFieldErrors(form);
    const nextFileErrors = getProjectRequestFileErrors(files);
    setFieldErrors(nextFieldErrors);
    setFileErrors(nextFileErrors);

    if (Object.keys(nextFieldErrors).length > 0 || nextFileErrors.length > 0) {
      setShowRequiredAlert(true);

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

    setShowRequiredAlert(false);
    setSubmitError("");
    setValidationCode("");
    setIsValidationModalOpen(true);
  };
  const handleValidationSubmit = async (code) => {
    if (isSubmitting || !/^\d{6}$/.test(String(code ?? "").trim())) {
      return;
    }
    setValidationCode("");
    setIsSubmitting(true);
    setSubmitError("");

    try {
      if (!submissionIdRef.current) submissionIdRef.current = window.crypto.randomUUID();
      const payload = buildProjectRequestPayload(form, submissionIdRef.current);
      let nextDraftId = draftId;
      if (nextDraftId) {
        await api.projectRequests.update({
          payload: buildProjectRequestPayload(form),
          projectRequestId: nextDraftId,
        });
      } else {
        const created = await api.projectRequests.create(payload);
        nextDraftId = created?.projectRequest?.id;
        if (!nextDraftId) throw new Error("No se pudo identificar el borrador de la solicitud.");
        setDraftId(nextDraftId);
      }

      for (const item of files) {
        if (item.status === "uploaded") continue;
        updateFileItem(item.id, { error: "", progress: 0, status: "uploading" });
        try {
          await api.projectRequests.uploadFile({
            file: item.file,
            onUploadProgress: ({ progress }) => updateFileItem(item.id, { progress }),
            projectRequestId: nextDraftId,
          });
          updateFileItem(item.id, { progress: 100, status: "uploaded" });
        } catch (error) {
          updateFileItem(item.id, {
            error: error.message || "No se pudo subir el archivo.",
            status: "error",
          });
          throw error;
        }
      }

      const submitted = await api.projectRequests.submit(nextDraftId);
      setReceivedRequest(submitted?.projectRequest || null);
      setIsValidationModalOpen(false);
      setIsRequestReceived(true);
      setIsSidebarExpanded(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSubmitError(error.message || "No se pudo enviar la solicitud. Puedes reintentarlo.");
    } finally {
      setIsSubmitting(false);
    }
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

            <form ref={formRef} noValidate className="flex w-full flex-col items-center gap-[48px]" onSubmit={(event) => { event.preventDefault(); handleFrontendSubmit(); }}>
              <FormSection title="Detalles del proyecto" description="Cuéntanos qué deseas desarrollar. Esta información nos ayudará a comprender el alcance, los objetivos y las características generales de tu proyecto antes de la primera reunión.">
                <TextField error={hasAttemptedSubmit ? fieldErrors.projectName : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectName)} label="Nombre del proyecto" icon={Edit2} placeholder='Ej. “Apto. Noventa y Uno”' value={form.projectName} onChange={update("projectName")} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.projectType : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectType)} label="Tipo de proyecto" value={form.projectType} onChange={update("projectType")} options={PROJECT_REQUEST_OPTIONS.projectType} />
                <TextField
                  error={hasAttemptedSubmit ? fieldErrors.location : ""}
                  invalid={hasAttemptedSubmit && Boolean(fieldErrors.location)}
                  label="Ubicación del proyecto"
                  icon={Location}
                  placeholder='Ej. “Maracaibo, Estado Zulia”'
                  value={form.location}
                  onFocus={() => setIsLocationInputFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsLocationInputFocused(false), 120);
                  }}
                  onChange={updateLocation}
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
                <TextField error={hasAttemptedSubmit ? fieldErrors.description : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.description)} label="Descripción del proyecto" multiline minLength={30} maxLength={100} placeholder="Describe brevemente qué quieres lograr, dónde está el inmueble y cualquier detalle relevante." value={form.description} onChange={update("description")} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.projectSize : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectSize)} label="Tamaño aproximado del proyecto" optional value={form.projectSize} onChange={update("projectSize")} options={PROJECT_REQUEST_OPTIONS.projectSize} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.developmentMode : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.developmentMode)} label="¿Cómo prefiere desarrollar el proyecto?" info value={form.developmentMode} onChange={update("developmentMode")} options={PROJECT_REQUEST_OPTIONS.developmentMode} />
                <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.landStatus : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.landStatus)} label="¿Tiene terreno o inmueble disponible?" optional value={form.landStatus} onChange={update("landStatus")} options={PROJECT_REQUEST_OPTIONS.landStatus} />
              </FormSection>

              <FormDivider />

              <FormSection title="Documentación legal del inmueble" description="Por favor, proporciona detalles sobre el estado legal de la propiedad que deseas intervenir. Esta información es crucial para evaluar la viabilidad del proyecto y asegurarnos de que se cumplan todos los requisitos legales antes de proceder.">
                <SelectField error={hasAttemptedSubmit ? fieldErrors.legalDocumentationStatus : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.legalDocumentationStatus)} label="¿Cuenta con documentación que acredite la situación legal del inmueble?" value={form.legalDocumentationStatus} onChange={updateLegalDocumentationStatus} options={PROJECT_REQUEST_OPTIONS.legalDocumentationStatus} />
                <LegalDocumentTypesField error={hasAttemptedSubmit ? fieldErrors.legalDocumentTypes : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.legalDocumentTypes)} value={form.legalDocumentTypes} onChange={update("legalDocumentTypes")} disabled={form.legalDocumentationStatus !== "available"} />
                <div className="flex w-full flex-col gap-[8px]">
                  <SelectField error={hasAttemptedSubmit ? fieldErrors.multipleOwners : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.multipleOwners)} label="¿El inmueble tiene más de un propietario?" value={form.multipleOwners} onChange={update("multipleOwners")} options={PROJECT_REQUEST_OPTIONS.multipleOwners} />
                  <HintText state="Default" hintText="La documentación podrá ser presentada posteriormente durante la reunión inicial." className="w-full" />
                </div>
                <div className="border-t border-[var(--color-neutral-200)] pt-[12px]">
                  <CheckboxField label="¿Dispone de planos del lugar?" value={form.hasBlueprints} onChange={(value) => setForm((current) => ({ ...current, hasBlueprints: value }))} />
                </div>
              </FormSection>

              <FormDivider />

              <FormSection fieldsVariant="responsive-grid" title="Viabilidad financiera" description="Conocer tu presupuesto y la disponibilidad de capital nos permite proponerte soluciones acordes.">
                <SelectField error={hasAttemptedSubmit ? fieldErrors.investmentRange : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.investmentRange)} label="Rango de inversión estimado" value={form.investmentRange} onChange={update("investmentRange")} options={PROJECT_REQUEST_OPTIONS.investmentRange} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.capitalAvailability : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.capitalAvailability)} label="Disponibilidad de capital" value={form.capitalAvailability} onChange={update("capitalAvailability")} options={PROJECT_REQUEST_OPTIONS.capitalAvailability} />
              </FormSection>

              <FormDivider />

              <FormSection title="Compatibilidad" description="Estas preguntas nos ayudan a conocer tus expectativas, tiempos y experiencia previa para ofrecerte un proceso de trabajo más personalizado y eficiente.">
                <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.startTime : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.startTime)} label="¿Cuándo espera iniciar el proyecto?" orientation="vertical" value={form.startTime} onChange={update("startTime")} options={PROJECT_REQUEST_OPTIONS.startTime} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.decisionMaker : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.decisionMaker)} label="¿Quién toma la decisión final del proyecto?" optional value={form.decisionMaker} onChange={update("decisionMaker")} options={PROJECT_REQUEST_OPTIONS.decisionMaker} />
                <SelectField error={hasAttemptedSubmit ? fieldErrors.quality : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.quality)} label="Expectativa de estilo / nivel de calidad" optional info value={form.quality} onChange={update("quality")} options={PROJECT_REQUEST_OPTIONS.quality} />
                <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.experience : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.experience)} label="¿Ha trabajado con un arquitecto o diseñador antes?" optional value={form.experience} onChange={update("experience")} options={PROJECT_REQUEST_OPTIONS.experience} />
              </FormSection>

              <FormDivider />

              <FormSection title="Referencias" description="Comparte imágenes, enlaces o cualquier material de referencia que represente tu visión del proyecto. Esto nos ayudará a comprender mejor el estilo, la atmósfera y los acabados que deseas lograr.">
                <div className="flex flex-col gap-[8px]">
                  <FieldLabel optional>Subir imágenes o archivos (opcional)</FieldLabel>
                  <Button layout="content" htmlType="button" disabled={isSubmitting} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFilesChange(event.dataTransfer.files); }} className="flex min-h-[177px] w-full flex-col items-center justify-center gap-[12px] rounded-[12px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[24px] py-[32px] text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] disabled:cursor-not-allowed disabled:opacity-60 min-[480px]:h-[177px]">
                    <span className="flex size-[40px] items-center justify-center rounded-[8px] border border-[var(--color-neutral-200)] text-[var(--color-text-100)] shadow-[var(--shadow-e1)]"><CloudPlus size="20" color="currentColor" /></span>
                    <span className="flex w-full flex-col items-center gap-[8px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)]">
                      <span className="flex min-h-[36px] flex-wrap items-center justify-center gap-[8px]">
                        <span className="text-[var(--color-text-300)] underline">Elige un archivo</span>
                        <span>O</span>
                        <span>Arrastra y suelta</span>
                      </span>
                      <span>Formatos JPEG, PNG, PDF y MP4, hasta 50 MB.</span>
                    </span>
                  </Button>
                  <Input presentation="control" inputRef={fileInputRef} htmlType="file" multiple accept=".jpeg,.jpg,.png,.pdf,.mp4" className="sr-only" onChange={(event) => handleFilesChange(event.target.files)} />
                  {files.length ? (
                    <ul className="flex flex-col gap-[4px] text-[14px] text-[var(--color-text-200)]" aria-live="polite">
                      {files.map((item) => <li key={item.id}>{item.file.name} · {item.status === "uploading" ? `${item.progress}%` : item.status === "uploaded" ? "Cargado" : item.status === "error" ? item.error : "Listo para cargar"}</li>)}
                    </ul>
                  ) : null}
                  {fileErrors.map((error) => <HintText key={error} state="Error" hintText={error} className="w-full" role="alert" />)}
                </div>
                <TextField error={hasAttemptedSubmit ? fieldErrors.referenceLink : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.referenceLink)} label="Links de referencia (Pinterest, web, etc.) (opcional)" optional icon={Link21} placeholder='Ej. “https://es.pinterest.com/pin”' value={form.referenceLink} onChange={update("referenceLink")} />
              </FormSection>

              <FormDivider />

              <div className="w-full max-w-[850px]">
                <p className="text-[16px] leading-[19px] tracking-[-0.5px] text-[var(--color-text-100)]">Al enviar este formulario, nuestro equipo revisará la información y se pondrá en contacto contigo en un plazo aproximado de 24–48 horas.</p>
              </div>
              <footer className="flex w-full max-w-[850px] flex-col-reverse gap-[8px] min-[480px]:flex-row min-[480px]:justify-end">
                <Button theme="Primary" type="Outline" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto" onClick={requestFormReset}>Limpiar formulario</Button>
                <Button disabled={isSubmitting} theme="Primary" type="Solid" htmlType="submit" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto">{isSubmitting ? "Enviando" : "Enviar"}</Button>
              </footer>
            </form>
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
