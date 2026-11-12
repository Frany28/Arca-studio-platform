import { getClientProjectRequestPath } from "../../../utils/projectRequestRoutes.js";
import { getProjectRequestClientReason } from "../../../utils/projectRequestStatus.js";

export const DEFAULT_REQUEST_ROW_MESSAGE = "Puedes consultar el avance y la decisión de nuestro equipo.";

/**
 * Acciones de una solicitud en «Mis proyectos» según su estado real. La última es la principal
 * (`Solid`); las anteriores son secundarias (`Outline`).
 * - En evaluación (y estados sin acción propia): «Ver solicitud» abre el seguimiento por id.
 * - `converted`: «Ver resultado» abre «Estado de la solicitud» y «Ver proyecto» el proyecto creado
 *   (solo si sigue vinculado).
 * - `rejected`: «Ver motivo» abre «Estado de la solicitud», nunca el formulario directamente.
 * - `changes_requested`: «Corregir solicitud» reabre la misma solicitud en el formulario.
 *
 * @param {{status?: string, convertedProjectId?: number|null}} projectRequest - Solicitud del listado.
 * @returns {Array<{kind: "status"|"viewProject"|"correct", label: string, type: "Outline"|"Solid"}>} Acciones en orden visual.
 */
export function getProjectRequestRowActions(projectRequest) {
  switch (projectRequest?.status) {
    case "converted":
      return projectRequest.convertedProjectId
        ? [
          { kind: "status", label: "Ver resultado", type: "Outline" },
          { kind: "viewProject", label: "Ver proyecto", type: "Solid" },
        ]
        : [{ kind: "status", label: "Ver resultado", type: "Solid" }];
    case "rejected":
      return [{ kind: "status", label: "Ver motivo", type: "Solid" }];
    case "changes_requested":
      return [{ kind: "correct", label: "Corregir solicitud", type: "Solid" }];
    default:
      return [{ kind: "status", label: "Ver solicitud", type: "Solid" }];
  }
}

/**
 * Destino de una acción de la fila. La consulta usa la ruta persistente por id (no el estado de
 * navegación); corregir envía la solicitud al formulario, que recupera sus adjuntos del backend.
 *
 * @param {Object} projectRequest - Solicitud del listado.
 * @param {"status"|"viewProject"|"correct"} kind - Acción elegida.
 * @returns {{to: string, state?: Object}} Ruta y estado de navegación.
 */
export function getProjectRequestRowDestination(projectRequest, kind) {
  if (kind === "viewProject") return { to: `/proyectos/${projectRequest.convertedProjectId}` };
  if (kind === "correct") return { state: { initialRequest: projectRequest }, to: "/solicitudes/nueva" };
  return { to: getClientProjectRequestPath(projectRequest.id) };
}

/**
 * Texto de apoyo de la fila: el motivo que corresponde al estado (rechazo o correcciones) o un
 * texto neutral. La fila lo recorta a una línea; el texto completo se consulta con su acción.
 *
 * @param {Object} projectRequest - Solicitud del listado.
 * @returns {string} Texto de apoyo.
 */
export function getProjectRequestRowMessage(projectRequest) {
  return getProjectRequestClientReason(projectRequest) || DEFAULT_REQUEST_ROW_MESSAGE;
}
