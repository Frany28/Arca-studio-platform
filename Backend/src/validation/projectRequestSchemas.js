import { z } from "zod";

import { hasAvailableProperty, PROJECT_REQUEST_TEXT_LIMITS, PROJECT_REQUEST_VALUES, READABLE_PROJECT_REQUEST_TYPES } from "../domain/projectRequest.js";
import { isAdvertisingStand } from "../domain/projectRequestStand.js";
import { projectRequestStandSchema } from "./projectRequestStandSchema.js";

const positiveId = z.coerce.number().int().positive();
/**
 * Procesa el valor de nullable text para completar la responsabilidad asignada al módulo.
 * Se utiliza para normalizar entradas y construir contratos Zod reutilizables.
 *
 * @param {number} maximum - Valor de `maximum` requerido por esta operación.
 * @returns {void} Finalización de la operación.
 */
const nullableText = (maximum) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null;
      const normalized = String(value).trim();
      return normalized || null;
    },
    z.string().max(maximum).nullable(),
  );
/**
 * Procesa el valor de optional choice para completar la responsabilidad asignada al módulo.
 * Se utiliza para normalizar entradas y construir contratos Zod reutilizables.
 *
 * @param {Array<unknown>} values - Valor de `values` requerido por esta operación.
 * @returns {void} Finalización de la operación.
 */
const optionalChoice = (values) => z.enum(values).nullable().optional().default(null);
const optionalCoordinate = z.number().finite().nullable().optional().default(null);

/**
 * Normaliza el valor de address para mantener un formato interno consistente.
 * Se utiliza para normalizar entradas y construir contratos Zod reutilizables.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function normalizeAddress(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Determina si es válida el valor de manual address según las reglas del dominio.
 * Se utiliza para normalizar entradas y construir contratos Zod reutilizables.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function validManualAddress(value) {
  const normalized = normalizeAddress(value);
  if (normalized.length < 5 || !/[a-z]/.test(normalized)) return false;
  if (/^(.)\1{5,}$/.test(normalized.replace(/\s/g, ""))) return false;
  return (normalized.match(/[a-z0-9]+/g) || []).some((word) => word.length >= 5);
}

/**
 * Aplica la regla de dominio del inmueble: con terreno disponible exige la situación legal
 * y los propietarios; sin él, rechaza cualquier dato legal, de propietarios o de planos
 * para no persistir información incompatible con la respuesta del cliente.
 *
 * @param {object} body - Cuerpo normalizado por Zod.
 * @param {import("zod").RefinementCtx} context - Contexto para registrar incidencias.
 * @returns {void} Registra incidencias en el contexto cuando corresponde.
 */
function validatePropertyDependentFields(body, context) {
  if (hasAvailableProperty(body.landStatus)) {
    if (body.legalDocumentationStatus === null) {
      context.addIssue({ code: "custom", message: "Indica la situación legal del inmueble.", path: ["legalDocumentationStatus"] });
    }
    if (body.hasMultipleOwners === null) {
      context.addIssue({ code: "custom", message: "Indica si el inmueble tiene más de un propietario.", path: ["hasMultipleOwners"] });
    }
    return;
  }

  const message = "Solo aplica cuando se dispone de terreno o inmueble.";
  if (body.legalDocumentationStatus !== null) context.addIssue({ code: "custom", message, path: ["legalDocumentationStatus"] });
  if (body.legalDocumentTypes.length > 0) context.addIssue({ code: "custom", message, path: ["legalDocumentTypes"] });
  if (body.hasMultipleOwners !== null) context.addIssue({ code: "custom", message, path: ["hasMultipleOwners"] });
  if (body.hasBlueprints !== null) context.addIssue({ code: "custom", message, path: ["hasBlueprints"] });
}

