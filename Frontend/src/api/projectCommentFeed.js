/* Fuente compartida de observaciones por proyecto (P1-1). */
import { api } from "./http.js";

// Antes, cada hook (detalle de proyecto, notificaciones, visores, paneles) descargaba todo el
// historial de comentarios, abría su propia conexión SSE y repetía la descarga completa cada 5–15 s,
// también con la pestaña oculta. Este módulo mantiene una única entrada por proyecto, compartida por
// todos los hooks montados:
// - una carga inicial y, después, lecturas incrementales con `syncCursor` (solo comentarios nuevos);
// - como máximo una conexión SSE por proyecto y MAX_REALTIME_PROJECTS en total;
// - un único temporizador por proyecto, con el intervalo más corto pedido, que se alarga a
//   HEALTHY_POLL_MS mientras SSE está conectado y crece con los fallos (respeta saturación y 429);
// - sin sondeo con la pestaña oculta: al volver se ponen al día los proyectos con una lectura
//   incremental, sin perder eventos.
// SSE solo entrega eventos de la misma instancia del backend, por eso el sondeo se mantiene como
// respaldo en lugar de desactivarse.

const DEFAULT_OPTIONS = Object.freeze({
  healthyPollMs: 30 * 1000,
  maxBackoffMs: 5 * 60 * 1000,
  maxRealtimeProjects: 3,
  realtimeRetryMs: 60 * 1000,
  teardownGraceMs: 2000,
});

/**
 * Entorno real del navegador: temporizadores y visibilidad de la pestaña.
 * Fuera del navegador (pruebas de Node) se considera siempre visible.
 *
 * @returns {Object} Temporizadores, consulta de visibilidad y suscripción a sus cambios.
 */
