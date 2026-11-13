import { buildProjectRequestPayload } from "../../../utils/projectRequestValidation.js";

// Texto de los adjuntos en la edición: ya pertenecen a la solicitud enviada (no están pendientes).
export const ADMIN_EDIT_ATTACHMENT_LABEL = "Adjunto de la solicitud";
// La edición administrativa no añade ni elimina adjuntos: se conservan tal como los envió el cliente.
export const ADMIN_EDIT_ATTACHMENTS_MESSAGE = "Los archivos adjuntos se conservan sin cambios al guardar. Solo el cliente puede añadir o eliminar archivos de su solicitud.";

/**
 * Representa el formulario como el cuerpo que se enviaría al guardar, normalizado y serializado.
 * Sirve para detectar cambios reales: dos formularios equivalentes (por ejemplo, respuestas
 * condicionales ocultas que no se envían) producen la misma huella.
 *
 * @param {Object} form - Campos de useProjectRequestForm.
 * @returns {string} Huella del cuerpo que se enviaría.
 */
export function getProjectRequestFormFingerprint(form) {
  return JSON.stringify(buildProjectRequestPayload(form));
}

/**
 * Construye el cuerpo de `PUT /admin/project-requests/:id/form`: las mismas respuestas que envía
 * el cliente (buildProjectRequestPayload, sin `submissionId`) y la versión con la que se abrió el
 * formulario, que el backend compara para no sobrescribir cambios posteriores.
 *
 * @param {Object} form - Campos de useProjectRequestForm.
 * @param {string} expectedUpdatedAt - `updatedAt` de la solicitud leída al abrir el formulario.
 * @returns {Object} Cuerpo de la edición administrativa.
 */
export function buildAdminProjectRequestEditPayload(form, expectedUpdatedAt) {
  return { ...buildProjectRequestPayload(form), expectedUpdatedAt };
}

/**
 * Traduce un error al guardar en el aviso que ve el administrador. El formulario conserva lo
 * ingresado en todos los casos; un conflicto de versión o de estado ofrece recargar la solicitud.
 *
 * @param {Error & {status?: number, code?: string, fields?: Object|null}} error - Error de la API.
 * @returns {{canReload: boolean, description: string, title: string}} Aviso del guardado.
 */
export function getAdminProjectRequestSaveFailure(error) {
  const fields = error?.fields && typeof error.fields === "object" ? Object.values(error.fields).filter(Boolean) : [];
  if (error?.code === "PROJECT_REQUEST_EDIT_CONFLICT") {
    return {
      canReload: true,
      description: "Otra persona modificó la solicitud mientras la editabas. Recárgala para ver la versión vigente; tus cambios no se guardaron.",
      title: "La solicitud cambió",
    };
  }
  if (error?.code === "PROJECT_REQUEST_NOT_EDITABLE") {
    return {
      canReload: true,
      description: "La solicitud ya tiene una decisión o volvió al cliente, así que no admite edición.",
      title: "La solicitud ya no se puede editar",
    };
  }
  if (error?.status === 403) {
    return { canReload: false, description: "Tu cuenta no tiene permiso para editar solicitudes.", title: "Sin permiso" };
  }
  if (error?.status === 404) {
    return { canReload: false, description: "La solicitud ya no existe o no está disponible.", title: "Solicitud no encontrada" };
  }
  return {
    canReload: false,
    description: fields[0] || error?.message || "Revisa la conexión e inténtalo de nuevo.",
    title: error?.status === 400 || error?.status === 409 ? "Revisa la información" : "No se pudieron guardar los cambios",
  };
}
