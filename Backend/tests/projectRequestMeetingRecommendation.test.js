import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";

import { MEETING_RECOMMENDATIONS } from "../src/domain/projectRequestReview.js";
import { projectRequestReviewSchema } from "../src/validation/projectRequestWorkflowSchemas.js";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { submitProjectRequestReview } = await import("../src/services/projectRequestWorkflowService.js");
const { listProjectRequestReviewQueue } = await import("../src/repositories/projectRequestWorkflowRepository.js");
after(() => pool.end());

const payload = { recommendation: "approve", note: "Justificación técnica independiente de la reunión." };
const input = { params: { projectRequestId: 12 }, body: payload };
const user = { id: 9, role: { code: "architect" } };

test("la revisión valida ambos códigos, null y omisión sin aceptar workflow como reunión", () => {
  for (const meetingRecommendation of [...MEETING_RECOMMENDATIONS, null, undefined]) {
    assert.equal(projectRequestReviewSchema.safeParse({ ...input, body: { ...payload, meetingRecommendation } }).success, true);
  }
  for (const meetingRecommendation of ["approve", "reject", "agendar", "schedule_meeting", "unknown", "", 1, false, {}]) {
    assert.equal(projectRequestReviewSchema.safeParse({ ...input, body: { ...payload, meetingRecommendation } }).success, false);
  }
});

test("el enum versionado y Prisma conservan los códigos del dominio sin default histórico", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20261006120000_project_request_meeting_recommendation/migration.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.deepEqual([...sql.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]), MEETING_RECOMMENDATIONS);
  const prismaValues = schema.match(/enum project_request_meeting_recommendation \{([^}]+)\}/)[1].trim().split(/\s+/);
  assert.deepEqual(prismaValues, MEETING_RECOMMENDATIONS);
  assert.match(sql, /ADD COLUMN meeting_recommendation public\.project_request_meeting_recommendation;/);
  assert.doesNotMatch(sql, /\b(?:DEFAULT|UPDATE|DELETE|DROP)\b/);
});

for (const meetingRecommendation of [...MEETING_RECOMMENDATIONS, null, undefined]) {
  test(`service y repository guardan la reunión ${String(meetingRecommendation)} sin reemplazar workflow`, async (context) => {
    let parameters;
    context.mock.method(pool, "query", async (_sql, params) => {
      parameters = params;
      return { rows: [{ target_exists: true, status: "pending_review", allowed: true,
        review: { id: "3", recommendation: payload.recommendation, note: payload.note,
          meeting_recommendation: meetingRecommendation ?? null, updated_at: "2026-10-06T10:00:00Z" } }] };
    });
    const result = await submitProjectRequestReview({ projectRequestId: 12, user, payload: { ...payload, meetingRecommendation } });
    assert.equal(result.meetingRecommendation, meetingRecommendation ?? null);
    assert.equal(result.recommendation, "approve");
    assert.equal(result.note, payload.note);
    assert.deepEqual(parameters, [12, 9, "approve", payload.note, "architect", meetingRecommendation ?? null, meetingRecommendation !== undefined]);
  });
}

test("la cola devuelve reuniones estructuradas y normaliza las revisiones históricas a null", async (context) => {
  const reviews = MEETING_RECOMMENDATIONS.map((meetingRecommendation, index) => ({ meetingRecommendation, note: payload.note, recommendation: "reject", updatedAt: `2026-10-0${index + 1}T10:00:00Z`, reviewer: { id: 9 } }));
  reviews.push({ recommendation: "approve", note: "Revisión histórica" });
  context.mock.method(pool, "query", async () => ({ rows: [{ id: "12", client_id: "1", reviews }] }));
  const result = await listProjectRequestReviewQueue({ cursor: null, limit: 25, user });
  assert.deepEqual(result.items[0].reviews.map((review) => review.meetingRecommendation), [...MEETING_RECOMMENDATIONS, null]);
});

for (const [row, code, status] of [
  [{ target_exists: false }, "PROJECT_REQUEST_NOT_FOUND", 404],
  [{ target_exists: true, status: "pending_review", allowed: false }, "PROJECT_REQUEST_REVIEW_FORBIDDEN", 403],
  [{ target_exists: true, status: "rejected", allowed: true }, "PROJECT_REQUEST_CLOSED", 409],
]) {
  test(`el servicio conserva el error ${code}`, async (context) => {
    context.mock.method(pool, "query", async () => ({ rows: [row] }));
    await assert.rejects(submitProjectRequestReview({ projectRequestId: 12, user, payload: { ...payload, meetingRecommendation: MEETING_RECOMMENDATIONS[0] } }), { code, status });
  });
}

test("el servicio propaga un fallo de PostgreSQL y no informa un guardado exitoso", async (context) => {
  const error = new Error("PostgreSQL unavailable");
  context.mock.method(pool, "query", async () => { throw error; });
  await assert.rejects(submitProjectRequestReview({ projectRequestId: 12, user, payload }), (caught) => caught === error);
});

test("PUT real conserva autenticación, roles, Zod y la respuesta del controller", async (context) => {
  const { default: express } = await import("express");
  const { default: routes } = await import("../src/routes/projectRequests.js");
  const app = express();
  let role = null;
  let writes = 0;
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { isAuthenticated: Boolean(role) };
    req.user = role ? { id: 9, role: { code: role } } : null;
    next();
  });
  app.use("/api/project-requests", routes);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message, fields: error.fields }));
  context.mock.method(pool, "query", async (_sql, values) => {
    writes += 1;
    return { rows: [{ target_exists: true, allowed: true, status: "pending_review", review: { id: "3", recommendation: values[2], note: values[3], meeting_recommendation: values[5], updated_at: "2026-10-06T10:00:00Z" } }] };
  });
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const send = (meetingRecommendation) => fetch(`http://127.0.0.1:${server.address().port}/api/project-requests/12/review`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, meetingRecommendation }),
  });
  const unauthenticated = await send(MEETING_RECOMMENDATIONS[0]);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).code, "UNAUTHENTICATED");
  role = "client";
  const forbidden = await send(MEETING_RECOMMENDATIONS[0]);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "FORBIDDEN");
  role = "architect";
  const invalid = await send("UNKNOWN");
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.code, "VALIDATION_ERROR");
  assert.ok(invalidBody.fields["body.meetingRecommendation"]);
  assert.equal(writes, 0);
  for (const meetingRecommendation of MEETING_RECOMMENDATIONS) {
    const response = await send(meetingRecommendation);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const { review } = await response.json();
    assert.equal(review.meetingRecommendation, meetingRecommendation);
    assert.equal(review.recommendation, "approve");
  }
  assert.equal(writes, 2);
});
