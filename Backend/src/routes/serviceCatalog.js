import { Router } from "express";

import {
  getServiceById,
  getServices,
  patchService,
  patchServiceStatus,
  postService,
  rejectServiceDeletion,
} from "../controllers/serviceCatalogController.js";
import { adminRateLimits } from "../middlewares/actionRateLimits.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  serviceCreateSchema,
  serviceDetailSchema,
  serviceListSchema,
  serviceStatusSchema,
  serviceUpdateSchema,
} from "../validation/serviceCatalogSchemas.js";

// Catálogo administrativo de servicios (/api/admin/services). Exclusivo de administradores
// en la fase 1: la protección se declara aquí para que el router sea seguro aunque se monte
// en otra ruta. Las escrituras comparten un límite por administrador.
const router = Router();
router.use(requireAuth, requireRoles("admin"));

router.get("/", validate(serviceListSchema), getServices);
router.post("/", adminRateLimits.serviceCatalogWrite, validate(serviceCreateSchema), postService);
router.get("/:serviceId", validate(serviceDetailSchema), getServiceById);
router.patch("/:serviceId", adminRateLimits.serviceCatalogWrite, validate(serviceUpdateSchema), patchService);
router.patch("/:serviceId/status", adminRateLimits.serviceCatalogWrite, validate(serviceStatusSchema), patchServiceStatus);
router.delete("/:serviceId", rejectServiceDeletion);

export default router;
