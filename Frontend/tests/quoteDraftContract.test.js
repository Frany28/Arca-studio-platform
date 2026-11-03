import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { quoteCreateSchema, quoteUpdateSchema } from "../../Backend/src/validation/quoteSchemas.js";
import { buildQuoteSubmissionContent } from "../../Backend/src/domain/quote.js";
import { PROJECT_KIND, createLineFromService, toQuotePayload } from "../src/pages/admin-services-quotes/quote-editor/utils/quoteDraft.js";

// Contrato del editor con el backend: el cuerpo que construye el frontend debe superar la
// validación Zod real de POST/PATCH /admin/quotes, y un reintento del mismo borrador debe producir
// la misma huella de idempotencia (el backend devuelve entonces la cotización ya guardada).
const SERVICE = {
  code: "SERV-001", description: null, id: 1, measurementUnit: { allowsDecimals: true }, name: "Anteproyecto",
  referenceRate: "14.00", unitLabel: "m²",
};
const BASE_DRAFT = { client: { id: 3, name: "Leonel" }, lines: [{ ...createLineFromService(SERVICE), quantity: "200,5" }], notes: " Visita " };

/**
 * Valida un cuerpo con un esquema del backend y devuelve el cuerpo normalizado o los errores.
 *
 * @param {import("zod").ZodType} schema - Esquema de la ruta.
 * @param {object} input - `{ body, params }`.
 * @returns {{ body?: object, issues?: Array<string> }} Resultado.
 */
function parse(schema, input) {
  const result = schema.safeParse(input);
  return result.success ? { body: result.data.body } : { issues: result.error.issues.map((issue) => issue.path.join(".")) };
}

test("alta con proyecto nuevo: el cuerpo del editor es válido y conserva el nombre normalizado", () => {
  const draft = { ...BASE_DRAFT, project: { kind: PROJECT_KIND.NEW, name: "  Casa   del Lago " } };
  const { body, issues } = parse(quoteCreateSchema, { body: { ...toQuotePayload(draft), submissionId: randomUUID() } });
  assert.equal(issues, undefined, JSON.stringify(issues));
  assert.equal(body.newProjectName, "Casa del Lago");
  assert.equal(body.projectId, undefined);
  assert.equal(body.notes, "Visita");
});

test("alta y edición con proyecto existente: projectId válido; la edición rechaza nombres nuevos y submissionId", () => {
  const existing = { ...BASE_DRAFT, project: { id: 9, kind: PROJECT_KIND.EXISTING, name: "Apto. 910" } };
  assert.equal(parse(quoteCreateSchema, { body: { ...toQuotePayload(existing), submissionId: randomUUID() } }).issues, undefined);
  assert.equal(parse(quoteUpdateSchema, { body: { ...toQuotePayload(existing), expectedVersion: 1 }, params: { quoteId: "5" } }).issues, undefined);
  const renamed = { ...existing, project: { kind: PROJECT_KIND.NEW, name: "Casa nueva" } };
  assert.ok(parse(quoteUpdateSchema, { body: { ...toQuotePayload(renamed), expectedVersion: 1 }, params: { quoteId: "5" } }).issues.length);
  assert.ok(parse(quoteUpdateSchema, { body: { ...toQuotePayload(existing), expectedVersion: 1, submissionId: randomUUID() }, params: { quoteId: "5" } }).issues.length);
});

test("idempotencia: reenviar el mismo borrador produce la misma huella; cambiarlo, otra", () => {
  const submissionId = randomUUID();
  const draft = { ...BASE_DRAFT, project: { kind: PROJECT_KIND.NEW, name: "Casa del Lago" } };
  const fingerprintOf = (value) => buildQuoteSubmissionContent(parse(quoteCreateSchema, { body: { ...toQuotePayload(value), submissionId } }).body);
  assert.equal(fingerprintOf(draft), fingerprintOf({ ...draft, project: { ...draft.project, name: " Casa  del Lago" } }));
  assert.notEqual(fingerprintOf(draft), fingerprintOf({ ...draft, notes: "Otra" }));
  assert.notEqual(fingerprintOf(draft), fingerprintOf({ ...draft, project: { id: 9, kind: PROJECT_KIND.EXISTING, name: "Apto. 910" } }));
});

test("compatibilidad: el cuerpo del frontend anterior (sin submissionId) sigue siendo válido en el alta", () => {
  // Forma exacta que enviaba el editor antes de los proyectos Draft y la idempotencia.
  const legacyBody = { clientId: 3, items: [{ quantity: "200.5", serviceId: 1, unitRate: "14" }], notes: "Visita", projectId: 9 };
  const { body, issues } = parse(quoteCreateSchema, { body: legacyBody });
  assert.equal(issues, undefined, JSON.stringify(issues));
  assert.equal(body.submissionId, undefined);
  assert.ok(parse(quoteCreateSchema, { body: { ...legacyBody, submissionId: "no-es-uuid" } }).issues.includes("body.submissionId"));
});

test("proyecto nuevo: el backend exige submissionId y el editor siempre lo envía", () => {
  const draft = { ...BASE_DRAFT, project: { kind: PROJECT_KIND.NEW, name: "Casa del Lago" } };
  assert.deepEqual(parse(quoteCreateSchema, { body: toQuotePayload(draft) }).issues, ["body.submissionId"]);
  // useQuoteSubmit añade el identificador a toda alta.
  assert.equal(parse(quoteCreateSchema, { body: { ...toQuotePayload(draft), submissionId: randomUUID() } }).issues, undefined);
});
