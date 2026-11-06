import { UPLOAD_TRANSFER_LIMIT_BYTES } from "../config/uploadTransferLimit.js";
import { hasApplicableProperty, requiresPropertyAvailability } from "./projectRequestApplicability.js";
import { LEGACY_PROJECT_REQUEST_TYPES, optionValues } from "./projectRequestOptions.js";
import { allowsStandDocumentSelection, isAdvertisingStand } from "./projectRequestStand.js";

// Se conserva la exportación anterior para los consumidores existentes.
export { hasAvailableProperty } from "./projectRequestApplicability.js";

export const PROJECT_REQUEST_REQUIRED_FIELDS = [
  "projectName",
  "projectType",
  "location",
  "description",
  "developmentMode",
  "landStatus",
  "legalDocumentationStatus",
  "legalDocumentTypes",
  "multipleOwners",
  "investmentRange",
  "capitalAvailability",
  "startTime",
  "standSpaceStatus",
];

export const PROJECT_REQUEST_FILE_LIMITS = {
  maxCount: 10,
  maxFileBytes: 50 * 1024 * 1024,
  maxNameLength: 150,
  maxTotalBytes: 200 * 1024 * 1024,
};

const FILE_MIME_BY_EXTENSION = new Map([
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["mp4", "video/mp4"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
]);

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Aplica una comprobación textual de ubicación, sin geocodificar.
 * Normaliza acentos y exige letras, longitud mínima y alguna palabra de cinco
 * caracteres; rechaza secuencias largas de un solo carácter.
 *
 * @param {string|null} value - Ubicación introducida.
 * @returns {boolean} Si el texto supera la comprobación local.
 */
function isValidLocation(value) {
  const normalized = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.length < 5 || !/[a-z]/.test(normalized)) return false;
  if (/^(.)\1{5,}$/.test(normalized.replace(/\s/g, ""))) return false;
  return (normalized.match(/[a-z0-9]+/g) || []).some((word) => word.length >= 5);
}

/**
 * Valida campos de la solicitud y devuelve mensajes indexados por campo.
 * Conserva un tipo retirado únicamente con el contexto original de un registro existente.
 * Comprueba longitudes, opciones del catálogo y enlace HTTP(S). La pregunta del inmueble
 * solo se exige si aplica al tipo (no en Stand publicitario); la situación legal, los
 * documentos (sin duplicados y coherentes con su disponibilidad) y los propietarios solo
 * se validan cuando el inmueble aplica y está disponible. Exige coordenadas presentes
 * en pareja y compara sus rangos numéricos; no verifica explícitamente su finitud.
 *
 * @param {Object} [values={}] - Valores actuales del formulario.
 * @param {Object} [context={}] - Contexto del registro que se edita, nunca de una nueva solicitud.
 * @param {string|null} [context.existingProjectType=null] - Tipo original para conservar una opción histórica.
 * @returns {Object} Errores por campo; objeto vacío si no se detectan problemas.
 */
