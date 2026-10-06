import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Opt-in: usa staging/pruebas y revierte todas las filas creadas en una transacción.
test("PostgreSQL: persiste reunión, conserva históricos, omisiones y permisos con el repositorio real", {
  skip: process.env.ARCA_WORKFLOW_DB_TESTS !== "1",
}, async (context) => {
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
  process.env.DATABASE_URL = process.env.DATABASE_URL?.replace(/^"|"$/g, "");
  const { pool } = await import("../src/config/db.js");
  const { submitProjectRequestReview } = await import("../src/services/projectRequestWorkflowService.js");
  const { listProjectRequestReviewQueue } = await import("../src/repositories/projectRequestWorkflowRepository.js");
  const client = await pool.connect();
  const suffix = randomUUID();
  try {
    await client.query("begin");
    const source = await client.query("select client_id, requested_by from public.project_requests limit 1");
    assert.ok(source.rows[0], "Se requiere una solicitud previa para referenciar cliente/solicitante en la prueba.");
    const role = await client.query("select id from public.roles where code = 'architect' limit 1");
    assert.ok(role.rows[0], "Se requiere el rol architect.");
    const reviewers = [];
    for (let index = 0; index < 2; index += 1) {
      const created = await client.query(`
        insert into public.users (role_id, email, first_name, last_name, password_hash, status)
        values ($1, $2, 'Prueba', 'Reunión', '!integration-login-disabled!', 'active') returning id
      `, [role.rows[0].id, `meeting-${index}-${suffix}@example.test`]);
      reviewers.push({ id: Number(created.rows[0].id), role: { code: "architect" } });
    }
    const createdRequest = await client.query(`
      insert into public.project_requests (client_id, requested_by, project_name, project_type, location, status)
      values ($1, $2, $3, 'residential', 'Ubicación de prueba', 'pending_review') returning id
    `, [source.rows[0].client_id, source.rows[0].requested_by, `Prueba reunión ${suffix}`]);
    const projectRequestId = Number(createdRequest.rows[0].id);
    await client.query(`
      insert into public.project_request_assignees (project_request_id, user_id, assigned_by) values ($1, $2, $2)
    `, [projectRequestId, reviewers[0].id]);
    // Solo sustituye el transporte del pool para que el código real use la transacción aislada.
    context.mock.method(pool, "query", (sql, values) => client.query(sql, values));
    const payload = { note: "Justificación técnica para probar PostgreSQL.", recommendation: "approve" };
    const save = (values, user = reviewers[0], id = projectRequestId) => submitProjectRequestReview({ payload: { ...payload, ...values }, projectRequestId: id, user });
    const read = async () => {
      const page = await listProjectRequestReviewQueue({ user: reviewers[0], cursor: null, limit: 100 });
      const request = page.items.find((request) => request.id === projectRequestId);
      assert.ok(request); return request;
    };

    const historical = await save({});
    assert.equal(historical.meetingRecommendation, null);
    assert.equal((await read()).reviews[0].meetingRecommendation, null);
    for (const meetingRecommendation of ["SCHEDULE_MEETING", "DO_NOT_SCHEDULE_MEETING"]) {
      const saved = await save({ meetingRecommendation });
      assert.equal(saved.meetingRecommendation, meetingRecommendation);
      assert.equal(saved.recommendation, "approve");
      const stored = await client.query("select meeting_recommendation, recommendation from public.project_request_reviews where id = $1", [saved.id]);
      assert.equal(stored.rows[0].meeting_recommendation, meetingRecommendation);
      assert.equal(stored.rows[0].recommendation, "approve");
      assert.equal((await read()).reviews[0].meetingRecommendation, meetingRecommendation);
    }
    assert.equal((await save({ recommendation: "reject" })).meetingRecommendation, "DO_NOT_SCHEDULE_MEETING");
    assert.equal((await save({ meetingRecommendation: null })).meetingRecommendation, null);
    await assert.rejects(save({ meetingRecommendation: "SCHEDULE_MEETING" }, reviewers[1]), { code: "PROJECT_REQUEST_REVIEW_FORBIDDEN", status: 403 });
    const missing = await client.query("select coalesce(max(id), 0) + 1 as id from public.project_requests");
    await assert.rejects(save({}, reviewers[0], Number(missing.rows[0].id)), { code: "PROJECT_REQUEST_NOT_FOUND", status: 404 });
    await client.query("update public.project_requests set status = 'rejected' where id = $1", [projectRequestId]);
    await assert.rejects(save({}), { code: "PROJECT_REQUEST_CLOSED", status: 409 });
    await client.query("update public.project_requests set status = 'pending_review' where id = $1", [projectRequestId]);

    await client.query("savepoint invalid_enum");
    await assert.rejects(client.query("update public.project_request_reviews set meeting_recommendation = $1 where project_request_id = $2", ["UNKNOWN", projectRequestId]), { code: "22P02" });
    await client.query("rollback to savepoint invalid_enum");
    await client.query("insert into public.project_request_assignees (project_request_id, user_id, assigned_by) values ($1, $2, $2)", [projectRequestId, reviewers[1].id]);
    await save({ meetingRecommendation: "SCHEDULE_MEETING" });
    await save({ meetingRecommendation: "DO_NOT_SCHEDULE_MEETING", note: "Justificación de la revisión más reciente." }, reviewers[1]);
    // now() es estable en esta transacción; fija fechas distintas para probar el orden público.
    await client.query("update public.project_request_reviews set updated_at = case when reviewer_id = $2 then now() + interval '1 second' else now() end where project_request_id = $1", [projectRequestId, reviewers[1].id]);
    const latest = (await read()).reviews[0];
    assert.equal(latest.meetingRecommendation, "DO_NOT_SCHEDULE_MEETING");
    assert.equal(latest.note, "Justificación de la revisión más reciente.");
    assert.equal(latest.reviewer.id, reviewers[1].id);
  } finally {
    context.mock.restoreAll();
    await client.query("rollback");
    client.release();
    await pool.end();
  }
});
