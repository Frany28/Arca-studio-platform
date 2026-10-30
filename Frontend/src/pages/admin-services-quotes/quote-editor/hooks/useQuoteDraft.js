import { useReducer } from "react";

import { addServicesToLines, replaceLineService } from "../utils/quoteDraft.js";

/**
 * Aplica una acción del formulario al borrador. Cambiar de cliente retira el proyecto, porque un
 * proyecto solo pertenece a su cliente; el resto de acciones modifica únicamente su campo.
 *
 * @param {Object} draft - Borrador actual.
 * @param {{type: string}} action - Acción con sus datos.
 * @returns {Object} Borrador resultante.
 */
function quoteDraftReducer(draft, action) {
  switch (action.type) {
    case "reset":
      return action.draft;
    case "setClient":
      return draft.client?.id === action.client?.id ? { ...draft, client: action.client } : { ...draft, client: action.client, project: null };
    case "setProject":
      return { ...draft, project: action.project };
    case "setNotes":
      return { ...draft, notes: action.notes };
    case "addServices":
      return { ...draft, lines: addServicesToLines(draft.lines, action.services) };
    case "replaceService":
      return { ...draft, lines: replaceLineService(draft.lines, action.key, action.service) };
    case "removeLine":
      return { ...draft, lines: draft.lines.filter((line) => line.key !== action.key) };
    case "removeLines":
      return { ...draft, lines: draft.lines.filter((line) => !action.keys.includes(line.key)) };
    case "updateLine":
      return { ...draft, lines: draft.lines.map((line) => (line.key === action.key ? { ...line, [action.field]: action.value } : line)) };
    default:
      return draft;
  }
}

/**
 * Estado del borrador de una cotización con acciones de intención explícita. El borrador vive solo
 * en memoria del formulario: nada se guarda hasta que el servidor confirma el alta o la edición.
 *
 * @param {Object} initialDraft - Borrador inicial (vacío o leído de la cotización).
 * @returns {{draft: Object, actions: Object}} Borrador y acciones.
 */
export function useQuoteDraft(initialDraft) {
  const [draft, dispatch] = useReducer(quoteDraftReducer, initialDraft);
  return {
    actions: {
      addServices: (services) => dispatch({ services, type: "addServices" }),
      removeLine: (key) => dispatch({ key, type: "removeLine" }),
      removeLines: (keys) => dispatch({ keys, type: "removeLines" }),
      replaceService: (key, service) => dispatch({ key, service, type: "replaceService" }),
      reset: (nextDraft) => dispatch({ draft: nextDraft, type: "reset" }),
      setClient: (client) => dispatch({ client, type: "setClient" }),
      setNotes: (notes) => dispatch({ notes, type: "setNotes" }),
      setProject: (project) => dispatch({ project, type: "setProject" }),
      updateLine: (key, field, value) => dispatch({ field, key, type: "updateLine", value }),
    },
    draft,
  };
}