export function getProjectRequestFieldErrors(values = {}, { existingProjectType = null } = {}) {
  const errors = {};
  const projectName = String(values.projectName || "").trim();
  const location = String(values.location || "").trim();
  const description = String(values.description || "").trim();
  const referenceLink = String(values.referenceLink || "").trim();

  if (projectName.length < 3) errors.projectName = "Ingresa al menos 3 caracteres.";
  else if (projectName.length > 150) errors.projectName = "Máximo 150 caracteres.";

  const preservesLegacyType = LEGACY_PROJECT_REQUEST_TYPES.includes(values.projectType)
    && values.projectType === existingProjectType;
  if (!optionValues("projectType").has(values.projectType) && !preservesLegacyType) {
    errors.projectType = "Selecciona un tipo de proyecto.";
  }
  if (!isValidLocation(location)) errors.location = "Ingresa una ubicación válida de al menos 5 caracteres.";
  else if (location.length > 255) errors.location = "Máximo 255 caracteres.";

  if (description.length < 30) errors.description = "Ingresa una descripción de al menos 30 caracteres.";
  else if (description.length > 100) errors.description = "Máximo 100 caracteres.";

  for (const field of ["developmentMode", "investmentRange", "capitalAvailability", "startTime"]) {
    if (!optionValues(field).has(values[field])) errors[field] = "Selecciona una opción válida.";
  }
  if (requiresPropertyAvailability(values.projectType) && !optionValues("landStatus").has(values.landStatus)) {
    errors.landStatus = "Selecciona una opción válida.";
  }
  for (const field of ["projectSize", "decisionMaker", "quality", "experience"]) {
    if (values[field] && !optionValues(field).has(values[field])) errors[field] = "Selecciona una opción válida.";
  }

  if (isAdvertisingStand(values.projectType)) {
    if (!optionValues("standSpaceStatus").has(values.standSpaceStatus)) {
      errors.standSpaceStatus = "Indica si ya tienes asignado el espacio dentro del evento.";
    }
    if (values.standRequirementsStatus && !optionValues("standRequirementsStatus").has(values.standRequirementsStatus)) {
      errors.standRequirementsStatus = "Selecciona una opción válida.";
    }
    const documents = values.standDocumentTypes ?? [];
    if (!Array.isArray(documents) || documents.some((type) => !optionValues("standDocumentTypes").has(type))
      || new Set(documents).size !== documents.length) {
      errors.standDocumentTypes = "Selecciona documentos válidos sin repetirlos.";
    } else if (!allowsStandDocumentSelection(values.standRequirementsStatus) && documents.length > 0) {
      errors.standDocumentTypes = "Solo indica documentación que ya tengas disponible.";
    }
    if (values.hasStandSpacePlans && !["Yes", "No", "Indeterminate"].includes(values.hasStandSpacePlans)) {
      errors.hasStandSpacePlans = "Indica si tienes las medidas o el plano.";
    }
  }

  // Los datos del inmueble solo se validan si aplican; ocultos no generan errores.
  if (hasApplicableProperty(values)) {
    if (!optionValues("legalDocumentationStatus").has(values.legalDocumentationStatus)) {
      errors.legalDocumentationStatus = "Selecciona el estado de la documentación.";
    }

    const legalDocumentTypes = Array.isArray(values.legalDocumentTypes)
      ? values.legalDocumentTypes
      : [];
    const allowedLegalDocumentTypes = optionValues("legalDocumentTypes");
    const hasInvalidLegalDocumentType = legalDocumentTypes.some(
      (type) => !allowedLegalDocumentTypes.has(type),
    );
    if (hasInvalidLegalDocumentType || new Set(legalDocumentTypes).size !== legalDocumentTypes.length) {
      errors.legalDocumentTypes = "Selecciona documentos válidos sin repetirlos.";
    } else if (values.legalDocumentationStatus === "available" && legalDocumentTypes.length === 0) {
      errors.legalDocumentTypes = "Selecciona al menos un documento disponible.";
    } else if (values.legalDocumentationStatus !== "available" && legalDocumentTypes.length > 0) {
      errors.legalDocumentTypes = "Los documentos solo pueden seleccionarse cuando están disponibles.";
    }

    if (!optionValues("multipleOwners").has(values.multipleOwners)) {
      errors.multipleOwners = "Indica si el inmueble tiene más de un propietario.";
    }
  }

  if (referenceLink && (referenceLink.length > 500 || !isHttpUrl(referenceLink))) {
    errors.referenceLink = referenceLink.length > 500
      ? "Máximo 500 caracteres."
      : "Ingresa un enlace que comience con http:// o https://.";
  }

  const hasLatitude = values.locationLatitude !== null && values.locationLatitude !== undefined;
  const hasLongitude = values.locationLongitude !== null && values.locationLongitude !== undefined;
  if (hasLatitude !== hasLongitude) errors.location = "La ubicación seleccionada tiene coordenadas incompletas.";
  if (hasLatitude && (Number(values.locationLatitude) < -90 || Number(values.locationLatitude) > 90)) errors.location = "La latitud no es válida.";
  if (hasLongitude && (Number(values.locationLongitude) < -180 || Number(values.locationLongitude) > 180)) errors.location = "La longitud no es válida.";

  return errors;
}

