// Ruta de la consulta administrativa de una solicitud (solo rol admin; ver main.jsx).
export const ADMIN_PROJECT_REQUEST_ROUTE = "/solicitudes-proyecto/:projectRequestId";

/**
 * Construye el enlace directo a la consulta administrativa de una solicitud.
 *
 * @param {number|string} projectRequestId - ID de la solicitud.
 * @returns {string} Ruta `/solicitudes-proyecto/:id`.
 */
export function getAdminProjectRequestPath(projectRequestId) {
  return `/solicitudes-proyecto/${encodeURIComponent(projectRequestId)}`;
}

// Consulta del cliente de una de sus solicitudes (solo rol client; ver main.jsx). La solicitud se
// lee del backend por id, que solo la entrega a su propietario.
export const CLIENT_PROJECT_REQUEST_ROUTE = "/solicitudes/:projectRequestId";

/**
 * Construye el enlace persistente a la consulta del cliente de una solicitud.
 *
 * @param {number|string} projectRequestId - ID de la solicitud.
 * @returns {string} Ruta `/solicitudes/:id`.
 */
export function getClientProjectRequestPath(projectRequestId) {
  return `/solicitudes/${encodeURIComponent(projectRequestId)}`;
}

/**
 * Normaliza el ID de la URL: solo enteros positivos identifican una solicitud.
 * Un ID inválido se trata como inexistente sin consultar la API.
 *
 * @param {string|undefined} value - Parámetro `projectRequestId` de la ruta.
 * @returns {number|null} ID numérico o null si no es válido.
 */
export function parseProjectRequestId(value) {
  if (!/^[1-9]\d{0,17}$/.test(String(value ?? ""))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

// Edición administrativa de una solicitud con el mismo formulario de creación (solo rol admin).
export const ADMIN_PROJECT_REQUEST_EDIT_ROUTE = "/solicitudes-proyecto/:projectRequestId/editar";

/**
 * Construye el enlace al formulario «Editar solicitud» del administrador.
 *
 * @param {number|string} projectRequestId - ID de la solicitud.
 * @returns {string} Ruta `/solicitudes-proyecto/:id/editar`.
 */
export function getAdminProjectRequestEditPath(projectRequestId) {
  return `${getAdminProjectRequestPath(projectRequestId)}/editar`;
}
