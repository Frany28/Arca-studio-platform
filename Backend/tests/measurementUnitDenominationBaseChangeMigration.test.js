import assert from "node:assert/strict";
import test from "node:test";

import { listMigrations, readMigrationStatements } from "./helpers/migrationSchema.js";

// El comportamiento del trigger contra PostgreSQL real se prueba en measurementUnits.integration.test.js.
const MIGRATION_NAME = "20261021120000_measurement_unit_denomination_base_change";

test("la función del trigger solo rechaza el cambio de base con servicios o versiones que la referencien", async () => {
  const sql = (await readMigrationStatements(MIGRATION_NAME)).replace(/\s+/g, " ");
  for (const fragment of [
    "CREATE OR REPLACE FUNCTION public.prevent_denomination_unit_change() RETURNS trigger LANGUAGE plpgsql SET search_path = ''",
    "IF NEW.measurement_unit_id IS NOT DISTINCT FROM OLD.measurement_unit_id THEN RETURN NEW; END IF;",
    "EXISTS (SELECT 1 FROM public.services WHERE unit_denomination_id = OLD.id)",
    "OR EXISTS (SELECT 1 FROM public.service_versions WHERE unit_denomination_id = OLD.id)",
    "USING ERRCODE = '55000'",
    "REVOKE EXECUTE ON FUNCTION public.prevent_denomination_unit_change() FROM PUBLIC;",
  ]) {
    assert.ok(sql.includes(fragment), fragment);
  }
  // Se ejecuta con los privilegios de quien actualiza: no se eleva con SECURITY DEFINER.
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
});

test("la migración solo redefine la función: conserva el trigger, tablas, datos y privilegios", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const forbidden of [/\bDROP\b/i, /\bINSERT\b/i, /\bUPDATE\s+public\./i, /\bDELETE\b/i, /\bTRUNCATE\b/i,
    /\bALTER\s+TABLE\b/i, /\bCREATE\s+(TABLE|TRIGGER|INDEX|UNIQUE|SEQUENCE)\b/i, /\bGRANT\b/i]) {
    assert.doesNotMatch(sql, forbidden);
  }
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.[a-z_]+)/g)].map(([, name]) => name), ["public.prevent_denomination_unit_change"]);
});

test("se aplica después de B2 y del código público de denominaciones", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261020090000_measurement_unit_denominations"));
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261020150000_measurement_unit_denomination_public_code"));
});
