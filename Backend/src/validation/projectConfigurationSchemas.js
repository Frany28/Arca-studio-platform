import { z } from "zod";

import { findTrackingDateErrors, isConfigurationDate, PROJECT_CONFIGURATION_LIMITS, PROJECT_STAGE_STATUSES } from "../domain/projectConfiguration.js";

const positiveId = z.coerce.number().int().positive();
const isoDate = z.string().refine(isConfigurationDate, "Usa una fecha válida (AAAA-MM-DD).");
const optionalText = z.string().trim().max(PROJECT_CONFIGURATION_LIMITS.textMax).transform((value) => value || null).nullable().optional()
  .transform((value) => value ?? null);
// Un borrador puede guardarse incompleto: los campos obligatorios se exigen al finalizar.
const optionalArea = z.number().positive("El área debe ser mayor que cero.").max(99999999.99).nullable().optional()
  .transform((value) => value ?? null);
const projectParams = z.object({ projectId: positiveId });

export const projectConfigurationParamsSchema = z.object({ params: projectParams });

export const projectDraftCreateSchema = z.object({
  body: z.object({
    clientId: positiveId,
    name: z.string().trim().min(3, "El nombre debe tener al menos 3 caracteres.").max(150),
  }).strict(),
});

export const projectGeneralConfigurationSchema = z.object({
  params: projectParams,
  body: z.object({
    assigneeIds: z.array(positiveId).max(PROJECT_CONFIGURATION_LIMITS.maxAssignees)
      .refine((ids) => new Set(ids).size === ids.length, "No se permiten responsables duplicados."),
    conditions: optionalText,
    constructionArea: optionalArea,
    equipment: optionalText,
    formattedAddress: z.string().trim().max(500).nullable().optional().transform((value) => value || null),
    generalArea: optionalArea,
    hasPlans: z.boolean().nullable().optional().transform((value) => value ?? null),
    latitude: z.number().min(-90).max(90).nullable().optional().transform((value) => value ?? null),
    location: z.string().trim().max(255).nullable().optional().transform((value) => value || null),
    longitude: z.number().min(-180).max(180).nullable().optional().transform((value) => value ?? null),
    name: z.string().trim().min(3, "El nombre debe tener al menos 3 caracteres.").max(150),
    procedures: optionalText,
    projectType: z.enum(["residential", "commercial", "corporate", "advertising_stand"]).nullable().optional()
      .transform((value) => value ?? null),
    providerPlaceId: z.string().trim().max(255).nullable().optional().transform((value) => value || null),
    zoning: optionalText,
  }).strict().refine((body) => (body.latitude === null) === (body.longitude === null), {
    message: "Latitud y longitud deben enviarse juntas.",
    path: ["latitude"],
  }),
});

const stageSchema = z.object({
  endDate: isoDate.nullable(),
  name: z.string().trim().min(1, "Escribe el nombre de la fase.").max(150),
  startDate: isoDate.nullable(),
  status: z.enum(PROJECT_STAGE_STATUSES),
}).strict();

/**
 * Adapta los errores compartidos de seguimiento a las rutas de validación de Zod.
 * Mantiene una sola regla de fechas para HTTP, guardado del servicio y finalización.
 *
 * @param {object} body - Seguimiento recibido con sus campos estructurales validados.
 * @param {import("zod").RefinementCtx} context - Receptor de errores de Zod.
 * @returns {void}
 */
function validateTrackingDates(body, context) {
  for (const [field, message] of Object.entries(findTrackingDateErrors(body))) {
    context.addIssue({ code: "custom", message, path: field.replace(/\.beforeStart$/, "").split(".") });
  }
}

export const projectTrackingConfigurationSchema = z.object({
  params: projectParams,
  body: z.object({
    estimatedDeliveryDate: isoDate.nullable(),
    milestones: z.array(z.object({
      dueDate: isoDate,
      title: z.string().trim().min(1, "Escribe el hito.").max(150),
    }).strict()).max(PROJECT_CONFIGURATION_LIMITS.maxMilestones),
    stages: z.array(stageSchema).max(PROJECT_CONFIGURATION_LIMITS.maxStages),
  }).strict().superRefine(validateTrackingDates),
});

export const projectWarrantiesConfigurationSchema = z.object({
  params: projectParams,
  body: z.object({
    warranties: z.array(z.object({
      code: z.string().trim().min(1, "Escribe el código.").max(100),
      endDate: isoDate,
      model: z.string().trim().min(1, "Escribe el modelo.").max(100),
      product: z.string().trim().min(1, "Escribe el producto.").max(150),
      serviceDate: isoDate,
      startDate: isoDate,
    }).strict().refine((warranty) => warranty.startDate <= warranty.serviceDate && warranty.serviceDate <= warranty.endDate, {
      message: "Las fechas deben ser inicio ≤ servicio ≤ finalización.",
      path: ["endDate"],
    })).max(PROJECT_CONFIGURATION_LIMITS.maxWarranties),
  }).strict(),
});

const folderName = z.string().trim().min(1, "Escribe el nombre de la carpeta.").max(120);

export const projectFolderCreateSchema = z.object({
  params: projectParams,
  body: z.object({ name: folderName, parentId: positiveId.nullable().optional().transform((value) => value ?? null) }).strict(),
});

export const projectFolderUpdateSchema = z.object({
  params: projectParams.extend({ folderId: positiveId }),
  body: z.object({ name: folderName }).strict(),
});

export const projectFolderDeleteSchema = z.object({
  params: projectParams.extend({ folderId: positiveId }),
});

export const projectFileMoveSchema = z.object({
  params: projectParams.extend({ fileId: positiveId }),
  body: z.object({ folderId: positiveId.nullable() }).strict(),
});

export const projectConfigurationUploadSchema = z.object({
  params: projectParams,
  query: z.object({ folderId: positiveId.optional() }).passthrough(),
});

export const projectRequestFirstContactSchema = z.object({
  params: z.object({ projectRequestId: positiveId }),
});
