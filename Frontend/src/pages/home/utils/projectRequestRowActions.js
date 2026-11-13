import { getClientProjectRequestPath } from "../../../utils/projectRequestRoutes.js";
import { getProjectRequestClientReason } from "../../../utils/projectRequestStatus.js";

export const DEFAULT_REQUEST_ROW_MESSAGE = "Puedes consultar el avance y la decisión de nuestro equipo.";

// Acción estándar de toda solicitud en el listado: abre su seguimiento por id, donde el cliente ve
// el motivo o la decisión y la acción propia del estado (por ejemplo, «Corregir solicitud»).
const VIEW_REQUEST_LABEL = "Ver solicitud";

/**
 * Acciones de una solicitud en «Mis proyectos». La última es la principal (`Solid`); las
 * anteriores son secundarias (`Outline`).
 * - Todas las solicitudes, en cualquier estado: «Ver solicitud» abre «Solicitud recibida» o
 *   «Estado de la solicitud» por id (motivo del rechazo, información solicitada y corrección
 *   incluidos), nunca el formulario directamente.
 * - `converted` con el proyecto disponible: además, «Ver proyecto» como acción principal. Mientras
 *   el proyecto sea un borrador interno (`convertedProjectAvailable` falso) no se ofrece.
 *
 * @param {{status?: string, convertedProjectId?: number|null, convertedProjectAvailable?: boolean}} projectRequest - Solicitud del listado.
 * @returns {Array<{kind: "status"|"viewProject", label: string, type: "Outline"|"Solid"}>} Acciones en orden visual.
 */
export function getProjectRequestRowActions(projectRequest) {
  const projectAvailable = projectRequest?.status === "converted"
    && Boolean(projectRequest.convertedProjectId)
    && projectRequest.convertedProjectAvailable === true;
  return projectAvailable
    ? [
      { kind: "status", label: VIEW_REQUEST_LABEL, type: "Outline" },
      { kind: "viewProject", label: "Ver proyecto", type: "Solid" },
    ]
    : [{ kind: "status", label: VIEW_REQUEST_LABEL, type: "Solid" }];
}

/**
 * Destino de una acción de la fila. La consulta usa la ruta persistente por id (no el estado de
 * navegación); desde ella, «Corregir solicitud» abre el formulario con la misma solicitud.
 *
 * @param {Object} projectRequest - Solicitud del listado.
 * @param {"status"|"viewProject"} kind - Acción elegida.
 * @returns {{to: string}} Ruta de destino.
 */
export function getProjectRequestRowDestination(projectRequest, kind) {
  if (kind === "viewProject") return { to: `/proyectos/${projectRequest.convertedProjectId}` };
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
