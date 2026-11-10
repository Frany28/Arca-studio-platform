import { Router } from "express";

import { getAddressSuggestions } from "../controllers/geoapifyController.js";
import { addressSuggestionRateLimit } from "../middlewares/actionRateLimits.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// Cada consulta llama a Geoapify con la clave del operador: límite por usuario autenticado.
router.get("/address-suggestions", requireAuth, addressSuggestionRateLimit, getAddressSuggestions);

export default router;
