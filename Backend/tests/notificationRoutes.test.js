import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";

// /api/notifications con PostgreSQL simulado: cada usuario solo lee y marca las suyas, el usuario y su
// alcance salen de la sesión y el proyecto del evento solo se expone si sigue siendo accesible.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
const { pool } = await import("../src/config/db.js");
const { default: notificationRoutes } = await import("../src/routes/notifications.js");

const CLIENT = { clientId: 4, id: 7, permissionCodes: ["projects.read"], role: { code: "client" } };

/**
 * Base simulada con notificaciones de dos usuarios. Reconoce las tres sentencias del repositorio y
 * registra sus parámetros; aplica el filtro por usuario como lo haría PostgreSQL.
 *
 * @returns {{ respond: Function, state: object }} Respondedor y estado.
 */
function createDatabase() {
  const state = {
    calls: [],
    notifications: [
      { created_at: "2026-11-23T10:00:00.000Z", entity_id: "302", entity_type: "file_version", id: "11", is_read: false, message: "La versión V2 de «Plano.pdf» fue rechazada. Motivo: Falta firma. Puedes subir una versión corregida.", project: { id: "1", name: "Quinta Bella Vista" }, read_at: null, title: "Archivo rechazado", type: "project_file.version_rejected", user_id: 7 },
      { created_at: "2026-11-22T10:00:00.000Z", entity_id: "301", entity_type: "file_version", id: "10", is_read: true, message: "La versión V1 de «Plano.pdf» fue aprobada por el equipo de ARCA Studio.", project: null, read_at: "2026-11-22T11:00:00.000Z", title: "Archivo aprobado", type: "project_file.version_approved", user_id: 7 },
      { created_at: "2026-11-21T10:00:00.000Z", entity_id: "90", entity_type: "file_version", id: "12", is_read: false, message: "Otra persona", project: { id: "8", name: "Proyecto ajeno" }, read_at: null, title: "Archivo aprobado", type: "project_file.version_approved", user_id: 99 },
    ],
  };
  /**
   * Responde las sentencias del repositorio de notificaciones.
   *
   * @param {string} sql - Sentencia.
   * @param {unknown[]} params - Parámetros.
   * @returns {{ rows: object[], rowCount: number }} Resultado.
   */
  function respond(sql, params = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    state.calls.push({ params, text });
    const result = (rows) => ({ rowCount: rows.length, rows });
    if (text.startsWith("select n.id, n.title")) {
      const [userId, , , cursorAt, cursorId, limit] = params;
      const own = state.notifications.filter((notification) => notification.user_id === userId)
        .filter((notification) => cursorAt === null || notification.created_at < cursorAt || (notification.created_at === cursorAt && Number(notification.id) < Number(cursorId)));
      return result(own.slice(0, limit).map(({ project, user_id: _owner, ...row }) => ({
        ...row, cursor_value: row.created_at.replace(".000Z", ".000000Z"), project_id: project?.id ?? null, project_name: project?.name ?? null,
      })));
    }
    if (text.startsWith("select count(*)::int as unread")) {
      return result([{ unread: state.notifications.filter((notification) => notification.user_id === params[0] && !notification.is_read).length }]);
    }
    if (text.startsWith("update public.notifications set is_read = true")) {
      const notification = state.notifications.find((candidate) => candidate.id === String(params[0]) && candidate.user_id === params[1]);
      if (!notification) return result([]);
      notification.is_read = true;
      notification.read_at ??= "2026-11-23T12:00:00.000Z";
      return result([{ id: notification.id, is_read: true, read_at: notification.read_at }]);
    }
    throw new Error(`Sentencia no simulada: ${text.slice(0, 100)}`);
  }
  return { respond, state };
}

/**
 * Levanta el router con la base simulada y la sesión indicada.
 *
 * @param {import("node:test").TestContext} context - Contexto de la prueba.
 * @param {object|null} user - Usuario de la sesión.
 * @returns {Promise<object>} Servidor y base.
 */
async function start(context, user = CLIENT) {
  const database = createDatabase();
  const server = await startAdminRouterServer(context, { pool, respond: database.respond, routes: [["/api/notifications", notificationRoutes]] });
  server.setUser(user);
  return { database, server };
}

test("lista solo las notificaciones propias, con no leídas, motivo del rechazo y contexto autorizado", async (context) => {
  const { database, server } = await start(context);
  const response = await server.send("GET", "/api/notifications");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.body.unreadCount, 1);
  assert.deepEqual(response.body.notifications.map((notification) => [notification.id, notification.isRead, notification.type]), [
    [11, false, "project_file.version_rejected"],
    [10, true, "project_file.version_approved"],
  ]);
  assert.match(response.body.notifications[0].message, /Motivo: Falta firma/);
  assert.deepEqual(response.body.notifications[0].project, { id: 1, name: "Quinta Bella Vista" });
  assert.equal(response.body.notifications[1].project, null, "sin acceso al proyecto, sin contexto");
  assert.equal(JSON.stringify(response.body).includes("Proyecto ajeno"), false, "nunca la de otro usuario");
  // El usuario, su rol y su cliente salen de la sesión.
  assert.deepEqual(database.state.calls[0].params.slice(0, 3), [7, "client", 4]);
});

test("pagina con cursor y rechaza parámetros que intenten elegir otro usuario", async (context) => {
  const { server } = await start(context);
  const first = await server.send("GET", "/api/notifications?limit=1");
  assert.deepEqual(first.body.notifications.map((notification) => notification.id), [11]);
  const second = await server.send("GET", `/api/notifications?limit=1&cursor=${first.body.nextCursor}`);
  assert.deepEqual([second.body.notifications.map((notification) => notification.id), second.body.nextCursor], [[10], null]);
  for (const query of ["userId=99", "limit=51", "cursor=no-valido"]) {
    assert.equal((await server.send("GET", `/api/notifications?${query}`)).status, 400, query);
  }
});

test("marca como leída una propia (idempotente) y responde 404 ante una ajena sin modificarla", async (context) => {
  const { database, server } = await start(context);
  const read = await server.send("PATCH", "/api/notifications/11/read");
  assert.equal(read.status, 200);
  assert.deepEqual([read.body.notification.id, read.body.notification.isRead, read.body.unreadCount], [11, true, 0]);
  const again = await server.send("PATCH", "/api/notifications/11/read");
  assert.equal(again.body.notification.readAt, read.body.notification.readAt, "conserva la primera fecha de lectura");
  const foreign = await server.send("PATCH", "/api/notifications/12/read");
  assert.deepEqual([foreign.status, foreign.body.code], [404, "NOTIFICATION_NOT_FOUND"]);
  assert.equal(database.state.notifications.find((notification) => notification.id === "12").is_read, false);
  assert.equal((await server.send("PATCH", "/api/notifications/abc/read")).status, 400);
});

test("sin sesión responde 401 sin consultar PostgreSQL", async (context) => {
  const { database, server } = await start(context, null);
  assert.equal((await server.send("GET", "/api/notifications")).status, 401);
  assert.equal((await server.send("PATCH", "/api/notifications/11/read")).status, 401);
  assert.equal(database.state.calls.length, 0);
});
