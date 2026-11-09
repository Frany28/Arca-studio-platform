import assert from "node:assert/strict";
import test from "node:test";

import { getContentDispositionFileName } from "../src/api/client.js";

test("Content-Disposition: lee el nombre que el backend envía codificado con encodeURIComponent", () => {
  assert.equal(getContentDispositionFileName('attachment; filename="COT-001-v2.pdf"'), "COT-001-v2.pdf");
  assert.equal(getContentDispositionFileName('attachment; filename="Cotizaci%C3%B3n%20final.pdf"'), "Cotización final.pdf");
  assert.equal(getContentDispositionFileName("attachment; filename=COT-003-v1.pdf"), "COT-003-v1.pdf");
});

test("Content-Disposition: prefiere filename* (RFC 5987) sobre filename", () => {
  assert.equal(
    getContentDispositionFileName("attachment; filename=\"respaldo.pdf\"; filename*=UTF-8''COT-010-v3.pdf"),
    "COT-010-v3.pdf",
  );
});

test("Content-Disposition: sin nombre utilizable devuelve null para que se use el respaldo", () => {
  assert.equal(getContentDispositionFileName(null), null);
  assert.equal(getContentDispositionFileName("attachment"), null);
  assert.equal(getContentDispositionFileName('attachment; filename=""'), null);
  assert.equal(getContentDispositionFileName('attachment; filename="%E0%A4%A.pdf"'), null, "Codificación inválida");
});
