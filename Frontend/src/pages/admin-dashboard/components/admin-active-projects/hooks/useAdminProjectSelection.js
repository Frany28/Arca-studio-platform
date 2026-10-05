import { useMemo, useState } from "react";

/**
 * Mantiene IDs seleccionados como texto y deriva el checkbox y la selección visible.
 * No elimina IDs al desaparecer una fila: su reaparición conserva la selección actual.
 * El consumidor decide cuándo limpiar por filtros, página o éxito de una acción;
 * la disponibilidad de acciones sigue siendo responsabilidad del helper compartido.
 * @param {Object[]} visibleProjects Proyectos de la página actual, sin copiar sus objetos.
 * @returns {{selectedProjectIds: Set<string>, setSelectedProjectIds: Function,
 * selectedVisibleProjects: Object[], selectedVisibleCount: number, headerChecked: string,
 * toggleAllVisible: Function, toggleProject: Function}} Estado y operaciones de selección.
 */
export function useAdminProjectSelection(visibleProjects) {
  const [selectedProjectIds, setSelectedProjectIds] = useState(() => new Set());

  const selectedVisibleProjects = useMemo(
    () => visibleProjects.filter(
      (project) => selectedProjectIds.has(String(project.id)),
    ),
    [selectedProjectIds, visibleProjects],
  );
  const selectedVisibleCount = selectedVisibleProjects.length;
  const allVisibleSelected = visibleProjects.length > 0
    && selectedVisibleCount === visibleProjects.length;
  const headerChecked = allVisibleSelected
    ? "Yes"
    : selectedVisibleCount > 0
      ? "Indeterminate"
      : "No";

  /**
   * Alterna solo los IDs visibles conservando cualquier ID de otras filas.
   * @returns {void}
   */
  const toggleAllVisible = () => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      visibleProjects.forEach((project) => {
        const id = String(project.id);
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  /**
   * Alterna un ID sobre una copia del Set para preservar actualizaciones encadenadas.
   * @param {string|number} projectId Identificador original de la fila.
   * @returns {void}
   */
  const toggleProject = (projectId) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      const id = String(projectId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return {
    selectedProjectIds, setSelectedProjectIds, selectedVisibleProjects,
    selectedVisibleCount, headerChecked, toggleAllVisible, toggleProject,
  };
}
