import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";

// Restaurar una versión (POST /projects/:projectId/files/:fileId/versions/:versionId/restore) con
// PostgreSQL y almacenamiento simulados: crea V(n+1) pendiente que reutiliza el objeto de la versión de
// origen, sin tocar las anteriores, y aplica las reglas confirmadas (PR1, PR2, PR5, conservación).
// El SQL real se cubre en projectFileVersions.integration.test.js (PostgreSQL desechable).
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
process.env.SUPABASE_STORAGE_BUCKET = "general-test";
const { pool } = await import("../src/config/db.js");
const { default: projectRoutes } = await import("../src/routes/projects.js");
const { withProjectFileReviewState } = await import("../src/config/projectFileReview.js");
const { objectStorage } = await import("../src/services/objectStorage.js");

const ADMIN = { id: 2, permissionCodes: ["projects.read", "projects.files.upload"], role: { code: "admin" } };
const STATUSES = ["approved", "approved", "rejected", "approved", "approved"];

/**
 * Base simulada: archivo 30 del proyecto 1 con V1…V5 (V3 rechazada, V5 vigente), cada una con su objeto.
 *
 * @param {{ uploadedBy?: number, architectId?: number }} [options] - Autor del archivo y arquitecto asignado.
 * @returns {{ respond: Function, state: object }} Respondedor y estado.
 */
function createDatabase({ architectId = 3, uploadedBy = 3 } = {}) {
  const state = {
    audits: [],
    inserts: 0,
    versions: STATUSES.map((status, index) => ({
      change_note: null, content_type: "image/png", created_at: `2026-11-0${index + 1}T10:00:00.000Z`, deleted_at: null, file_extension: "png",
      file_id: "30", file_name: `projects/1/files/30/v${index + 1}-abc/fachada.png`, file_size: String(1000 * (index + 1)), file_url: "s3://ficticio",
      id: String(301 + index), is_current: index === 4, original_name: "fachada.png", restored_from_version_id: null, review_reason: status === "rejected" ? "Borrosa" : null,
      review_status: status, reviewed_at: null, reviewed_by: "2", uploaded_by: String(uploadedBy), version_number: index + 1,
    })),
  };
  let snapshot = null;
  /**
   * Responde las sentencias del flujo de restauración.
   *
   * @param {string} sql - Sentencia.
   * @param {unknown[]} params - Parámetros.
   * @returns {{ rows: object[], rowCount: number }} Resultado.
   */
  function respond(sql, params = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    const result = (rows) => ({ rowCount: rows.length, rows });
    if (text === "begin") {
      snapshot = structuredClone(state);
      return result([]);
    }
    if (text === "commit") return result([]);
    if (text === "rollback") {
      Object.assign(state, snapshot);
      return result([]);
    }
    if (text.startsWith("select id from public.projects where id = $1 for share")) return result(Number(params[0]) === 1 ? [{ id: "1" }] : []);
    if (text.startsWith("select f.id, f.project_id, f.uploaded_by")) {
      if (Number(params[0]) !== 30 || Number(params[1]) !== 1) return result([]);
      return result([{
        access_policy: 1, archived_from_status: null, assigned_architect_id: String(architectId), client_id: "4", current_version: 5, deleted_at: null,
        file_type: "image/png", id: "30", is_assignee: false, is_public: false, project_id: "1", project_status: "in_progress", status: "active", title: "fachada.png", uploaded_by: String(uploadedBy),
      }]);
    }
    if (text.includes("from public.file_versions v left join public.users uploader")) {
      return result([...state.versions].sort((left, right) => right.version_number - left.version_number).map((version) => ({ ...version, reviewer_name: null, uploader_name: "Arq. Armando" })));
    }
    if (text.startsWith("select") && text.includes("project_file_audience_grants")) return result([]);
    if (text.startsWith("insert into public.file_versions")) {
      const [fileId, uploadedById, versionNumber, storageKey, originalName, fileUrl, extension, size, contentType, changeNote, restoredFrom] = params;
      state.inserts += 1;
      const row = {
        change_note: changeNote, content_type: contentType, created_at: "2026-11-23T10:00:00.000Z", deleted_at: null, file_extension: extension, file_id: String(fileId),
        file_name: storageKey, file_size: String(size), file_url: fileUrl, id: String(400 + state.inserts), is_current: false, original_name: originalName,
        restored_from_version_id: String(restoredFrom), review_reason: null, review_status: "pending", reviewed_at: null, reviewed_by: null, uploaded_by: String(uploadedById), version_number: versionNumber,
      };
      state.versions.push(row);
      return result([row]);
    }
    if (text.startsWith("update public.files set updated_at")) return result([]);
    if (text.startsWith("insert into public.audit_logs")) {
      state.audits.push({ action: params[1], newValues: JSON.parse(params[5]), userId: params[0] });
      return result([{ id: "1" }]);
    }
    throw new Error(`Sentencia no simulada: ${text.slice(0, 120)}`);
  }
  return { respond, state };
}

