import { Router } from "express";

import {
  getAdminAssignees,
  getDashboardMetrics,
  getDashboardOverview,
  updateProjectAssignees,
  updateAdminProjects,
  updateProjectRequestAssignees,
  streamAdminAssigneeProfilePhoto,
} from "../controllers/adminDashboardController.js";
import { patchProjectRequestDecision } from "../controllers/projectRequestWorkflowController.js";
import {
  getPermissions,
  getRolePermissionMatrix,
  getRolePermissions,
  getRoles,
  updateRolePermissions,
} from "../controllers/rolePermissionController.js";
import {
  archiveAdminUserNoteById,
  archiveAdminUserNoteByLegacyDelete,
  getAdminUsers,
  getAdminUser,
  getAdminUserNotes,
  patchAdminUser,
  patchAdminUserNote,
  patchAdminUserStatus,
  postAdminUser,
  postAdminUserSessionRevocation,
  postAdminUserNote,
  streamAdminUserProfilePhoto,
} from "../controllers/adminUserController.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { adminRateLimits } from "../middlewares/actionRateLimits.js";
import { validate } from "../middlewares/validate.js";
import {
  adminAssigneePhotoSchema,
  adminProjectBulkActionSchema,
  projectAssigneesSchema,
  projectRequestAssigneesSchema,
} from "../validation/adminDashboardSchemas.js";
import { projectRequestDecisionSchema } from "../validation/projectRequestWorkflowSchemas.js";
import {
  adminUserCreateSchema,
  adminUserDetailSchema,
  adminUserListSchema,
  adminUserNoteCreateSchema,
  adminUserNoteArchiveSchema,
  adminUserNoteDeleteSchema,
  adminUserNoteListSchema,
  adminUserNoteUpdateSchema,
  adminUserPhotoSchema,
  adminUserSessionRevokeSchema,
  adminUserStatusSchema,
  adminUserUpdateSchema,
} from "../validation/adminUserSchemas.js";

const router = Router();
router.use(requireAuth, requireRoles("admin"));

router.get("/dashboard-metrics", getDashboardMetrics);
router.get("/dashboard-overview", getDashboardOverview);
router.get("/assignees", getAdminAssignees);
router.get("/users", validate(adminUserListSchema), getAdminUsers);
router.get("/users/:userId", validate(adminUserDetailSchema), getAdminUser);
router.get("/users/:userId/notes", validate(adminUserNoteListSchema), getAdminUserNotes);
router.post(
  "/users/:userId/notes",
  adminRateLimits.userNote,
  validate(adminUserNoteCreateSchema),
  postAdminUserNote,
);
router.patch(
  "/users/:userId",
  adminRateLimits.userStatus,
  validate(adminUserUpdateSchema),
  patchAdminUser,
);
router.patch(
  "/users/:userId/notes/:noteId",
  adminRateLimits.userNote,
  validate(adminUserNoteUpdateSchema),
  patchAdminUserNote,
);
router.patch(
  "/users/:userId/notes/:noteId/archive",
  adminRateLimits.userNote,
  validate(adminUserNoteArchiveSchema),
  archiveAdminUserNoteById,
);
router.delete(
  "/users/:userId/notes/:noteId",
  adminRateLimits.userNote,
  validate(adminUserNoteDeleteSchema),
  archiveAdminUserNoteByLegacyDelete,
);
router.get(
  "/users/:userId/profile-photo",
  validate(adminUserPhotoSchema),
  streamAdminUserProfilePhoto,
);
router.post(
  "/users",
  adminRateLimits.userCreate,
  validate(adminUserCreateSchema),
  postAdminUser,
);
router.patch(
  "/users/:userId/status",
  adminRateLimits.userStatus,
  validate(adminUserStatusSchema),
  patchAdminUserStatus,
);
router.post(
  "/users/:userId/sessions/revoke",
  adminRateLimits.userSessionRevoke,
  validate(adminUserSessionRevokeSchema),
  postAdminUserSessionRevocation,
);
router.get(
  "/assignees/:userId/profile-photo",
  validate(adminAssigneePhotoSchema),
  streamAdminAssigneeProfilePhoto,
);
router.put(
  "/projects/:projectId/assignees",
  validate(projectAssigneesSchema),
  updateProjectAssignees,
);
router.patch(
  "/projects/bulk-action",
  adminRateLimits.projectBulkAction,
  validate(adminProjectBulkActionSchema),
  updateAdminProjects,
);
router.put(
  "/project-requests/:projectRequestId/assignees",
  validate(projectRequestAssigneesSchema),
  updateProjectRequestAssignees,
);
router.patch(
  "/project-requests/:projectRequestId/decision",
  adminRateLimits.projectRequestDecision,
  validate(projectRequestDecisionSchema),
  patchProjectRequestDecision,
);
router.get("/roles", getRoles);
router.get("/permissions", getPermissions);
router.get("/roles-permissions", getRolePermissionMatrix);
router.get("/roles/:roleCode/permissions", getRolePermissions);
router.put("/roles/:roleCode/permissions", updateRolePermissions);

export default router;
