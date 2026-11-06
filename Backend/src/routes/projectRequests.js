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
  createProjectRequestDraftSchema,
  createProjectRequestSchema,
  isEmptyProjectRequestDraftBody,
  projectRequestFileIdSchema,
  projectRequestIdSchema,
  submitProjectRequestSchema,
  updateProjectRequestSchema,
} from "../validation/projectRequestSchemas.js";
import { projectRequestReviewSchema } from "../validation/projectRequestWorkflowSchemas.js";

const router = Router();
const validateFullCreation = validate(createProjectRequestSchema);
const validateEmptyDraftCreation = validate(createProjectRequestDraftSchema);

/**
 * Valida la creación de una solicitud: un cuerpo con solo `submissionId` crea un borrador vacío
 * (adjuntos antes de completar el formulario); cualquier otro cuerpo exige la solicitud completa.
 *
 * @param {import("express").Request} req - Solicitud HTTP.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa la cadena o entrega el error de validación.
 * @returns {void}
 */
function validateProjectRequestCreation(req, res, next) {
  const validator = isEmptyProjectRequestDraftBody(req.body) ? validateEmptyDraftCreation : validateFullCreation;
  validator(req, res, next);
}

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
router.post("/", requireAuth, requestRateLimit, validateProjectRequestCreation, createProjectRequest);
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
