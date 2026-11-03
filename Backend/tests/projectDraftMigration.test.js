import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { addedColumns, backendDirectory, listMigrations, prismaColumns, readMigrationStatements } from "./helpers/migrationSchema.js";

// Proyectos draft desde cotizaciones (20261102120000–20261102122000): enum, datos mínimos e idempotencia.
const STATUS_MIGRATION = "20261102120000_project_draft_status";
const REQUIREMENTS_MIGRATION = "20261102121000_project_draft_requirements";
const SUBMISSION_MIGRATION = "20261102122000_quote_submission_id";
const DATA_MUTATIONS = /\b(DROP\s+(TABLE|TYPE|INDEX|CONSTRAINT|COLUMN)|TRUNCATE\s|DELETE FROM|UPDATE public\.|INSERT INTO|DISABLE TRIGGER|ALTER SEQUENCE|setval)/i;

/**
 * Lee una migración sin comentarios y con los espacios normalizados.
 *
 * @param {string} name - Carpeta de la migración.
 * @returns {Promise<string>} SQL en una línea.
 */
async function flatMigration(name) {
  return (await readMigrationStatements(name)).replace(/\s+/g, " ");
}

test("orden: el valor del enum se crea en una migración anterior a las restricciones que lo usan", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(STATUS_MIGRATION) >= 0);
  assert.equal(migrations.indexOf(REQUIREMENTS_MIGRATION), migrations.indexOf(STATUS_MIGRATION) + 1);
  const sql = (await flatMigration(STATUS_MIGRATION)).trim();
  assert.equal(sql, "ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'pending';");
});

test("datos mínimos: solo un draft puede omitir fecha de inicio, tipo, ubicación y planos", async () => {
  const sql = await flatMigration(REQUIREMENTS_MIGRATION);
  const dropped = [...sql.matchAll(/ALTER TABLE public\.projects ALTER COLUMN (\w+) DROP NOT NULL;/g)].map(([, column]) => column);
  assert.deepEqual(dropped.sort(), ["has_plans", "location", "project_type", "start_date"]);
  const draftOrArchivedDraft = "status = 'draft'::public.project_status OR (status = 'archived'::public.project_status AND archived_from_status = 'draft'::public.project_status)";
  assert.ok(sql.includes(`chk_projects_draft_requirements CHECK ( ${draftOrArchivedDraft} OR (start_date IS NOT NULL AND project_type IS NOT NULL AND location IS NOT NULL AND has_plans IS NOT NULL) ) NOT VALID`));
  assert.match(sql, /chk_projects_draft_without_end_date CHECK \( end_date IS NULL OR NOT \(/);
  assert.match(sql, /chk_project_stages_status_not_draft CHECK \(status <> 'draft'::public\.project_status\) NOT VALID/);
  assert.match(sql, /chk_project_milestones_status_not_draft CHECK \(status <> 'draft'::public\.project_status\) NOT VALID/);
  for (const constraint of ["chk_projects_draft_requirements", "chk_projects_draft_without_end_date", "chk_project_stages_status_not_draft", "chk_project_milestones_status_not_draft"]) {
    assert.match(sql, new RegExp(`VALIDATE CONSTRAINT ${constraint};`), constraint);
  }
  assert.match(sql, /^ ?BEGIN;.*COMMIT; ?$/);
});

test("idempotencia: identificador y huella opcionales, coherentes y únicos por autor", async () => {
  const sql = await readMigrationStatements(SUBMISSION_MIGRATION);
  assert.deepEqual(Object.fromEntries(addedColumns(sql, "quotes")), { submission_fingerprint: "CHAR(64)", submission_id: "UUID" });
  const flat = sql.replace(/\s+/g, " ");
  assert.ok(flat.includes("(submission_id IS NULL AND submission_fingerprint IS NULL) OR (submission_id IS NOT NULL AND submission_fingerprint ~ '^[0-9a-f]{64}$')"));
  assert.ok(flat.includes("CREATE UNIQUE INDEX uq_quotes_created_by_submission ON public.quotes (created_by, submission_id) WHERE submission_id IS NOT NULL;"));
});

test("las tres migraciones no modifican filas, triggers ni secuencias", async () => {
  for (const name of [STATUS_MIGRATION, REQUIREMENTS_MIGRATION, SUBMISSION_MIGRATION]) {
    assert.doesNotMatch(await readMigrationStatements(name), DATA_MUTATIONS, name);
  }
});

test("schema.prisma: draft en el enum y nulabilidad de los datos mínimos", async () => {
  const schema = await readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /enum project_status \{\s+draft\s+pending\s+in_process\s+finished\s+cancelled\s+archived\s+\}/);
  const projects = prismaColumns(schema, "projects");
  for (const column of ["start_date", "location", "has_plans"]) assert.match(projects.get(column), /^\S+\?/, column);
  // prismaColumns solo reconoce escalares; el enum se comprueba sobre el modelo.
  const projectsModel = schema.match(/^model projects \{([\s\S]*?)^\}/m)[1];
  assert.match(projectsModel, /^\s+project_type\s+project_type\?\s*$/m);
  assert.match(projects.get("name"), /^String /);
});
