import { useCallback, useEffect, useRef } from "react";

import { isDefinitiveAuthenticationFailure } from "../auth/authSession.js";
import { getSessionDataScopeKey } from "../auth/sessionDataScope.js";

/**
 * Plazo para que llegue la confirmación del propio 401. La restauración de AuthContext hace hasta
 * tres intentos con unos 1,3 s de esperas; si /auth/me no responde o falla (5xx), AuthContext no
 * publica nada y el reintento caduca. Así una confirmación posterior, provocada por otro 401, no
 * ejecuta una lectura ajena. Superado el plazo, la vista conserva el error y la acción manual.
 */
export const SESSION_CONFIRMATION_WINDOW_MS = 10_000;

/**
 * Reintenta una lectura rechazada con 401 UNAUTHENTICATED cuando AuthContext confirma que la
 * misma sesión sigue vigente, reutilizando su confirmación existente (sin otra llamada a /auth/me).
 *
 * Señal usada: ante ese 401, `apiRequest` avisa de forma síncrona al manejador global, que consulta
 * /auth/me y, si la sesión sigue activa, publica un objeto `user` nuevo con la misma clave de ámbito
 * (getSessionDataScopeKey). Como el aviso es síncrono y la confirmación requiere red, el `catch` de
 * la lectura siempre programa el reintento antes de que llegue el objeto nuevo. Resultados:
 * - misma clave y objeto distinto: sesión confirmada, se ejecuta el reintento una vez;
 * - clave distinta (otra cuenta, rol o cliente, o `null` por sesión expirada): se descarta, porque
 *   la propia vista relee por su clave o ProtectedRoute lleva al login;
 * - servicio no disponible: AuthContext no publica nada y la vista conserva el error; el reintento
 *   caduca tras SESSION_CONFIRMATION_WINDOW_MS para que una confirmación ajena posterior no lo ejecute.
 * El primer objeto `user` publicado tras programarlo lo consume siempre (se ejecute o no).
 *
 * El límite de un reintento lo aplica quien llama: solo programa desde el primer intento de una
 * lectura. Un reintento pendiente se descarta si su `signal` ya está abortada (lectura sustituida,
 * cambio de ámbito o desmontaje) o al llamar a `clear` (nueva lectura manual).
 *
 * @param {Object|null} user - Usuario publicado por AuthContext.
 * @returns {{ scheduleIfUnauthenticated: Function, clear: Function }} Acciones estables.
 */
export function useRetryAfterSessionConfirmation(user) {
  const pendingRef = useRef(null);
  // Usuario del último render confirmado: identifica la sesión vigente al programar el reintento.
  const committedUserRef = useRef(user);

  // Declarado antes de actualizar committedUserRef: compara el usuario nuevo con el del fallo.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || pending.user === user) return;
    pendingRef.current = null;
    if (pending.signal.aborted || Date.now() > pending.expiresAt) return;
    if (getSessionDataScopeKey(user) !== getSessionDataScopeKey(pending.user)) return;
    pending.retry();
  }, [user]);

  useEffect(() => {
    committedUserRef.current = user;
  }, [user]);

  /**
   * Programa `retry` si `error` es un 401 UNAUTHENTICATED; sustituye cualquier reintento pendiente.
   *
   * @param {Object} error - Error de la lectura fallida.
   * @param {AbortSignal} signal - Señal de la lectura fallida; si se aborta, el reintento se descarta.
   * @param {Function} retry - Repite la lectura (como segundo y último intento).
   * @returns {boolean} true si quedó programado.
   */
  const scheduleIfUnauthenticated = useCallback((error, signal, retry) => {
    if (!isDefinitiveAuthenticationFailure(error) || !committedUserRef.current) return false;
    pendingRef.current = {
      expiresAt: Date.now() + SESSION_CONFIRMATION_WINDOW_MS,
      retry,
      signal,
      user: committedUserRef.current,
    };
    return true;
  }, []);

  /** Descarta el reintento pendiente (por ejemplo, al iniciar una lectura manual). */
  const clear = useCallback(() => {
    pendingRef.current = null;
  }, []);

  return { clear, scheduleIfUnauthenticated };
}
