import { useMemo, useState } from "react";

import {
  getProjectRequestFieldErrors,
  hasAvailableProperty,
} from "../../../utils/projectRequestValidation.js";

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

// Campos que solo existen con terreno o inmueble disponible (misma regla que el backend).
const PROPERTY_DEPENDENT_FIELDS = ["legalDocumentationStatus", "legalDocumentTypes", "multipleOwners", "hasBlueprints"];

/**
 * Adapta campos de la solicitud a los valores editables y sus defaults.
 * Traduce booleanos a opciones del formulario y conserva coordenadas nulas.
 *
 * @param {Object|null} initialRequest - Solicitud usada para inicializar el formulario.
 * @returns {Object} Campos iniciales con ubicaci?n y documentaci?n legal.
 */
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

/**
 * Inicializa los campos desde una solicitud solo al montar y deriva su validaci?n.
 * Expone errores por campo despu?s del intento de env?o y coordina ubicaci?n,
 * documentaci?n legal, foco y aviso conjunto con los errores de archivos recibidos.
 *
 * @param {Object} params - Datos iniciales y control del aviso.
 * @param {Object|null} params.initialRequest - Solicitud inicial; cambios posteriores no reinicializan el estado.
 * @param {Function} params.setShowRequiredAlert - Controla el aviso de datos inv?lidos.
 * @returns {Object} Formulario, errores actuales/visibles, intento de env?o, foco y acciones de edici?n, validaci?n y reset.
 */
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

  /**
   * Revalida errores visibles solo despu?s del primer intento de env?o.
   * Oculta el aviso cuando ambos conjuntos de errores est?n vac?os.
   *
   * @param {Object} nextForm - Valores resultantes de la edici?n.
   * @param {Array} fileErrors - Errores de los archivos seleccionados.
   * @returns {void} Actualiza errores y eventualmente el aviso.
   */
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

  /**
   * Conserva los tipos legales solo para el estado available; en otros estados los vac?a.
   *
   * @param {string} status - Estado de documentaci?n seleccionado.
   * @param {Array} [fileErrors=[]] - Errores para coordinar el aviso.
   * @returns {void} Actualiza documentaci?n y revalida cuando corresponde.
   */
  const updateLegalDocumentationStatus = (status, fileErrors = []) => {
    const nextForm = {
      ...form,
      legalDocumentationStatus: status,
      legalDocumentTypes: status === "available" ? form.legalDocumentTypes : [],
    };

    setForm(nextForm);
    updateErrorsAfterChange(nextForm, fileErrors);
  };

  /**
   * Cambia la disponibilidad del terreno. Si deja de estar disponible, restablece los
   * campos del inmueble a su valor inicial: la sección se oculta y sus datos no deben
   * reaparecer ni enviarse como parte activa de la solicitud.
   *
   * @param {string} status - Respuesta seleccionada sobre el terreno.
   * @param {Array} [fileErrors=[]] - Errores para coordinar el aviso.
   * @returns {void} Actualiza el formulario y revalida cuando corresponde.
   */
  const updateLandStatus = (status, fileErrors = []) => {
    const clearedPropertyFields = hasAvailableProperty(status)
      ? {}
      : Object.fromEntries(PROPERTY_DEPENDENT_FIELDS.map((field) => [field, INITIAL_FORM[field]]));
    const nextForm = { ...form, ...clearedPropertyFields, landStatus: status };

    setForm(nextForm);
    updateErrorsAfterChange(nextForm, fileErrors);
  };

  /**
   * Descarta la direcci?n estructurada y coordenadas previas al editar el texto libre.
   *
   * @param {Object} event - Evento cuyo target.value contiene la ubicaci?n.
   * @param {Array} [fileErrors=[]] - Errores para coordinar el aviso.
   * @returns {void} Actualiza ubicaci?n, activa foco y revalida cuando corresponde.
   */
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

  /**
   * Aplica direcci?n, coordenadas e identificador del proveedor como una selecci?n conjunta.
   *
   * @param {Object} suggestion - Sugerencia con formattedAddress, latitude, longitude y placeId.
   * @param {Array} [fileErrors=[]] - Errores para coordinar el aviso.
   * @returns {void} Actualiza la ubicaci?n y desactiva el foco l?gico del input.
   */
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

  /**
   * Marca el intento de env?o y sincroniza los errores visibles y el aviso conjunto.
   *
   * @param {Array} [fileErrors=[]] - Errores de archivos comprobados por el consumidor.
   * @returns {boolean} true si hay errores que impiden continuar; false si no los hay.
   */
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
    updateLandStatus,
    updateLegalDocumentationStatus,
    updateLocation,
    validateForSubmit,
  };
}
