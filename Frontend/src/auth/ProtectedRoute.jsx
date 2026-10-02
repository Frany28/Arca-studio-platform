/* Protege rutas privadas y redirige según sesión, disponibilidad y rol del usuario. */
import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./AuthContext.jsx";
import { getDefaultAuthenticatedPath } from "./authRoutes.js";
import SessionUnavailable from "./SessionUnavailable.jsx";
import { getProtectedRouteDecision } from "./authRouteState.js";

/**
 * Aplica la decisi?n compartida de sesi?n y rol antes de renderizar la ruta hija.
 * La indisponibilidad ofrece reintento; la carga evita una redirecci?n prematura.
 *
 * @param {Object} props - Pol?tica de acceso de la ruta.
 * @param {Array} [props.allowedRoles] - Roles permitidos por esta ruta.
 * @returns {Object|null} Contenido, aviso, redirecci?n o null durante la carga.
 */
function ProtectedRoute({ allowedRoles }) {
  const {
    isAuthenticated,
    isLoading,
    isSessionUnavailable,
    restoreSession,
    user,
  } = useAuth();

  const decision = getProtectedRouteDecision({
    allowedRoles,
    isAuthenticated,
    isLoading,
    isSessionUnavailable,
    role: user?.role,
  });

  if (decision === "loading") {
    return null;
  }

  if (decision === "unavailable") {
    return <SessionUnavailable onRetry={restoreSession} />;
  }

  if (decision === "login") {
    return <Navigate to="/" replace />;
  }

  if (decision === "role-home") {
    return <Navigate to={getDefaultAuthenticatedPath(user)} replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
