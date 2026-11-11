import {
  activateAccount,
  isActivationTokenValid,
  sendAccountActivationLink,
} from "../services/accountActivationService.js";

const INVALID_LINK = {
  code: "INVALID_ACTIVATION_TOKEN",
  message: "El enlace de activación no es válido, ya se usó o expiró. Solicita uno nuevo a ARCA Studio.",
};

/**
 * Envía el enlace de activación a una cuenta pendiente (solo administradores).
 * Responde 202 con el destinatario y el vencimiento del enlace.
 *
 * @param {import("express").Request} req - Solicitud con el usuario validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function postAdminUserActivationLink(req, res, next) {
  try {
    const result = await sendAccountActivationLink({ actorUserId: req.user.id, userId: Number(req.params.userId) });
    res.status(202).json({ ...result, message: "Enviamos el enlace de activación al correo de la cuenta." });
  } catch (error) {
    next(error);
  }
}

/**
 * Comprueba sin consumirlo que un enlace de activación siga vigente.
 * Responde 200 `{ valid: true }` o 400 INVALID_ACTIVATION_TOKEN, sin revelar la causa.
 *
 * @param {import("express").Request} req - Solicitud con el token validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function verifyActivationToken(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    if (!(await isActivationTokenValid(req.body.token))) {
      res.status(400).json(INVALID_LINK);
      return;
    }
    res.status(200).json({ valid: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Activa la cuenta pendiente con la contraseña elegida por su titular. No inicia sesión: la
 * persona entra después con su correo y la contraseña nueva.
 *
 * @param {import("express").Request} req - Solicitud con token y contraseña validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function completeAccountActivation(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    if (!(await activateAccount(req.body))) {
      res.status(400).json(INVALID_LINK);
      return;
    }
    res.status(200).json({ message: "Tu cuenta está activa. Ya puedes iniciar sesión." });
  } catch (error) {
    next(error);
  }
}
