import { useState } from "react";

import { api } from "../../../../api/http.js";
import { PROJECT_KIND, findExactProjectMatch } from "../utils/quoteDraft.js";
import { useRemoteOptions } from "./useRemoteOptions.js";

/**
 * Lee los proyectos del cliente elegido para el selector de la cotización.
 *
 * @param {number} clientId - Cliente propietario.
 * @param {{search?: string, limit: number, signal: AbortSignal}} query - Búsqueda y cancelación.
 * @returns {Promise<Array<Object>>} Proyectos del cliente.
 */
async function loadClientProjects(clientId, query) {
  return (await api.quotes.listClientProjects({ ...query, clientId })).projects;
}

/**
 * Estado del campo «Nombre del proyecto». El proyecto elegido vive en el borrador: uno existente
 * (`{kind: "existing", id, name}`) o, solo en el alta, el nombre escrito de uno nuevo
 * (`{kind: "new", name}`), que el backend crea como Draft al guardar. En la edición el texto es
 * solo una búsqueda local. Las sugerencias son siempre del cliente elegido (cambiarlo relee y
 * aborta la lectura anterior) y la coincidencia exacta con un proyecto existente se expone para
 * pedir que se seleccione, sin vincularlo en silencio. Un cliente nuevo todavía no tiene proyectos:
 * no se consultan sugerencias y solo cabe escribir el nombre de un proyecto nuevo.
 *
 * @param {Object} params - Borrador y modo.
 * @param {boolean} params.allowNewProject - Permite escribir un proyecto nuevo (solo en el alta).
 * @param {{id: number}|null} params.client - Cliente elegido.
 * @param {Object|null} params.project - Proyecto del borrador.
 * @param {(project: Object|null) => void} params.onProjectChange - Cambia el proyecto del borrador.
 * @returns {{query: string, remote: Object, selectedProject: Object|null, newProjectName: string,
 *   exactMatch: Object|null, changeQuery: (text: string) => void, resetSearch: () => void}} Estado y acciones.
 */
export function useQuoteProjectField({ allowNewProject, client, onProjectChange, project }) {
  const [search, setSearch] = useState("");
  const selectedProject = project?.kind === PROJECT_KIND.EXISTING ? project : null;
  const newProjectName = project?.kind === PROJECT_KIND.NEW ? project.name : "";
  const query = allowNewProject ? newProjectName : search;
  const remote = useRemoteOptions({
    enabled: client?.id != null && !selectedProject,
    load: (options) => loadClientProjects(client.id, options),
    query,
    scope: String(client?.id ?? ""),
  });
  // Solo con la respuesta de la búsqueda vigente: mientras carga, las opciones aún no corresponden.
  const exactMatch = newProjectName && !remote.loading ? findExactProjectMatch(remote.options, newProjectName) : null;

  return {
    changeQuery(text) {
      if (!allowNewProject) {
        setSearch(text);
        return;
      }
      onProjectChange(text.trim() ? { kind: PROJECT_KIND.NEW, name: text } : null);
    },
    exactMatch,
    newProjectName,
    query,
    remote,
    resetSearch: () => setSearch(""),
    selectedProject,
  };
}
