/* Deriva la clave primitiva que determina qué datos protegidos puede leer la sesión actual. */

/**
 * Devuelve la clave del ámbito de datos de la sesión: cuenta, rol y cliente vinculado. Son las
 * propiedades del usuario con las que el backend decide qué proyectos y solicitudes devuelve
 * (rol y `clientId` en los repositorios; la cuenta identifica la cookie).
 *
 * AuthContext publica un objeto `user` nuevo al confirmar la misma sesión (por ejemplo, cuando
 * /auth/me desmiente un 401) o al actualizar el perfil. Los efectos que leen datos deben depender
 * de esta clave y no de la referencia del objeto: así una confirmación no repite lecturas, y un
 * cambio de cuenta, de rol o de cliente sí las repite. Nombre, foto u otros campos de
 * presentación no forman parte de la clave porque no cambian lo que la API devuelve.
 *
 * @param {Object|null|undefined} user - Usuario publicado por AuthContext.
 * @returns {string|null} Clave estable para la misma sesión, o null sin usuario.
 */
export function getSessionDataScopeKey(user) {
  if (!user) return null;
  const account = user.id ?? user.email ?? "";
  const role = user.role ?? user.roleDetails?.code ?? "";
  return `${account}:${role}:${user.clientId ?? ""}`;
}
