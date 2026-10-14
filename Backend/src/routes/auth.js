import { Router } from "express";

import {
  changePassword,
  forgotPassword,
  getProfilePhotoImage,
  login,
  logout,
  me,
  resetPassword,
  uploadProfilePhoto,
  verifyResetToken,
} from "../controllers/authController.js";
import { requireAuth } from "../middlewares/auth.js";
import { authRateLimits } from "../middlewares/authRateLimit.js";
import { validate } from "../middlewares/validate.js";
import { loginSchema } from "../validation/schemas.js";
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
router.post("/registration/start", authRateLimits.registration, validate(startRegistrationSchema), startRegistration);
router.post("/registration/resend", authRateLimits.registration, validate(resendRegistrationSchema), resendRegistration);
router.post("/registration/verify", authRateLimits.registration, validate(verifyRegistrationSchema), verifyRegistration);
router.post("/registration/complete", authRateLimits.registration, validate(completeRegistrationSchema), completeRegistration);
router.post("/forgot-password", authRateLimits.passwordReset, forgotPassword);
router.post("/verify-reset-token", authRateLimits.passwordReset, verifyResetToken);
router.post("/reset-password", authRateLimits.passwordReset, resetPassword);
router.post("/change-password", requireAuth, authRateLimits.changePassword, changePassword);
router.get("/profile-photo/image", requireAuth, getProfilePhotoImage);
router.post(
  "/profile-photo",
  requireAuth,
  uploadProfilePhoto,
);
router.get("/me", requireAuth, me);
router.post("/logout", logout);

export default router;
