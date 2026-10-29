import bcrypt from "bcrypt";

import { authConfig } from "../config/auth.js";
import {
  buildStorageFileUrl,
  buildUserProfilePhotoObjectKey,
  getStorageObjectKeyFromFileUrl,
  getSupabaseStorageConfig,
} from "../config/storage.js";
import { objectStorage } from "../services/objectStorage.js";
import {
  findUserByEmail,
  findActiveUserById,
  findActiveUserCredentialsById,
  sanitizeUser,
  toPublicUser,
  updateLastLoginAt,
  updateUserProfilePhotoUrl,
} from "../repositories/userRepository.js";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  findValidPasswordResetToken,
} from "../repositories/passwordResetRepository.js";
import {
  createPasswordResetPayload,
  hashPasswordResetToken,
  sendPasswordResetEmail,
} from "../services/passwordResetEmailService.js";
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  preventAuthResponseCaching,
} from "../utils/authCookies.js";
import { verifyAuthToken } from "../utils/tokens.js";
import {
  changePasswordAndRotateSession,
  issueUserSession,
  resetPasswordAndRevokeSessions,
  revokeCurrentSession,
  revokeOtherUserSessions,
  scheduleExpiredSessionCleanup,
} from "../services/sessionService.js";
import { prepareUpload, uploadPolicies } from "../services/fileUploadService.js";
import { verifyUserCredentials } from "../services/credentialService.js";

const PASSWORD_RESET_ACCEPTED_RESPONSE = {
  message: "Si el correo está registrado, enviaremos un enlace de recuperación.",
};

/**
 * Obtiene el tipo MIME permitido para la foto de perfil para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function getProfilePhotoContentType(value) {
  const contentType = String(value || "").split(";")[0].trim().toLowerCase();

  return uploadPolicies.avatar.types.has(contentType)
    ? contentType
    : "image/jpeg";
}

/**
 * Determina si el valor de valid correo cumple la condición esperada.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {string} email - Valor de `email` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Determina si el valor de valid contraseña cumple la condición esperada.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {string} password - Valor de `password` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function isValidPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

/**
 * Interpreta el token de restablecimiento y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {string} token - Valor de `token` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function parseResetToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const payload = verifyAuthToken(token, {
    secret: authConfig.tokenSecret,
  });

  if (
    !payload ||
    payload.purpose !== "password_reset" ||
    !payload.sub ||
    Number.isNaN(Number(payload.sub))
  ) {
    return null;
  }

  return {
    userId: Number(payload.sub),
    email: payload.email,
    tokenHash: hashPasswordResetToken(token),
  };
}

/**
 * Procesa el valor de login para completar la responsabilidad asignada al módulo.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function login(req, res, next) {
  try {
    preventAuthResponseCaching(res);
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!isValidEmail(email) || password.length < 8 || password.length > 256) {
      res.status(400).json({
        code: "INVALID_CREDENTIALS",
        message: "Correo o contraseña invalidos.",
      });
      return;
    }

    const { status, userRecord } = await verifyUserCredentials({ email, password });

    if (status === "invalid") {
      res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: "Correo o contraseña invalidos.",
      });
      return;
    }

    if (status === "inactive") {
      res.status(409).json({
        code: "ACCOUNT_NOT_ACTIVE",
        message: "La cuenta no esta activa. Contacta a soporte.",
      });
      return;
    }

    // Cada inicio de sesión crea una sesión independiente (B-3): ya no invalida las de otros
    // dispositivos aunque el trigger de `users` actualice `updated_at` al registrar el acceso.
    const { token } = await issueUserSession(userRecord.id);
    await updateLastLoginAt(userRecord.id);
    scheduleExpiredSessionCleanup();

    const safeUser = sanitizeUser({
      ...userRecord,
      last_login_at: new Date().toISOString(),
    });

    res.setHeader(
      "Set-Cookie",
      buildSessionCookie(token, authConfig.tokenExpiresInSeconds),
    );
    res.status(200).json({
      user: toPublicUser(safeUser),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve la operación me como respuesta HTTP para la sesión actual.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @returns {void} Finalización de la operación.
 */
export function me(req, res) {
  preventAuthResponseCaching(res);
  res.status(200).json({
    user: toPublicUser(req.user),
  });
}

