import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;
const OPTIONS_LIMIT = 20;
const IDLE = Object.freeze({ error: "", key: "", options: [], status: "idle" });

/**
 * Opciones de un selector con búsqueda en la API (clientes y proyectos de la cotización). La
 * consulta escrita se aplica tras una pausa y cada lectura aborta la anterior, así que una
 * respuesta lenta nunca sustituye a una consulta más reciente. Sin `enabled` no se consulta (por
 * ejemplo, los proyectos antes de elegir un cliente).
 *
 * @param {Object} params - Lectura y consulta.
 * @param {(query: {search?: string, limit: number, signal: AbortSignal}) => Promise<Array<Object>>} params.load -
 * Lee las opciones; se lee desde una ref y puede cambiar de identidad entre renders.
 * @param {string} params.query - Texto escrito.
 * @param {boolean} params.enabled - Habilita la consulta.
 * @param {string} [params.scope=""] - Contexto de la consulta (p. ej. el cliente); cambiarlo relee.
 * @returns {{options: Array<Object>, loading: boolean, error: string, retry: () => void}} Opciones y estado.
 */
export function useRemoteOptions({ enabled, load, query, scope = "" }) {
  const [state, setState] = useState(IDLE);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const search = query.trim();
  const key = enabled ? `${scope}|${search}|${attempt}` : "";

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    // La primera lectura del contexto no espera; escribir sí aplica la pausa.
    const timeoutId = window.setTimeout(() => {
      loadRef.current({ limit: OPTIONS_LIMIT, search: search || undefined, signal: controller.signal })
        .then((options) => {
          if (!controller.signal.aborted) setState({ error: "", key, options, status: "ready" });
        })
        .catch((error) => {
          if (error?.name === "AbortError" || controller.signal.aborted) return;
          setState({ error: error?.message || "No se pudieron cargar las opciones.", key, options: [], status: "error" });
        });
    }, search ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [enabled, key, search]);

  const current = state.key === key ? state : { ...IDLE, status: enabled ? "loading" : "idle" };
  return {
    error: current.error,
    loading: current.status === "loading",
    options: current.options,
    retry: () => setAttempt((value) => value + 1),
  };
}
