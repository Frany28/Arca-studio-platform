import assert from "node:assert/strict";
import test from "node:test";

import { buildQuotePdfReservation, toQuotePdfStatus } from "../src/domain/quotePdfDocument.js";
import { getSupabaseS3Client } from "../src/config/storage.js";
import { objectStorage } from "../src/services/objectStorage.js";

const QUOTE = { id: 152, currentVersion: 2, code: "COT-152", client: { name: "Cliente" }, project: { name: "Draft" },
  currency: "USD", createdAt: "2026-11-03T02:30:00Z", version: { id: 300, createdAt: "2026-11-03T15:00:00Z" },
  items: [], notes: null, servicesTotal: "0.00" };

test("reserva: clave segura por id y versión, fecha canónica y snapshot independiente del estado vivo", () => {
  const quote = structuredClone(QUOTE);
  const reservation = buildQuotePdfReservation(quote);
  assert.equal(reservation.objectKey, "quotes/152/versions/v2/COT-152-v2.pdf");
  assert.equal(reservation.model.date, "02/11/2026");
  assert.equal(reservation.model.generatedAt, QUOTE.version.createdAt);
  assert.match(reservation.sourceHash, /^[a-f0-9]{64}$/);
  quote.project.name = "Otro proyecto";
  assert.equal(reservation.model.projectName, "Draft");
  assert.equal(buildQuotePdfReservation({ ...QUOTE, code: "../../nombre del usuario" }).objectKey, reservation.objectKey);
  assert.throws(() => buildQuotePdfReservation({ ...QUOTE, id: "../../1" }));
});

test("estado público omite instantánea, bucket, clave y token de ejecución", () => {
  const status = toQuotePdfStatus({ status: "available", size_bytes: 200, file_name: "COT-152-v2.pdf", bucket: "private", lease_token: "secret", object_key: "key", document_model: QUOTE });
  assert.equal(status.size, 200);
  assert.equal(status.mimeType, "application/pdf");
  for (const field of ["bucket", "lease_token", "object_key", "document_model"]) assert.equal(status[field], undefined);
  assert.equal(toQuotePdfStatus(null).status, "pending");
});

Object.assign(process.env, { SUPABASE_STORAGE_S3_ACCESS_KEY_ID: "unit-test", SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: "unit-test",
  SUPABASE_STORAGE_S3_ENDPOINT: "https://storage.invalid", SUPABASE_STORAGE_BUCKET: "general-test" });

test("adaptador S3: bucket privado, precondición y metadatos; archivos generales conservan el bucket actual", async (context) => {
  const calls = [];
  context.mock.method(getSupabaseS3Client(), "send", async (command) => { calls.push(command); return {}; });
  await objectStorage.put({ body: Buffer.from("pdf"), bucket: "quotes-private-test", key: "quotes/1/versions/v1/COT-001-v1.pdf",
    contentLength: 3, contentType: "application/pdf", metadata: { sha256: "hash" }, ifNoneMatch: "*", timeoutMs: 1000 });
  assert.equal(calls[0].input.Bucket, "quotes-private-test");
  assert.equal(calls[0].input.IfNoneMatch, "*");
  assert.equal(calls[0].input.Metadata.sha256, "hash");
  await objectStorage.get("general.txt");
  assert.equal(calls[1].input.Bucket, "general-test");
  await objectStorage.head("private.pdf", { bucket: "quotes-private-test" });
  assert.equal(calls[2].input.Bucket, "quotes-private-test");
  await objectStorage.createBucket("quotes-private-test");
  assert.equal(calls[3].input.Bucket, "quotes-private-test");
  assert.equal(calls[3].constructor.name, "CreateBucketCommand");
});

test("adaptador S3: solo un 404 representa ausencia; no oculta permisos ni fallos de conexión", async (context) => {
  context.mock.method(getSupabaseS3Client(), "send", async () => { throw Object.assign(new Error("missing"), { $metadata: { httpStatusCode: 404 } }); });
  assert.equal(await objectStorage.head("key", { bucket: "quotes-private-test" }), null);
  context.mock.method(getSupabaseS3Client(), "send", async () => { throw Object.assign(new Error("denied"), { $metadata: { httpStatusCode: 403 } }); });
  await assert.rejects(objectStorage.head("key", { bucket: "quotes-private-test" }), /denied/);
});
