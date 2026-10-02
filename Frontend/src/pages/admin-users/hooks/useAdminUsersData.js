import { useEffect, useMemo, useState } from "react";

import { api } from "../../../api/http.js";

const ADMIN_USERS_PAGE_SIZE = 10;
const STATUS_FILTER_ITEMS = [
  { id: "active", label: "Activo", type: "Checkbox" },
  { id: "blocked", label: "Suspendido", type: "Checkbox" },
  { id: "inactive", label: "Deshabilitado", type: "Checkbox" },
];

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

  function clearFilters() {
    setQuery("");
    setRoleFilterIds([]);
    setStatusFilterIds([]);
    setCursorHistory([null]);
    setPageIndex(0);
    setSelectedUserIds(new Set());
  }

  function changeRoleFilters(nextItems) {
    setRoleFilterIds(nextItems
      .filter((item) => item.checked === "Yes")
      .map((item) => String(item.id)));
    setCursorHistory([null]);
    setPageIndex(0);
    setSelectedUserIds(new Set());
  }

  function changeStatusFilters(nextItems) {
    setStatusFilterIds(nextItems
      .filter((item) => item.checked === "Yes")
      .map((item) => String(item.id)));
    setCursorHistory([null]);
    setPageIndex(0);
    setSelectedUserIds(new Set());
  }

  function goNext() {
    if (!nextCursor) return;
    setCursorHistory((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((current) => current + 1);
  }

  function goPrevious() {
    setPageIndex((index) => Math.max(index - 1, 0));
  }

  function resetPagination() {
    setCursorHistory([null]);
    setPageIndex(0);
  }

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
