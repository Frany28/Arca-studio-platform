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

test("review queue expone completitud y viabilidad separadas sin publicar las respuestas internas", async (context) => {
  const { loadProjectRequestReviewQueue } = await import("../src/services/projectRequestWorkflowService.js");
  context.mock.method(pool, "query", async () => ({
    rows: [{
      capital_availability: "seeking_financing",
      client_id: "2",
      compatibility_level: "excellent",
      compatibility_score: 100,
      decision_maker: null,
      description: "Remodelación de cocina pequeña.",
      development_mode: "full",
      expected_start_time: "over_6_months",
      has_multiple_owners: null,
      has_plans: null,
      id: "9",
      investment_range: "10k_50k",
      land_status: "unavailable",
      legal_document_types: [],
      legal_documentation_status: null,
      location: "Maracaibo, Zulia",
      prior_design_experience: "first_time",
      project_name: "Cocina Norte",
      project_size: "small_lt_80",
      project_type: "residential",
      quality_expectation: "standard",
      requested_by: "11",
      status: "pending_review",
    }],
  }));

  const page = await loadProjectRequestReviewQueue({ cursor: null, limit: 25, user: { id: 1, role: { code: "admin" } } });
  const [request] = page.items;
  assert.equal("answers" in request, false);
  assert.deepEqual(request.compatibility, { level: "excellent", score: 100 });
  assert.deepEqual(request.completeness, { answered: 12, applicable: 13, missingFields: ["decisionMaker"], score: 92 });
  // Busca financiamiento con plazo flexible y presupuesto coherente: sin hallazgos financieros.
  assert.deepEqual(request.financialViability, { findings: [], score: null, status: "NO_OBVIOUS_CONFLICT" });
});
