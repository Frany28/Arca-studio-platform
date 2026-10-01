import { useProjectRequestSubmit } from "./useProjectRequestSubmit.js";
import { useProjectRequestFiles } from "./useProjectRequestFiles.js";
import { INITIAL_FORM } from "../projectRequestFormConfig.js";
import { useMemo, useRef, useState } from "react";
import useAddressSuggestions from "../../../hooks/useAddressSuggestions.js";
import { getProjectRequestFieldErrors, getProjectRequestFileErrors } from "../../../utils/projectRequestValidation.js";

export function useProjectRequestForm({ viewRequest, initialRequest, setIsSidebarExpanded }) {
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

  const [fieldErrors, setFieldErrors] = useState({});

  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const [showRequiredAlert, setShowRequiredAlert] = useState(false);

  const [draftId, setDraftId] = useState(
    initialRequest?.status === "changes_requested" ? initialRequest.id : null,
  );

  const [isLocationInputFocused, setIsLocationInputFocused] = useState(false);

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

  const currentFieldErrors = useMemo(
    () => getProjectRequestFieldErrors(form),
    [form],
  );

  const {
    files,
    setFiles,
    fileErrors,
    setFileErrors,
    fileInputRef,
    handleFilesChange,
    updateFileItem,
  } = useProjectRequestFiles({
    hasAttemptedSubmit,
    setShowRequiredAlert,
    draftId,
    currentFieldErrors,
  });

  const {
    isValidationModalOpen,
    setIsValidationModalOpen,
    validationCode,
    setValidationCode,
    isRequestReceived,
    setIsRequestReceived,
    receivedRequest,
    setReceivedRequest,
    isSubmitting,
    submitError,
    setSubmitError,
    submissionIdRef,
    handleValidationSubmit,
  } = useProjectRequestSubmit({
    viewRequest,
    setIsSidebarExpanded,
    form,
    draftId,
    setDraftId,
    files,
    updateFileItem,
  });

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

  return {
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
  };
}