function browserEnvironment() {
  const hasDocument = typeof document !== "undefined";
  return {
    clearTimeout: (id) => globalThis.clearTimeout(id),
    isHidden: () => hasDocument && document.visibilityState === "hidden",
    onVisibilityChange(listener) {
      if (!hasDocument) return () => {};
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  };
}

/**
 * Ordena observaciones de la más antigua a la más reciente, con el id como desempate.
 * Es el mismo orden que devuelve la API y que usaban los hooks al combinar lecturas.
 *
 * @param {Array<Object>} comments - Observaciones sin orden garantizado.
 * @returns {Array<Object>} Copia ordenada.
 */
function sortComments(comments) {
  return [...comments].sort((left, right) => {
    const byDate = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    return byDate || Number(left.id) - Number(right.id);
  });
}

/**
 * Crea una fuente compartida de observaciones con sus dependencias inyectables.
 * La aplicación usa la instancia por defecto; las pruebas inyectan API, tiempo y visibilidad.
 *
 * @param {Object} [options] - Dependencias y parámetros.
 * @param {() => Object} [options.getApi] - Devuelve la API de proyectos (se consulta en cada uso).
 * @param {Object} [options.environment] - Temporizadores y visibilidad.
 * @returns {Object} subscribe, refresh, add y getStats.
 */
export function createProjectCommentFeed({
  environment = browserEnvironment(),
  getApi = () => api.projects,
  ...overrides
} = {}) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const entries = new Map();
  let realtimeConnections = 0;
  let nextListenerId = 1;
  let stopVisibility = null;

  /**
   * Devuelve la instantánea pública de una entrada, reutilizando el array mientras no cambie.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {{ comments: Array<Object>, error: string, loading: boolean }} Estado visible.
   */
  function snapshotOf(entry) {
    if (entry.sortedVersion !== entry.version) {
      entry.sorted = sortComments(entry.comments.values());
      entry.sortedVersion = entry.version;
    }
    return { comments: entry.sorted, error: entry.error, loading: entry.loading };
  }

  /**
   * Notifica a todos los hooks suscritos a la entrada.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {void}
   */
  function notify(entry) {
    const snapshot = snapshotOf(entry);
    for (const listener of entry.listeners.values()) listener.onChange?.(snapshot);
  }

  /**
   * Inserta o reemplaza observaciones por id.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @param {Array<Object>} comments - Observaciones recibidas.
   * @returns {void}
   */
  function upsert(entry, comments) {
    for (const comment of comments) {
      if (comment?.id == null) continue;
      entry.comments.set(String(comment.id), comment);
    }
    entry.version += 1;
  }

  /**
   * Intervalo de sondeo vigente: el más corto pedido, alargado con SSE conectado y tras fallos.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {number} Milisegundos, o 0 si no hay que sondear.
   */
  function pollInterval(entry) {
    const requested = [...entry.listeners.values()]
      .map((listener) => listener.intervalMs)
      .filter((intervalMs) => intervalMs > 0);
    if (requested.length === 0) return 0;
    let interval = Math.min(...requested);
    if (entry.sse.state === "open") interval = Math.max(interval, options.healthyPollMs);
    if (entry.failures > 0) interval = Math.min(interval * 2 ** entry.failures, options.maxBackoffMs);
    return interval;
  }

  /**
   * Programa la próxima lectura de respaldo (nunca con la pestaña oculta ni sin suscriptores).
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {void}
   */
  function schedule(entry) {
    if (entry.timer) environment.clearTimeout(entry.timer);
    entry.timer = null;
    const interval = pollInterval(entry);
    if (!interval || entry.listeners.size === 0 || environment.isHidden()) return;
    entry.timer = environment.setTimeout(() => {
      entry.timer = null;
      load(entry).catch(() => {});
    }, interval);
  }

  /**
   * Lee observaciones: completas la primera vez y con `refresh`, incrementales después.
   * Las lecturas simultáneas de un mismo proyecto se comparten, también las recargas: la lectura en
   * curso ya devuelve la lista completa y actual (la API solo añade observaciones, no las edita).
   *
   * @param {Object} entry - Entrada del proyecto.
   * @param {{ full?: boolean }} [options] - Fuerza una lectura completa que reemplaza la lista.
   * @returns {Promise<Object>} Instantánea tras la lectura.
   */
  function load(entry, { full = false } = {}) {
    if (entry.inFlight) return entry.inFlight;
    const since = full ? null : entry.syncCursor;
    const run = Promise.resolve().then(async () => {
      const wasLoaded = entry.loaded;
      if (!wasLoaded || full) {
        entry.loading = true;
        notify(entry);
      }
      try {
        const data = await getApi().listAllComments(since ? { projectId: entry.projectId, since } : { projectId: entry.projectId });
        const comments = Array.isArray(data?.comments) ? data.comments : [];
        if (full || !since) entry.comments.clear();
        upsert(entry, comments);
        if (data?.syncCursor) entry.syncCursor = data.syncCursor;
        entry.loaded = true;
        entry.failures = 0;
        entry.error = "";
        return snapshotOf(entry);
      } catch (error) {
        entry.failures += 1;
        // Los fallos de fondo no se muestran: se conservan las observaciones y se reintenta con espera.
        if (!wasLoaded || full) entry.error = error?.message || "No se pudieron cargar las observaciones.";
        throw error;
      } finally {
        entry.loading = false;
        if (entry.inFlight === run) entry.inFlight = null;
        notify(entry);
        schedule(entry);
      }
    });
    entry.inFlight = run;
    return run;
  }

  /**
   * Indica si algún suscriptor de la entrada pide eventos en tiempo real.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {boolean} true si se quiere SSE.
   */
  function wantsRealtime(entry) {
    return [...entry.listeners.values()].some((listener) => listener.realtime);
  }

  /**
   * Cierra la conexión SSE de la entrada y libera su plaza.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {void}
   */
  function closeRealtime(entry) {
    if (entry.sse.retryTimer) environment.clearTimeout(entry.sse.retryTimer);
    entry.sse.retryTimer = null;
    if (!entry.sse.unsubscribe) return;
    entry.sse.unsubscribe();
    entry.sse.unsubscribe = null;
    entry.sse.state = "none";
    realtimeConnections -= 1;
  }

  /**
   * Abre la conexión SSE del proyecto si hay plaza; si no, el proyecto queda con sondeo de respaldo.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {void}
   */
  function openRealtime(entry) {
    if (entry.sse.unsubscribe || !wantsRealtime(entry) || realtimeConnections >= options.maxRealtimeProjects) return;
    realtimeConnections += 1;
    entry.sse.state = "connecting";
    entry.sse.unsubscribe = getApi().subscribeToEvents({
      onCommentCreated(comment) {
        upsert(entry, [comment]);
        notify(entry);
      },
      onError(_event, { closed = false } = {}) {
        const wasOpen = entry.sse.state === "open";
        entry.sse.state = closed ? "closed" : "reconnecting";
        schedule(entry);
        // Al perder la conexión se recuperan los eventos que pudieron perderse.
        if (wasOpen) load(entry).catch(() => {});
        if (closed) {
          closeRealtime(entry);
          entry.sse.retryTimer = environment.setTimeout(() => {
            entry.sse.retryTimer = null;
            if (entries.get(entry.key) === entry) openRealtime(entry);
          }, options.realtimeRetryMs);
          openPendingRealtime();
        }
      },
      onOpen() {
        const reconnected = entry.sse.state === "reconnecting";
        entry.sse.state = "open";
        schedule(entry);
        if (reconnected) load(entry).catch(() => {});
      },
      projectId: entry.projectId,
    });
  }

  /**
   * Asigna plazas SSE libres a proyectos que las esperan.
   *
   * @returns {void}
   */
  function openPendingRealtime() {
    for (const entry of entries.values()) {
      if (realtimeConnections >= options.maxRealtimeProjects) return;
      if (!entry.sse.unsubscribe && !entry.sse.retryTimer && entry.listeners.size > 0) openRealtime(entry);
    }
  }

  /**
   * Elimina la entrada: cierra SSE, cancela temporizadores y libera la plaza para otro proyecto.
   *
   * @param {Object} entry - Entrada del proyecto.
   * @returns {void}
   */
  function destroy(entry) {
    if (entry.timer) environment.clearTimeout(entry.timer);
    closeRealtime(entry);
    entries.delete(entry.key);
    openPendingRealtime();
    if (entries.size === 0 && stopVisibility) {
      stopVisibility();
      stopVisibility = null;
    }
  }

  /**
   * Reacciona a la visibilidad: con la pestaña oculta se detiene el sondeo; al volver, cada proyecto
   * que lo necesita hace una lectura incremental para recuperar lo ocurrido.
   *
   * @returns {void}
   */
  function handleVisibilityChange() {
    for (const entry of entries.values()) {
      if (environment.isHidden()) {
        schedule(entry);
      } else if (entry.loaded && (pollInterval(entry) > 0 || entry.sse.state !== "open")) {
        load(entry).catch(() => {});
      } else {
        schedule(entry);
      }
    }
  }

  /**
   * Obtiene o crea la entrada de un proyecto.
   *
   * @param {number|string} projectId - Proyecto.
   * @returns {Object} Entrada.
   */
  function entryFor(projectId) {
    const key = String(projectId);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        comments: new Map(),
        error: "",
        failures: 0,
        inFlight: null,
        key,
        listeners: new Map(),
        loaded: false,
        loading: false,
        projectId,
        sorted: [],
        sortedVersion: -1,
        sse: { retryTimer: null, state: "none", unsubscribe: null },
        syncCursor: null,
        teardownTimer: null,
        timer: null,
        version: 0,
      };
      entries.set(key, entry);
      stopVisibility ||= environment.onVisibilityChange(handleVisibilityChange);
    }
    return entry;
  }

  return {
    /**
     * Suscribe un hook a las observaciones de un proyecto.
     * La primera suscripción carga el historial; las siguientes reutilizan la entrada sin descargar.
     *
     * @param {number|string} projectId - Proyecto.
     * @param {Object} listener - Preferencias del hook.
     * @param {number} [listener.intervalMs] - Sondeo de respaldo deseado; 0 lo desactiva.
     * @param {boolean} [listener.realtime] - Pide eventos SSE.
     * @param {(snapshot: Object) => void} listener.onChange - Recibe cada instantánea.
     * @returns {() => void} Cancela la suscripción.
     */
    subscribe(projectId, { intervalMs = 0, onChange, realtime = true } = {}) {
      const entry = entryFor(projectId);
      if (entry.teardownTimer) {
        environment.clearTimeout(entry.teardownTimer);
        entry.teardownTimer = null;
      }
      const previousInterval = pollInterval(entry);
      const id = nextListenerId++;
      entry.listeners.set(id, { intervalMs, onChange, realtime });
      openRealtime(entry);
      if (entry.loaded || entry.inFlight) {
        const snapshot = snapshotOf(entry);
        queueMicrotask(() => { if (entry.listeners.has(id)) onChange?.(snapshot); });
        // Quien pide más frescura (por ejemplo, al abrir el drawer) recibe una lectura incremental
        // inmediata en lugar de esperar al siguiente ciclo.
        const wantsFresher = intervalMs > 0 && (previousInterval === 0 || intervalMs < previousInterval);
        if (entry.loaded && !entry.inFlight && wantsFresher && !environment.isHidden()) {
          load(entry).catch(() => {});
        } else {
          schedule(entry);
        }
      } else {
        load(entry).catch(() => {});
      }

      return () => {
        if (!entry.listeners.delete(id)) return;
        if (entry.listeners.size > 0) {
          if (!wantsRealtime(entry)) closeRealtime(entry);
          schedule(entry);
          return;
        }
        // Un periodo de gracia evita descargar de nuevo al remontar (navegación, StrictMode).
        if (entry.timer) environment.clearTimeout(entry.timer);
        entry.timer = null;
        entry.teardownTimer = environment.setTimeout(() => destroy(entry), options.teardownGraceMs);
      };
    },

    /**
     * Recarga completa de un proyecto (acción manual de los hooks). Rechaza si la lectura falla.
     *
     * @param {number|string} projectId - Proyecto.
     * @returns {Promise<Object>} Instantánea actualizada.
     */
    refresh(projectId) {
      const entry = entries.get(String(projectId));
      if (!entry) {
        return getApi().listAllComments({ projectId }).then((data) => ({
          comments: Array.isArray(data?.comments) ? data.comments : [],
          error: "",
          loading: false,
        }));
      }
      return load(entry, { full: true });
    },

    /**
     * Añade una observación recién creada para que todos los hooks del proyecto la vean.
     *
     * @param {number|string} projectId - Proyecto.
     * @param {Object} comment - Observación devuelta por la API.
     * @returns {void}
     */
    add(projectId, comment) {
      const entry = entries.get(String(projectId));
      if (!entry || comment?.id == null) return;
      upsert(entry, [comment]);
      notify(entry);
    },

    /**
     * Estado interno resumido, para pruebas y diagnóstico.
     *
     * @returns {{ projects: number, realtimeConnections: number }} Proyectos activos y conexiones SSE.
     */
    getStats() {
      return { projects: entries.size, realtimeConnections };
    },
  };
}

