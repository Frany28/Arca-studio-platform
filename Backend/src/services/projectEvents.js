import { sanitizePublicPayload } from "../utils/publicPayload.js";

const projectClients = new Map();
const userConnectionCounts = new Map();
let eventSequence = 0;

/**
 * Obtiene el valor de proyecto key para que el flujo llamador pueda continuar.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function getProjectKey(projectId) {
  return String(projectId);
}

/**
 * Envía el valor de evento y traduce los fallos externos al contrato de errores.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {import("express").Response} response - Respuesta o conexión sobre la que se escribe el resultado.
 * @param {string} eventName - Valor de `eventName` requerido por esta operación.
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {void} Finalización de la operación.
 */
function sendEvent(response, eventName, payload) {
  eventSequence += 1;
  response.write(`id: ${Date.now()}-${eventSequence}\n`);
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(sanitizePublicPayload(payload))}\n\n`);
}

/**
 * Intervalo entre revalidaciones de una suscripción abierta. En un servidor de larga duración (VPS)
 * una conexión SSE puede durar horas; este valor acota cuánto tarda en cerrarse tras revocarse la
 * sesión o el acceso al proyecto.
 *
 * @returns {number} Milisegundos entre revalidaciones (por defecto 30 s).
 */
function getReauthorizeIntervalMs() {
  const value = Number(process.env.SSE_REAUTHORIZE_INTERVAL_MS);
  return Number.isInteger(value) && value > 0 ? value : 30000;
}

/**
 * Suscribe una respuesta SSE a los eventos de un proyecto y administra el ciclo de vida de la conexión.
 * Si se proporciona `reauthorize`, la vuelve a evaluar periódicamente y cierra el stream cuando deja
 * de devolver true o falla (falla cerrado): así una revocación de sesión, una desactivación o la
 * pérdida del acceso al proyecto también cortan las conexiones ya abiertas.
 *
 * @param {object} options - Datos de la suscripción.
 * @param {string} options.projectId - Proyecto cuyos eventos se reciben.
 * @param {import("express").Response} options.response - Respuesta SSE abierta.
 * @param {string} options.userId - Usuario suscrito, para el límite de conexiones.
 * @param {() => Promise<boolean>} [options.reauthorize] - Comprobación periódica de acceso vigente.
 * @returns {() => void} Función que cancela la suscripción.
 * @throws {Error} `SSE_CONNECTION_LIMIT` cuando se supera el límite por usuario o por proyecto.
 */
export function subscribeToProjectEvents({ projectId, response, userId, reauthorize }) {
  const projectKey = getProjectKey(projectId);
  const clients = projectClients.get(projectKey) || new Set();
  const userKey = String(userId);
  const perUserLimit = Number(process.env.SSE_MAX_CONNECTIONS_PER_USER || 5);
  const perProjectLimit = Number(process.env.SSE_MAX_CONNECTIONS_PER_PROJECT || 100);

  if ((userConnectionCounts.get(userKey) || 0) >= perUserLimit || clients.size >= perProjectLimit) {
    const error = new Error("SSE connection limit reached");
    error.code = "SSE_CONNECTION_LIMIT";
    throw error;
  }

  clients.add(response);
  projectClients.set(projectKey, clients);
  userConnectionCounts.set(userKey, (userConnectionCounts.get(userKey) || 0) + 1);

  sendEvent(response, "project.connected", {
    projectId: Number(projectId),
    timestamp: new Date().toISOString(),
  });

  const heartbeat = setInterval(() => {
    response.write(": heartbeat\n\n");
  }, 25000);

  let closed = false;
  let reauthorizing = false;
  let reauthorization = null;
    /**
   * Procesa el valor de unsubscribe para completar la responsabilidad asignada al módulo.
   * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
   *
   * @returns {void} Finalización de la operación.
   */
const unsubscribe = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (reauthorization) clearInterval(reauthorization);
    clients.delete(response);
    const remaining = Math.max(0, (userConnectionCounts.get(userKey) || 1) - 1);
    if (remaining) userConnectionCounts.set(userKey, remaining);
    else userConnectionCounts.delete(userKey);

    if (clients.size === 0) {
      projectClients.delete(projectKey);
    }
  };

  /**
   * Revalida la suscripción y, si el acceso ya no es vigente o la comprobación falla, la cancela y
   * cierra el stream. Evita revalidaciones solapadas si una consulta tarda más que el intervalo.
   *
   * @returns {Promise<void>} Finalización de la revalidación.
   */
  const revalidateSubscription = async () => {
    if (closed || reauthorizing) return;
    reauthorizing = true;
    let allowed = false;
    try {
      allowed = (await reauthorize()) === true;
    } catch {
      allowed = false;
    } finally {
      reauthorizing = false;
    }
    if (allowed || closed) return;
    unsubscribe();
    if (!response.writableEnded) response.end();
  };

  if (typeof reauthorize === "function") {
    reauthorization = setInterval(revalidateSubscription, getReauthorizeIntervalMs());
  }
  response.on("error", unsubscribe);
  return unsubscribe;
}

/**
 * Comprueba la capacidad de conexiones de eventos del proyecto y rechaza la operación cuando no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {void} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export function assertProjectEventCapacity({ projectId, userId }) {
  const clients = projectClients.get(getProjectKey(projectId)) || new Set();
  const perUserLimit = Number(process.env.SSE_MAX_CONNECTIONS_PER_USER || 5);
  const perProjectLimit = Number(process.env.SSE_MAX_CONNECTIONS_PER_PROJECT || 100);
  if ((userConnectionCounts.get(String(userId)) || 0) >= perUserLimit || clients.size >= perProjectLimit) {
    const error = new Error("SSE connection limit reached");
    error.code = "SSE_CONNECTION_LIMIT";
    throw error;
  }
}

/**
 * Publica el valor de proyecto evento a todas las conexiones suscritas que sigan activas.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.eventName - Valor de `options.eventName` requerido por esta operación.
 * @param {unknown} options.payload - Valor de `options.payload` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @returns {void} Finalización de la operación.
 */
export function publishProjectEvent({ eventName, payload, projectId }) {
  const clients = projectClients.get(getProjectKey(projectId));

  if (!clients || clients.size === 0) {
    return;
  }

  for (const response of clients) {
    if (!response.destroyed && !response.writableEnded) sendEvent(response, eventName, payload);
  }
}

/**
 * Cierra el valor de all proyecto evento connections y libera los recursos asociados.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @returns {void} Finalización de la operación.
 */
export function closeAllProjectEventConnections() {
  for (const clients of projectClients.values()) {
    for (const response of clients) response.end();
  }
  projectClients.clear();
  userConnectionCounts.clear();
}

export const projectEventBus = {
  close: closeAllProjectEventConnections,
  publish: publishProjectEvent,
  subscribe: subscribeToProjectEvents,
};
