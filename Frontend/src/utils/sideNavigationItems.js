import { getProjectPath } from "./projectRoutes.js";
import { selectRecentProjects } from "./recentProjects.js";

/**
 * Adapta los proyectos recientes a accesos laterales con ruta por slug.
 * La selección excluye archivados y limita a tres; proyectos públicos añaden icono window.
 *
 * @param {Array} projects - Proyectos candidatos.
 * @returns {Array} Accesos de navegación con ID project- y destino.
 */
function createProjectShortcutItems(projects) {
  return selectRecentProjects(projects).map((project) => ({
    id: `project-${project.id}`,
    label: project.name || project.title || "Proyecto",
    icon: "project",
    trailingIcon: project.isPublic ? "window" : undefined,
    wrapperHeight: "56px",
    to: getProjectPath(project),
  }));
}

/**
 * Reemplaza accesos project- conservando los demás elementos de navegación.
 * Inserta nuevos recientes después de dashboard, o al principio si no existe;
 * si se deshabilitan los accesos devuelve solo elementos persistentes.
 *
 * @param {Array} [items=[]] - Navegación actual.
 * @param {Array} [projects=[]] - Proyectos para los accesos nuevos.
 * @param {Object} [options={}] - Opciones de composición.
 * @param {boolean} [options.includeProjectShortcuts=true] - Incluye accesos recientes.
 * @returns {Array} Navegación resultante.
 */
export function mergeRecentProjectNavigationItems(
  items = [],
  projects = [],
  { includeProjectShortcuts = true } = {},
) {
  const persistentItems = (Array.isArray(items) ? items : []).filter(
    (item) => !String(item?.id || "").startsWith("project-"),
  );

  if (!includeProjectShortcuts) {
    return persistentItems;
  }

  const dashboardIndex = persistentItems.findIndex(
    (item) => item.id === "dashboard",
  );
  const insertIndex = dashboardIndex >= 0 ? dashboardIndex + 1 : 0;

  return [
    ...persistentItems.slice(0, insertIndex),
    ...createProjectShortcutItems(projects),
    ...persistentItems.slice(insertIndex),
  ];
}

/**
 * Construye navegación por rol sin comprobar permisos de backend.
 * Administradores reciben secciones administrativas sin recientes; otros reciben
 * recientes, galería y configuración, y solo client incorpora Solicitudes.
 *
 * @param {Array} [projects=[]] - Proyectos candidatos para accesos recientes.
 * @param {string} [roleCode="client"] - Rol exacto para escoger navegación.
 * @returns {Array} Elementos con etiquetas, iconos y destinos.
 */
export function createUserSideNavigationItems(projects = [], roleCode = "client") {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const isClient = roleCode === "client";

  if (roleCode === "admin") {
    return [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: "admin-dashboard",
        wrapperHeight: "44px",
        to: getDashboardPath(roleCode),
      },
      {
        id: "users",
        label: "Usuarios",
        icon: "users",
        wrapperHeight: "44px",
        to: "/usuarios",
      },
      {
        id: "projects",
        label: "Proyectos",
        icon: "projects",
        wrapperHeight: "44px",
        to: "/proyectos",
      },
      {
        id: "files",
        label: "Archivos",
        icon: "files",
        wrapperHeight: "44px",
        to: "/archivos",
      },
      {
        id: "history",
        label: "Historial",
        icon: "history",
        wrapperHeight: "44px",
        to: "/historial",
      },
      {
        id: "settings",
        label: "Configuraciones",
        icon: "settings",
        wrapperHeight: "44px",
        to: "/configuraciones",
      },
    ];
  }

  return [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "dashboard",
      wrapperHeight: "44px",
      to: getDashboardPath(roleCode),
    },
    ...createProjectShortcutItems(safeProjects),
    ...(isClient
      ? [
          {
            id: "requests",
            label: "Solicitudes",
            icon: "requests",
            wrapperHeight: "44px",
            to: "/solicitudes",
          },
        ]
      : []),
    {
      id: "more-projects",
      label: "Ver más proyectos",
      icon: "discover",
      wrapperHeight: "56px",
      to: "/proyectos",
    },
    {
      id: "settings",
      label: "Configuraciones",
      icon: "settings",
      wrapperHeight: "56px",
      to: "/configuraciones",
    },
  ];
}

/**
 * Resuelve la ruta principal de navegación por rol.
 * architect y admin comparten dashboard-arquitecto; cualquier otro código usa dashboard-clientes.
 *
 * @param {string|null} roleCode - Código de rol.
 * @returns {string} Ruta del dashboard.
 */
export function getDashboardPath(roleCode) {
  return roleCode === "architect" || roleCode === "admin"
    ? "/dashboard-arquitecto"
    : "/dashboard-clientes";
}