/**
 * Levanta el router de proyectos con la base y el almacenamiento simulados.
 *
 * @param {import("node:test").TestContext} context - Contexto de la prueba.
 * @param {{ user?: object, missingKeys?: string[], storageDown?: boolean, database?: object }} [options] - Sesión y almacenamiento.
 * @returns {Promise<object>} Servidor, base y consultas al almacenamiento.
 */
async function start(context, { database = createDatabase(), missingKeys = [], storageDown = false, user = ADMIN } = {}) {
  const heads = [];
  context.mock.method(objectStorage, "head", async (key, options) => {
    heads.push({ bucket: options?.bucket, key });
    if (storageDown) throw Object.assign(new Error("S3 caído"), { name: "TimeoutError" });
    return missingKeys.includes(key) ? null : { ContentLength: 1000 };
  });
  const server = await startAdminRouterServer(context, {
    pool,
    respond: database.respond,
    routes: [["/api", (_req, _res, next) => withProjectFileReviewState(true, next)], ["/api/projects", projectRoutes]],
  });
  server.setUser(user);
  return { database, heads, server };
}

const restore = (server, versionId, body = { changeNote: "Se vuelve a la versión firmada." }, path = "/api/projects/1/files/30") => server.send("POST", `${path}/versions/${versionId}/restore`, body);

test("restaurar V2 crea V6 pendiente con el objeto de V2, autor, motivo y origen; V1…V5 quedan intactas", async (context) => {
  const { database, heads, server } = await start(context);
  const before = structuredClone(database.state.versions);
  const response = await restore(server, 302);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const { version } = response.body;
  assert.deepEqual([version.versionNumber, version.review.status, version.isCurrent, version.changeNote], [6, "pending", false, "Se vuelve a la versión firmada."]);
  assert.equal(version.restoredFromVersionId, 302);
  const created = database.state.versions.at(-1);
  assert.equal(created.file_name, "projects/1/files/30/v2-abc/fachada.png", "reutiliza la clave del objeto de V2, sin copiarlo");
  assert.deepEqual([created.uploaded_by, created.file_size, created.content_type], ["2", "2000", "image/png"], "registra al responsable y conserva formato y tamaño");
  assert.deepEqual(database.state.versions.slice(0, 5), before, "no modifica ni retira versiones anteriores (la V5 sigue vigente)");
  assert.deepEqual(heads, [{ bucket: "general-test", key: "projects/1/files/30/v2-abc/fachada.png" }], "comprueba que el contenido original existe");
  assert.deepEqual(database.state.audits.map((audit) => [audit.action, audit.userId, audit.newValues.restoredFromVersionId, audit.newValues.reviewStatus]), [["project_file.version_restored", 2, 302, "pending"]]);
});

test("solo con motivo válido y desde una versión aprobada; una pendiente en el archivo bloquea otra restauración", async (context) => {
  const { database, server } = await start(context);
  for (const changeNote of [undefined, "", "   ", "x".repeat(256)]) {
    assert.equal((await restore(server, 302, changeNote === undefined ? {} : { changeNote })).status, 400, JSON.stringify(changeNote));
  }
  const rejected = await restore(server, 303);
  assert.deepEqual([rejected.status, rejected.body.code], [409, "FILE_VERSION_NOT_APPROVED"], "una versión rechazada no se restaura");
  assert.equal((await restore(server, 305)).status, 201, "la vigente aprobada sí (PR2)");
  // Ya hay una pendiente (la V6 creada): ni otra restauración ni restaurar la propia pendiente (PR1).
  for (const versionId of [302, 401]) {
    const blocked = await restore(server, versionId);
    assert.equal(blocked.status, 409, String(versionId));
  }
  assert.equal(database.state.inserts, 1, "solo se creó una versión");
});

