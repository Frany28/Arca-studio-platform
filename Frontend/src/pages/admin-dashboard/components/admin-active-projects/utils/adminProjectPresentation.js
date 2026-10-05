import { getAvatarPresentation } from "../../../../../utils/avatarPresentation.js";

const STATUS_DETAILS = {
  completed: { label: "Finalizado", theme: "Success" },
  finished: { label: "Finalizado", theme: "Success" },
  archived: { label: "Archivado", theme: "Archived" },
  in_process: { label: "En progreso", theme: "Info" },
  in_review: { label: "En revisión", theme: "Brand 2" },
  pending_approval: { label: "Solicitud", theme: "Neutral" },
  request: { label: "Solicitud", theme: "Neutral" },
};

export const STATUS_FILTER_ITEMS = [
  { id: "in_process", label: "En progreso", type: "Checkbox" },
  { id: "in_review", label: "En revisión", type: "Checkbox" },
  { id: "pending_approval", label: "Solicitud", type: "Checkbox" },
  { id: "completed", label: "Finalizado", type: "Checkbox" },
  { id: "archived", label: "Archivado", type: "Checkbox" },
];

/**
 * Conserva los aliases históricos al comparar los estados con el catálogo de filtros.
 * @param {string|null|undefined} status Estado del proyecto, sin normalizar otros valores.
 * @returns {string|null|undefined} ID equivalente; los estados desconocidos se conservan.
 */
export function getStatusFilterId(status) {
  if (status === "finished") return "completed";
  if (status === "request") return "pending_approval";
  return status;
}

/**
 * Obtiene el texto y tema actuales del estado sin modificar el proyecto.
 * @param {Object} project Proyecto con su estado original.
 * @returns {{label: string, theme: string}} Presentación; Solicitud para estados desconocidos.
 */
export function getStatus(project) {
  return STATUS_DETAILS[project.status] || { label: "Solicitud", theme: "Neutral" };
}

/**
 * Resuelve cliente y avatar respetando la prioridad de campos y el fallback Sin cliente.
 * Reutiliza la identidad y presentación compartida de avatares, sin transformar el cliente.
 * @param {Object} project Proyecto con cliente embebido o datos históricos de cliente.
 * @returns {{avatar: Object, name: string}} Nombre y props visuales del avatar.
 */
export function getClient(project) {
  const client = project.client || {};
  const name = client.name || project.clientName || "Sin cliente";
  const photo = client.profilePhotoUrl || client.avatarUrl || "";
  return {
    avatar: getAvatarPresentation({
      identity: client.id || project.clientId || name,
      name,
      roleCode: "client",
      src: photo,
    }),
    name,
  };
}

/**
 * Resuelve responsables de los formatos actuales e históricos por su prioridad existente.
 * Las listas no vacías se devuelven por referencia para conservar snapshots y callbacks.
 * @param {Object} project Proyecto con assignees, assignedArchitects o assignedArchitect.
 * @returns {Object[]} Lista original, responsable individual o lista vacía.
 */
export function getAssignees(project) {
  if (Array.isArray(project.assignees) && project.assignees.length) return project.assignees;
  if (Array.isArray(project.assignedArchitects) && project.assignedArchitects.length) {
    return project.assignedArchitects;
  }
  return project.assignedArchitect ? [project.assignedArchitect] : [];
}
