import { useMemo, useState } from "react";
import {
  STATUS_FILTER_ITEMS, getAssignees, getClient, getStatusFilterId,
} from "../utils/adminProjectPresentation.js";

/**
 * Mantiene búsqueda y filtros locales, y deriva catálogo e intersección de proyectos.
 * Conserva orden, referencias y aliases; el consumidor coordina los resets de página,
 * selección y feedback para que este hook no dependa de esas responsabilidades.
 * @param {Object[]} projects Proyectos originales del consumidor.
 * @returns {{query: string, setQuery: Function, setStatusFilterIds: Function,
 * setPersonFilterIds: Function, personnelFilterItems: Object[], statusFilterItems: Object[],
 * filteredProjects: Object[], hasFilters: boolean}} Filtros controlados y resultados derivados.
 */
export function useAdminProjectFilters(projects) {
  const [query, setQuery] = useState("");
  const [statusFilterIds, setStatusFilterIds] = useState([]);
  const [personFilterIds, setPersonFilterIds] = useState([]);

  const personnel = useMemo(() => {
    // Map conserva el primer orden de inserción y los datos de la última coincidencia.
    const people = new Map();
    projects.forEach((project) => {
      getAssignees(project).forEach((person) => {
        if (person?.id || person?.name) people.set(String(person.id || person.name), person);
      });
    });
    return [...people.values()];
  }, [projects]);

  const personnelFilterItems = useMemo(() => [
    ...personnel.map((person) => ({
      id: String(person.id || person.name),
      label: person.name,
      type: "Checkbox",
      checked: personFilterIds.includes(String(person.id || person.name))
        ? "Yes"
        : "No",
    })),
  ], [personFilterIds, personnel]);

  const statusFilterItems = useMemo(
    () => STATUS_FILTER_ITEMS.map((item) => ({
      ...item,
      checked: statusFilterIds.includes(item.id) ? "Yes" : "No",
    })),
    [statusFilterIds],
  );

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return projects.filter((project) => {
      const assignees = getAssignees(project);
      const matchesQuery = !normalizedQuery || [project.title, project.name, getClient(project).name]
        .some((value) => String(value || "").toLocaleLowerCase("es").includes(normalizedQuery));
      const matchesStatus = statusFilterIds.length === 0
        || statusFilterIds.includes(getStatusFilterId(project.status));
      const matchesPerson = personFilterIds.length === 0 || assignees.some(
        (person) => personFilterIds.includes(String(person.id || person.name)),
      );
      return matchesQuery && matchesStatus && matchesPerson;
    });
  }, [personFilterIds, projects, query, statusFilterIds]);

  const hasFilters = Boolean(
    query || statusFilterIds.length > 0 || personFilterIds.length > 0,
  );

  return {
    query, setQuery, setStatusFilterIds, setPersonFilterIds,
    personnelFilterItems, statusFilterItems, filteredProjects, hasFilters,
  };
}
