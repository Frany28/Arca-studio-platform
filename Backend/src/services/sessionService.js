import { authConfig } from "../config/auth.js";
import {
  findActiveSessionUser,
  updateUserPasswordRevokingSessions,
} from "../repositories/userRepository.js";
import {
  SESSION_REVOCATION_REASONS,
  createSession,
  deleteExpiredSessions,
  revokeSession,
  revokeUserSessions,
} from "../repositories/sessionRepository.js";
import { createAuthToken } from "../utils/tokens.js";

// Deduplicación de cargas concurrentes del mismo `sid` dentro de una instancia. No es una caché:
// la entrada desaparece al resolverse la consulta, de modo que una revocación es visible en la
// siguiente petición de cualquier instancia (B-3 elimina la ventana residual de la antigua TTL).
const inFlightSessionLoads = new Map();

/**
 * Firma el JWT de sesión para una sesión ya persistida. Solo incluye `sub` y `sid`: el rol y el
 * correo se leen de PostgreSQL en cada petición, así que copiarlos en el token solo añadiría datos
 * personales y un valor potencialmente obsoleto.
 *
 * @param {object} options - Identificadores de la sesión.
 * @param {number|string} options.userId - Usuario propietario.
 * @param {string} options.sessionId - Identificador de `user_sessions`.
 * @returns {string} JWT compacto para la cookie de sesión.
 */
function signSessionToken({ sessionId, userId }) {
  return createAuthToken(
    { sid: sessionId, sub: String(userId) },
    {
      expiresInSeconds: authConfig.tokenExpiresInSeconds,
      secret: authConfig.tokenSecret,
    },
  );
}

/**
 * Crea una sesión revocable en PostgreSQL y devuelve el JWT que la representa.
 * Admite el cliente de una transacción para emitir la sesión junto con el cambio que la origina.
 *
 * @param {number|string} userId - Usuario autenticado.
 * @param {{ query: Function }} [executor] - Cliente de transacción opcional.
 * @returns {Promise<{ sessionId: string, token: string }>} Sesión creada y su token.
 */
export async function issueUserSession(userId, executor) {
  const session = await createSession(
    { expiresInSeconds: authConfig.tokenExpiresInSeconds, userId },
    executor,
  );
  return {
    sessionId: session.id,
    token: signSessionToken({ sessionId: session.id, userId }),
  };
}

/**
 * Carga el usuario activo de una sesión vigente consultando PostgreSQL en cada petición.
 * Las peticiones simultáneas con el mismo `sid` comparten una única consulta en vuelo.
 *
 * @param {{ sid: string, sub: string }} payload - Payload de sesión ya verificado.
 * @returns {Promise<object|null>} Usuario con rol y permisos, o null si la sesión no es válida.
 */
export function loadSessionUser(payload) {
  const key = `${payload.sid}:${payload.sub}`;
  const currentLoad = inFlightSessionLoads.get(key);
  if (currentLoad) return currentLoad;

  const load = findActiveSessionUser({
    sessionId: payload.sid,
    userId: payload.sub,
  }).finally(() => {
    if (inFlightSessionLoads.get(key) === load) inFlightSessionLoads.delete(key);
  });

  inFlightSessionLoads.set(key, load);
  return load;
}

/**
 * Revoca únicamente la sesión indicada (cierre de sesión). Es idempotente: una sesión
 * ya revocada o inexistente no produce error.
 *
 * @param {string} sessionId - Sesión a revocar.
 * @returns {Promise<boolean>} true si se revocó una sesión activa.
 */
export function revokeCurrentSession(sessionId) {
  return revokeSession({
    reason: SESSION_REVOCATION_REASONS.logout,
    sessionId,
  });
}

/**
 * Revoca todas las sesiones del usuario salvo la actual, a petición del propio usuario.
 *
 * @param {object} options - Datos de la revocación.
 * @param {number|string} options.userId - Usuario autenticado.
 * @param {string} options.currentSessionId - Sesión que se conserva.
 * @returns {Promise<number>} Número de sesiones revocadas.
 */
export function revokeOtherUserSessions({ currentSessionId, userId }) {
  return revokeUserSessions({
    exceptSessionId: currentSessionId,
    reason: SESSION_REVOCATION_REASONS.revokedByUser,
    userId,
  });
}

/**
 * Cambia la contraseña del usuario autenticado, revoca todas sus sesiones (incluida la actual) y
 * emite una sesión nueva en la misma transacción, para que solo el dispositivo que hizo el cambio
 * conserve el acceso.
 *
 * @param {object} options - Datos del cambio.
 * @param {number|string} options.userId - Usuario autenticado.
 * @param {string} options.passwordHash - Hash bcrypt de la nueva contraseña.
 * @returns {Promise<{ token: string }|null>} Token de la sesión nueva, o null si el usuario ya no existe.
 */
export async function changePasswordAndRotateSession({ passwordHash, userId }) {
  const result = await updateUserPasswordRevokingSessions({
    newSessionExpiresInSeconds: authConfig.tokenExpiresInSeconds,
    passwordHash,
    revocationReason: SESSION_REVOCATION_REASONS.passwordChanged,
    userId,
  });

  if (!result.updated) return null;
  return { token: signSessionToken({ sessionId: result.newSessionId, userId }) };
}

/**
 * Restablece la contraseña desde un enlace de recuperación y revoca todas las sesiones del
 * usuario en la misma transacción; quien recupera la cuenta debe iniciar sesión de nuevo.
 *
 * @param {object} options - Datos del restablecimiento.
 * @param {number|string} options.userId - Usuario del enlace ya validado y consumido.
 * @param {string} options.passwordHash - Hash bcrypt de la nueva contraseña.
 * @returns {Promise<boolean>} true si la contraseña se actualizó.
 */
export async function resetPasswordAndRevokeSessions({ passwordHash, userId }) {
  const result = await updateUserPasswordRevokingSessions({
    passwordHash,
    revocationReason: SESSION_REVOCATION_REASONS.passwordReset,
    userId,
  });
  return result.updated;
}

/**
 * Limpia en segundo plano sesiones caducadas o revocadas hace más de un día.
 * Un fallo solo se registra: la limpieza es oportunista y no debe afectar al inicio de sesión.
 *
 * @returns {void} Finalización de la operación.
 */
export function scheduleExpiredSessionCleanup() {
  deleteExpiredSessions({ limit: 200 }).catch((error) => {
    console.warn(JSON.stringify({
      message: error?.message || "Error desconocido",
      type: "session_cleanup_failed",
    }));
  });
}
