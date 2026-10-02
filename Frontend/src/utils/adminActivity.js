import { formatRelativeTime } from "./relativeTime.js";

/**
 * Adapta un evento administrativo al modelo del panel y calcula su fecha relativa.
 * Los IDs file- indican carga; el título Entrega finalizada indica finalización;
 * los demás eventos se presentan como cambios de estado. Solo genera destino con projectId.
 *
 * @param {Object} activity - Evento con autor, proyecto, título y createdAt.
 * @returns {Object} Actividad con acción visible, timestamp, destino opcional y type event.
 */
export function toAdminDrawerActivity(activity) {
  const isFileActivity = String(activity?.id || "").startsWith("file-");
  const isCompleted = activity?.title === "Entrega finalizada";

  return {
    id: activity.id,
    name: activity.userName,
    action: isFileActivity
      ? "subió un archivo al proyecto"
      : isCompleted
        ? "finalizó la entrega del proyecto"
        : "actualizó el estado del proyecto",
    projectId: activity.projectId,
    projectName: activity.projectName,
    roleCode: activity.userRoleCode,
    timestamp: formatRelativeTime(activity.createdAt),
    to: activity.projectId ? `/proyectos/${activity.projectId}` : undefined,
    type: "event",
  };
}
