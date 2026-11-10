import { Router } from "express";

import {
  createSupportRequest,
  uploadSupportRequestAttachment,
} from "../controllers/supportController.js";
import { requireAuth, requirePermissions } from "../middlewares/auth.js";
import { supportRequestRateLimit, uploadRateLimit } from "../middlewares/actionRateLimits.js";

const router = Router();

router.post(
  "/requests",
  requireAuth,
  requirePermissions("support.requests.create"),
  supportRequestRateLimit,
  createSupportRequest,
);
router.post(
  "/requests/:supportRequestId/files",
  requireAuth,
  requirePermissions("support.files.upload"),
  uploadRateLimit,
  uploadSupportRequestAttachment,
);

export default router;
