import {
  getRolePermissionBoundary,
  getRolePermissionBoundaries,
  listPermissions,
  listRoles,
  replaceRolePermissions,
} from "../repositories/rolePermissionRepository.js";

/**
 * Interpreta el valor de include inactive y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function parseIncludeInactive(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

/**
 * Obtiene los roles del sistema para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} _req - Solicitud HTTP que este controlador no necesita inspeccionar.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getRoles(_req, res, next) {
  try {
    const roles = await listRoles();

    res.status(200).json({ roles });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene los permisos del sistema para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getPermissions(req, res, next) {
  try {
    const permissions = await listPermissions({
      includeInactive: parseIncludeInactive(req.query?.includeInactive),
    });

    res.status(200).json({ permissions });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene el valor de rol permiso matrix para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getRolePermissionMatrix(req, res, next) {
  try {
    const roles = await getRolePermissionBoundaries({
      includeInactive: parseIncludeInactive(req.query?.includeInactive),
    });

    res.status(200).json({
      roles,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene los permisos asociados con un rol para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getRolePermissions(req, res, next) {
  try {
    const roleCode = String(req.params?.roleCode || "").trim();
    const role = await getRolePermissionBoundary(roleCode);

    if (!role) {
      res.status(404).json({
        code: "ROLE_NOT_FOUND",
        message: "Rol no encontrado.",
      });
      return;
    }

    res.status(200).json({ role });
  } catch (error) {
    next(error);
  }
}

/**
 * Actualiza los permisos asociados con un rol conservando las reglas de acceso e integridad.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function updateRolePermissions(req, res, next) {
  try {
    const roleCode = String(req.params?.roleCode || "").trim();
    const permissionCodes = req.body?.permissionCodes;

    if (!Array.isArray(permissionCodes)) {
      res.status(400).json({
        code: "INVALID_PERMISSION_CODES",
        message: "permissionCodes debe ser un arreglo de códigos de permiso.",
      });
      return;
    }

    const result = await replaceRolePermissions(roleCode, permissionCodes);

    if (result.error === "ROLE_NOT_FOUND") {
      res.status(404).json({
        code: "ROLE_NOT_FOUND",
        message: "Rol no encontrado.",
      });
      return;
    }

    if (result.error === "PERMISSIONS_NOT_FOUND") {
      res.status(400).json({
        code: "PERMISSIONS_NOT_FOUND",
        message: "Uno o más permisos no existen o no están activos.",
        missingPermissionCodes: result.missingPermissionCodes,
      });
      return;
    }

    res.status(200).json({
      role: result.boundary,
    });
  } catch (error) {
    next(error);
  }
}
