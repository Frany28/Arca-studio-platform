/**
 * Traduce el fallo de la lectura de una solicitud propia a un estado de la interfaz del cliente.
 * El backend responde 404 tanto a una solicitud inexistente como a una de otro cliente (no revela
 * su existencia), así que ambos casos comparten el mismo mensaje. 401/403 indican una sesión sin
 * ficha de cliente o sin permiso; sin estado HTTP, un fallo de conexión. Solo los fallos
 * transitorios ofrecen reintentar.
 *
 * @param {{error?: string, errorStatus?: number|null}} failure - Mensaje y estado HTTP de la lectura.
 * @returns {{kind: "not_found"|"forbidden"|"connection"|"error", title: string, description: string, canRetry: boolean}}
 *   Estado presentable.
 */
export function getClientProjectRequestFailure({ error = "", errorStatus = null } = {}) {
  if (errorStatus === 400 || errorStatus === 404) {
    return {
      canRetry: false,
      description: "Es posible que el enlace no sea correcto o que la solicitud no pertenezca a tu cuenta.",
      kind: "not_found",
      title: "No encontramos esta solicitud",
    };
  }
  if (errorStatus === 401 || errorStatus === 403) {
    return {
      canRetry: false,
      description: "Tu cuenta no tiene permiso para consultar esta solicitud.",
      kind: "forbidden",
      title: "No puedes ver esta solicitud",
    };
  }
  if (errorStatus == null) {
    return {
      canRetry: true,
      description: "Comprueba tu conexión e inténtalo de nuevo.",
      kind: "connection",
      title: "No se pudo conectar con el servidor",
    };
  }
  return {
    canRetry: true,
    description: error || "Inténtalo de nuevo en unos minutos.",
    kind: "error",
    title: "No pudimos cargar la solicitud",
  };
}
