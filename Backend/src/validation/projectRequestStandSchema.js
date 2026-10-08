import { z } from "zod";
import { allowsStandDocumentSelection, STAND_REQUIREMENTS_VALUES } from "../domain/projectRequestStand.js";

/**
 * Comprueba que los documentos declarados sean únicos y estén disponibles para la reunión.
 * La declaración es informativa y no verifica archivos ni modifica métricas de evaluación.
 *
 * @param {object} answers - Respuestas normalizadas de requisitos del stand.
 * @param {import("zod").RefinementCtx} context - Contexto de incidencias del contrato.
 * @returns {void} Registra errores para documentos repetidos o incompatibles.
 */
function validateStandDocuments(answers, context) {
  if (new Set(answers.documentTypes).size !== answers.documentTypes.length) {
    context.addIssue({ code: "custom", message: "Los documentos no pueden repetirse.", path: ["documentTypes"] });
  }
  if (!allowsStandDocumentSelection(answers.requirementsStatus) && answers.documentTypes.length > 0) {
    context.addIssue({ code: "custom", message: "Solo indica documentación que ya tengas disponible.", path: ["documentTypes"] });
  }
}

export const projectRequestStandSchema = z.object({
  requirementsStatus: z.enum(STAND_REQUIREMENTS_VALUES.requirementsStatus).nullable().optional().default(null),
  documentTypes: z.array(z.enum(STAND_REQUIREMENTS_VALUES.documentTypes)).max(4).optional().default([]),
  spaceStatus: z.enum(STAND_REQUIREMENTS_VALUES.spaceStatus),
  hasSpacePlans: z.boolean().nullable().optional().default(null),
}).strict().superRefine(validateStandDocuments);
