import { getApiUrl } from "../api/http.js";

export function getInitialsFromDisplayName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

/**
 * Construye la URL de foto del responsable dentro del ámbito del proyecto.
 * Devuelve vacío sin indicador de foto o sin ID de proyecto entero positivo; no carga la imagen.
 *
 * @param {Object|null} project - Proyecto con id y assignedArchitect.hasProfilePhoto.
 * @returns {string} URL de API o vacío.
 */
export function buildAssignedArchitectAvatarUrl(project) {
  const projectId = Number(project?.id);
  if (!project?.assignedArchitect?.hasProfilePhoto || !Number.isInteger(projectId) || projectId <= 0) return "";

  return getApiUrl(`/projects/${projectId}/assigned-architect/profile-photo`);
}

/**
 * Adapta al responsable a un avatar Neutral con iniciales y URL de foto opcional.
 * El nombre usa name, email o Arquitecto encargado; content permanece Text incluso
 * con src. Devuelve null si no hay responsable.
 *
 * @param {Object|null} project - Proyecto con assignedArchitect.
 * @returns {Object|null} Datos de presentación del avatar.
 */
export function getProjectAssigneeAvatar(project) {
  const architect = project?.assignedArchitect;
  if (!architect) return null;

  const name = architect.name || architect.email || "Arquitecto encargado";
  return {
    alt: name,
    content: "Text",
    decorative: false,
    initials: getInitialsFromDisplayName(name),
    name,
    src: buildAssignedArchitectAvatarUrl(project),
    theme: "Neutral",
  };
}
