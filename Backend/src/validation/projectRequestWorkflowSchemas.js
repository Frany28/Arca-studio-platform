import { z } from "zod";
import { MEETING_RECOMMENDATIONS } from "../domain/projectRequestReview.js";

const positiveId = z.coerce.number().int().positive();

export const projectRequestReviewSchema = z.object({
  params: z.object({ projectRequestId: positiveId }),
  body: z.object({
    recommendation: z.enum(["approve", "reject", "changes_requested"]),
    meetingRecommendation: z.enum(MEETING_RECOMMENDATIONS).nullable().optional(),
    note: z.string().trim().min(10).max(2000),
  }).strict(),
});

export const projectRequestDecisionSchema = z.object({
  params: z.object({ projectRequestId: positiveId }),
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("approve"),
      // Excepción para aprobar con revisiones técnicas anteriores a la última edición relevante:
      // confirmación explícita y justificación juntas (el servicio exige ambas o ninguna).
      acknowledgeOutdatedReviews: z.literal(true).optional(),
      internalNotes: z.string().trim().max(4000).nullable().optional(),
      outdatedReviewsJustification: z.string().trim().min(10).max(2000).optional(),
    }).strict(),
    z.object({
      action: z.literal("reject"),
      internalNotes: z.string().trim().max(4000).nullable().optional(),
      reason: z.string().trim().min(10).max(2000),
    }).strict(),
    z.object({
      action: z.literal("request_changes"),
      internalNotes: z.string().trim().max(4000).nullable().optional(),
      reason: z.string().trim().min(10).max(2000),
    }).strict(),
  ]),
});
