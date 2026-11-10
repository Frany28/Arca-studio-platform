import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { getSessionDataScopeKey } from "../../../auth/sessionDataScope.js";

/**
 * Carga solicitudes por cursor y permite reintentar la primera página.
 * La primera página depende del ámbito de la sesión (cuenta, rol y cliente; ver
 * getSessionDataScopeKey), no de la referencia de `user`: confirmar la misma sesión no la relee
 * ni descarta las páginas ya cargadas. Releerla (reintento o cambio de ámbito) o desmontar aborta
 * la lectura en curso y la página adicional pendiente, para que una respuesta de la lista anterior
 * no se mezcle con la nueva. Las páginas adicionales se combinan por id y conservan lo cargado si
 * fallan.
 *
 * @param {Object} params - Contexto de la consulta.
 * @param {Object|null} params.user - Usuario cuya sesión habilita la carga inicial.
 * @returns {Object} Solicitudes, cursor, errores como texto, estados de carga y acciones de carga/reintento.
 */
export default function useHomeProjectRequests({ user }) {
  const [projectRequests, setProjectRequests] = useState([]);
  const [projectRequestsError, setProjectRequestsError] = useState("");
  const [projectRequestsLoading, setProjectRequestsLoading] = useState(false);
  const [projectRequestsLoadingMore, setProjectRequestsLoadingMore] =
    useState(false);
  const [projectRequestsNextCursor, setProjectRequestsNextCursor] =
    useState(null);
  const [projectRequestsRevision, setProjectRequestsRevision] = useState(0);
  // Página adicional en curso. La ref (y no el estado) bloquea clics repetidos en el mismo evento.
  const loadMoreRequestRef = useRef(null);
  const sessionScopeKey = getSessionDataScopeKey(user);

  useEffect(() => {
    if (!sessionScopeKey) return undefined;

    const controller = new AbortController();
    const { signal } = controller;
    setProjectRequestsLoading(true);
    setProjectRequestsLoadingMore(false);
    setProjectRequestsError("");

    api.projectRequests
      .list({ signal })
      .then((data) => {
        if (!signal.aborted) {
          setProjectRequests(data.projectRequests || []);
          setProjectRequestsNextCursor(data.nextCursor || null);
        }
      })
      .catch(() => {
        if (!signal.aborted) {
          setProjectRequests([]);
          setProjectRequestsError("No se pudieron cargar tus solicitudes.");
        }
      })
      .finally(() => {
        if (!signal.aborted) setProjectRequestsLoading(false);
      });

    return () => {
      controller.abort();
      loadMoreRequestRef.current?.abort();
      loadMoreRequestRef.current = null;
    };
  }, [projectRequestsRevision, sessionScopeKey]);

  /**
   * Carga el cursor disponible salvo que ya esté cargando otra página.
   * Sustituye las coincidencias por id con la versión recibida y actualiza el cursor.
   * Si la primera página se relee mientras tanto, la respuesta se descarta.
   *
   * @returns {Promise<void>} Actualiza solicitudes y estado; registra el error sin propagarlo.
   */
  const loadMoreProjectRequests = async () => {
    if (!projectRequestsNextCursor || loadMoreRequestRef.current) return;

    const controller = new AbortController();
    const { signal } = controller;
    loadMoreRequestRef.current = controller;
    setProjectRequestsLoadingMore(true);
    setProjectRequestsError("");

    try {
      const data = await api.projectRequests.list({
        cursor: projectRequestsNextCursor,
        signal,
      });
      if (signal.aborted) return;
      setProjectRequests((current) => {
        const byId = new Map(current.map((item) => [String(item.id), item]));
        (data.projectRequests || []).forEach((item) => {
          byId.set(String(item.id), item);
        });
        return Array.from(byId.values());
      });
      setProjectRequestsNextCursor(data.nextCursor || null);
    } catch {
      if (!signal.aborted) {
        setProjectRequestsError("No se pudieron cargar más solicitudes.");
      }
    } finally {
      // Una lectura abortada ya fue sustituida: la nueva primera página gestiona el estado.
      if (loadMoreRequestRef.current === controller) {
        loadMoreRequestRef.current = null;
        setProjectRequestsLoadingMore(false);
      }
    }
  };

  const retryProjectRequests = () => {
    setProjectRequestsRevision((current) => current + 1);
  };

  return {
    loadMoreProjectRequests,
    projectRequests,
    projectRequestsError,
    projectRequestsLoading,
    projectRequestsLoadingMore,
    projectRequestsNextCursor,
    retryProjectRequests,
  };
}
