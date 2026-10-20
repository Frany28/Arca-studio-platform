import { Router } from "express";

import {
  getBaseUnits,
  getDenominationById,
  getDenominations,
  patchDenomination,
  patchDenominationStatus,
  postDenomination,
  rejectBaseUnitWrite,
  rejectDenominationDeletion,
} from "../controllers/measurementUnitController.js";
import { adminRateLimits } from "../middlewares/actionRateLimits.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  denominationCreateSchema,
  denominationDetailSchema,
  denominationListSchema,
  denominationStatusSchema,
  denominationUpdateSchema,
  measurementUnitListSchema,
} from "../validation/measurementUnitSchemas.js";

// Unidades de medida: exclusivas de administradores en la fase 1. Cada router declara su
// propia protección para seguir siendo seguro aunque se monte en otra ruta.

// /api/admin/measurement-units: catálogo de unidades base, solo lectura.
export const measurementUnitRouter = Router();
measurementUnitRouter.use(requireAuth, requireRoles("admin"));
measurementUnitRouter.get("/", validate(measurementUnitListSchema), getBaseUnits);
measurementUnitRouter.all(["/", "/:measurementUnitId"], rejectBaseUnitWrite);

// /api/admin/measurement-unit-denominations: denominaciones personalizadas.
export const measurementUnitDenominationRouter = Router();
measurementUnitDenominationRouter.use(requireAuth, requireRoles("admin"));
measurementUnitDenominationRouter.get("/", validate(denominationListSchema), getDenominations);
measurementUnitDenominationRouter.post("/", adminRateLimits.measurementUnitWrite, validate(denominationCreateSchema), postDenomination);
measurementUnitDenominationRouter.get("/:denominationId", validate(denominationDetailSchema), getDenominationById);
measurementUnitDenominationRouter.patch("/:denominationId", adminRateLimits.measurementUnitWrite, validate(denominationUpdateSchema), patchDenomination);
measurementUnitDenominationRouter.patch("/:denominationId/status", adminRateLimits.measurementUnitWrite, validate(denominationStatusSchema), patchDenominationStatus);
measurementUnitDenominationRouter.delete("/:denominationId", rejectDenominationDeletion);
