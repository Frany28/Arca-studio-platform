import assert from "node:assert/strict";
import test from "node:test";

import { QUOTE_DECIMAL_FORMATS } from "../src/domain/quoteTotals.js";
import { addedColumns, readMigrationStatements } from "./helpers/migrationSchema.js";

// 20261031120000_quote_reference_vat: IVA referencial guardado con cada versión de cotización.
const MIGRATION_NAME = "20261031120000_quote_reference_vat";

test("añade la tasa y el importe con las escalas del motor y valores que cumplen las versiones existentes", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  const { amount, vatRate } = QUOTE_DECIMAL_FORMATS;
  assert.deepEqual(Object.fromEntries(addedColumns(sql, "quote_versions")), {
    reference_vat_amount: `NUMERIC(${amount.maxIntegerDigits + amount.scale},${amount.scale}) NOT NULL DEFAULT 0`,
    reference_vat_enabled: "BOOLEAN NOT NULL DEFAULT false",
    reference_vat_rate: `NUMERIC(${vatRate.maxIntegerDigits + vatRate.scale},${vatRate.scale})`,
  });
});

test("las restricciones replican el motor: tasa 0–100, importe redondeado y sin IVA ni tasa ni importe", async () => {
  const sql = (await readMigrationStatements(MIGRATION_NAME)).replace(/\s+/g, " ");
  assert.match(sql, /chk_quote_versions_reference_vat_rate CHECK \(reference_vat_rate IS NULL OR reference_vat_rate BETWEEN 0 AND 100\)/);
  assert.match(sql, /reference_vat_amount = round\(services_total \* reference_vat_rate \/ 100, 2\)/);
  assert.match(sql, /NOT reference_vat_enabled AND reference_vat_rate IS NULL AND reference_vat_amount = 0/);
  assert.match(sql, /chk_quote_versions_estimated_total_with_vat CHECK \(services_total \+ reference_vat_amount <= 999999999999\.99\)/);
});

test("solo añade columnas y restricciones: no modifica datos, triggers ni secuencias", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  assert.doesNotMatch(sql, /\b(DROP\s|TRUNCATE\s|DELETE FROM|UPDATE public\.|INSERT INTO|DISABLE TRIGGER|ALTER SEQUENCE|setval)/i);
  const alters = [...sql.matchAll(/ALTER TABLE public\.(\w+)/g)].map(([, table]) => table);
  assert.ok(alters.length > 0 && alters.every((table) => table === "quote_versions"), alters.join());
});
