// Filas de solicitudes de proyecto en la tabla de Gestión de proyectos (Figma 3727:686417): se
// muestran junto a los proyectos con el estado «Solicitud» y progreso 0 %. Funciones puras.

export const PROJECT_REQUEST_ROW_KIND = "request";

/**
 * Indica si una fila de la tabla es una solicitud (y no un proyecto).
 *
 * @param {Object|null} row - Fila de la tabla.
 * @returns {boolean} true si representa una solicitud.
 */
export function isProjectRequestRow(row) {
  return row?.kind === PROJECT_REQUEST_ROW_KIND;
}

/**
 * Convierte una solicitud abierta de la cola administrativa en una fila de la tabla. El id lleva
 * prefijo para no coincidir con el de un proyecto (claves, selección y filtros por id); el id real
 * se conserva en `requestId`. No es editable ni pública: su gestión vive en su página de detalle.
 *
 * @param {{id: number, projectName: string, clientId: number, clientName?: string|null, assignees?: Array<Object>,
 *   status: string, updatedAt?: string, createdAt?: string}} request - Solicitud de `listOpenProjectRequests`.
 * @returns {Object} Fila con la forma de un proyecto de la tabla.
 */
export function toProjectRequestRow(request) {
  const assignees = Array.isArray(request.assignees) ? request.assignees : [];
  return {
    assignedArchitect: assignees[0] || null,
    assignedArchitects: assignees,
    assignees,
    client: { id: request.clientId, name: request.clientName || "" },
    createdAt: request.createdAt || null,
    editable: false,
    id: `${PROJECT_REQUEST_ROW_KIND}-${request.id}`,
    isPublic: false,
    kind: PROJECT_REQUEST_ROW_KIND,
    name: request.projectName,
    progress: 0,
    requestId: request.id,
    requestStatus: request.status,
    status: "request",
    title: request.projectName,
    updatedAt: request.updatedAt || null,
  };
}
