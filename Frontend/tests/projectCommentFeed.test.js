import assert from "node:assert/strict";
import test from "node:test";

import { createProjectCommentFeed } from "../src/api/projectCommentFeed.js";

// P1-1: fuente compartida de observaciones. Tiempo y visibilidad simulados; la API es un doble que
// registra cada lectura y cada conexión SSE.

/**
 * Reloj manual: los temporizadores solo se ejecutan al avanzar el tiempo.
 *
 * @returns {Object} Entorno inyectable y controles de la prueba.
 */
function createEnvironment() {
  let now = 0;
  let hidden = false;
  let nextId = 1;
  const timers = new Map();
  const visibilityListeners = new Set();
  return {
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
        await flush();
      }
      now = target;
      await flush();
    },
    clearTimeout: (id) => timers.delete(id),
    isHidden: () => hidden,
    onVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    async setHidden(value) {
      hidden = value;
      visibilityListeners.forEach((listener) => listener());
      await flush();
    },
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
  };
}

/**
 * Deja correr las promesas pendientes.
 *
 * @returns {Promise<void>}
 */
async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

/**
 * Doble de la API: proyectos con historial, lecturas registradas y conexiones SSE controlables.
 *
 * @param {Object} [options] - Historial por proyecto y fallos simulados.
 * @returns {Object} API y registros.
 */
function createApi({ historySize = 3 } = {}) {
  const calls = [];
  const sockets = [];
  const store = new Map();
  let failNext = 0;
  const historyOf = (projectId) => {
    if (!store.has(String(projectId))) {
      store.set(String(projectId), Array.from({ length: historySize }, (_, index) => ({
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), id: Number(projectId) * 1000 + index, projectId,
      })));
    }
    return store.get(String(projectId));
  };
  return {
    api: {
      async listAllComments({ projectId, since }) {
        calls.push({ projectId: String(projectId), since: since || null });
        if (failNext > 0) {
          failNext -= 1;
          throw Object.assign(new Error("El servicio está temporalmente saturado."), { status: 503 });
        }
        const history = historyOf(projectId);
        const fromIndex = since ? Number(since.split(":")[1]) : 0;
        return { comments: history.slice(fromIndex), nextCursor: null, syncCursor: `sync:${Math.max(0, history.length - 1)}` };
      },
      subscribeToEvents({ projectId, onCommentCreated, onError, onOpen }) {
        const socket = { closed: false, onCommentCreated, onError, onOpen, projectId: String(projectId) };
        sockets.push(socket);
        return () => { socket.closed = true; };
      },
    },
    addComment(projectId, comment) { historyOf(projectId).push(comment); },
    calls,
    failNextRequests(count) { failNext = count; },
    openSockets: () => sockets.filter((socket) => !socket.closed),
    sockets,
  };
}

test("dos hooks del mismo proyecto comparten una carga inicial y una conexión SSE", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  const first = [];
  const second = [];
  feed.subscribe(7, { intervalMs: 15000, onChange: (snapshot) => first.push(snapshot) });
  feed.subscribe(7, { intervalMs: 5000, onChange: (snapshot) => second.push(snapshot) });
  await flush();
  assert.equal(backend.calls.length, 1, "una sola descarga del historial");
  assert.equal(backend.openSockets().length, 1, "una sola conexión SSE");
  assert.equal(first.at(-1).comments.length, 3);
  assert.equal(second.at(-1).comments.length, 3);
});

test("el respaldo pide solo comentarios nuevos y se espacia con SSE conectado", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  feed.subscribe(7, { intervalMs: 15000, onChange: () => {} });
  await flush();
  await environment.advance(15000);
  assert.deepEqual(backend.calls.map((call) => call.since), [null, "sync:2"], "la segunda lectura es incremental");

  backend.sockets[0].onOpen();
  await environment.advance(29000);
  assert.equal(backend.calls.length, 2, "con SSE conectado no sondea cada 15 s");
  await environment.advance(1000);
  assert.equal(backend.calls.length, 3);
});

test("pestaña oculta: no hay sondeo; al volver, una lectura incremental recupera lo ocurrido", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  const snapshots = [];
  feed.subscribe(7, { intervalMs: 5000, onChange: (snapshot) => snapshots.push(snapshot) });
  await flush();
  await environment.setHidden(true);
  backend.addComment(7, { createdAt: "2026-01-01T01:00:00.000Z", id: 7999 });
  await environment.advance(10 * 60 * 1000);
  assert.equal(backend.calls.length, 1, "ninguna petición durante 10 minutos oculta");
  await environment.setHidden(false);
  assert.equal(backend.calls.length, 2);
  assert.equal(backend.calls[1].since, "sync:2");
  assert.ok(snapshots.at(-1).comments.some((comment) => comment.id === 7999), "el comentario de mientras estaba oculta aparece");
});

