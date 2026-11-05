import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const { getUserProjectRequest } = await import("../src/services/projectRequestQueryService.js");

const CLIENT_USER = { clientId: 2, id: 11, role: { code: "client" } };

test("detalle devuelve la solicitud propia con los adjuntos persistidos", async (context) => {
  const calls = [];
  context.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    if (calls.length === 1) {
      return { rows: [{ client_id: "2", id: "9", project_name: "Cocina Norte", requested_by: "11", status: "pending_review", submission_id: "x" }] };
    }
    return {
      rows: [{ created_at: "2026-10-07T12:00:00Z", file_size: "5242880", file_type: "video/mp4", id: "31", name: "Vestier.mp4" }],
    };
  });

  const projectRequest = await getUserProjectRequest({ projectRequestId: "9", user: CLIENT_USER });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].values, ["9", 2, 11]);
  assert.match(calls[1].sql, /project_request_id = \$1/);
  assert.deepEqual(calls[1].values, [9]);
  assert.equal(projectRequest.id, 9);
  assert.equal(projectRequest.status, "pending_review");
  assert.equal("submissionId" in projectRequest, false);
  assert.deepEqual(projectRequest.files, [
    { createdAt: "2026-10-07T12:00:00Z", fileType: "video/mp4", id: 31, name: "Vestier.mp4", size: 5242880 },
  ]);
});

test("detalle responde 404 sin consultar adjuntos cuando la solicitud no pertenece al usuario", async (context) => {
  const query = context.mock.method(pool, "query", async () => ({ rows: [] }));

  await assert.rejects(
    getUserProjectRequest({ projectRequestId: "9", user: CLIENT_USER }),
    (error) => error.status === 404 && error.code === "PROJECT_REQUEST_NOT_FOUND",
  );
  assert.equal(query.mock.callCount(), 1);
});

test("detalle exige un usuario cliente antes de consultar PostgreSQL", async (context) => {
  const query = context.mock.method(pool, "query", async () => ({ rows: [] }));

  await assert.rejects(
    getUserProjectRequest({ projectRequestId: "9", user: { id: 1, role: { code: "admin" } } }),
    (error) => error.status === 403 && error.code === "CLIENT_REQUIRED",
  );
  assert.equal(query.mock.callCount(), 0);
});
