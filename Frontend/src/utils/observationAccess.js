/**
 * Normaliza un rol desde texto o las formas de usuario admitidas.
 * Prioriza roleCode, después role string u objeto y finalmente roleDetails.code.
 *
 * @param {Object|string|null} userOrRoleCode - Usuario o código de rol.
 * @returns {string} Código recortado en minúsculas, o vacío.
 */
export function getRoleCode(userOrRoleCode) {
  const roleCode = typeof userOrRoleCode === "string"
    ? userOrRoleCode
    : userOrRoleCode?.roleCode
      || (typeof userOrRoleCode?.role === "string"
        ? userOrRoleCode.role
        : userOrRoleCode?.role?.code)
      || userOrRoleCode?.roleDetails?.code;

  return String(roleCode || "").trim().toLowerCase();
}

export function isAdministrator(userOrRoleCode) {
  return getRoleCode(userOrRoleCode) === "admin";
}

/**
 * Aplica la exclusión de administradores del panel de observaciones.
 * Todo rol distinto de admin, incluido el vacío, devuelve true; no verifica autenticación
 * ni permisos de proyecto y no reemplaza la autorización de la API.
 *
 * @param {Object|string|null} userOrRoleCode - Usuario o código de rol.
 * @returns {boolean} Si no corresponde a administrador.
 */
export function canAccessObservations(userOrRoleCode) {
  return !isAdministrator(userOrRoleCode);
}

/**
 * Resuelve si el panel global muestra actividad o permite observaciones.
 * Administradores siempre usan actividad; activityOnly también deshabilita observaciones
 * para otros roles. Esta política de presentación no concede acceso a recursos.
 *
 * @param {Object|string|null} userOrRoleCode - Usuario o código de rol.
 * @param {Object} [options={}] - Preferencias del panel.
 * @param {boolean} [options.activityOnly=false] - Restringe el panel a actividad.
 * @returns {Object} activityOnly y observationsAllowed.
 */
export function getEnvironmentNotificationsPolicy(
  userOrRoleCode,
  { activityOnly = false } = {},
) {
  const observationsAllowed = canAccessObservations(userOrRoleCode);

  return {
    activityOnly: activityOnly || !observationsAllowed,
    observationsAllowed: observationsAllowed && !activityOnly,
  };
}
