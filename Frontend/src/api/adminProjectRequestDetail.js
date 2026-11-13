/* Deduplica las lecturas administrativas de una solicitud (detalle y formulario editable) mientras están en curso. */
import { api } from "./http.js";

// Clave: usuario + ID de la solicitud. Alcance: pestaña actual (ruta exclusiva de
// administradores); incluir al usuario impide entregar una lectura iniciada con otra sesión.
// Duración: solo mientras la petición está en curso; al resolverse o fallar se elimina, de
// modo que cada visita, reintento o revalidación lee el estado vigente y ningún error queda en caché.
// Cada lectura tiene su propio mapa: el detalle y el formulario editable son respuestas distintas.
const inFlightByKey = new Map();
const formInFlightByKey = new Map();

/**
 * Reutiliza la petición equivalente en curso de un mapa de lecturas (o inicia otra con `fresh`) y
 * entrega su resultado al consumidor salvo que su señal se cancele. La señal del consumidor no
 * cancela la petición compartida, solo su uso del resultado; al resolverse o fallar la entrada se
 * elimina, de modo que ninguna respuesta ni error queda en caché.
 *
 * @param {Map<string, Promise>} inFlight - Lecturas en curso de este recurso.
 * @param {string} key - Usuario de la sesión + ID de la solicitud.
 * @param {() => Promise<Object>} start - Inicia la petición HTTP.
 * @param {{fresh?: boolean, signal?: AbortSignal}} options - Lectura sin reutilización y cancelación.
 * @returns {Promise<Object>} Respuesta compartida.
 */
function shareInFlightRead(inFlight, key, start, { fresh = false, signal } = {}) {
  let request = fresh ? null : inFlight.get(key);

  if (!request) {
    const current = start()
      // Solo se retira la entrada propia: una lectura `fresh` posterior pudo sustituirla.
      .finally(() => {
        if (inFlight.get(key) === current) inFlight.delete(key);
      });
    request = current;
    inFlight.set(key, request);
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
  return shareInFlightRead(inFlightByKey, key, () => api.admin.getProjectRequest({ projectRequestId }), { fresh, signal });
}

/**
 * Lee la solicitud en su forma editable («Editar solicitud») reutilizando la petición equivalente
 * en curso, con la misma clave, alcance y duración que el detalle: evita la lectura duplicada del
 * doble montaje de StrictMode sin cachear respuestas ni errores entre visitas.
 *
 * @param {number|string} projectRequestId - Solicitud a editar.
 * @param {{signal?: AbortSignal, scopeKey?: number|string, fresh?: boolean}} [options] - Cancelación
 *   del consumidor, usuario de la sesión y lectura sin reutilización.
 * @returns {Promise<{projectRequest: Object}>} Respuesta de `GET /admin/project-requests/:id/form`.
 */
export function loadAdminProjectRequestForm(projectRequestId, { fresh = false, scopeKey, signal } = {}) {
  const key = `${scopeKey ?? "admin-session"}:${projectRequestId}`;
  return shareInFlightRead(formInFlightByKey, key, () => api.admin.getProjectRequestForm({ projectRequestId }), { fresh, signal });
}
