import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";

// Revisión de versiones subidas por un cliente (aprobar y rechazar) con PostgreSQL simulado: la
// decisión, su auditoría y la notificación al autor van en una sola transacción y una segunda
// decisión no repite nada. El SQL real se cubre en projectFileVersions.integration.test.js.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
const { pool } = await import("../src/config/db.js");
const { default: projectRoutes } = await import("../src/routes/projects.js");
const { withProjectFileReviewState } = await import("../src/config/projectFileReview.js");
const { describeReviewNotification } = await import("../src/services/projectFileVersionService.js");

const ADMIN = { id: 2, permissionCodes: ["projects.read"], role: { code: "admin" } };
const CLIENT_UPLOADER = 7;

/**
 * Base simulada: archivo 30 del proyecto 1 con la V1 aprobada y la V2 pendiente subida por el cliente.
 *
 * @returns {{ respond: Function, state: object }} Respondedor y estado.
 */
function createDatabase() {
  const state = {
    audits: [],
    notifications: [],
    transactions: { begin: 0, commit: 0, rollback: 0 },
    versions: [
      { id: 301, review_status: "approved", review_reason: null, uploaded_by: 3, version_number: 1 },
      { id: 302, review_status: "pending", review_reason: null, uploaded_by: CLIENT_UPLOADER, version_number: 2 },
    ],
  };
  let snapshot = null;
  const versionRow = (version) => ({
    change_note: null, content_type: "application/pdf", created_at: "2026-11-20T10:00:00.000Z", deleted_at: null, file_extension: "pdf",
    file_id: "30", file_name: `projects/1/files/30/v${version.version_number}/plano.pdf`, file_size: "1000", file_url: "s3://ficticio",
    id: String(version.id), is_current: version.review_status === "approved", original_name: "Plano cliente.pdf", restored_from_version_id: null,
    review_reason: version.review_reason, review_status: version.review_status, reviewed_at: null, reviewed_by: null,
    reviewer_name: null, uploaded_by: String(version.uploaded_by), uploader_name: "Cliente Uno", version_number: version.version_number,
  });
  /**
   * Responde las sentencias del flujo de revisión.
   *
   * @param {string} sql - Sentencia.
   * @param {unknown[]} params - Parámetros.
   * @returns {{ rows: object[], rowCount: number }} Resultado.
   */
  function respond(sql, params = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    const result = (rows, rowCount = rows.length) => ({ rowCount, rows });
    if (/^(begin|commit|rollback)$/i.test(text)) {
      state.transactions[text.toLowerCase()] += 1;
      if (text === "begin") snapshot = structuredClone(state);
      if (text === "rollback" && snapshot) Object.assign(state, { ...snapshot, transactions: state.transactions });
      return result([]);
    }
    if (text.startsWith("select id from public.projects where id = $1 for share")) return result([{ id: "1" }]);
    if (text.startsWith("select f.id, f.project_id, f.uploaded_by")) {
      return result([{
        access_policy: 1, archived_from_status: null, assigned_architect_id: "3", client_id: "4", current_version: 1, deleted_at: null,
        file_type: "application/pdf", id: "30", is_assignee: false, is_public: false, project_id: "1", project_status: "in_progress",
        status: "active", title: "Plano cliente.pdf", uploaded_by: String(CLIENT_UPLOADER),
      }]);
    }
    if (text.includes("from public.file_versions v left join public.users uploader")) {
      return result([...state.versions].sort((left, right) => right.version_number - left.version_number).map(versionRow));
    }
    const decision = /^update public\.file_versions set review_status = '(approved|rejected)'/.exec(text);
    if (decision) {
      const version = state.versions.find((candidate) => candidate.id === Number(params[0]) && candidate.review_status === "pending");
      if (!version) return result([]);
      version.review_status = decision[1];
      if (decision[1] === "rejected") version.review_reason = params[3];
      return result([versionRow(version)]);
    }
    if (text.startsWith("update public.file")) return result([], 1);
    if (text.startsWith("insert into public.audit_logs")) {
      state.audits.push({ action: params[1], entityId: params[3] });
      return result([{ id: String(state.audits.length) }]);
    }
    if (text.startsWith("insert into public.notifications")) {
      const [userId, projectId, createdBy, title, message, type, versionId] = params;
      if (userId === createdBy) return result([], 0);
      state.notifications.push({ createdBy, message, projectId, title, type, userId, versionId });
      return result([], 1);
    }
    throw new Error(`Sentencia no simulada: ${text.slice(0, 120)}`);
  }
  return { respond, state };
}

/**
 * Levanta el router de proyectos con la revisión activada y la base simulada.
 *
 * @param {import("node:test").TestContext} context - Contexto de la prueba.
 * @returns {Promise<object>} Servidor y base.
 */
