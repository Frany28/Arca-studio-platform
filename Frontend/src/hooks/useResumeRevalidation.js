import { useEffect, useRef } from "react";

// Intervalo mínimo entre revalidaciones por visibilidad: alternar pestañas seguido no repite
// lecturas. Recuperar la conexión revalida siempre, porque las lecturas previas pudieron fallar.
export const RESUME_REVALIDATION_MIN_INTERVAL_MS = 30000;

/**
 * Decide si un evento de reanudación debe revalidar los datos.
 *
 * @param {Object} params - Evento y momento de la última revalidación.
 * @param {"visible"|"online"} params.reason - Pestaña visible de nuevo o conexión recuperada.
 * @param {number} params.now - Marca de tiempo actual.
 * @param {number} params.lastRevalidatedAt - Marca de la última revalidación o del montaje.
 * @param {number} [params.minIntervalMs] - Intervalo mínimo entre revalidaciones por visibilidad.
 * @returns {boolean} true si corresponde revalidar.
 */
export function shouldRevalidateOnResume({
  lastRevalidatedAt,
  minIntervalMs = RESUME_REVALIDATION_MIN_INTERVAL_MS,
  now,
  reason,
}) {
  if (reason === "online") return true;
  return now - lastRevalidatedAt >= minIntervalMs;
}

/**
 * Revalida datos que pueden haber cambiado mientras la vista no estaba a la vista: al volver a
 * la pestaña (`visibilitychange`) o al recuperar la conexión (`online`). No hace sondeos
 * periódicos ni usa SSE; el consumidor decide qué leer y conserva lo mostrado mientras lee.
 * El montaje cuenta como lectura reciente, de modo que volver enseguida no repite la carga.
 * La función recibida se guarda en una ref: cambiarla no vuelve a registrar los listeners.
 *
 * @param {(reason: "visible"|"online") => void} onRevalidate - Lectura en segundo plano.
 * @param {Object} [options] - Activación y frecuencia.
 * @param {boolean} [options.enabled=true] - Solo escucha mientras la vista tenga datos que revalidar.
 * @param {number} [options.minIntervalMs] - Intervalo mínimo entre revalidaciones por visibilidad.
 * @returns {void}
 */
export function useResumeRevalidation(onRevalidate, { enabled = true, minIntervalMs } = {}) {
  const onRevalidateRef = useRef(onRevalidate);
  useEffect(() => {
    onRevalidateRef.current = onRevalidate;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let lastRevalidatedAt = Date.now();

    const revalidate = (reason) => {
      const now = Date.now();
      if (!shouldRevalidateOnResume({ lastRevalidatedAt, minIntervalMs, now, reason })) return;
      lastRevalidatedAt = now;
      onRevalidateRef.current?.(reason);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidate("visible");
    };
    const handleOnline = () => revalidate("online");

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [enabled, minIntervalMs]);
}
