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
import {
  getAdminProjectRequest,
  patchProjectRequestDecision,
} from "../controllers/projectRequestWorkflowController.js";
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
import { postAdminUserActivationLink } from "../controllers/accountActivationController.js";
import {
  getAdminProjectRequestForm,
  putAdminProjectRequestForm,
} from "../controllers/projectRequestAdminEditController.js";
import {
  deleteProjectFolderById,
  getConfiguration,
  getConfigurationFiles,
  postDraftProject,
  patchProjectFileFolder,
  patchProjectFolder,
  postConfigurationFile,
  postFinalizeConfiguration,
  postFirstContact,
  postProjectFolder,
  putGeneralConfiguration,
  putTrackingConfiguration,
  putWarrantiesConfiguration,
} from "../controllers/projectConfigurationController.js";
import {
  projectConfigurationParamsSchema,
  projectConfigurationUploadSchema,
  projectDraftCreateSchema,
  projectFileMoveSchema,
  projectFolderCreateSchema,
  projectFolderDeleteSchema,
  projectFolderUpdateSchema,
  projectGeneralConfigurationSchema,
  projectRequestFirstContactSchema,
  projectTrackingConfigurationSchema,
  projectWarrantiesConfigurationSchema,
} from "../validation/projectConfigurationSchemas.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { adminRateLimits, requestRateLimit, uploadRateLimit } from "../middlewares/actionRateLimits.js";
import { validate } from "../middlewares/validate.js";
import { adminUserActivationLinkSchema } from "../validation/schemas.js";
import {
  adminAssigneePhotoSchema,
  adminProjectBulkActionSchema,
  projectAssigneesSchema,
  projectRequestAssigneesSchema,
} from "../validation/adminDashboardSchemas.js";
import { adminUpdateProjectRequestSchema, projectRequestIdSchema } from "../validation/projectRequestSchemas.js";
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
  "/users/:userId/activation-link",
  adminRateLimits.userActivationLink,
  validate(adminUserActivationLinkSchema),
  postAdminUserActivationLink,
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
// Configuración de proyectos draft (Figma «Nuevo Proyecto»): lectura de cualquier estado; las
// escrituras exigen draft y «finalize» es la única transición draft → pending.
router.post("/projects/drafts", validate(projectDraftCreateSchema), postDraftProject);
router.get("/projects/:projectId/configuration", validate(projectConfigurationParamsSchema), getConfiguration);
router.put("/projects/:projectId/configuration/general", validate(projectGeneralConfigurationSchema), putGeneralConfiguration);
router.put("/projects/:projectId/configuration/tracking", validate(projectTrackingConfigurationSchema), putTrackingConfiguration);
router.put("/projects/:projectId/configuration/warranties", validate(projectWarrantiesConfigurationSchema), putWarrantiesConfiguration);
router.post("/projects/:projectId/configuration/finalize", validate(projectConfigurationParamsSchema), postFinalizeConfiguration);
router.get("/projects/:projectId/configuration/files", validate(projectConfigurationParamsSchema), getConfigurationFiles);
router.post("/projects/:projectId/configuration/files", uploadRateLimit, validate(projectConfigurationUploadSchema), postConfigurationFile);
router.patch("/projects/:projectId/configuration/files/:fileId", validate(projectFileMoveSchema), patchProjectFileFolder);
router.post("/projects/:projectId/configuration/folders", validate(projectFolderCreateSchema), postProjectFolder);
router.patch("/projects/:projectId/configuration/folders/:folderId", validate(projectFolderUpdateSchema), patchProjectFolder);
router.delete("/projects/:projectId/configuration/folders/:folderId", validate(projectFolderDeleteSchema), deleteProjectFolderById);
router.post("/project-requests/:projectRequestId/first-contact", validate(projectRequestFirstContactSchema), postFirstContact);
router.get("/project-requests/:projectRequestId", validate(projectRequestIdSchema), getAdminProjectRequest);
// Edición administrativa de las respuestas (formulario «Editar solicitud»); nunca decide ni cambia el estado.
router.get("/project-requests/:projectRequestId/form", validate(projectRequestIdSchema), getAdminProjectRequestForm);
router.put(
  "/project-requests/:projectRequestId/form",
  requestRateLimit,
  validate(adminUpdateProjectRequestSchema),
  putAdminProjectRequestForm,
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
