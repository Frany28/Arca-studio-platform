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
      internalNotes: z.string().trim().max(4000).nullable().optional(),
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