test("como máximo tres conexiones SSE; al liberar una, otro proyecto la ocupa", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  const unsubscribers = [1, 2, 3, 4, 5].map((projectId) => feed.subscribe(projectId, { intervalMs: 15000, onChange: () => {} }));
  await flush();
  assert.equal(backend.openSockets().length, 3);
  unsubscribers[0]();
  await environment.advance(2000);
  assert.equal(backend.openSockets().length, 3);
  assert.ok(backend.openSockets().some((socket) => socket.projectId === "4"));
  assert.equal(feed.getStats().realtimeConnections, 3);
});

test("SSE caído: recupera eventos, sondea al intervalo pedido y reintenta la conexión", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  feed.subscribe(7, { intervalMs: 15000, onChange: () => {} });
  await flush();
  backend.sockets[0].onOpen();
  backend.sockets[0].onError({}, { closed: false });
  await flush();
  assert.equal(backend.calls.length, 2, "al perder la conexión se lee lo que pudo perderse");
  await environment.advance(15000);
  assert.equal(backend.calls.length, 3, "sin SSE vuelve al intervalo pedido");

  backend.sockets[0].onError({}, { closed: true });
  await flush();
  assert.equal(backend.openSockets().length, 0);
  await environment.advance(60000);
  assert.equal(backend.openSockets().length, 1, "se reintenta la conexión tras un minuto");
});

test("fallos: el inicial se muestra; los de fondo no, y el intervalo crece con ellos", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  backend.failNextRequests(1);
  const snapshots = [];
  feed.subscribe(7, { intervalMs: 5000, onChange: (snapshot) => snapshots.push(snapshot) });
  await flush();
  assert.match(snapshots.at(-1).error, /saturado/);

  await environment.advance(10000);
  assert.equal(snapshots.at(-1).error, "");
  assert.equal(snapshots.at(-1).comments.length, 3);

  backend.failNextRequests(2);
  const before = backend.calls.length;
  await environment.advance(5000);
  assert.equal(snapshots.at(-1).error, "", "un fallo de fondo conserva las observaciones sin error");
  assert.equal(snapshots.at(-1).comments.length, 3);
  await environment.advance(9999);
  assert.equal(backend.calls.length, before + 1, "tras un fallo espera el doble");
  await environment.advance(1);
  assert.equal(backend.calls.length, before + 2);
});

test("add notifica a todos los hooks; refresh recarga completo; el remontaje inmediato no descarga", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  const first = [];
  const second = [];
  const unsubscribeFirst = feed.subscribe(7, { onChange: (snapshot) => first.push(snapshot) });
  feed.subscribe(7, { onChange: (snapshot) => second.push(snapshot) });
  await flush();
  feed.add(7, { createdAt: "2026-02-01T00:00:00.000Z", id: 9001 });
  assert.ok(first.at(-1).comments.some((comment) => comment.id === 9001));
  assert.ok(second.at(-1).comments.some((comment) => comment.id === 9001));

  await feed.refresh(7);
  assert.equal(backend.calls.at(-1).since, null);

  unsubscribeFirst();
  const callsBefore = backend.calls.length;
  const remounted = [];
  feed.subscribe(7, { onChange: (snapshot) => remounted.push(snapshot) });
  await flush();
  assert.equal(backend.calls.length, callsBefore, "reutiliza la entrada en lugar de descargar de nuevo");
  assert.ok(remounted.length > 0);
});

test("pedir más frescura (abrir el drawer) lee una vez al momento; igual o menos frescura no", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  const closed = feed.subscribe(7, { intervalMs: 15000, onChange: () => {} });
  await flush();
  feed.subscribe(7, { intervalMs: 15000, onChange: () => {} });
  await flush();
  assert.equal(backend.calls.length, 1, "otro hook con el mismo intervalo no relee");
  // El drawer se abre: el hook vuelve a suscribirse pidiendo 5 s.
  closed();
  feed.subscribe(7, { intervalMs: 5000, onChange: () => {} });
  await flush();
  assert.equal(backend.calls.length, 2);
  assert.equal(backend.calls[1].since, "sync:2", "es incremental, no una descarga completa");
});

test("recargas simultáneas del mismo proyecto comparten una sola petición", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  feed.subscribe(7, { onChange: () => {} });
  await flush();
  const snapshots = await Promise.all([feed.refresh(7), feed.refresh(7), feed.refresh(7)]);
  assert.equal(backend.calls.length, 2, "carga inicial + una sola recarga");
  assert.ok(snapshots.every((snapshot) => snapshot.comments.length === 3));
});

test("sin suscriptores la entrada se destruye tras el periodo de gracia y cierra SSE", async () => {
  const environment = createEnvironment();
  const backend = createApi();
  const feed = createProjectCommentFeed({ environment, getApi: () => backend.api });
  const unsubscribe = feed.subscribe(7, { intervalMs: 5000, onChange: () => {} });
  await flush();
  unsubscribe();
  await environment.advance(2000);
  assert.deepEqual(feed.getStats(), { projects: 0, realtimeConnections: 0 });
  assert.equal(backend.openSockets().length, 0);
  const calls = backend.calls.length;
  await environment.advance(60000);
  assert.equal(backend.calls.length, calls, "ningún sondeo tras desmontar");
});