const projectRequestBody = z
  .object({
    capitalAvailability: z.enum(PROJECT_REQUEST_VALUES.capitalAvailability),
    decisionMaker: optionalChoice(PROJECT_REQUEST_VALUES.decisionMaker),
    description: z.string().trim().min(PROJECT_REQUEST_TEXT_LIMITS.description.min).max(PROJECT_REQUEST_TEXT_LIMITS.description.max),
    developmentMode: z.enum(PROJECT_REQUEST_VALUES.developmentMode),
    experience: optionalChoice(PROJECT_REQUEST_VALUES.experience),
    hasBlueprints: z.boolean().nullable().optional().default(null),
    investmentRange: z.enum(PROJECT_REQUEST_VALUES.investmentRange),
    // Obligatorio: determina si aplican los campos del inmueble (ver validatePropertyDependentFields).
    landStatus: z.enum(PROJECT_REQUEST_VALUES.landStatus),
    legalDocumentationStatus: optionalChoice(PROJECT_REQUEST_VALUES.legalDocumentationStatus),
    legalDocumentTypes: z.array(z.enum(PROJECT_REQUEST_VALUES.legalDocumentTypes)).max(4).optional().default([]),
    hasMultipleOwners: z.boolean().nullable().optional().default(null),
    projectLocation: z.string().trim().min(PROJECT_REQUEST_TEXT_LIMITS.projectLocation.min).max(PROJECT_REQUEST_TEXT_LIMITS.projectLocation.max).refine(validManualAddress, "Ingresa una ubicación válida."),
    projectLocationFormattedAddress: nullableText(500),
    projectLocationLatitude: optionalCoordinate,
    projectLocationLongitude: optionalCoordinate,
    projectLocationProviderPlaceId: nullableText(255),
    projectName: z.string().trim().min(PROJECT_REQUEST_TEXT_LIMITS.projectName.min).max(PROJECT_REQUEST_TEXT_LIMITS.projectName.max),
    projectSize: optionalChoice(PROJECT_REQUEST_VALUES.projectSize),
    // Editar admite tipos históricos; el servicio exige conservar el mismo tipo guardado.
    projectType: z.enum(READABLE_PROJECT_REQUEST_TYPES),
    quality: optionalChoice(PROJECT_REQUEST_VALUES.quality),
    referenceLink: nullableText(500).refine((value) => {
      if (value === null) return true;
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, "Ingresa un enlace http o https válido."),
    startTime: z.enum(PROJECT_REQUEST_VALUES.startTime),
    standRequirements: projectRequestStandSchema.nullable().optional().default(null),
  })
  .strict()
  .superRefine((body, context) => {
    validatePropertyDependentFields(body, context);
    if (isAdvertisingStand(body.projectType) && body.standRequirements === null) {
      context.addIssue({ code: "custom", message: "Indica si ya tienes asignado el espacio dentro del evento.", path: ["standRequirements", "spaceStatus"] });
    } else if (!isAdvertisingStand(body.projectType) && body.standRequirements !== null) {
      context.addIssue({ code: "custom", message: "Los requisitos del stand solo aplican a Stand publicitario.", path: ["standRequirements"] });
    }
    const uniqueLegalDocumentTypes = new Set(body.legalDocumentTypes);
    if (uniqueLegalDocumentTypes.size !== body.legalDocumentTypes.length) {
      context.addIssue({
        code: "custom",
        message: "Los documentos no pueden repetirse.",
        path: ["legalDocumentTypes"],
      });
    }
    if (hasAvailableProperty(body.landStatus) && body.legalDocumentationStatus === "available" && body.legalDocumentTypes.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Selecciona al menos un documento disponible.",
        path: ["legalDocumentTypes"],
      });
    }
    if (hasAvailableProperty(body.landStatus) && body.legalDocumentationStatus !== "available" && body.legalDocumentTypes.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Solo indica documentos que ya estén disponibles.",
        path: ["legalDocumentTypes"],
      });
    }
    const hasLatitude = body.projectLocationLatitude !== null;
    const hasLongitude = body.projectLocationLongitude !== null;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: "custom",
        message: "La latitud y longitud deben enviarse juntas.",
        path: hasLatitude ? ["projectLocationLongitude"] : ["projectLocationLatitude"],
      });
      return;
    }
    if (hasLatitude && (body.projectLocationLatitude < -90 || body.projectLocationLatitude > 90)) {
      context.addIssue({ code: "custom", message: "Latitud inválida.", path: ["projectLocationLatitude"] });
    }
    if (hasLongitude && (body.projectLocationLongitude < -180 || body.projectLocationLongitude > 180)) {
      context.addIssue({ code: "custom", message: "Longitud inválida.", path: ["projectLocationLongitude"] });
    }
  });

export const createProjectRequestSchema = z.object({
  body: projectRequestBody.safeExtend({
    projectType: z.enum(PROJECT_REQUEST_VALUES.projectType),
    submissionId: z.uuid(),
  }).strict(),
});

export const updateProjectRequestSchema = z.object({
  body: projectRequestBody,
  params: z.object({ projectRequestId: positiveId }),
});

export const projectRequestIdSchema = z.object({
  params: z.object({ projectRequestId: positiveId }),
});

export const projectRequestFileIdSchema = z.object({
  params: z.object({ fileId: positiveId, projectRequestId: positiveId }),
});
