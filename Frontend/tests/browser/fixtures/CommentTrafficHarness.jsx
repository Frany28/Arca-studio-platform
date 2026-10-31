import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { AuthProvider, useAuth } from "../../../src/auth/AuthContext.jsx";
import {
  useImageCommentNotifications,
  useImageComments,
} from "../../../src/components/ui/Gallery/useImageComments.js";
import {
  useProjectComments,
  useRecentProjectComments,
} from "../../../src/hooks/useProjectComments.js";
import useProjectDetailsComments from "../../../src/pages/projects/hooks/useProjectDetailsComments.js";

// Monta los hooks reales de observaciones con la misma combinación que las páginas (P1-1), para
// medir en un navegador real cuántas peticiones generan. La red la intercepta la prueba; solo se
// usan hooks y props que existen también en la versión anterior, para comparar antes y después.

const parameters = new URLSearchParams(window.location.search);
const scenario = parameters.get("scenario") || "detail";
const DASHBOARD_PROJECT_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const PROJECT_NAMES = Object.fromEntries(DASHBOARD_PROJECT_IDS.map((id) => [id, `Proyecto ${id}`]));
const VIEWER_ITEM = { id: "render-1", title: "Render 1" };
const PROJECT = { status: "in_process" };

window.trafficHarness = { observed: 0 };

/**
 * Página de detalle con el visor de imagen abierto: detalle, notificaciones y visor del mismo proyecto.
 *
 * @returns {JSX.Element} Contador visible.
 */
export function DetailPage() {
  const { comments } = useProjectDetailsComments({ isNotificationsDrawerOpen: false, project: PROJECT, resolvedProjectId: 7 });
  useImageCommentNotifications({ projectIds: [7], projectNamesById: PROJECT_NAMES, refreshIntervalMs: 15000 });
  useImageComments(VIEWER_ITEM, { commentType: "image", projectId: 7 });
  useEffect(() => { window.trafficHarness.observed = comments.length; }, [comments.length]);
  return <p data-testid="observed">{comments.length}</p>;
}

/**
 * Panel del arquitecto con ocho proyectos editables y el drawer cerrado.
 *
 * @returns {JSX.Element} Contador visible.
 */
export function DashboardPage() {
  const { user } = useAuth();
  useImageCommentNotifications({ projectIds: DASHBOARD_PROJECT_IDS, projectNamesById: PROJECT_NAMES, refreshIntervalMs: 15000 });
  useProjectComments({ enabled: false, projectId: 1, refreshIntervalMs: 0, user });
  const { comments } = useRecentProjectComments({
    enabled: true, projectIds: DASHBOARD_PROJECT_IDS, projectNamesById: PROJECT_NAMES, refreshIntervalMs: 15000, user,
  });
  useEffect(() => { window.trafficHarness.observed = comments.length; }, [comments.length]);
  return <p data-testid="observed">{comments.length}</p>;
}

/**
 * Espera la sesión simulada y monta el escenario pedido.
 *
 * @returns {JSX.Element} Escenario.
 */
export function App() {
  const { user } = useAuth();
  if (!user) return <p>Cargando sesión</p>;
  return scenario === "dashboard" ? <DashboardPage /> : <DetailPage />;
}

createRoot(document.getElementById("root")).render(<AuthProvider><App /></AuthProvider>);
