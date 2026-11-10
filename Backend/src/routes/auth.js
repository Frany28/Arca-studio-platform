import { Router } from "express";

import {
  changePassword,
  forgotPassword,
  getProfilePhotoImage,
  login,
  logout,
  me,
  resetPassword,
  revokeOtherSessions,
  uploadProfilePhoto,
  verifyResetToken,
} from "../controllers/authController.js";
import { requireAuth } from "../middlewares/auth.js";
import { ownSessionRevokeRateLimit } from "../middlewares/actionRateLimits.js";
import { authRateLimits, emailRateLimits } from "../middlewares/authRateLimit.js";
import { validate } from "../middlewares/validate.js";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  verifyResetTokenSchema,
} from "../validation/schemas.js";
import {
  completeRegistrationSchema,
  resendRegistrationSchema,
  startRegistrationSchema,
  verifyRegistrationSchema,
} from "../validation/registrationSchemas.js";
import {
  completeRegistration,
  resendRegistration,
  startRegistration,
  verifyRegistration,
} from "../controllers/registrationController.js";
import { preventAuthResponseCaching } from "../utils/authCookies.js";

const router = Router();

router.use((_req, res, next) => {
  preventAuthResponseCaching(res);
  next();
});

router.post("/login", authRateLimits.login, validate(loginSchema), login);
router.post("/registration/start", authRateLimits.registration, validate(startRegistrationSchema), emailRateLimits.registration, startRegistration);
router.post("/registration/resend", authRateLimits.registration, validate(resendRegistrationSchema), emailRateLimits.registration, resendRegistration);
router.post("/registration/verify", authRateLimits.registration, validate(verifyRegistrationSchema), verifyRegistration);
router.post("/registration/complete", authRateLimits.registration, validate(completeRegistrationSchema), completeRegistration);
// La validación de tipo va antes del límite por destinatario (mismo orden que registro): un correo
// no textual no genera clave de límite y no debe llegar al envío de correo.
router.post("/forgot-password", authRateLimits.passwordReset, validate(forgotPasswordSchema), emailRateLimits.passwordReset, forgotPassword);
router.post("/verify-reset-token", authRateLimits.passwordReset, validate(verifyResetTokenSchema), verifyResetToken);
router.post("/reset-password", authRateLimits.passwordReset, validate(resetPasswordSchema), resetPassword);
router.post("/change-password", requireAuth, authRateLimits.changePassword, changePassword);
router.get("/profile-photo/image", requireAuth, getProfilePhotoImage);
router.post(
  "/profile-photo",
  requireAuth,
  uploadProfilePhoto,
);
router.get("/me", requireAuth, me);
router.post("/logout", logout);
router.post("/sessions/revoke-others", requireAuth, ownSessionRevokeRateLimit, revokeOtherSessions);

export default router;
