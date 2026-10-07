import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import { getRequestClientFailure, normalizeRequestClientUserId } from "../utils/adminRequestClient.js";

const EMPTY_RESULT = { client: null, error: "", key: null };

/**
 * Lee el nombre y la empresa del cliente de una solicitud mediante el endpoint
 * administrativo existente `GET /admin/users/:userId` (solo administradores).
 *
 * Usa requestedBy (users.id), nunca clientId (clients.id), y omite IDs inválidos.
 * Cada lectura se identifica con `userId:revisión`; `loading` se deriva de que el
 * resultado guardado no corresponda a la clave vigente, sin estados síncronos en el efecto.
 * Al reabrir el drawer del mismo cliente se muestra el último resultado mientras se
 * revalida, porque los datos del usuario pueden haber cambiado desde Gestión de usuarios.
 * Las respuestas de lecturas anteriores se cancelan con AbortController.
 *
 * @param {Object} params - Cliente a consultar y habilitación.
 * @param {number|string|null} params.userId - ID del usuario solicitante; inválido omite la lectura.
 * @param {boolean} params.enabled - Solo lee mientras el drawer está abierto.
 * @returns {Object} Cliente, carga, ausencia, diagnóstico HTTP y reintento independiente.
 */
export function useAdminRequestClient({ userId, enabled }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(EMPTY_RESULT);
  const validUserId = normalizeRequestClientUserId(userId);
  const requestKey = validUserId == null ? null : `${validUserId}:${revision}`;
  const active = enabled && requestKey !== null;

  useEffect(() => {
    if (!active) return undefined;

    const controller = new AbortController();
    api.admin
      .getUserDetails({ signal: controller.signal, userId: validUserId })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setResult({ client: payload?.user || null, error: "", key: requestKey });
      })
      .catch((error) => {
        // Algunos transportes finalizan después del abort; ninguna respuesta obsoleta
        // puede sobrescribir el cliente actual ni mostrar errores al cerrar el drawer.
        if (controller.signal.aborted || error?.name === "AbortError") return;
        setResult({
          client: null,
          ...getRequestClientFailure(error),
          key: requestKey,
        });
      });

    return () => controller.abort();
  }, [active, validUserId, requestKey]);

  // Un resultado de otro cliente nunca se muestra; uno del mismo cliente sirve como
  // valor previo mientras se revalida o reintenta.
  const belongsToClient = requestKey !== null && Boolean(result.key?.startsWith(`${validUserId}:`));
  const client = belongsToClient ? result.client : null;
  const current = belongsToClient && result.key === requestKey;

  return {
    client,
    error: current ? result.error : "",
    status: current ? result.status ?? null : null,
    code: current ? result.code ?? null : null,
    unavailable: validUserId === null || (current && Boolean(result.unavailable)),
    canRetry: current && Boolean(result.canRetry),
    loading: active && result.key !== requestKey && !client,
    retry: () => setRevision((current) => current + 1),
  };
}
