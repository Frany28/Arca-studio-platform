/* Deduplica la lectura del detalle administrativo de una solicitud mientras está en curso. */
import { api } from "./http.js";

// Clave: usuario + ID de la solicitud. Alcance: pestaña actual (ruta exclusiva de
// administradores); incluir al usuario impide entregar una lectura iniciada con otra sesión.
// Duración: solo mientras la petición está en curso; al resolverse o fallar se elimina, de
// modo que cada visita, reintento o revalidación lee el estado vigente y ningún error queda en caché.
const inFlightByKey = new Map();

/**
 * Lee el detalle administrativo de una solicitud reutilizando la petición equivalente en curso.
 * Evita la lectura duplicada cuando la vista se monta dos veces seguidas (StrictMode o una
 * remontada inmediata): el consumidor cancelado descarta la respuesta y el siguiente la usa.
 * La señal del consumidor no cancela la petición compartida, solo su uso del resultado.
 *
 * Con `fresh` (lectura posterior a una mutación propia) no reutiliza la petición en curso, que
 * pudo empezar antes del cambio: inicia otra y la deja como compartida para las siguientes.
 *
 * @param {number|string} projectRequestId - Solicitud a consultar.
 * @param {{signal?: AbortSignal, scopeKey?: number|string, fresh?: boolean}} [options] - Cancelación
 *   del consumidor, usuario de la sesión que delimita la deduplicación y lectura sin reutilización.
 * @returns {Promise<{projectRequest: Object}>} Respuesta de `GET /admin/project-requests/:id`.
 */
export function loadAdminProjectRequest(projectRequestId, { fresh = false, scopeKey, signal } = {}) {
  const key = `${scopeKey ?? "admin-session"}:${projectRequestId}`;
  let request = fresh ? null : inFlightByKey.get(key);

  if (!request) {
    const current = api.admin
      .getProjectRequest({ projectRequestId })
      // Solo se retira la entrada propia: una lectura `fresh` posterior pudo sustituirla.
      .finally(() => {
        if (inFlightByKey.get(key) === current) inFlightByKey.delete(key);
      });
    request = current;
    inFlightByKey.set(key, request);
  }

  if (!signal) return request;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
