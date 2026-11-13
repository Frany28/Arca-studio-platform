import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = "20261113120000_project_draft_configuration";
const checksum = "7e5aa94035425b39ea49d325c0c9eba050b44c3c3b8c53ecaeb06eeea2475635";

test("alternativa B: la migración original conserva exactamente su checksum y sus protecciones", async () => {
  const bytes = await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum);
  const sql = bytes.toString("utf8").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(sql, /\b(?:UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE\s|INSERT\s+INTO)/i);
  for (const table of ["project_folders", "project_warranties"]) {
    assert.match(sql, new RegExp(`REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public\\.${table}`));
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
});

test("preflight y postcheck ejecutan únicamente consultas y configuración local en transacción READ ONLY", async () => {
  for (const name of ["preflight", "postcheck"]) {
    const source = await readFile(new URL(`../prisma/checks/${migration}/${name}.sql`, import.meta.url), "utf8");
    const sql = source.replace(/--[^\n]*/g, "").replace(/^\\.*$/gm, "").trim();
    assert.match(sql, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    assert.match(sql, /ROLLBACK;$/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMIT|CALL|DO|COPY)\b/i);
    assert.match(sql, /SET LOCAL lock_timeout/);
    assert.match(sql, /SET LOCAL statement_timeout/);
    for (const table of ["projects", "project_requests", "files", "file_versions"]) assert.ok(sql.includes(`public.${table}`));
  }
});
