import { useEffect, useMemo, useState } from "react";

import { api } from "../../../api/http.js";

const ADMIN_USERS_PAGE_SIZE = 10;
const STATUS_FILTER_ITEMS = [
  { id: "active", label: "Activo", type: "Checkbox" },
  { id: "blocked", label: "Suspendido", type: "Checkbox" },
  { id: "inactive", label: "Deshabilitado", type: "Checkbox" },
];

/**
 * Centraliza la lectura de usuarios, métricas y roles para AdminUsersPage.
 * Mantiene separados los datos, los filtros de búsqueda y la navegación por cursor;
 * las mutaciones usan setUsers y setMetrics para sincronizar la página local.
 *
 * @param {Object} params - Coordinación con la página administrativa.
 * @param {boolean} params.empty - Omite lecturas y parte con usuarios y roles vacíos y métricas en cero.
 * @param {Function} params.setSelectedUserIds - Setter de la selección, almacenada como Set de IDs string.
 * @returns {Object} Datos y loading/error; filters agrupa búsqueda, opciones y cambios;
 * pagination expone índice desde cero, siguiente cursor y navegación; incluye reload y setters de datos.
 */
export function useAdminUsersData({ empty, setSelectedUserIds }) {
  const [users, setUsers] = useState([]);
  const [metrics, setMetrics] = useState(() => empty
    ? { total: 0, active: 0, suspended: 0, disabled: 0 }
    : null);
  const [roles, setRoles] = useState([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [roleFilterIds, setRoleFilterIds] = useState([]);
  const [statusFilterIds, setStatusFilterIds] = useState([]);
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(!empty);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);

  const roleItems = useMemo(() => roles.map((role) => ({
    id: role.code,
    label: role.name,
    type: "Checkbox",
    checked: roleFilterIds.includes(role.code) ? "Yes" : "No",
  })), [roleFilterIds, roles]);
  const statusItems = useMemo(() => STATUS_FILTER_ITEMS.map((item) => ({
    ...item,
    checked: statusFilterIds.includes(item.id) ? "Yes" : "No",
  })), [statusFilterIds]);
  const hasFilters = Boolean(query || roleFilterIds.length || statusFilterIds.length);

  // La búsqueda se aplica sin espacios en los extremos tras 300 ms de pausa.
  // Al aplicarla se descartan cursores y selección, incluso en la ejecución inicial.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setCursorHistory([null]);
      setPageIndex(0);
      setSelectedUserIds(new Set());
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [query, setSelectedUserIds]);

  useEffect(() => {
    if (empty) return undefined;

    const controller = new AbortController();
    // Los roles se cargan aparte del listado; un fallo deja las opciones vacías,
    // sin alimentar el error de usuarios. La limpieza aborta esta lectura.
    api.admin.listRoles({ signal: controller.signal })
      .then((payload) => setRoles(payload?.roles || []))
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") setRoles([]);
      });
    return () => controller.abort();
  }, [empty]);

  useEffect(() => {
    if (empty) return undefined;

    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError("");
      }
    });
    // Carga inicial y recargas reemplazan la página de diez usuarios y sus métricas
    // por la respuesta del servidor; no calculan métricas desde las filas visibles.
    // El cursor null representa la primera página; filtros y requestKey repiten la lectura.
    // Un éxito limpia la selección. Un error conserva datos previos y publica error;
    // cada nueva lectura limpia el error y activa loading. La limpieza aborta la petición.
    api.admin.listUsers({
      cursor: cursorHistory[pageIndex],
      limit: ADMIN_USERS_PAGE_SIZE,
      role: roleFilterIds.length ? roleFilterIds : undefined,
      search: debouncedQuery || undefined,
      signal: controller.signal,
      status: statusFilterIds.length ? statusFilterIds : undefined,
    }).then((payload) => {
      setUsers(payload?.users || []);
      setMetrics(payload?.metrics || null);
      setNextCursor(payload?.nextCursor || null);
      setSelectedUserIds(new Set());
    }).catch((requestError) => {
      if (requestError?.name !== "AbortError") {
        setError(requestError?.message || "No se pudieron cargar los usuarios.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [cursorHistory, debouncedQuery, empty, pageIndex, requestKey, roleFilterIds, statusFilterIds, setSelectedUserIds]);

  /**
   * Limpia búsqueda, roles y estados, y vuelve al cursor inicial sin selección.
   * La búsqueda aplicada también se actualiza mediante el debounce del efecto.
   *
   * @returns {void} Actualiza filtros, historial, índice y selección.
   */
  function clearFilters() {
    setQuery("");
    setRoleFilterIds([]);
    setStatusFilterIds([]);
    setCursorHistory([null]);
    setPageIndex(0);
    setSelectedUserIds(new Set());
  }

  /**
   * Extrae los roles marcados con checked Yes como IDs string para la lectura.
   * Cambiar este filtro descarta cursores previos y limpia la selección.
   *
   * @param {Array} nextItems - Opciones de roles con id y checked.
   * @returns {void} Actualiza roles filtrados y vuelve a la primera página.
   */
  function changeRoleFilters(nextItems) {
    setRoleFilterIds(nextItems
      .filter((item) => item.checked === "Yes")
      .map((item) => String(item.id)));
    setCursorHistory([null]);
    setPageIndex(0);
    setSelectedUserIds(new Set());
  }

  /**
   * Extrae los estados marcados con checked Yes: active, blocked o inactive.
   * Reinicia historial, índice y selección para consultar el nuevo conjunto.
   *
   * @param {Array} nextItems - Opciones de estado con id y checked.
   * @returns {void} Actualiza estados filtrados y vuelve a la primera página.
   */
  function changeStatusFilters(nextItems) {
    setStatusFilterIds(nextItems
      .filter((item) => item.checked === "Yes")
      .map((item) => String(item.id)));
    setCursorHistory([null]);
    setPageIndex(0);
    setSelectedUserIds(new Set());
  }

  /**
   * Avanza solo si la respuesta anterior entregó nextCursor.
   * Conserva el historial hasta la página actual y reemplaza cualquier rama posterior.
   *
   * @returns {void} Guarda el cursor siguiente e incrementa el índice.
   */
  function goNext() {
    if (!nextCursor) return;
    setCursorHistory((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((current) => current + 1);
  }

  /**
   * Retrocede usando el cursor guardado para la página anterior, sin borrar el historial.
   * El índice no baja de cero; el efecto vuelve a consultar cuando cambia la página.
   *
   * @returns {void} Ajusta el índice de navegación.
   */
  function goPrevious() {
    setPageIndex((index) => Math.max(index - 1, 0));
  }

  /**
   * Descarta el historial de cursores y vuelve a la primera página sin cambiar filtros.
   * La lectura resultante limpia la selección cuando termina correctamente.
   *
   * @returns {void} Restablece historial e índice.
   */
  function resetPagination() {
    setCursorHistory([null]);
    setPageIndex(0);
  }

  /**
   * Fuerza otra lectura del listado y métricas mediante una clave de petición.
   * Conserva filtros y página actuales; no vuelve a cargar el catálogo de roles.
   *
   * @returns {void} Incrementa la clave observada por el efecto de lectura.
   */
  function reload() {
    setRequestKey((key) => key + 1);
  }

  return {
    users,
    metrics,
    roles,
    loading,
    error,
    filters: {
      query,
      setQuery,
      roleFilterIds,
      statusFilterIds,
      roleItems,
      statusItems,
      hasFilters,
      clear: clearFilters,
      changeRoles: changeRoleFilters,
      changeStatuses: changeStatusFilters,
    },
    pagination: {
      pageIndex,
      nextCursor,
      next: goNext,
      previous: goPrevious,
      reset: resetPagination,
    },
    reload,
    setUsers,
    setMetrics,
  };
}