export const projectCommentFeed = createProjectCommentFeed();

/**
 * Suscribe a varios proyectos y entrega una vista combinada en el orden de los ids.
 * `loading` sigue activo hasta recibir todos los proyectos; `error` es el primer fallo inicial.
 *
 * @param {Array<number>} projectIds - Proyectos normalizados.
 * @param {number} intervalMs - Sondeo de respaldo deseado; 0 lo desactiva.
 * @param {(view: { comments: Array<Object>, error: string, loading: boolean }) => void} onChange - Recibe la vista.
 * @param {Object} [feed] - Fuente de observaciones (por defecto, la compartida).
 * @returns {() => void} Cancela todas las suscripciones.
 */
export function subscribeToProjects(projectIds, intervalMs, onChange, feed = projectCommentFeed) {
  const snapshots = new Map();
  const publish = () => {
    const received = projectIds.map((projectId) => snapshots.get(projectId)).filter(Boolean);
    onChange({
      comments: received.flatMap((snapshot) => snapshot.comments),
      error: received.find((snapshot) => snapshot.error)?.error || "",
      loading: received.length < projectIds.length || received.some((snapshot) => snapshot.loading),
    });
  };
  const unsubscribers = projectIds.map((projectId) => feed.subscribe(projectId, {
    intervalMs,
    onChange(snapshot) {
      snapshots.set(projectId, snapshot);
      publish();
    },
  }));
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
