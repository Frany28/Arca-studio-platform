import assert from "node:assert/strict";
import test from "node:test";

import { listMigrations, readMigrationStatements } from "./helpers/migrationSchema.js";

const MIGRATION_NAME = "20261020150000_measurement_unit_denomination_public_code";

test("public_code es una columna generada desde el id, obligatoria y única", async () => {
  const sql = (await readMigrationStatements(MIGRATION_NAME)).replace(/\s+/g, " ");
  assert.ok(sql.includes(
    "ALTER TABLE public.measurement_unit_denominations ADD COLUMN public_code VARCHAR(24) GENERATED ALWAYS AS ('UNID-' || lpad(id::text, greatest(3, length(id::text)), '0')) STORED NOT NULL;",
  ));
  assert.ok(sql.includes("ADD CONSTRAINT uq_measurement_unit_denominations_public_code UNIQUE (public_code);"));
});

test("la migración solo añade el código: sin datos, funciones, triggers ni cambios en otras tablas", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const forbidden of [/\bDROP\b/i, /\bINSERT\b/i, /\bUPDATE\s+public\./i, /\bDELETE\b/i, /\bTRUNCATE\b/i,
    /\bCREATE\s+(TABLE|FUNCTION|TRIGGER|SEQUENCE)\b/i, /\bALTER\s+COLUMN\b/i, /\bGRANT\b/i, /\bREVOKE\b/i]) {
    assert.doesNotMatch(sql, forbidden);
  }
  const altered = [...sql.matchAll(/ALTER TABLE public\.([a-z_]+)/g)].map(([, table]) => table);
  assert.deepEqual([...new Set(altered)], ["measurement_unit_denominations"]);
});

test("se aplica después de B2 y de la carga del catálogo de unidades", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261020090000_measurement_unit_denominations"));
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261020130000_measurement_units_catalog_data"));
});
