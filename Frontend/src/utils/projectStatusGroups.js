export const PROJECT_STATUS_GROUPS = [
  {
    id: "in_process",
    status: "En Progreso",
    badgeTheme: "Info",
    badgeClassName:
      "border-[var(--color-info-10)] bg-[var(--color-info-10)] text-[var(--color-info-100)]",
  },
  {
    id: "in_review",
    status: "En Revisión",
    badgeTheme: "Brand 2",
    badgeClassName:
      "border-[var(--color-primary-10)] bg-[var(--color-primary-10)] text-[var(--color-text-300)]",
  },
  {
    id: "pending_approval",
    status: "En espera de Aprobación",
    badgeTheme: "Neutral",
    badgeClassName:
      "border-[var(--color-neutral-600)] bg-[var(--color-neutral-100)] text-[var(--color-text-300)]",
  },
  {
    id: "finished",
    status: "Finalizados",
    badgeTheme: "Success",
    badgeClassName:
      "border-[var(--color-success-10)] bg-[var(--color-success-10)] text-[var(--color-success-200)]",
  },
];

/**
 * Agrupa proyectos por los estados del catálogo conservando su orden de presentación.
 * Los estados no reconocidos van a Otros con estilo del primer grupo; omite grupos vacíos
 * y conserva el orden original de los proyectos dentro de cada grupo.
 *
 * @param {Array} projects - Proyectos con status.
 * @returns {Array} Grupos visuales con projects y propiedades de badge.
 */
export function groupProjectsByStatus(projects) {
  const fallbackGroup = PROJECT_STATUS_GROUPS[0];

  return PROJECT_STATUS_GROUPS.map((group) => ({
    ...group,
    projects: projects.filter((project) => project.status === group.id),
  }))
    .concat({
      ...fallbackGroup,
      id: "other",
      projects: projects.filter(
        (project) =>
          !PROJECT_STATUS_GROUPS.some((group) => group.id === project.status),
      ),
      status: "Otros",
    })
    .filter((group) => group.projects.length > 0);
}
