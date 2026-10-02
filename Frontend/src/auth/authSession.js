/* Gestiona la restauración de sesión, reintentos y cancelación de solicitudes de autenticación. */
export const AUTH_SESSION_STATUS = Object.freeze({
  AUTHENTICATED: "authenticated",
  LOADING: "loading",
  TEMPORARILY_UNAVAILABLE: "temporarily-unavailable",
  UNAUTHENTICATED: "unauthenticated",
});

export const AUTH_RETRY_DELAYS_MS = Object.freeze([250, 750]);

// Confirma la sesión tras el login y devuelve únicamente el usuario confirmado por el backend.
/**
 * Comprueba que login devuelve usuario y confirma despu?s la sesi?n con fetchSession.
 * El usuario retornado procede de la confirmaci?n, no de la respuesta inicial.
 *
 * @param {Object} params - Dependencias y credenciales de acceso.
 * @param {Object} params.credentials - Credenciales para requestLogin.
 * @param {Function} params.requestLogin - Petici?n de inicio de sesi?n.
 * @param {Function} params.fetchSession - Consulta de sesi?n posterior.
 * @returns {Promise<Object>} Usuario confirmado.
 * @throws {Error} Falta de usuario o rechazo de alguna petici?n.
 */
export async function loginAndConfirmSession({
  credentials,
  requestLogin,
  fetchSession,
}) {
  const data = await requestLogin(credentials);

  if (!data.user) {
    throw Object.assign(
      new Error("El backend de autenticación no está actualizado."),
      { code: "AUTH_SESSION_MISSING" },
    );
  }

  const session = await fetchSession();

  if (!session?.user) {
    throw Object.assign(new Error("No se pudo confirmar la sesión."), {
      code: "AUTH_SESSION_MISSING",
    });
  }

  return session.user;
}

/**
 * Reconoce ?nicamente el rechazo 401 con c?digo UNAUTHENTICATED.
 *
 * @param {Object} error - Error de autenticaci?n a clasificar.
 * @returns {boolean} Si el backend confirma ausencia de sesi?n.
 */
export function isDefinitiveAuthenticationFailure(error) {
  return error?.status === 401 && error?.code === "UNAUTHENTICATED";
}

/**
 * Clasifica fallos sin status entero, 429 y errores 5xx como reintentables.
 *
 * @param {Object} error - Error de la consulta de sesi?n.
 * @returns {boolean} Si admite reintento autom?tico.
 */
export function isRetryableAuthenticationFailure(error) {
  return (
    !Number.isInteger(error?.status) ||
    error.status === 429 ||
    error.status >= 500
  );
}

/**
 * Espera en el navegador antes de reintentar y libera el temporizador al cancelar.
 *
 * @param {number} delayMs - Espera en milisegundos.
 * @param {Object} [signal] - AbortSignal para cancelar la espera.
 * @returns {Promise<void>} Se resuelve al completar la espera.
 * @throws {DOMException} La promesa rechaza con AbortError al cancelar.
 */
export function waitForRetry(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

/**
 * Restaura la sesi?n con reintentos limitados y jitter ante fallos temporales.
 * Distingue ausencia confirmada de sesi?n de indisponibilidad del servicio.
 *
 * @param {Object} params - Dependencias y pol?tica de restauraci?n.
 * @param {Function} params.fetchSession - Consulta que recibe signal.
 * @param {Function} [params.random=Math.random] - Fuente del jitter.
 * @param {Array} [params.retryDelays] - Esperas entre intentos en milisegundos.
 * @param {Object} [params.signal] - AbortSignal de la restauraci?n.
 * @param {Function} [params.wait=waitForRetry] - Espera cancelable entre intentos.
 * @returns {Promise<Object>} status, user y error si queda indisponible.
 * @throws {DOMException} La cancelaci?n se propaga como AbortError.
 */
export async function restoreAuthSession({
  fetchSession,
  random = Math.random,
  retryDelays = AUTH_RETRY_DELAYS_MS,
  signal,
  wait = waitForRetry,
}) {
  let lastError;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const data = await fetchSession({ signal });
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (!data?.user || typeof data.user !== "object") {
        const error = new Error("La respuesta de sesión no es válida.");
        error.code = "AUTH_SESSION_INVALID";
        throw error;
      }
      return {
        status: AUTH_SESSION_STATUS.AUTHENTICATED,
        user: data?.user || null,
      };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (isDefinitiveAuthenticationFailure(error)) {
        return {
          status: AUTH_SESSION_STATUS.UNAUTHENTICATED,
          user: null,
        };
      }

      lastError = error;
      if (
        !isRetryableAuthenticationFailure(error) ||
        attempt === retryDelays.length
      ) {
        break;
      }

      const jitterMs = Math.floor(Math.max(0, random()) * 150);
      await wait(retryDelays[attempt] + jitterMs, signal);
    }
  }

  return {
    error: lastError,
    status: AUTH_SESSION_STATUS.TEMPORARILY_UNAVAILABLE,
    user: null,
  };
}

/**
 * Comparte la promesa de restauraci?n entre llamadas concurrentes.
 * cancel aborta la operaci?n activa; al finalizar se permite una nueva restauraci?n.
 *
 * @param {Object} options - Opciones de restoreAuthSession; la se?al se crea internamente.
 * @returns {Object} Acciones restore (Promise de estado) y cancel.
 */
export function createAuthSessionRestorer(options) {
  let controller = null;
  let inFlight = null;

  return {
    cancel() {
      controller?.abort();
    },
    restore() {
      if (inFlight) return inFlight;

      controller = new AbortController();
      const currentController = controller;
      const request = restoreAuthSession({
        ...options,
        signal: currentController.signal,
      }).finally(() => {
        if (inFlight === request) inFlight = null;
        if (controller === currentController) controller = null;
      });

      inFlight = request;
      return request;
    },
  };
}