/**
 * Cierra la sesión actual: revoca su `sid` en PostgreSQL y expira la cookie. Las demás sesiones
 * del usuario siguen activas. La cookie se expira antes de revocar para que el navegador la
 * descarte aunque la revocación falle; en ese caso el error se propaga y no se informa éxito.
 *
 * @param {import("express").Request} req - Solicitud con la sesión resuelta por `loadSession`.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function logout(req, res, next) {
  try {
    preventAuthResponseCaching(res);
    res.setHeader("Set-Cookie", buildExpiredSessionCookie());

    if (req.session?.isAuthenticated && req.session.payload?.sid) {
      await revokeCurrentSession(req.session.payload.sid);
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * Revoca todas las sesiones del usuario autenticado excepto la actual (otros dispositivos).
 * La sesión desde la que se solicita conserva el acceso y su cookie no cambia.
 *
 * @param {import("express").Request} req - Solicitud autenticada.
 * @param {import("express").Response} res - Respuesta con el número de sesiones revocadas.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function revokeOtherSessions(req, res, next) {
  try {
    const revokedCount = await revokeOtherUserSessions({
      currentSessionId: req.session.payload.sid,
      userId: req.user.id,
    });

    res.status(200).json({ revokedCount });
  } catch (error) {
    next(error);
  }
}

/**
 * Cambia la contraseña tras verificar la actual, revoca todas las sesiones del usuario y emite
 * una cookie con una sesión nueva: solo el dispositivo que hizo el cambio conserva el acceso.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function changePassword(req, res, next) {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (
      !currentPassword ||
      currentPassword.length > 256 ||
      !isValidPassword(newPassword) ||
      newPassword.length > 256
    ) {
      res.status(400).json({
        code: "INVALID_PASSWORD",
        message:
          "La nueva contraseña debe tener al menos 8 caracteres, incluir una mayúscula, un número y un carácter especial.",
      });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({
        code: "PASSWORD_UNCHANGED",
        message: "La nueva contraseña debe ser diferente a la actual.",
      });
      return;
    }

    const credentials = await findActiveUserCredentialsById(req.user.id);
    const currentPasswordMatches =
      typeof credentials?.password_hash === "string" &&
      (await bcrypt.compare(currentPassword, credentials.password_hash));

    if (!currentPasswordMatches) {
      res.status(401).json({
        code: "CURRENT_PASSWORD_INCORRECT",
        message: "La contraseña actual es incorrecta.",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // Revoca todas las sesiones (también la actual) y emite una nueva en la misma transacción.
    const rotatedSession = await changePasswordAndRotateSession({
      passwordHash,
      userId: req.user.id,
    });

    if (!rotatedSession) {
      res.setHeader("Set-Cookie", buildExpiredSessionCookie());
      res.status(401).json({
        code: "UNAUTHENTICATED",
        message: "Sesión requerida.",
      });
      return;
    }

    res.setHeader(
      "Set-Cookie",
      buildSessionCookie(rotatedSession.token, authConfig.tokenExpiresInSeconds),
    );
    res.status(200).json({
      message: "Tu contraseña ha sido actualizada con éxito.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Carga el valor de perfil foto coordinando la persistencia y el almacenamiento.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function uploadProfilePhoto(req, res, next) {
  let uploadedStorageKey = null;

  try {
    const { body: fileStream, contentType, originalName, size: fileSize } = prepareUpload(req, uploadPolicies.avatar, { fallbackName: "avatar.jpg" });

    const storageConfig = getSupabaseStorageConfig();

    if (!storageConfig.bucket) {
      throw new Error("SUPABASE_STORAGE_BUCKET is required");
    }

    const uploadedAt = new Date();
    const storageKey = buildUserProfilePhotoObjectKey({
      originalName,
      uploadedAt,
      userId: req.user.id,
    });
    const fileUrl = buildStorageFileUrl(storageKey);
    const previousStorageKey = getStorageObjectKeyFromFileUrl(
      req.user.profilePhotoUrl,
    );
    const previousProfilePhotoPrefix = `users/${req.user.id}/profile-photo/`;
    await objectStorage.put({
        body: fileStream,
        contentLength: fileSize,
        contentType,
        key: storageKey,
        metadata: {
          belongs_to: "user_profile_photo",
          uploaded_by: String(req.user.id),
          uploaded_year: String(uploadedAt.getUTCFullYear()),
          user_id: String(req.user.id),
        },
    });
    uploadedStorageKey = storageKey;

    const user = await updateUserProfilePhotoUrl(req.user.id, fileUrl);

    if (!user) {
      await objectStorage.delete(storageKey).catch(() => {});
      uploadedStorageKey = null;
      res.status(404).json({
        code: "USER_NOT_FOUND",
        message: "No encontramos un usuario activo para actualizar.",
      });
      return;
    }

    // La foto no es un cambio de seguridad: la sesión actual y las de otros dispositivos se
    // conservan, por lo que no se reemite la cookie (B-3).
    if (
      previousStorageKey?.startsWith(previousProfilePhotoPrefix) &&
      previousStorageKey !== storageKey
    ) {
      await objectStorage.delete(previousStorageKey).catch(() => {});
    }

    res.status(200).json({
      user: toPublicUser(user),
    });
    uploadedStorageKey = null;
  } catch (error) {
    if (uploadedStorageKey) {
      try {
        await objectStorage.delete(uploadedStorageKey);
      } catch {
        // Preserve the original failure.
      }
    }

    next(error);
  }
}

/**
 * Obtiene el valor de perfil foto image para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getProfilePhotoImage(req, res, next) {
  try {
    // Helmet defaults this header to same-origin. The authenticated image route
    // must also be embeddable when the frontend and API use different origins.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    const storageKey = getStorageObjectKeyFromFileUrl(req.user?.profilePhotoUrl);

    if (!storageKey) {
      res.status(404).json({
        code: "PROFILE_PHOTO_NOT_FOUND",
        message: "El usuario no tiene una foto de perfil cargada.",
      });
      return;
    }

    const object = await objectStorage.get(storageKey);
    res.status(200);
    res.setHeader(
      "Content-Type",
      getProfilePhotoContentType(object.ContentType),
    );
    res.setHeader("Cache-Control", "private, no-store");
    if (object.ContentLength !== undefined) res.setHeader("Content-Length", String(object.ContentLength));
    object.Body.on?.("error", next);
    object.Body.pipe(res);
  } catch (error) {
    if (
      error?.name === "NoSuchKey" ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      res.status(404).json({
        code: "PROFILE_PHOTO_NOT_FOUND",
        message: "No se pudo encontrar la foto de perfil.",
      });
      return;
    }

    next(error);
  }
}

/**
 * Procesa el valor de forgot contraseña para completar la responsabilidad asignada al módulo.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function forgotPassword(req, res, next) {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    if (!isValidEmail(email)) {
      res.status(400).json({
        code: "INVALID_EMAIL",
        message: "Ingresa un correo electronico valido.",
      });
      return;
    }

    const userRecord = await findUserByEmail(email);

    if (!userRecord || userRecord.status !== "active") {
      res.status(202).json(PASSWORD_RESET_ACCEPTED_RESPONSE);
      return;
    }

    const resetPayload = createPasswordResetPayload(userRecord);
    await createPasswordResetToken(
      userRecord.id,
      resetPayload.tokenHash,
      resetPayload.expiresAt,
    );

    await sendPasswordResetEmail({
      email: userRecord.email,
      ...resetPayload,
    });

    res.status(202).json(PASSWORD_RESET_ACCEPTED_RESPONSE);
  } catch (error) {
    next(error);
  }
}

/**
 * Verifica el token de restablecimiento y rechaza valores vencidos o inconsistentes.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function verifyResetToken(req, res, next) {
  try {
    const token = String(req.body?.token || "").trim();
    const payload = parseResetToken(token);

    if (!payload) {
      res.status(400).json({
        code: "INVALID_RESET_TOKEN",
        message: "El enlace de restablecimiento no es válido o expiró.",
      });
      return;
    }

    const userRecord = await findActiveUserById(payload.userId);
    const resetRecord = userRecord
      ? await findValidPasswordResetToken(payload.userId, payload.tokenHash)
      : null;

    if (!userRecord || !resetRecord) {
      res.status(404).json({
        code: "USER_NOT_FOUND",
        message: "No encontramos un usuario válido para este enlace.",
      });
      return;
    }

    res.status(200).json({ valid: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Restablece el valor de contraseña después de validar la credencial temporal.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function resetPassword(req, res, next) {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!isValidPassword(password)) {
      res.status(400).json({
        code: "INVALID_PASSWORD",
        message:
          "La contraseña debe tener al menos 8 caracteres, incluir una mayúscula, un número y un carácter especial.",
      });
      return;
    }

    const payload = parseResetToken(token);

    if (!payload) {
      res.status(400).json({
        code: "INVALID_RESET_TOKEN",
        message: "El enlace de restablecimiento no es válido o expiró.",
      });
      return;
    }

    const userRecord = await findActiveUserById(payload.userId);
    const tokenConsumed = userRecord
      ? await consumePasswordResetToken(payload.userId, payload.tokenHash)
      : false;

    if (!userRecord || !tokenConsumed) {
      res.status(404).json({
        code: "USER_NOT_FOUND",
        message: "No encontramos un usuario válido para este enlace.",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    // Quien recupera la cuenta debe iniciar sesión de nuevo: se revocan todas las sesiones.
    await resetPasswordAndRevokeSessions({ passwordHash, userId: userRecord.id });

    res.status(200).json({
      message: "Tu contraseña ha sido actualizada con éxito.",
    });
  } catch (error) {
    next(error);
  }
}
