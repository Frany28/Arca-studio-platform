import { Router } from "express";

import {
  deleteFileManagerFolderHandler,
  getFileManagerItemsHandler,
  getFileManagerMetricsHandler,
  getFileManagerTreeHandler,
  patchFileManagerFolder,
  postFileManagerFile,
  postFileManagerFolder,
  searchFileManagerFoldersHandler,
} from "../controllers/fileManagerController.js";
import { uploadRateLimit } from "../middlewares/actionRateLimits.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { requireProjectFileReviewEnabled } from "../middlewares/projectFileReview.js";
import { validate } from "../middlewares/validate.js";
import {
  fileManagerFolderCreateSchema,
  fileManagerFolderDeleteSchema,
  fileManagerFolderRenameSchema,
  fileManagerFolderSearchSchema,
  fileManagerItemsSchema,
  fileManagerMetricsSchema,
  fileManagerTreeSchema,
  fileManagerUploadSchema,
  warrantyDocumentLinkSchema,
} from "../validation/fileManagerSchemas.js";
import { deleteWarrantyDocumentLink, putWarrantyDocumentLink } from "../controllers/projectWarrantyController.js";

// /api/admin/files: administrador de archivos (Fase 1.2, B7). Se monta antes de /api/admin para que,
// con la revisión apagada, responda 404 API_ROUTE_NOT_FOUND antes de autenticar, como las demás rutas
// de la fase. Solo el administrador.
const router = Router();

router.use(requireProjectFileReviewEnabled, requireAuth, requireRoles("admin"));

router.get("/metrics", validate(fileManagerMetricsSchema), getFileManagerMetricsHandler);
router.get("/tree", validate(fileManagerTreeSchema), getFileManagerTreeHandler);
router.get("/folders", validate(fileManagerFolderSearchSchema), searchFileManagerFoldersHandler);
router.get("/items", validate(fileManagerItemsSchema), getFileManagerItemsHandler);
router.post("/projects/:projectId/folders", validate(fileManagerFolderCreateSchema), postFileManagerFolder);
router.patch("/projects/:projectId/folders/:folderId", validate(fileManagerFolderRenameSchema), patchFileManagerFolder);
router.delete("/projects/:projectId/folders/:folderId", validate(fileManagerFolderDeleteSchema), deleteFileManagerFolderHandler);
// Fase 1.2 (U3): archivo nuevo dentro de una carpeta, con la v1 pendiente de revisión.
router.post("/projects/:projectId/files", uploadRateLimit, validate(fileManagerUploadSchema), postFileManagerFile);
// Fase 1.2 (B8): vínculos auditados entre garantías y documentos de «Documentos › Garantías».
router.put("/projects/:projectId/warranties/:warrantyId/documents/:fileId", validate(warrantyDocumentLinkSchema), putWarrantyDocumentLink);
router.delete("/projects/:projectId/warranties/:warrantyId/documents/:fileId", validate(warrantyDocumentLinkSchema), deleteWarrantyDocumentLink);

export default router;
