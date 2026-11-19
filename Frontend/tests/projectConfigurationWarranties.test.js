import assert from "node:assert/strict";
import test from "node:test";

import { toWarrantiesForm, toWarrantiesPayload } from "../src/pages/project-configuration/utils/projectConfigurationForm.js";

// Fase 1.2 (B8): las garantías existentes se envían con su id para que la API las actualice sin
// recrearlas; las nuevas no lo llevan y la clave local nunca sale del formulario.

test("las garantías existentes conservan su id; las nuevas se envían sin él y sin la clave local", () => {
  const form = [
    ...toWarrantiesForm({ warranties: [{ code: "C-1", endDate: "2027-01-01", id: 41, model: "M", product: "Calentador", serviceDate: "2026-06-01", startDate: "2026-01-01" }] }),
    { code: " C-2 ", endDate: "2027-01-01", key: "nueva-1", model: "M", product: "Bomba", serviceDate: "2026-06-01", startDate: "2026-01-01" },
  ];
  const { warranties } = toWarrantiesPayload(form);
  assert.equal(warranties[0].id, 41);
  assert.equal(Object.hasOwn(warranties[1], "id"), false);
  assert.equal(warranties[1].code, "C-2");
  for (const warranty of warranties) assert.equal(Object.hasOwn(warranty, "key"), false);
});
