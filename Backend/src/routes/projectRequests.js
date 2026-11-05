import { Router } from "express";

import {
  createProjectRequest,
  getProjectRequest,
  listProjectRequests,
  requestProjectRequestVerificationCode,
  submitProjectRequest,
  updateProjectRequest,
} from "../controllers/projectRequestController.js";
import {
  deleteProjectRequestAttachment,
  uploadProjectRequestAttachment,
  streamProjectRequestFile,
} from "../controllers/fileController.js";
import {
  listProjectRequestReviews,
  putProjectRequestReview,
} from "../controllers/projectRequestWorkflowController.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { requestRateLimit, uploadRateLimit, verificationCodeRateLimit } from "../middlewares/actionRateLimits.js";
import { paginationSchema } from "../validation/schemas.js";
import {
  createProjectRequestSchema,
  projectRequestFileIdSchema,
  projectRequestIdSchema,
  submitProjectRequestSchema,
  updateProjectRequestSchema,
} from "../validation/projectRequestSchemas.js";
import { projectRequestReviewSchema } from "../validation/projectRequestWorkflowSchemas.js";

const router = Router();

router.get(
  "/review-queue",
  requireAuth,
  requireRoles("admin", "architect"),
  validate(paginationSchema),
  listProjectRequestReviews,
);
router.put(
  "/:projectRequestId/review",
  requireAuth,
  requireRoles("admin", "architect"),
  requestRateLimit,
  validate(projectRequestReviewSchema),
  putProjectRequestReview,
);
router.get("/", requireAuth, validate(paginationSchema), listProjectRequests);
router.get("/:projectRequestId", requireAuth, validate(projectRequestIdSchema), getProjectRequest);
router.post("/", requireAuth, requestRateLimit, validate(createProjectRequestSchema), createProjectRequest);
router.patch("/:projectRequestId", requireAuth, requestRateLimit, validate(updateProjectRequestSchema), updateProjectRequest);
router.post(
  "/:projectRequestId/verification-code",
  requireAuth,
  verificationCodeRateLimit,
  validate(projectRequestIdSchema),
  requestProjectRequestVerificationCode,
);
router.post("/:projectRequestId/submit", requireAuth, requestRateLimit, validate(submitProjectRequestSchema), submitProjectRequest);
router.post(
  "/:projectRequestId/files",
  requireAuth,
  uploadRateLimit,
  validate(projectRequestIdSchema),
  uploadProjectRequestAttachment,
);
router.delete(
  "/:projectRequestId/files/:fileId",
  requireAuth,
  validate(projectRequestFileIdSchema),
  deleteProjectRequestAttachment,
);
router.get(
  "/:projectRequestId/files/:fileId/content",
  requireAuth,
  validate(projectRequestFileIdSchema),
  streamProjectRequestFile,
);

export default router;
