import assert from "node:assert/strict";
import test from "node:test";

import { planWarrantySave } from "../src/domain/projectWarrantySave.js";

// Fase 1.2 (B8): plan del guardado estable de garantías, sin PostgreSQL.

const warranty = (overrides = {}) => ({ code: "C", endDate: "2027-01-01", model: "M", product: "P", serviceDate: "2026-06-01", startDate: "2026-01-01", ...overrides });

test("con ids: actualiza por id, inserta las nuevas, retira las omitidas y ordena por el envío", () => {
  const plan = planWarrantySave({
    existing: [{ id: 1 }, { id: 2 }, { id: 3 }],
    submitted: [warranty({ id: 3 }), warranty(), warranty({ id: 1 })],
  });
  assert.equal(plan.outcome, "allowed");
  assert.deepEqual(plan.updates.map((entry) => [entry.id, entry.sortOrder]), [[3, 1], [1, 3]]);
  assert.deepEqual(plan.inserts.map((entry) => entry.sortOrder), [2]);
  assert.deepEqual(plan.retireIds, [2]);
});

test("nunca asocia por posición ni por contenido: dos garantías iguales sin id son dos nuevas", () => {
  const plan = planWarrantySave({ existing: [{ id: 7 }], submitted: [warranty({ id: 7 }), warranty(), warranty()] });
  assert.deepEqual([plan.updates.length, plan.inserts.length, plan.retireIds], [1, 2, []]);
});

test("ids ajenos, retirados o repetidos se rechazan con su posición", () => {
  assert.deepEqual(planWarrantySave({ existing: [{ id: 1 }], submitted: [warranty({ id: 99 })] }), { index: 0, outcome: "invalid", reason: "WARRANTY_NOT_FOUND" });
  assert.deepEqual(planWarrantySave({ existing: [{ id: 1 }], submitted: [warranty({ id: 1 }), warranty({ id: 1 })] }), { index: 1, outcome: "invalid", reason: "DUPLICATE_WARRANTY_ID" });
});

test("compatibilidad: un envío sin ids que retiraría garantías con documentos se rechaza; sin vínculos, como antes", () => {
  const counts = new Map([[1, 2]]);
  assert.deepEqual(planWarrantySave({ activeLinkCounts: counts, existing: [{ id: 1 }, { id: 2 }], submitted: [warranty()] }),
    { outcome: "conflict", reason: "WARRANTY_REFERENCES_REQUIRED", warrantyIds: [1] });
  const legacy = planWarrantySave({ existing: [{ id: 1 }, { id: 2 }], submitted: [warranty()] });
  assert.deepEqual([legacy.outcome, legacy.retireIds, legacy.inserts.length], ["allowed", [1, 2], 1]);
  // Si el envío identifica alguna garantía, omitir otra es una retirada explícita aunque tenga vínculos.
  const explicit = planWarrantySave({ activeLinkCounts: counts, existing: [{ id: 1 }, { id: 2 }], submitted: [warranty({ id: 2 })] });
  assert.deepEqual([explicit.outcome, explicit.retireIds], ["allowed", [1]]);
});
