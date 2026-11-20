import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Catálogo e historial reales, exclusivamente en una base local desechable. Reutiliza la guarda
// de las integraciones de expansión; no carga .env ni consulta la base de staging.
const enabled = process.env.ARCA_FILE_REVIEW_EXPANSION_DB_TESTS === "1" && process.env.ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL;
const skip = !enabled && "Requiere ARCA_FILE_REVIEW_EXPANSION_DB_TESTS=1 y ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL local.";
let database;
let readState;
before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL, prefix: "arca_review_activation", recordMigrations: true });
  // El repositorio recibe el cliente real explícito; el pool del módulo nunca se conecta.
  process.env.DATABASE_URL = database.databaseUrl;
  ({ readProjectFileReviewSchemaState: readState } = await import("../src/repositories/projectFileReviewSchemaRepository.js"));
});
after(async () => { await database?.drop(); });

test("historial con checksum real y esquema completo habilitan las dependencias", { skip }, async () => {
  assert.deepEqual(await readState(database.client), { ready: true, legacySafe: true, missing: [] });
});

for (const [label, sql] of [
  ["registro ausente", "delete from public._prisma_migrations where migration_name = '20261118120000_project_file_review_audience_expand'"],
  ["checksum diferente", "update public._prisma_migrations set checksum='alterado' where migration_name = '20261117120000_project_folder_system_keys'"],
  ["columna ausente con historial terminado", "alter table public.file_versions drop column review_reason cascade"],
  ["índice ausente con historial terminado", "drop index public.project_comments_panorama_version_point_unique_idx"],
  ["índice que perdió unicidad", "drop index public.project_comments_panorama_version_point_unique_idx; create index project_comments_panorama_version_point_unique_idx on public.project_comments(id)"],
  ["valor de enum ausente", "alter type public.file_version_review_status rename value 'approved' to 'approved_missing'"],
]) {
  test(`${label} impide activar aunque las otras dependencias existan`, { skip }, async () => {
    await database.client.query("begin");
    try {
      await database.client.query(sql);
      assert.equal((await readState(database.client)).ready, false);
    } finally { await database.client.query("rollback"); }
  });
}

test("un intento sin terminar impide activar y no modifica el historial", { skip }, async () => {
  await database.client.query("begin");
  try {
    await database.client.query("insert into public._prisma_migrations(id,checksum,migration_name) values ($1,'fallida','migracion_fallida')", [randomUUID()]);
    assert.ok((await readState(database.client)).missing.includes("unfinished_migration"));
  } finally { await database.client.query("rollback"); }
  assert.equal((await readState(database.client)).ready, true);
});