/**
 * Restringe la validación completa a los campos del catálogo de requeridos.
 * No añade nuevas reglas; omite errores de campos opcionales en esta vista.
 *
 * @param {Object} [values={}] - Valores del formulario.
 * @param {Object} [context={}] - Tipo original de la solicitud existente cuando se edita.
 * @returns {Object} Errores de campos requeridos.
 */
export function getProjectRequestRequiredFieldErrors(values = {}, context = {}) {
  const errors = getProjectRequestFieldErrors(values, context);
  return Object.fromEntries(
    PROJECT_REQUEST_REQUIRED_FIELDS.filter((field) => errors[field]).map((field) => [field, errors[field]]),
  );
}

/**
 * Valida adjuntos locales como archivos directos o elementos con propiedad file y devuelve cada
 * problema con el adjunto al que pertenece. Admite JPEG/JPG, PNG, MP4 y PDF con MIME coincidente;
 * comprueba nombres de hasta 150 caracteres, duplicados sin distinguir mayúsculas (se señala la
 * repetición, no el primero), máximo diez archivos, 50 MiB por archivo y 200 MiB totales. Los
 * límites de cantidad y de tamaño total son de la sección (`index: null`). No lanza por validación.
 * Un adjunto ya guardado en la solicitud (`persisted: true`) cuenta para la cantidad, el tamaño
 * total y los duplicados, pero no repite las comprobaciones de nombre, formato y tamaño individual:
 * el backend las aplicó al recibirlo y su MIME guardado puede no coincidir con el de un `File`.
 * Además del límite funcional de 50 MB, aplica el límite temporal por subida del despliegue
 * (`UPLOAD_TRANSFER_LIMIT_BYTES`), para no aceptar un archivo que la plataforma rechazaría.
 *
 * @param {Array} [files=[]] - Archivos o wrappers del formulario.
 * @param {Object} [options] - Límites del entorno.
 * @param {number|null} [options.transferLimitBytes] - Máximo por subida del despliegue; null sin límite propio.
 * @returns {Array<{message: string, index: number|null}>} Problemas en el orden de los mensajes;
 * `index` es la posición del adjunto en `files` o null si el problema es de la sección.
 */
export function getProjectRequestFileIssues(files = [], { transferLimitBytes = UPLOAD_TRANSFER_LIMIT_BYTES } = {}) {
  const issues = [];
  const add = (message, index = null) => issues.push({ index, message });
  if (files.length > PROJECT_REQUEST_FILE_LIMITS.maxCount) add("Puedes adjuntar un máximo de 10 archivos.");
  const names = new Set();
  let totalBytes = 0;
  files.forEach((item, index) => {
    const file = item?.file || item;
    const name = String(file?.name || "").trim();
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const expectedMime = FILE_MIME_BY_EXTENSION.get(extension);
    totalBytes += Number(file?.size || 0);
    if (item?.persisted) {
      if (name && names.has(name.toLowerCase())) add(`${name}: está repetido.`, index);
      names.add(name.toLowerCase());
      return;
    }
    if (!name || name.length > PROJECT_REQUEST_FILE_LIMITS.maxNameLength) add(`${name || "Un archivo"}: nombre inválido.`, index);
    else if (names.has(name.toLowerCase())) add(`${name}: está repetido.`, index);
    names.add(name.toLowerCase());
    if (!expectedMime || expectedMime !== String(file?.type || "").toLowerCase()) add(`${name || "Un archivo"}: formato no permitido.`, index);
    if (!Number.isFinite(file?.size) || file.size <= 0) add(`${name || "Un archivo"}: está vacío.`, index);
    else if (file.size > PROJECT_REQUEST_FILE_LIMITS.maxFileBytes) add(`${name}: supera 50 MB.`, index);
    else if (transferLimitBytes && file.size > transferLimitBytes) add(`${name}: supera ${formatTransferLimit(transferLimitBytes)}, el máximo por archivo que admite temporalmente este entorno.`, index);
  });
  if (totalBytes > PROJECT_REQUEST_FILE_LIMITS.maxTotalBytes) add("Los archivos no pueden superar 200 MB en total.");
  return issues;
}

