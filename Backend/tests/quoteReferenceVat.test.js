import assert from "node:assert/strict";
import test from "node:test";

import { getConfiguredReferenceVat, QUOTE_REFERENCE_VAT_RATE_VARIABLE } from "../src/config/quoteReferenceVat.js";
import { hasQuoteContentChanged } from "../src/domain/quote.js";
import {
  formatReferenceVatRate,
  parseConfiguredReferenceVat,
  REFERENCE_VAT_NOT_CONFIGURED,
  resolveQuoteReferenceVat,
} from "../src/domain/quoteReferenceVat.js";

test("tasa configurada: vacía queda pendiente; las válidas se normalizan con el motor y 0 % es válida", () => {
  for (const missing of [undefined, null, "", "   "]) {
    assert.deepEqual(parseConfiguredReferenceVat(missing), { referenceVat: REFERENCE_VAT_NOT_CONFIGURED });
  }
  assert.deepEqual(parseConfiguredReferenceVat("16"), { referenceVat: { enabled: true, rate: "16.00" } });
  assert.deepEqual(parseConfiguredReferenceVat(" 12.5 "), { referenceVat: { enabled: true, rate: "12.50" } });
  assert.deepEqual(parseConfiguredReferenceVat("0"), { referenceVat: { enabled: true, rate: "0.00" } });
  assert.deepEqual(parseConfiguredReferenceVat("100"), { referenceVat: { enabled: true, rate: "100.00" } });
});

test("tasa configurada no válida: no se inventa una tasa", () => {
  for (const invalid of ["16%", "-1", "100.01", "12.345", "abc", "1e2"]) {
    assert.ok(parseConfiguredReferenceVat(invalid).error, invalid);
  }
  assert.throws(
    () => getConfiguredReferenceVat({ [QUOTE_REFERENCE_VAT_RATE_VARIABLE]: "16%" }),
    (error) => error.code === "QUOTE_REFERENCE_VAT_MISCONFIGURED" && error.status === 500,
  );
  assert.deepEqual(getConfiguredReferenceVat({}), REFERENCE_VAT_NOT_CONFIGURED);
  assert.deepEqual(getConfiguredReferenceVat({ [QUOTE_REFERENCE_VAT_RATE_VARIABLE]: "16" }), { enabled: true, rate: "16.00" });
});

test("al editar, una cotización con IVA conserva su tasa; una nueva o pendiente usa la configurada", () => {
  const configured = { enabled: true, rate: "16.00" };
  assert.deepEqual(resolveQuoteReferenceVat({ configured, stored: null }), configured);
  assert.deepEqual(resolveQuoteReferenceVat({ configured, stored: { enabled: true, rate: "12.00" } }), { enabled: true, rate: "12.00" });
  assert.deepEqual(resolveQuoteReferenceVat({ configured, stored: { enabled: false, rate: null } }), configured);
  assert.deepEqual(resolveQuoteReferenceVat({ configured: REFERENCE_VAT_NOT_CONFIGURED, stored: null }), REFERENCE_VAT_NOT_CONFIGURED);
  // La tasa guardada se conserva aunque después se retire la configuración.
  assert.deepEqual(
    resolveQuoteReferenceVat({ configured: REFERENCE_VAT_NOT_CONFIGURED, stored: { enabled: true, rate: "0.00" } }),
    { enabled: true, rate: "0.00" },
  );
});

test("pasar de IVA pendiente a una tasa es un cambio de contenido; la misma tasa escrita distinto no", () => {
  const content = { clientId: 1, items: [], notes: null, projectId: 2 };
  const pending = { ...content, referenceVat: REFERENCE_VAT_NOT_CONFIGURED };
  assert.equal(hasQuoteContentChanged(pending, { ...content, referenceVat: { enabled: true, rate: "16.00" } }), true);
  assert.equal(hasQuoteContentChanged({ ...content, referenceVat: { enabled: true, rate: "16.00" } }, { ...content, referenceVat: { enabled: true, rate: "16" } }), false);
  assert.equal(hasQuoteContentChanged(pending, content), false, "Sin IVA equivale a pendiente");
});

test("la tasa se muestra sin ceros decimales sobrantes", () => {
  assert.deepEqual(["16.00", "12.50", "0.00", "100.00", "7.25"].map(formatReferenceVatRate), ["16", "12.5", "0", "100", "7.25"]);
});
