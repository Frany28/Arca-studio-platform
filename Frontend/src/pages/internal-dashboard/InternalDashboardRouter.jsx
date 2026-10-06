import { lazy } from "react";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";

const AdminDashboard = lazy(() => import("../admin-dashboard/AdminDashboard.jsx"));
const ArchitectDashboard = lazy(() => import("../architect-dashboard/ArchitectDashboard.jsx"));

/**
 * Mantiene las URLs actuales seleccionando únicamente la página del rol activo.
 * Los guards de sesión y permisos siguen perteneciendo a las rutas existentes.
 *
 * @param {Object} props - Opciones reenviadas al dashboard correspondiente.
 * @param {boolean} [props.empty=false] - Conserva el escenario vacío en las entradas actuales.
 * @returns {import("react").ReactElement} Una sola página, administrativa o de arquitecto.
 */
function InternalDashboardRouter({ empty = false }) {
  const { user } = useAuth();
  return getUserDisplay(user).roleCode === "admin"
    ? <AdminDashboard empty={empty} />
    : <ArchitectDashboard empty={empty} />;
}

export default InternalDashboardRouter;
