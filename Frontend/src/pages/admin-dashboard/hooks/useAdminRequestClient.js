import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

const EMPTY_RESULT = { client: null, error: "", key: null };

/**
 * Lee el nombre y la empresa del cliente de una solicitud mediante el endpoint
 * administrativo existente `GET /admin/users/:userId` (solo administradores).
 *
 * Cada lectura se identifica con `clientId:revisión`; `loading` se deriva de que el
 * resultado guardado no corresponda a la clave vigente, sin estados síncronos en el efecto.
 * Al reabrir el drawer del mismo cliente se muestra el último resultado mientras se
 * revalida, porque los datos del usuario pueden haber cambiado desde Gestión de usuarios.
 * Las respuestas de lecturas anteriores se cancelan con AbortController.
 *
 * @param {Object} params - Cliente a consultar y habilitación.
 * @param {number|null} params.clientId - ID del cliente; null omite la lectura.
 * @param {boolean} params.enabled - Solo lee mientras el drawer está abierto.
 * @returns {{client: Object|null, error: string, loading: boolean, retry: () => void}} Estado de la lectura.
 */
export function useAdminRequestClient({ clientId, enabled }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(EMPTY_RESULT);
  const requestKey = clientId == null ? null : `${clientId}:${revision}`;
  const active = enabled && requestKey !== null;

  useEffect(() => {
    if (!active) return undefined;

    const controller = new AbortController();
    api.admin
      .getUserDetails({ signal: controller.signal, userId: clientId })
      .then((payload) => {
        setResult({ client: payload?.user || null, error: "", key: requestKey });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setResult({
          client: null,
          error: error?.message || "No se pudieron cargar los datos del cliente.",
          key: requestKey,
        });
      });

    return () => controller.abort();
  }, [active, clientId, requestKey]);

  // Un resultado de otro cliente nunca se muestra; uno del mismo cliente sirve como
  // valor previo mientras se revalida o reintenta.
  const belongsToClient = requestKey !== null && Boolean(result.key?.startsWith(`${clientId}:`));
  const client = belongsToClient ? result.client : null;

  return {
    client,
    error: belongsToClient && result.key === requestKey ? result.error : "",
    loading: active && result.key !== requestKey && !client,
    retry: () => setRevision((current) => current + 1),
  };
}
