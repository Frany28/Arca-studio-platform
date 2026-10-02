import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

/**
 * Carga solicitudes por cursor y permite reintentar la primera p?gina.
 * La carga inicial ignora respuestas despu?s de limpiar el efecto; las p?ginas
 * adicionales se combinan por id y conservan lo cargado si fallan.
 *
 * @param {Object} params - Contexto de la consulta.
 * @param {Object|null} params.user - Usuario cuya presencia habilita la carga inicial.
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

  useEffect(() => {
    if (!user) return undefined;

    let isMounted = true;
    setProjectRequestsLoading(true);
    setProjectRequestsError("");

    api.projectRequests
      .list()
      .then((data) => {
        if (isMounted) {
          setProjectRequests(data.projectRequests || []);
          setProjectRequestsNextCursor(data.nextCursor || null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProjectRequests([]);
          setProjectRequestsError("No se pudieron cargar tus solicitudes.");
        }
      })
      .finally(() => {
        if (isMounted) setProjectRequestsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [projectRequestsRevision, user]);

  /**
   * Carga el cursor disponible salvo que ya est? cargando otra p?gina.
   * Sustituye las coincidencias por id con la versi?n recibida y actualiza el cursor.
   *
   * @returns {Promise<void>} Actualiza solicitudes y estado; registra el error sin propagarlo.
   */
  const loadMoreProjectRequests = async () => {
    if (!projectRequestsNextCursor || projectRequestsLoadingMore) return;

    setProjectRequestsLoadingMore(true);
    setProjectRequestsError("");

    try {
      const data = await api.projectRequests.list({
        cursor: projectRequestsNextCursor,
      });
      setProjectRequests((current) => {
        const byId = new Map(current.map((item) => [String(item.id), item]));
        (data.projectRequests || []).forEach((item) => {
          byId.set(String(item.id), item);
        });
        return Array.from(byId.values());
      });
      setProjectRequestsNextCursor(data.nextCursor || null);
    } catch {
      setProjectRequestsError("No se pudieron cargar más solicitudes.");
    } finally {
      setProjectRequestsLoadingMore(false);
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
