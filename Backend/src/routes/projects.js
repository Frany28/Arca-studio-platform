import { Router } from "express";

import {
  getProjectDetail,
  getMyProjects,
  streamAssignedArchitectProfilePhoto,
  updateProjectPublication,
} from "../controllers/projectController.js";
import {
  deleteProjectAttachment,
  streamProjectFile,
  uploadProjectAttachment,
} from "../controllers/fileController.js";
import {
  createProjectComment,
  getProjectComments,
  getProjectDocumentComments,
  streamProjectCommentAuthorProfilePhoto,
  streamProjectCommentEvents,
} from "../controllers/projectCommentController.js";
import {
  getProjectFileVersions,
  postProjectFileVersion,
  postProjectFileVersionApproval,
  postProjectFileVersionRejection,
  postProjectFileVersionRestore,
} from "../controllers/projectFileVersionController.js";
import { requireAuth, requirePermissions, requireRoles } from "../middlewares/auth.js";
import { requireProjectFileReviewEnabled } from "../middlewares/projectFileReview.js";
import {
  deleteProjectFileAudience,
  getProjectFileAudienceState,
  putProjectFileAudience,
} from "../controllers/projectFileAudienceController.js";
import {
  projectFileAudienceGrantSchema,
  projectFileAudienceListSchema,
  projectFileAudienceRevokeSchema,
  projectFileVersionApproveSchema,
  projectFileVersionListSchema,
  projectFileVersionRejectSchema,
  projectFileVersionRestoreSchema,
  projectFileVersionUploadSchema,
} from "../validation/projectFileVersionSchemas.js";
import { commentRateLimit, uploadRateLimit } from "../middlewares/actionRateLimits.js";
import { validate } from "../middlewares/validate.js";
import {
  commentSchema,
  documentCommentsSchema,
  paginationSchema,
  projectListSchema,
  projectDetailSchema,
  projectFileContentSchema,
  projectCommentAuthorPhotoSchema,
  projectIdSchema,
} from "../validation/schemas.js";

const router = Router();

router.get("/", requireAuth, requirePermissions("projects.read"), validate(projectListSchema), getMyProjects);
router.get(
  "/:projectId/assigned-architect/profile-photo",
  requireAuth,
  validate(projectIdSchema),
  streamAssignedArchitectProfilePhoto,
);
router.get(
  "/:projectId",
  requireAuth,
  requirePermissions("projects.read"),
  validate(projectDetailSchema),
  getProjectDetail,
);
router.get("/:projectId/comments", requireAuth, validate(paginationSchema), getProjectComments);
router.get(
  "/:projectId/files/:fileId/comments",
  requireAuth,
  validate(documentCommentsSchema),
  getProjectDocumentComments,
);
router.get(
  "/:projectId/comment-authors/:userId/profile-photo",
  requireAuth,
  validate(projectCommentAuthorPhotoSchema),
  streamProjectCommentAuthorProfilePhoto,
);
router.get("/:projectId/events", requireAuth, streamProjectCommentEvents);
router.post("/:projectId/comments", requireAuth, commentRateLimit, validate(commentSchema), createProjectComment);
router.post(
  "/:projectId/files",
  requireAuth,
  requirePermissions("projects.files.upload"),
  uploadRateLimit,
  uploadProjectAttachment,
);
router.delete(
  "/:projectId/files/:fileId",
  requireAuth,
  requirePermissions("projects.files.delete"),
  deleteProjectAttachment,
);
router.get(
  "/:projectId/files/:fileId/content",
  requireAuth,
  requirePermissions("projects.read"),
  validate(projectFileContentSchema),
  streamProjectFile,
);
// Versiones y revisión (Fase 1.2, B4). Con la activación coordinada apagada responden 404 antes de
// autenticar, como una ruta inexistente. Aprobar y rechazar: solo el administrador.
router.get(
  "/:projectId/files/:fileId/versions",
  requireProjectFileReviewEnabled,
  requireAuth,
  requirePermissions("projects.read"),
  validate(projectFileVersionListSchema),
  getProjectFileVersions,
);
router.post(
  "/:projectId/files/:fileId/versions",
  requireProjectFileReviewEnabled,
  requireAuth,
  requirePermissions("projects.files.upload"),
  uploadRateLimit,
  validate(projectFileVersionUploadSchema),
  postProjectFileVersion,
);
router.post(
  "/:projectId/files/:fileId/versions/:versionId/restore",
  requireProjectFileReviewEnabled,
  requireAuth,
  requirePermissions("projects.files.upload"),
  validate(projectFileVersionRestoreSchema),
  postProjectFileVersionRestore,
);
router.post(
  "/:projectId/files/:fileId/versions/:versionId/approve",
  requireProjectFileReviewEnabled,
  requireAuth,
  requireRoles("admin"),
  validate(projectFileVersionApproveSchema),
  postProjectFileVersionApproval,
);
router.post(
  "/:projectId/files/:fileId/versions/:versionId/reject",
  requireProjectFileReviewEnabled,
  requireAuth,
  requireRoles("admin"),
  validate(projectFileVersionRejectSchema),
  postProjectFileVersionRejection,
);
// Audiencias (Fase 1.2, B5): solo el administrador comparte con el cliente y autoriza el escaparate.
router.get(
  "/:projectId/files/:fileId/audiences",
  requireProjectFileReviewEnabled,
  requireAuth,
  requireRoles("admin"),
  validate(projectFileAudienceListSchema),
  getProjectFileAudienceState,
);
router.put(
  "/:projectId/files/:fileId/audiences/:audience",
  requireProjectFileReviewEnabled,
  requireAuth,
  requireRoles("admin"),
  validate(projectFileAudienceGrantSchema),
  putProjectFileAudience,
);
router.delete(
  "/:projectId/files/:fileId/audiences/:audience",
  requireProjectFileReviewEnabled,
  requireAuth,
  requireRoles("admin"),
  validate(projectFileAudienceRevokeSchema),
  deleteProjectFileAudience,
);
router.patch(
  "/:projectId/publication",
  requireAuth,
  requirePermissions("projects.publish"),
  updateProjectPublication,
);

export default router;
