import { DocumentForward, GlobalEdit } from "iconsax-react";

import { isArchivedProject } from "../../admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js";

export const PROJECT_ROW_ACTION_IDS = Object.freeze({
  settings: "settings",
  archive: "archive",
  unarchive: "unarchive",
});

/**
 * Construye las acciones del menú de fila según Figma (3727:686867): Cambiar visibilidad
 * y Archivar. Un proyecto ya archivado ofrece Desarchivar para mantenerlo recuperable.
 * @param {Object} project - Fila real de la tabla.
 * @returns {import("../../../components/ui/ActionMenu/ActionMenu.jsx").ActionMenuItem[]} Acciones.
 */
export function getProjectRowActions(project) {
  const archived = isArchivedProject(project);
  return [
    { id: PROJECT_ROW_ACTION_IDS.settings, label: "Cambiar visibilidad", icon: GlobalEdit },
    archived
      ? { id: PROJECT_ROW_ACTION_IDS.unarchive, label: "Desarchivar", icon: DocumentForward }
      : { id: PROJECT_ROW_ACTION_IDS.archive, label: "Archivar", icon: DocumentForward },
  ];
}

/**
 * Obtiene el nombre visible del proyecto con el mismo respaldo que la tabla.
 * @param {Object} project - Proyecto de la fila.
 * @returns {string} Nombre para textos y etiquetas accesibles.
 */
export function getProjectDisplayName(project) {
  return project?.title || project?.name || "Proyecto";
}

/**
 * Redacta el aviso compartido (AlertToast) tras confirmar o rechazar una operación.
 * @param {{action: string, isPublic?: boolean}} operation - Operación del contrato bulk-action.
 * @param {Object} project - Proyecto afectado.
 * @param {Error|null} [error=null] - Error de la API; null indica éxito confirmado.
 * @returns {{theme: "Success"|"Danger", title: string, description: string}} Contenido del aviso.
 */
export function getProjectActionFeedback(operation, project, error = null) {
  const name = getProjectDisplayName(project);
  const copy = {
    archive: {
      success: "Proyecto archivado",
      description: `${name} se ocultó de las listas principales. Puedes desarchivarlo cuando lo necesites.`,
      error: "No se pudo archivar el proyecto",
    },
    unarchive: {
      success: "Proyecto desarchivado",
      description: `${name} volvió a las listas principales con su estado anterior.`,
      error: "No se pudo desarchivar el proyecto",
    },
    change_visibility: {
      success: "Visibilidad actualizada",
      description: operation.isPublic
        ? `${name} ahora se muestra en el portafolio público.`
        : `${name} ya no se muestra en el portafolio público.`,
      error: "No se pudo cambiar la visibilidad",
    },
  }[operation.action];

  if (error) {
    return {
      theme: "Danger",
      title: copy.error,
      description: error.message || "No se pudo actualizar el proyecto.",
    };
  }

  return { theme: "Success", title: copy.success, description: copy.description };
}