test("dos restauraciones seguidas del mismo archivo: la segunda encuentra la pendiente y no duplica", async (context) => {
  const { database, server } = await start(context);
  const [first, second] = [await restore(server, 302), await restore(server, 304)];
  assert.deepEqual([first.status, second.status, second.body.code], [201, 409, "FILE_VERSION_PENDING_REVIEW"]);
  assert.deepEqual(database.state.versions.map((version) => version.version_number), [1, 2, 3, 4, 5, 6], "numeración consecutiva sin huecos ni duplicados");
});

test("versión inexistente, de otro archivo o de otro proyecto: 404 sin crear nada", async (context) => {
  const { database, server } = await start(context);
  assert.equal((await restore(server, 999)).status, 404);
  assert.equal((await restore(server, 302, undefined, "/api/projects/2/files/30")).status, 404, "otro proyecto");
  assert.equal((await restore(server, 302, undefined, "/api/projects/1/files/31")).status, 404, "otro archivo");
  assert.equal(database.state.inserts, 0);
});

test("contenido ausente en el almacenamiento: 409 sin registrar la versión; almacenamiento caído: 503", async (context) => {
  const missing = await start(context, { missingKeys: ["projects/1/files/30/v2-abc/fachada.png"] });
  const response = await restore(missing.server, 302);
  assert.deepEqual([response.status, response.body.code], [409, "FILE_VERSION_OBJECT_MISSING"]);
  assert.equal(missing.database.state.inserts, 0);
  assert.equal(missing.database.state.audits.length, 0);
});

test("almacenamiento no disponible: 503 y nada registrado", async (context) => {
  const down = await start(context, { storageDown: true });
  const response = await restore(down.server, 302);
  assert.deepEqual([response.status, response.body.code], [503, "FILE_STORAGE_UNAVAILABLE"]);
  assert.equal(down.database.state.inserts, 0);
});

test("permisos: el arquitecto asignado puede; un cliente que no subió el archivo, uno sin permiso o sin sesión no", async (context) => {
  const architect = await start(context, { user: { id: 3, permissionCodes: ["projects.read", "projects.files.upload"], role: { code: "architect" } } });
  assert.equal((await restore(architect.server, 302)).status, 201, "equipo del proyecto (PR5)");

  const client = await start(context, { user: { clientId: 4, id: 9, permissionCodes: ["projects.read", "projects.files.upload"], role: { code: "client" } } });
  assert.equal((await restore(client.server, 302)).status, 404, "un cliente que no es autor no restaura");
  const stranger = await start(context, { user: { id: 50, permissionCodes: ["projects.read", "projects.files.upload"], role: { code: "architect" } } });
  assert.equal((await restore(stranger.server, 302)).status, 404, "arquitecto sin acceso al proyecto");
  const noPermission = await start(context, { user: { id: 3, permissionCodes: ["projects.read"], role: { code: "architect" } } });
  assert.equal((await restore(noPermission.server, 302)).status, 403);
  const anonymous = await start(context, { user: null });
  assert.equal((await restore(anonymous.server, 302)).status, 401);
  for (const run of [client, stranger, noPermission, anonymous]) assert.equal(run.database.state.inserts, 0);
});

test("permisos: el cliente autor del archivo en su propio proyecto puede restaurar (PR5) y la versión queda pendiente", async (context) => {
  const { database, server } = await start(context, {
    database: createDatabase({ uploadedBy: 9 }),
    user: { clientId: 4, id: 9, permissionCodes: ["projects.read", "projects.files.upload"], role: { code: "client" } },
  });
  const response = await restore(server, 302);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.version.review.status, "pending", "nunca se aprueba sola");
  assert.equal(database.state.versions.at(-1).uploaded_by, "9");
});