async function start(context) {
  const database = createDatabase();
  const server = await startAdminRouterServer(context, {
    pool,
    respond: database.respond,
    routes: [["/api", (_req, _res, next) => withProjectFileReviewState(true, next)], ["/api/projects", projectRoutes]],
  });
  server.setUser(ADMIN);
  return { database, server };
}

const APPROVE = "/api/projects/1/files/30/versions/302/approve";
const REJECT = "/api/projects/1/files/30/versions/302/reject";

test("aprobar: la versión del cliente queda vigente, se audita y su autor recibe una sola notificación", async (context) => {
  const { database, server } = await start(context);
  const approved = await server.send("POST", APPROVE);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.version.review.status, "approved");
  assert.equal(approved.body.sharedWithClient, false, "aprobar no comparte con el cliente");
  assert.deepEqual(database.state.audits.map((audit) => audit.action), ["project_file.version_approved"]);
  assert.deepEqual(database.state.notifications, [{
    createdBy: 2, message: "La versión V2 de «Plano cliente.pdf» fue aprobada por el equipo de ARCA Studio.", projectId: 1,
    title: "Archivo aprobado", type: "project_file.version_approved", userId: CLIENT_UPLOADER, versionId: 302,
  }]);
  assert.deepEqual(database.state.versions.map((version) => version.review_status), ["approved", "approved"], "el historial se conserva");

  // Una segunda aprobación (otro administrador o un doble clic) no repite ni la auditoría ni la notificación.
  const again = await server.send("POST", APPROVE);
  assert.deepEqual([again.status, again.body.code], [409, "FILE_VERSION_NOT_PENDING"]);
  const rejectAfter = await server.send("POST", REJECT, { reason: "Tarde" });
  assert.deepEqual([rejectAfter.status, rejectAfter.body.code], [409, "FILE_VERSION_NOT_PENDING"], "no se aprueba y rechaza la misma versión");
  assert.equal(database.state.notifications.length, 1);
  assert.equal(database.state.audits.length, 1);
});

test("rechazar: exige motivo, lo persiste, conserva la versión y notifica al autor con el motivo", async (context) => {
  const { database, server } = await start(context);
  for (const reason of [undefined, "", "   ", "x".repeat(501)]) {
    const invalid = await server.send("POST", REJECT, reason === undefined ? {} : { reason });
    assert.equal(invalid.status, 400, `motivo ${JSON.stringify(reason)}`);
  }
  assert.equal(database.state.versions.find((version) => version.id === 302).review_status, "pending", "sin motivo no cambia nada");
  assert.equal(database.state.notifications.length, 0);

  const rejected = await server.send("POST", REJECT, { reason: "  Falta la firma del cliente.  " });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.deepEqual([rejected.body.version.review.status, rejected.body.version.review.reason], ["rejected", "Falta la firma del cliente."]);
  assert.equal(rejected.body.currentVersionId, 301, "la vigente no cambia");
  assert.equal(database.state.versions.length, 2, "la versión rechazada se conserva");
  assert.deepEqual(database.state.notifications.map((notification) => [notification.type, notification.userId, notification.message]), [[
    "project_file.version_rejected", CLIENT_UPLOADER, "La versión V2 de «Plano cliente.pdf» fue rechazada. Motivo: Falta la firma del cliente. Puedes subir una versión corregida.",
  ]]);
  const again = await server.send("POST", REJECT, { reason: "Otro motivo" });
  assert.equal(again.status, 409, "el motivo no se sobrescribe");
  assert.equal(database.state.versions.find((version) => version.id === 302).review_reason, "Falta la firma del cliente.");
  assert.equal(database.state.notifications.length, 1);
});

test("solo el administrador decide: cliente, arquitecto y anónimo no aprueban ni rechazan", async (context) => {
  const { database, server } = await start(context);
  for (const role of ["client", "architect"]) {
    server.setUser({ clientId: 4, id: 9, permissionCodes: ["projects.read", "projects.files.upload"], role: { code: role } });
    assert.equal((await server.send("POST", APPROVE)).status, 403, role);
    assert.equal((await server.send("POST", REJECT, { reason: "x" })).status, 403, role);
  }
  server.setUser(null);
  assert.equal((await server.send("POST", APPROVE)).status, 401);
  assert.equal(database.state.versions.find((version) => version.id === 302).review_status, "pending");
  assert.equal(database.state.notifications.length, 0);
});

test("la notificación no promete visibilidad y nunca se envía al propio revisor", () => {
  const approve = describeReviewNotification({ action: "approve", fileName: "Fachada.jpg", versionNumber: 3 });
  assert.doesNotMatch(approve.message, /compart|visible|público/i);
  assert.ok(approve.title.length <= 150 && approve.type.length <= 50);
  const reject = describeReviewNotification({ action: "reject", fileName: "Fachada.jpg", reason: "Imagen borrosa", versionNumber: 3 });
  assert.match(reject.message, /Motivo: Imagen borrosa/);
});
