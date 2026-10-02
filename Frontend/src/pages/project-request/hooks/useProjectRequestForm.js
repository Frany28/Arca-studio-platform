import { useMemo, useState } from "react";

import { getProjectRequestFieldErrors } from "../../../utils/projectRequestValidation.js";

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

function createInitialForm(initialRequest) {
  return {
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
  };
}

export default function useProjectRequestForm({
  initialRequest,
  setShowRequiredAlert,
}) {
  const [form, setForm] = useState(() => createInitialForm(initialRequest));
  const [fieldErrors, setFieldErrors] = useState({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isLocationInputFocused, setIsLocationInputFocused] = useState(false);

  const currentFieldErrors = useMemo(
    () => getProjectRequestFieldErrors(form),
    [form],
  );

  const updateErrorsAfterChange = (nextForm, fileErrors) => {
    if (!hasAttemptedSubmit) return;

    const nextErrors = getProjectRequestFieldErrors(nextForm);
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0 && fileErrors.length === 0) {
      setShowRequiredAlert(false);
    }
  };

  const update = (field, fileErrors = []) => (eventOrValue) => {
    const value = eventOrValue?.target ? eventOrValue.target.value : eventOrValue;
    const nextForm = { ...form, [field]: value };

    setForm(nextForm);
    updateErrorsAfterChange(nextForm, fileErrors);
  };

  const updateLegalDocumentationStatus = (status, fileErrors = []) => {
    const nextForm = {
      ...form,
      legalDocumentationStatus: status,
      legalDocumentTypes: status === "available" ? form.legalDocumentTypes : [],
    };

    setForm(nextForm);
    updateErrorsAfterChange(nextForm, fileErrors);
  };

  const updateLocation = (event, fileErrors = []) => {
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
    updateErrorsAfterChange(nextForm, fileErrors);
  };

  const applyLocationSuggestion = (suggestion, fileErrors = []) => {
    const nextForm = {
      ...form,
      location: suggestion.formattedAddress,
      locationFormattedAddress: suggestion.formattedAddress,
      locationLatitude: suggestion.latitude,
      locationLongitude: suggestion.longitude,
      locationProviderPlaceId: suggestion.placeId,
    };

    setForm(nextForm);
    updateErrorsAfterChange(nextForm, fileErrors);
    setIsLocationInputFocused(false);
  };

  const validateForSubmit = (fileErrors = []) => {
    setHasAttemptedSubmit(true);
    const nextFieldErrors = getProjectRequestFieldErrors(form);
    setFieldErrors(nextFieldErrors);

    const invalid = Object.keys(nextFieldErrors).length > 0 || fileErrors.length > 0;
    setShowRequiredAlert(invalid);

    return invalid;
  };

  const resetFormState = () => {
    setForm(INITIAL_FORM);
    setFieldErrors({});
    setHasAttemptedSubmit(false);
    setIsLocationInputFocused(false);
    setShowRequiredAlert(false);
  };

  return {
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
  };
}
