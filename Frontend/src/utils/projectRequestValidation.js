import { optionValues } from "./projectRequestOptions.js";

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
];

export const PROJECT_REQUEST_FILE_LIMITS = {
  maxCount: 10,
  maxFileBytes: 50 * 1024 * 1024,
  maxNameLength: 150,
  maxTotalBytes: 200 * 1024 * 1024,
};

/**
 * Indica si el cliente declaró un terreno o inmueble disponible. Es la misma regla de
 * dominio que aplica el backend: solo entonces existen la situación legal, la documentación,
 * los propietarios y los planos del lugar; en otro caso esos campos no aplican.
 *
 * @param {string|null|undefined} landStatus - Respuesta sobre disponibilidad del terreno.
 * @returns {boolean} true cuando la respuesta es "available".
 */
export function hasAvailableProperty(landStatus) {
  return landStatus === "available";
}

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
 * Comprueba longitudes, opciones del catálogo y enlace HTTP(S). La situación legal, los
 * documentos (sin duplicados y coherentes con su disponibilidad) y los propietarios solo
 * se validan cuando hay terreno o inmueble disponible. Exige coordenadas presentes
 * en pareja y compara sus rangos numéricos; no verifica explícitamente su finitud.
 *
 * @param {Object} [values={}] - Valores actuales del formulario.
 * @returns {Object} Errores por campo; objeto vacío si no se detectan problemas.
 */
export function getProjectRequestFieldErrors(values = {}) {
  const errors = {};
  const projectName = String(values.projectName || "").trim();
  const location = String(values.location || "").trim();
  const description = String(values.description || "").trim();
  const referenceLink = String(values.referenceLink || "").trim();

  if (projectName.length < 3) errors.projectName = "Ingresa al menos 3 caracteres.";
  else if (projectName.length > 150) errors.projectName = "Máximo 150 caracteres.";

  if (!optionValues("projectType").has(values.projectType)) errors.projectType = "Selecciona un tipo de proyecto.";
  if (!isValidLocation(location)) errors.location = "Ingresa una ubicación válida de al menos 5 caracteres.";
  else if (location.length > 255) errors.location = "Máximo 255 caracteres.";

  if (description.length < 30) errors.description = "Ingresa una descripción de al menos 30 caracteres.";
  else if (description.length > 100) errors.description = "Máximo 100 caracteres.";

  for (const field of ["developmentMode", "landStatus", "investmentRange", "capitalAvailability", "startTime"]) {
    if (!optionValues(field).has(values[field])) errors[field] = "Selecciona una opción válida.";
  }
  for (const field of ["projectSize", "decisionMaker", "quality", "experience"]) {
    if (values[field] && !optionValues(field).has(values[field])) errors[field] = "Selecciona una opción válida.";
  }

  // Los datos del inmueble solo se validan si aplican; ocultos no generan errores.
  if (hasAvailableProperty(values.landStatus)) {
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
 * @returns {Object} Errores de campos requeridos.
 */
export function getProjectRequestRequiredFieldErrors(values = {}) {
  const errors = getProjectRequestFieldErrors(values);
  return Object.fromEntries(
    PROJECT_REQUEST_REQUIRED_FIELDS.filter((field) => errors[field]).map((field) => [field, errors[field]]),
  );
}

/**
 * Valida adjuntos locales como archivos directos o elementos con propiedad file.
 * Admite JPEG/JPG, PNG, MP4 y PDF con MIME coincidente; comprueba nombres de hasta
 * 150 caracteres, duplicados sin distinguir mayúsculas, máximo diez archivos,
 * 50 MiB por archivo y 200 MiB totales. Devuelve mensajes únicos, no lanza por validación.
 *
 * @param {Array} [files=[]] - Archivos o wrappers del formulario.
 * @returns {Array} Mensajes de error sin duplicados.
 */
export function getProjectRequestFileErrors(files = []) {
  const errors = [];
  if (files.length > PROJECT_REQUEST_FILE_LIMITS.maxCount) errors.push("Puedes adjuntar un máximo de 10 archivos.");
  const names = new Set();
  let totalBytes = 0;
  for (const item of files) {
    const file = item?.file || item;
    const name = String(file?.name || "").trim();
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const expectedMime = FILE_MIME_BY_EXTENSION.get(extension);
    totalBytes += Number(file?.size || 0);
    if (!name || name.length > PROJECT_REQUEST_FILE_LIMITS.maxNameLength) errors.push(`${name || "Un archivo"}: nombre inválido.`);
    else if (names.has(name.toLowerCase())) errors.push(`${name}: está repetido.`);
    names.add(name.toLowerCase());
    if (!expectedMime || expectedMime !== String(file?.type || "").toLowerCase()) errors.push(`${name || "Un archivo"}: formato no permitido.`);
    if (!Number.isFinite(file?.size) || file.size <= 0) errors.push(`${name || "Un archivo"}: está vacío.`);
    else if (file.size > PROJECT_REQUEST_FILE_LIMITS.maxFileBytes) errors.push(`${name}: supera 50 MB.`);
  }
  if (totalBytes > PROJECT_REQUEST_FILE_LIMITS.maxTotalBytes) errors.push("Los archivos no pueden superar 200 MB en total.");
  return [...new Set(errors)];
}

function nullableText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

/**
 * Transforma el formulario al payload de solicitud sin validarlo ni incluir adjuntos.
 * Recorta textos, convierte opciones vacías a null, traduce hasBlueprints Yes/No
 * a boolean o null y multipleOwners yes a boolean. Sin terreno disponible envía los datos
 * del inmueble como null y la documentación vacía, como exige el contrato del backend. Añade submissionId solo si es truthy.
 *
 * @param {Object} form - Campos de formulario y metadatos de ubicación.
 * @param {string} [submissionId] - Referencia opcional del envío.
 * @returns {Object} Payload con nombres de campos esperados por la API.
 */
export function buildProjectRequestPayload(form, submissionId) {
  // Sin inmueble disponible los datos legales se omiten aunque sigan en el estado local.
  const hasProperty = hasAvailableProperty(form.landStatus);

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
    landStatus: form.landStatus || null,
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
    ...(submissionId ? { submissionId } : {}),
  };
}
