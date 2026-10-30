import assert from "node:assert/strict";
import test from "node:test";

import { hasQuoteContentChanged } from "../src/domain/quote.js";
import {
  formatReferenceVatRate,
  QUOTE_REFERENCE_VAT,
  QUOTE_REFERENCE_VAT_RATE,
  REFERENCE_VAT_NOT_APPLIED,
  resolveQuoteReferenceVat,
} from "../src/domain/quoteReferenceVat.js";
import { calculateQuoteTotals } from "../src/domain/quoteTotals.js";

test("tasa fija: 16 % con la escala de la columna y válida para el motor de importes", () => {
  assert.equal(QUOTE_REFERENCE_VAT_RATE, "16.00");
  assert.deepEqual(QUOTE_REFERENCE_VAT, { enabled: true, rate: "16.00" });
  const totals = calculateQuoteTotals({ items: [{ quantity: "200", unitRate: "14" }, { quantity: "35", unitRate: "47" }], referenceVat: QUOTE_REFERENCE_VAT });
  assert.deepEqual([totals.servicesTotal, totals.referenceVat.amount, totals.estimatedTotalWithVat], ["4445.00", "711.20", "5156.20"]);
  assert.equal(totals.referenceVat.rate, QUOTE_REFERENCE_VAT_RATE, "El motor no cambia la tasa");
});

test("una cotización nueva usa la tasa fija; al editar se conserva la de su versión guardada", () => {
  assert.deepEqual(resolveQuoteReferenceVat({ stored: null }), QUOTE_REFERENCE_VAT);
  assert.deepEqual(resolveQuoteReferenceVat({ stored: undefined }), QUOTE_REFERENCE_VAT);
  // Una tasa histórica distinta no se sustituye en silencio.
  assert.deepEqual(resolveQuoteReferenceVat({ stored: { amount: "1.00", enabled: true, rate: "12.50" } }), { enabled: true, rate: "12.50" });
  // Una versión guardada antes del IVA referencial sigue sin IVA.
  assert.deepEqual(resolveQuoteReferenceVat({ stored: { amount: "0.00", enabled: false, rate: null } }), REFERENCE_VAT_NOT_APPLIED);
});

test("la tasa forma parte del contenido: conservarla no crea versión; la misma tasa escrita distinto tampoco", () => {
  const content = { clientId: 1, items: [], notes: null, projectId: 2 };
  assert.equal(hasQuoteContentChanged({ ...content, referenceVat: QUOTE_REFERENCE_VAT }, { ...content, referenceVat: { enabled: true, rate: "16" } }), false);
  assert.equal(hasQuoteContentChanged({ ...content, referenceVat: REFERENCE_VAT_NOT_APPLIED }, content), false, "Sin IVA equivale a no aplicado");
  assert.equal(hasQuoteContentChanged({ ...content, referenceVat: REFERENCE_VAT_NOT_APPLIED }, { ...content, referenceVat: QUOTE_REFERENCE_VAT }), true);
});

test("la tasa se muestra sin ceros decimales sobrantes", () => {
  assert.deepEqual(["16.00", "12.50", "0.00", "100.00", "7.25"].map(formatReferenceVatRate), ["16", "12.5", "0", "100", "7.25"]);
});
