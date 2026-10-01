/* Gestiona la restauración de sesión, reintentos y cancelación de solicitudes de autenticación. */
export const AUTH_SESSION_STATUS = Object.freeze({
  AUTHENTICATED: "authenticated",
  LOADING: "loading",
  TEMPORARILY_UNAVAILABLE: "temporarily-unavailable",
  UNAUTHENTICATED: "unauthenticated",
});

export const AUTH_RETRY_DELAYS_MS = Object.freeze([250, 750]);

// Detecta cuando el backend confirma que ya no existe una sesión válida.
export function isDefinitiveAuthenticationFailure(error) {
  return error?.status === 401 && error?.code === "UNAUTHENTICATED";
}

// Determina si un fallo temporal admite reintentos automáticos.
export function isRetryableAuthenticationFailure(error) {
  return (
    !Number.isInteger(error?.status) ||
    error.status === 429 ||
    error.status >= 500
  );
}

// Espera antes de un reintento y permite cancelar la espera mediante AbortSignal.
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

// Intenta restaurar la sesión aplicando reintentos cortos y jitter ante fallos temporales.
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

// Evita restauraciones duplicadas y expone una forma de cancelar la solicitud activa.
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
