import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

// Fase 1.2, B4: activación coordinada de versiones y revisión. Con la activación apagada el backend
// conserva exactamente su comportamiento: mismas sentencias de alta, sin columnas nuevas, y las rutas
// nuevas responden como inexistentes. El transporte simulado nunca consulta la base configurada.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { isProjectFileReviewEnabled } = await import("../src/config/projectFileReview.js");
const { buildStorageObjectKey } = await import("../src/config/storage.js");
const { describeStorageKeyShape } = await import("../src/domain/storageInventory.js");
const { requireProjectFileReviewEnabled } = await import("../src/middlewares/projectFileReview.js");
const { uploadProjectFile } = await import("../src/repositories/fileRepository.js");
const { objectStorage } = await import("../src/services/objectStorage.js");

/**
 * Simula PostgreSQL para una carga de proyecto y registra cada sentencia de la transacción.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @returns {string[]} Sentencias ejecutadas dentro de la transacción.
 */
function mockUploadDatabase(context) {
  const statements = [];
  context.mock.method(pool, "query", async (sql) => {
    if (/nextval/.test(sql)) return { rows: [{ id: "500" }] };
    return { rows: [] };
  });
  const client = {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      statements.push(text);
      if (/^select status from public\.projects/.test(text)) return { rows: [{ status: "in_process" }] };
      if (/from public\.projects project/.test(text)) {
        return { rows: [{ assigned_architect_id: 70, client_id: 1, id: 15, is_assignee: false, is_public: false, status: "in_process" }] };
      }
      if (/^insert into public\.files/.test(text)) return { rows: [{ current_version: null, file_category: "document", file_type: "application/pdf", id: 500, uploaded_by: 70 }] };
      if (/^insert into public\.file_versions/.test(text)) {
        return { rows: [{ created_at: new Date(), file_name: "k", file_size: 4, file_url: "u", id: 900, original_name: "plano.pdf", review_status: "pending", version_number: 1 }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  context.mock.method(pool, "connect", async () => client);
  context.mock.method(objectStorage, "put", async () => ({}));
  return statements;
}

/**
 * Sube un PDF mínimo como arquitecto asignado, con la activación indicada.
 *
 * @param {boolean} reviewRequired - Activación de la revisión.
 * @returns {Promise<object>} Archivo registrado.
 */
function uploadAs(reviewRequired) {
  return uploadProjectFile({
    body: Readable.from([Buffer.from("%PDF")]),
    contentType: "application/pdf",
    originalName: "plano.pdf",
    projectId: 15,
    reviewRequired,
    size: 4,
    user: { id: 70, role: { code: "architect" } },
  });
}

test("la activación se lee del entorno en cada llamada y solo «true» la enciende", () => {
  const previous = process.env.PROJECT_FILE_REVIEW_ENABLED;
  try {
    for (const [value, expected] of [[undefined, false], ["", false], ["false", false], ["1", false], ["yes", false], ["true", true], [" TRUE ", true]]) {
      if (value === undefined) delete process.env.PROJECT_FILE_REVIEW_ENABLED;
      else process.env.PROJECT_FILE_REVIEW_ENABLED = value;
      assert.equal(isProjectFileReviewEnabled(), expected, String(value));
    }
  } finally {
    if (previous === undefined) delete process.env.PROJECT_FILE_REVIEW_ENABLED;
    else process.env.PROJECT_FILE_REVIEW_ENABLED = previous;
  }
});

test("activación apagada: las rutas nuevas responden 404 de ruta inexistente sin continuar la cadena", () => {
  const previous = process.env.PROJECT_FILE_REVIEW_ENABLED;
  try {
    for (const [value, expectNext] of [["false", false], ["true", true]]) {
      process.env.PROJECT_FILE_REVIEW_ENABLED = value;
      const response = { body: null, statusCode: 200, json(body) { this.body = body; return this; }, status(code) { this.statusCode = code; return this; } };
      let continued = false;
      requireProjectFileReviewEnabled({}, response, () => { continued = true; });
      assert.equal(continued, expectNext, value);
      if (!expectNext) assert.deepEqual([response.statusCode, response.body], [404, { code: "API_ROUTE_NOT_FOUND", message: "Ruta de API no encontrada." }]);
    }
  } finally {
    if (previous === undefined) delete process.env.PROJECT_FILE_REVIEW_ENABLED;
    else process.env.PROJECT_FILE_REVIEW_ENABLED = previous;
  }
});

test("activación apagada: la carga usa exactamente las sentencias anteriores (sin columnas de B3)", async (context) => {
  const statements = mockUploadDatabase(context);
  const file = await uploadAs(false);
  const fileInsert = statements.find((sql) => sql.startsWith("insert into public.files"));
  const versionInsert = statements.find((sql) => sql.startsWith("insert into public.file_versions"));
  assert.equal(fileInsert, "insert into public.files (id, project_id, uploaded_by, title, file_type, file_category, current_version, status, folder_id) values ($1, $2, $3, $4, $5, $6, $7, $8::file_status, $9) returning id, project_id, project_request_id, uploaded_by, file_type, file_category, current_version");
  assert.equal(versionInsert, "insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current) values ($1, $2, $3, $4, $5, $6, $7, $8, true) returning id, version_number, file_name, original_name, file_url, file_size, created_at");
  for (const column of ["access_policy", "review_status", "content_type"]) {
    assert.ok(statements.every((sql) => !sql.includes(column)), `sin ${column}`);
  }
  assert.equal("reviewStatus" in file, false, "la respuesta de la carga no cambia");
});

test("activación encendida: la v1 nace pendiente, sin vigente y con la política 1.2", async (context) => {
  const statements = mockUploadDatabase(context);
  const file = await uploadAs(true);
  const fileInsert = statements.find((sql) => sql.startsWith("insert into public.files"));
  const versionInsert = statements.find((sql) => sql.startsWith("insert into public.file_versions"));
  assert.match(fileInsert, /access_policy\) values \(\$1, \$2, \$3, \$4, \$5, \$6, null, \$7::file_status, \$8, 1\)/);
  assert.match(versionInsert, /content_type, review_status\) values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, false, \$9, 'pending'\)/);
  assert.deepEqual([file.reviewStatus, file.versionId], ["pending", 900]);
});

test("claves de objeto: el identificador de intento solo se añade a las versiones nuevas", () => {
  const base = { belongsTo: "projects", fileId: 5, originalName: "Plano Final.pdf", ownerId: 7, parentId: 3, uploadedAt: new Date("2026-11-18T00:00:00Z"), versionNumber: 2 };
  assert.equal(buildStorageObjectKey(base), "projects/3/users/7/2026/11/files/5/v2/plano-final.pdf", "sin intento, la clave de siempre");
  assert.equal(buildStorageObjectKey({ ...base, attemptId: "AB12-cd/34" }), "projects/3/users/7/2026/11/files/5/v2-ab12cd34/plano-final.pdf");
  assert.notEqual(buildStorageObjectKey({ ...base, attemptId: "a1" }), buildStorageObjectKey({ ...base, attemptId: "b2" }), "dos intentos nunca comparten clave");
  assert.equal(describeStorageKeyShape("projects/3/users/7/2026/11/files/5/v2-ab12cd34/plano-final.pdf"), "projects/<n>/users/<n>/<n>/<n>/files/<n>/v<n>-<id>/<archivo>.pdf");
});
