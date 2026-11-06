import assert from "node:assert/strict";
import test from "node:test";

import { resolveUploadTransferLimit, VERCEL_FUNCTION_BODY_LIMIT_BYTES } from "../src/config/uploadTransferLimit.js";
import {
  formatTransferLimit,
  getProjectRequestFileErrors,
  getProjectRequestFileIssues,
} from "../src/utils/projectRequestValidation.js";

const pdf = (size) => ({ file: { name: "plano.pdf", size, type: "application/pdf" } });

test("el límite por subida solo se aplica en el build de producción o si se configura", () => {
  assert.equal(resolveUploadTransferLimit({ PROD: true }), VERCEL_FUNCTION_BODY_LIMIT_BYTES);
  assert.equal(resolveUploadTransferLimit({ PROD: false }), null, "desarrollo con Express local");
  assert.equal(resolveUploadTransferLimit({ PROD: true, VITE_UPLOAD_TRANSFER_LIMIT_BYTES: "0" }), null, "0 lo desactiva");
  assert.equal(resolveUploadTransferLimit({ PROD: false, VITE_UPLOAD_TRANSFER_LIMIT_BYTES: "1000" }), 1000);
  assert.equal(resolveUploadTransferLimit({ PROD: true, VITE_UPLOAD_TRANSFER_LIMIT_BYTES: "abc" }), null);
});

test("la validación distingue el límite funcional (50 MB) del límite temporal del entorno", () => {
  assert.equal(formatTransferLimit(VERCEL_FUNCTION_BODY_LIMIT_BYTES), "4,5 MB");
  const options = { transferLimitBytes: VERCEL_FUNCTION_BODY_LIMIT_BYTES };
  // Sin límite de entorno (pruebas en Node), un archivo de 10 MB es válido.
  assert.deepEqual(getProjectRequestFileErrors([pdf(10_000_000)]), []);
  // Con el límite del despliegue, se rechaza antes de subirlo y con un motivo distinto.
  assert.deepEqual(
    getProjectRequestFileIssues([pdf(10_000_000)], options).map((issue) => issue.message),
    ["plano.pdf: supera 4,5 MB, el máximo por archivo que admite temporalmente este entorno."],
  );
  assert.deepEqual(getProjectRequestFileIssues([pdf(4_000_000)], options), []);
  assert.deepEqual(
    getProjectRequestFileIssues([pdf(60 * 1024 * 1024)], options).map((issue) => issue.message),
    ["plano.pdf: supera 50 MB."],
  );
});
