import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDuplicateServiceErrors,
  collectWholeQuantityErrors,
  formatGeneratedQuoteCode,
  hasQuoteContentChanged,
} from "../src/domain/quote.js";
import { formatGeneratedServiceCode } from "../src/domain/serviceCatalog.js";

const CONTENT = {
  clientId: 3,
  items: [
    { quantity: "200.000", serviceId: 1, serviceVersionId: 10, unitRate: "12.00" },
    { quantity: "35.000", serviceId: 2, serviceVersionId: 20, unitRate: "45.00" },
  ],
  notes: null,
  projectId: 9,
};

test("código visible: COT- con el id de al menos tres dígitos y cumple chk_quotes_code", () => {
  assert.equal(formatGeneratedQuoteCode(1), "COT-001");
  assert.equal(formatGeneratedQuoteCode(42), "COT-042");
  assert.equal(formatGeneratedQuoteCode(1000), "COT-1000");
  assert.match(formatGeneratedQuoteCode(123456), /^COT-[0-9]{3,}$/);
  for (const invalid of [0, -1, 1.5, Number.NaN, "7", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatGeneratedQuoteCode(invalid), TypeError, String(invalid));
  }
  // El generador compartido conserva el comportamiento del tabulador.
  assert.equal(formatGeneratedServiceCode(7), "SERV-007");
  assert.throws(() => formatGeneratedServiceCode(0), /service_catalog: el id del servicio debe ser un entero positivo/);
});

test("servicios repetidos: se señala cada repetición, no la primera aparición", () => {
  const fields = {};
  collectDuplicateServiceErrors([{ serviceId: 1 }, { serviceId: 2 }, { serviceId: 1 }, { serviceId: 1 }], fields);
  assert.deepEqual(Object.keys(fields), ["items.2.serviceId", "items.3.serviceId"]);
  const clean = {};
  collectDuplicateServiceErrors([{ serviceId: 1 }, { serviceId: 2 }], clean);
  assert.deepEqual(clean, {});
});

test("unidades sin decimales: solo admiten cantidades enteras, con cualquier escritura de ceros", () => {
  const fields = {};
  collectWholeQuantityErrors([
    { quantity: "35.000", unitAllowsDecimals: false },
    { quantity: "35", unitAllowsDecimals: false },
    { quantity: "2.500", unitAllowsDecimals: false },
    { quantity: "2.500", unitAllowsDecimals: true },
  ], fields);
  assert.deepEqual(fields, { "items.2.quantity": "La unidad de este servicio solo admite cantidades enteras." });
});

test("cambios efectivos: misma escritura numérica no cambia; cliente, notas, orden, versión o importe sí", () => {
  assert.equal(hasQuoteContentChanged(CONTENT, structuredClone(CONTENT)), false);
  const rewritten = structuredClone(CONTENT);
  rewritten.items[0] = { ...rewritten.items[0], quantity: "200", unitRate: "12" };
  assert.equal(hasQuoteContentChanged(CONTENT, rewritten), false, "200 y 200.000 son la misma cantidad");

  const variants = [
    { ...CONTENT, clientId: 4 },
    { ...CONTENT, projectId: 10 },
    { ...CONTENT, notes: "Nueva observación" },
    { ...CONTENT, items: [...CONTENT.items].reverse() },
    { ...CONTENT, items: [{ ...CONTENT.items[0], serviceVersionId: 11 }, CONTENT.items[1]] },
    { ...CONTENT, items: [{ ...CONTENT.items[0], unitRate: "12.01" }, CONTENT.items[1]] },
    { ...CONTENT, items: [CONTENT.items[0]] },
  ];
  for (const variant of variants) assert.equal(hasQuoteContentChanged(CONTENT, variant), true, JSON.stringify(variant));
});
