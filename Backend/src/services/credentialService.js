import bcrypt from "bcrypt";

import { AppError } from "../errors/appError.js";
import { findUserByEmail } from "../repositories/userRepository.js";

// Rol exigido por las rutas administrativas del catálogo (requireRoles("admin")).
const ADMIN_ROLE_CODE = "admin";

// Hash bcrypt de una contraseña inexistente: un correo desconocido cuesta lo mismo que uno
// registrado, de modo que el tiempo de respuesta no revela qué cuentas existen.
const FAKE_BCRYPT_HASH =
  "$2a$10$rN2S9IoJgP1Fx41s6fWaIOY6PksHh4EYoJ.13YZRbrxIJpV66F79i";

/**
 * Comprueba un correo y una contraseña contra PostgreSQL con el mismo criterio que el inicio de
 * sesión: bcrypt también para correos desconocidos y la cuenta debe estar activa. No crea
 * sesiones ni registra el acceso; eso corresponde a quien llama.
 *
 * @param {object} credentials - Credenciales recibidas.
 * @param {string} credentials.email - Correo ya normalizado (sin espacios y en minúsculas).
 * @param {string} credentials.password - Contraseña en claro.
 * @returns {Promise<{ status: "invalid"|"inactive"|"valid", userRecord: object|null }>} Resultado y
 *   fila del usuario (solo cuando la contraseña coincide).
 */
export async function verifyUserCredentials({ email, password }) {
  const userRecord = await findUserByEmail(email);
  const passwordMatches = await bcrypt.compare(password, userRecord?.password_hash || FAKE_BCRYPT_HASH);
  if (!userRecord || !passwordMatches) return { status: "invalid", userRecord: null };
  if (userRecord.status !== "active") return { status: "inactive", userRecord };
  return { status: "valid", userRecord };
}

/**
 * Identifica a quien ejecuta un comando de mantenimiento con sus propias credenciales y exige el
 * mismo rol que las rutas administrativas del catálogo. No crea sesión: las operaciones quedan a
 * nombre de esa cuenta, sin suplantar a ningún otro usuario.
 *
 * @param {object} credentials - Credenciales de la persona que ejecuta el comando.
 * @param {string} credentials.email - Correo de su cuenta administrativa.
 * @param {string} credentials.password - Su contraseña.
 * @returns {Promise<{ id: number, email: string, name: string }>} Administrador autenticado.
 * @throws {AppError} MAINTENANCE_INVALID_CREDENTIALS (401), MAINTENANCE_ACCOUNT_NOT_ACTIVE (409) o
 *   MAINTENANCE_FORBIDDEN (403) si la cuenta no es administradora.
 */
export async function authenticateMaintenanceAdmin({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const { status, userRecord } = await verifyUserCredentials({ email: normalizedEmail, password: String(password || "") });
  if (status === "invalid") {
    throw new AppError({ code: "MAINTENANCE_INVALID_CREDENTIALS", message: "Correo o contraseña inválidos.", status: 401 });
  }
  if (status === "inactive") {
    throw new AppError({ code: "MAINTENANCE_ACCOUNT_NOT_ACTIVE", message: "La cuenta no está activa.", status: 409 });
  }
  if (userRecord.role_code !== ADMIN_ROLE_CODE) {
    throw new AppError({ code: "MAINTENANCE_FORBIDDEN", message: "La cuenta no tiene el rol de administrador.", status: 403 });
  }
  return {
    email: userRecord.email,
    id: Number(userRecord.id),
    name: `${userRecord.first_name} ${userRecord.last_name}`.trim(),
  };
}
