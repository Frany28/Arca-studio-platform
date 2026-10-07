import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const { listProjectRequestReviewQueue } = await import("../src/repositories/projectRequestWorkflowRepository.js");

test("review queue conserva clients.id y expone requested_by como users.id sin consultas adicionales", async (context) => {
  const calls = [];
  context.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: "9", client_id: "2", requested_by: "11", status: "pending_review", updated_at: "2026-10-07T12:00:00Z" }] };
  });
  const page = await listProjectRequestReviewQueue({ cursor: null, limit: 25, user: { id: 1, role: { code: "admin" } } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /request\.requested_by/);
  assert.equal(page.items[0].id, 9);
  assert.equal(page.items[0].clientId, 2);
  assert.equal(page.items[0].requestedBy, 11);
});

test("review queue conserva ausencia del solicitante como null", async (context) => {
  context.mock.method(pool, "query", async () => ({ rows: [{ id: "9", client_id: "2", requested_by: null }] }));
  const page = await listProjectRequestReviewQueue({ cursor: null, limit: 25, user: { id: 1, role: { code: "admin" } } });
  assert.equal(page.items[0].requestedBy, null);
});
