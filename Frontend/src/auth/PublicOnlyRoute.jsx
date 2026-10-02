/* Restringe rutas públicas a usuarios no autenticados, como login y recuperación. */
import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./AuthContext.jsx";
import { getDefaultAuthenticatedPath } from "./authRoutes.js";
import SessionUnavailable from "./SessionUnavailable.jsx";

// Envía a usuarios autenticados a su pantalla inicial y deja pasar al resto.
/**
 * Espera a resolver la sesi?n antes de mostrar la ruta p?blica.
 * Una sesi?n indisponible ofrece reintento y una autenticada redirige seg?n rol.
 *
 * @returns {Object|null} Ruta hija, aviso, redirecci?n o null durante la carga.
 */
function PublicOnlyRoute() {
  const {
    isAuthenticated,
    isLoading,
    isSessionUnavailable,
    restoreSession,
    user,
  } = useAuth();

  if (isLoading) {
    return null;
  }

  if (isSessionUnavailable) {
    return <SessionUnavailable onRetry={restoreSession} />;
  }

  if (isAuthenticated) {
    return <Navigate to={getDefaultAuthenticatedPath(user)} replace />;
  }

  return <Outlet />;
}

export default PublicOnlyRoute;