/**
 * Formatea el límite por subida del entorno en MB con coma decimal (p. ej. «4,5 MB»).
 * Usa megabytes decimales, como la documentación de la plataforma que lo impone.
 *
 * @param {number} bytes - Límite en bytes.
 * @returns {string} Límite legible.
 */
export function formatTransferLimit(bytes) {
  const megabytes = Math.floor((bytes / 1_000_000) * 10) / 10;
  return `${String(megabytes).replace(".", ",")} MB`;
}

/**
 * Mensajes de validación de los adjuntos (getProjectRequestFileIssues) sin duplicados, en el mismo
 * orden. Es el contrato que usan el formulario y el aviso de envío.
 *
 * @param {Array} [files=[]] - Archivos o wrappers del formulario.
 * @returns {Array<string>} Mensajes de error sin duplicados.
 */
export function getProjectRequestFileErrors(files = []) {
  return [...new Set(getProjectRequestFileIssues(files).map((issue) => issue.message))];
}

function nullableText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

/**
 * Transforma el formulario al payload de solicitud sin validarlo ni incluir adjuntos.
 * Recorta textos, convierte opciones vacías a null, traduce hasBlueprints Yes/No
 * a boolean o null y multipleOwners yes a boolean. En Stand publicitario envía landStatus
 * null (N/A). Sin inmueble aplicable y disponible envía los datos del inmueble como null y
 * la documentación vacía. Los requisitos del evento se incluyen solo para
 * advertising_stand. Añade submissionId si existe.
 *
 * @param {Object} form - Campos de formulario y metadatos de ubicación.
 * @param {string} [submissionId] - Referencia opcional del envío.
 * @returns {Object} Payload con nombres de campos esperados por la API.
 */
export function buildProjectRequestPayload(form, submissionId) {
  // Sin inmueble aplicable y disponible los datos legales se omiten aunque sigan en el estado local.
  const hasProperty = hasApplicableProperty(form);

  return {
    capitalAvailability: form.capitalAvailability,
    decisionMaker: form.decisionMaker || null,
    description: nullableText(form.description),
    developmentMode: form.developmentMode,
    experience: form.experience || null,
    hasBlueprints: hasProperty
      ? form.hasBlueprints === "Yes" ? true : form.hasBlueprints === "No" ? false : null
      : null,
    investmentRange: form.investmentRange,
    landStatus: requiresPropertyAvailability(form.projectType) ? form.landStatus || null : null,
    legalDocumentationStatus: hasProperty ? form.legalDocumentationStatus : null,
    legalDocumentTypes: hasProperty && Array.isArray(form.legalDocumentTypes)
      ? form.legalDocumentTypes
      : [],
    hasMultipleOwners: hasProperty ? form.multipleOwners === "yes" : null,
    projectLocation: String(form.location || "").trim(),
    projectLocationFormattedAddress: nullableText(form.locationFormattedAddress),
    projectLocationLatitude: form.locationLatitude ?? null,
    projectLocationLongitude: form.locationLongitude ?? null,
    projectLocationProviderPlaceId: nullableText(form.locationProviderPlaceId),
    projectName: String(form.projectName || "").trim(),
    projectSize: form.projectSize || null,
    projectType: form.projectType,
    quality: form.quality || null,
    referenceLink: nullableText(form.referenceLink),
    startTime: form.startTime,
    ...(isAdvertisingStand(form.projectType) ? {
      standRequirements: {
        requirementsStatus: form.standRequirementsStatus || null,
        documentTypes: allowsStandDocumentSelection(form.standRequirementsStatus) ? form.standDocumentTypes || [] : [],
        spaceStatus: form.standSpaceStatus,
        hasSpacePlans: form.hasStandSpacePlans === "Yes" ? true : form.hasStandSpacePlans === "No" ? false : null,
      },
    } : {}),
    ...(submissionId ? { submissionId } : {}),
  };
}
