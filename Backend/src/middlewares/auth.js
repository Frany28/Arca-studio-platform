import { authConfig, resolveRouteAuthBypass } from "../config/auth.js";
import { parseCookies } from "../utils/cookies.js";
import { isSessionTokenPayload, verifyAuthToken } from "../utils/tokens.js";
import { loadSessionUser } from "../services/sessionService.js";

const routeAuthBypass = resolveRouteAuthBypass();
const ROUTE_AUTH_DISABLED_FOR_TESTS = routeAuthBypass.enabled;

// Una solicitud de bypass rechazada indica una configuración incorrecta del
// despliegue; se registra para que no pase inadvertida, sin detener el servicio.
if (routeAuthBypass.requested && !routeAuthBypass.enabled) {
  console.warn(JSON.stringify({
    type: "route_auth_bypass_ignored",
    message: "ROUTE_AUTH_DISABLED_FOR_TESTS se ignoró: solo se permite con NODE_ENV development/test fuera de plataformas de despliegue.",
  }));
}

/**
 * Obtiene el usuario público de pruebas para que el flujo llamador pueda continuar.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @returns {object} Resultado producido por la operación.
 */
function getPublicTestUser() {
  const id = Number(process.env.PUBLIC_TEST_USER_ID || 1);

  return {
    clientId: process.env.PUBLIC_TEST_CLIENT_ID
      ? Number(process.env.PUBLIC_TEST_CLIENT_ID)
      : null,
    email: "pruebas@arca.local",
    firstName: "Usuario",
    id: Number.isInteger(id) && id > 0 ? id : 1,
    lastLoginAt: null,
    lastName: "Pruebas",
    name: "Usuario Pruebas",
    permissionCodes: ["projects.read", "projects.publish"],
    permissions: [
      {
        code: "projects.read",
        description: null,
        id: 0,
        module: "projects",
        name: "Leer proyectos",
      },
      {
        code: "projects.publish",
        description: null,
        id: 0,
        module: "projects",
        name: "Publicar proyectos",
      },
    ],
    phone: "",
    profilePhotoUrl: "",
    role: {
      code: "admin",
      id: 1,
      name: "Administrador",
    },
    status: "active",
    updatedAt: null,
  };
}

/**
 * Obtiene el valor de empty sesión para que el flujo llamador pueda continuar.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @returns {object} Resultado producido por la operación.
 */
function getEmptySession() {
  return {
    isAuthenticated: false,
    payload: null,
    token: null,
  };
}

/**
 * Obtiene el token Bearer de la solicitud para que el flujo llamador pueda continuar.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @returns {object} Resultado producido por la operación.
 */
function getBearerToken(req) {
  const authorization = req.headers.authorization;

  if (!authorization || typeof authorization !== "string") {
    return null;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

/**
 * Resuelve la sesión autenticada a partir de la solicitud y la configuración disponible.
 * Solo acepta tokens de sesión con `sid`; la sesión debe seguir activa en PostgreSQL (B-3), por lo
 * que una revocación o desactivación surte efecto en la siguiente petición de cualquier instancia.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @returns {Promise<object>} Sesión resuelta y usuario autenticado, o una sesión vacía.
 */
async function resolveSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = getBearerToken(req) || cookies[authConfig.cookieName];
  const payload = verifyAuthToken(token, {
    secret: authConfig.tokenSecret,
  });

  // Los tokens de recuperación y registro comparten secreto y formato con la
  // sesión; sin esta comprobación un enlace de correo serviría como sesión.
  // Los JWT anteriores a B-3 no tienen `sid` y también se rechazan aquí.
  if (!isSessionTokenPayload(payload)) {
    return {
      session: getEmptySession(),
      user: null,
    };
  }

  const user = await loadSessionUser(payload);

  if (!user) {
    return {
      session: getEmptySession(),
      user: null,
    };
  }

  return {
    session: {
      isAuthenticated: true,
      payload,
      token,
    },
    user,
  };
}

/**
 * Carga la sesión autenticada y deja el resultado disponible para el flujo actual.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} _res - Valor de `_res` requerido por esta operación.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function loadSession(req, _res, next) {
  try {
    const { session, user } = await resolveSession(req);

    req.session = session;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Exige el valor de autenticación y detiene el flujo cuando la condición no se cumple.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function requireAuth(req, res, next) {
  if (ROUTE_AUTH_DISABLED_FOR_TESTS) {
    req.session = req.session || {
      isAuthenticated: true,
      payload: {
        role: "admin",
        sub: String(process.env.PUBLIC_TEST_USER_ID || 1),
      },
      token: null,
    };
    req.user = req.user || getPublicTestUser();
    next();
    return;
  }

  if (!req.session) {
    try {
      const { session, user } = await resolveSession(req);

      req.session = session;
      req.user = user;
    } catch (error) {
      next(error);
      return;
    }
  }

  if (!req.session.isAuthenticated || !req.user) {
    res.status(401).json({
      code: "UNAUTHENTICATED",
      message: "Sesión requerida.",
    });
    return;
  }

  next();
}

/**
 * Exige los roles del sistema y detiene el flujo cuando la condición no se cumple.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @param {...unknown} allowedRoles - Valor de `allowedRoles` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (ROUTE_AUTH_DISABLED_FOR_TESTS) {
      req.user = req.user || getPublicTestUser();
      next();
      return;
    }

    if (!req.user) {
      res.status(401).json({
        code: "UNAUTHENTICATED",
        message: "Sesión requerida.",
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role.code)) {
      res.status(403).json({
        code: "FORBIDDEN",
        message: "No tienes permisos para realizar esta acción.",
      });
      return;
    }

    next();
  };
}

/**
 * Exige los permisos del sistema y detiene el flujo cuando la condición no se cumple.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @param {...unknown} requiredPermissions - Valor de `requiredPermissions` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function requirePermissions(...requiredPermissions) {
  return (req, res, next) => {
    if (ROUTE_AUTH_DISABLED_FOR_TESTS) {
      req.user = req.user || getPublicTestUser();
      next();
      return;
    }

    if (!req.user) {
      res.status(401).json({
        code: "UNAUTHENTICATED",
        message: "Sesión requerida.",
      });
      return;
    }

    const userPermissions = new Set(req.user.permissionCodes || []);
    const hasAllPermissions = requiredPermissions.every((permission) =>
      userPermissions.has(permission),
    );

    if (!hasAllPermissions) {
      res.status(403).json({
        code: "FORBIDDEN",
        message: "No tienes permisos para realizar esta acción.",
      });
      return;
    }

    next();
  };
}
