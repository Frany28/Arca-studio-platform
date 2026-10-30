import { Router } from "express";

import {
  getQuoteById,
  getQuoteClientProjects,
  getQuoteClients,
  getQuotePdfDocument,
  getQuotes,
  getQuotesSummary,
  patchQuote,
  postQuote,
} from "../controllers/quoteController.js";
import { adminRateLimits } from "../middlewares/actionRateLimits.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  quoteClientOptionsSchema,
  quoteCreateSchema,
  quoteDetailSchema,
  quoteListSchema,
  quotePdfSchema,
  quoteProjectOptionsSchema,
  quoteUpdateSchema,
} from "../validation/quoteSchemas.js";

// Cotizaciones administrativas (/api/admin/quotes), exclusivas de administradores como el resto
// del módulo Servicios y cotizaciones. Las rutas fijas (summary, clients) se declaran antes de
// /:quoteId. No existe eliminación: las cotizaciones se conservan con su historial de versiones.
const router = Router();
router.use(requireAuth, requireRoles("admin"));

router.get("/", validate(quoteListSchema), getQuotes);
router.post("/", adminRateLimits.quoteWrite, validate(quoteCreateSchema), postQuote);
router.get("/summary", getQuotesSummary);
router.get("/clients", validate(quoteClientOptionsSchema), getQuoteClients);
router.get("/clients/:clientId/projects", validate(quoteProjectOptionsSchema), getQuoteClientProjects);
router.get("/:quoteId", validate(quoteDetailSchema), getQuoteById);
router.patch("/:quoteId", adminRateLimits.quoteWrite, validate(quoteUpdateSchema), patchQuote);
router.get("/:quoteId/pdf", adminRateLimits.quotePdf, validate(quotePdfSchema), getQuotePdfDocument);

export default router;
