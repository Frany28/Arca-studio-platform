import assert from "node:assert/strict";
import test from "node:test";

import { isFilterChange } from "../src/pages/admin-services-quotes/hooks/useCursorSearchList.js";

test("filtros: aplicar el mismo valor no cambia la consulta", () => {
  assert.equal(isFilterChange({ status: "active" }, "status", "active"), false);
  assert.equal(isFilterChange({ measurementUnitId: 4 }, "measurementUnitId", 4), false);
  assert.equal(isFilterChange({ dateFrom: "2026-03-10" }, "dateFrom", "2026-03-10"), false);
});

test("filtros: los valores vacíos equivalen a no tener el filtro", () => {
  for (const empty of [null, undefined, ""]) {
    assert.equal(isFilterChange({}, "status", empty), false, `Retirar un filtro ausente (${String(empty)})`);
  }
  assert.equal(isFilterChange({ status: "active" }, "status", null), true, "Retirar un filtro activo sí cambia");
});

test("filtros: un valor distinto o nuevo cambia la consulta", () => {
  assert.equal(isFilterChange({ status: "active" }, "status", "inactive"), true);
  assert.equal(isFilterChange({}, "status", "active"), true);
  assert.equal(isFilterChange({ measurementUnitId: 4 }, "measurementUnitId", "4"), true, "Sin conversiones implícitas de tipo");
});
