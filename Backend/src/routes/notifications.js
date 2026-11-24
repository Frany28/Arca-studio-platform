import { Router } from "express";

import { getNotifications, patchNotificationRead } from "../controllers/notificationController.js";
import { requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { notificationListSchema, notificationReadSchema } from "../validation/notificationSchemas.js";

// /api/notifications: notificaciones del usuario autenticado (cualquier rol). Solo lectura y marca de
// lectura de las propias; no existe una ruta para consultar las de otro usuario.
const router = Router();
router.use(requireAuth);

router.get("/", validate(notificationListSchema), getNotifications);
router.patch("/:notificationId/read", validate(notificationReadSchema), patchNotificationRead);

export default router;
