import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = path.join(backendDirectory, "prisma", "migrations");
const MIGRATION_NAME = "20261014130000_revoke_api_role_table_privileges";
const API_ROLES = ["anon", "authenticated", "service_role"];
const DANGEROUS_PRIVILEGES = ["MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE"];
const DATA_PRIVILEGES = ["DELETE", "INSERT", "SELECT", "UPDATE"];

const catalogUrl = process.env.ARCA_DB_PRIVILEGE_TEST_DATABASE_URL;
const catalogSkip = !catalogUrl && "Requiere ARCA_DB_PRIVILEGE_TEST_DATABASE_URL; solo lee el catálogo en una transacción READ ONLY.";

/**
 * Lee el SQL de la migración D-2 sin comentarios para analizar solo sentencias.
 *
 * @returns {Promise<{ raw: string, statements: string }>} SQL completo y SQL sin comentarios.
 */
async function readMigration() {
  const raw = await readFile(path.join(migrationsDirectory, MIGRATION_NAME, "migration.sql"), "utf8");
  return { raw, statements: raw.replace(/--.*$/gm, "") };
}

test("D-2 revoca los privilegios peligrosos en todas las tablas propias y solo en ellas", async () => {
  const [{ statements }, schema] = await Promise.all([
    readMigration(),
    readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8"),
  ]);
  const declared = [...statements.match(/ARRAY\[([\s\S]*?)\]/)[1].matchAll(/'([a-z_]+)'/g)].map(([, name]) => name).sort();
  const models = [...schema.matchAll(/^model ([a-z_]+) \{/gm)].map(([, name]) => name);
  assert.deepEqual(declared, ["_prisma_migrations", ...models].sort());
  assert.equal(new Set(declared).size, declared.length);
});

test("D-2 no concede, no toca datos ni privilegios de lectura/escritura, ni otros esquemas", async () => {
  const { statements } = await readMigration();
  const revoked = statements.match(/'(TRUNCATE, TRIGGER, REFERENCES)'[\s\S]*?', (MAINTAIN)'/);
  assert.deepEqual(revoked.slice(1).join(", ").split(", ").sort(), DANGEROUS_PRIVILEGES);
  assert.match(statements, /rolname IN \('anon', 'authenticated', 'service_role'\)/);
  assert.match(statements, /REVOKE %s ON TABLE public\.%I FROM %s/);
  for (const forbidden of [/\bGRANT\b/i, /DEFAULT\s+PRIVILEGES/i, /\b(?:DROP|TRUNCATE\s+public|DELETE\s+FROM|UPDATE\s+public|INSERT\s+INTO|ALTER\s+ROLE|ALTER\s+TABLE)\b/i]) {
    assert.doesNotMatch(statements, forbidden);
  }
  for (const schemaName of ["auth", "storage", "realtime", "extensions", "graphql", "vault", "supabase_"]) {
    assert.doesNotMatch(statements, new RegExp(`\\b${schemaName}[a-z_]*\\.`));
  }
  assert.match(statements, /RAISE EXCEPTION 'D-2: la tabla public\.% no existe/);
  // Con otro propietario, REVOKE dejaría en silencio privilegios concedidos por terceros.
  assert.match(statements, /IF target_owner <> current_user THEN\s+RAISE EXCEPTION/);
});

test("D-2 se aplica después de crear las tablas de soporte (D-4)", async () => {
  const migrations = (await readdir(migrationsDirectory)).filter((name) => /^\d{14}_/.test(name)).sort();
  assert.ok(migrations.indexOf("20261014120000_support_tables") >= 0);
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261014120000_support_tables"));
});

test("toda migración posterior a D-2 que cree tablas revoca los privilegios peligrosos", async () => {
  // Los privilegios predeterminados de postgres se mantienen a propósito: cada tabla nueva
  // los recibiría, así que la migración que la crea debe revocarlos explícitamente.
  const migrations = (await readdir(migrationsDirectory)).filter((name) => /^\d{14}_/.test(name) && name > MIGRATION_NAME).sort();
  const offenders = [];
  for (const name of migrations) {
    const sql = (await readFile(path.join(migrationsDirectory, name, "migration.sql"), "utf8")).replace(/--.*$/gm, "");
    for (const [, table] of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_]+)"?/gi)) {
      if (!hasDangerousPrivilegeRevoke(sql, table)) offenders.push(`${name}: ${table}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("la regla de tablas nuevas reconoce la sentencia REVOKE documentada", () => {
  const documented = "REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.new_table FROM anon, authenticated, service_role;";
  assert.equal(hasDangerousPrivilegeRevoke(documented, "new_table"), true);
  assert.equal(hasDangerousPrivilegeRevoke("REVOKE TRUNCATE ON TABLE public.new_table FROM anon;", "new_table"), false);
  assert.equal(hasDangerousPrivilegeRevoke(documented, "other_table"), false);
});

/**
 * Comprueba si un SQL revoca los cuatro privilegios peligrosos de una tabla a los tres roles de la API.
 *
 * @param {string} sql - SQL de la migración, sin comentarios.
 * @param {string} table - Tabla creada por la migración.
 * @returns {boolean} true si incluye la sentencia REVOKE documentada para esa tabla.
 */
function hasDangerousPrivilegeRevoke(sql, table) {
  const pattern = new RegExp(
    `REVOKE\\s+TRUNCATE,\\s*TRIGGER,\\s*REFERENCES,\\s*MAINTAIN\\s+ON\\s+TABLE\\s+(?:"?public"?\\.)?"?${table}"?\\s+FROM\\s+anon,\\s*authenticated,\\s*service_role\\b`,
    "i",
  );
  return pattern.test(sql);
}

/**
 * Ejecuta una consulta del catálogo en una transacción de solo lectura y la revierte.
 *
 * @param {string} sql - Consulta sobre el catálogo de PostgreSQL.
 * @returns {Promise<Array<object>>} Filas obtenidas.
 */
async function readCatalog(sql) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: catalogUrl, connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    return (await client.query(sql, [API_ROLES])).rows;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

test("catálogo: los roles de la API no conservan privilegios sobre tablas de ARCA en public", { skip: catalogSkip }, async () => {
  const rows = await readCatalog(`
    select c.relname as table_name, a.grantee::regrole::text as grantee, a.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relowner = (select oid from pg_roles where rolname = current_user)
      and a.grantee <> 0
      and a.grantee::regrole::text = any($1)
    order by 1, 2, 3
  `);
  assert.deepEqual(rows.filter((row) => DANGEROUS_PRIVILEGES.includes(row.privilege_type)), [], "privilegios peligrosos");
  assert.deepEqual(rows.filter((row) => DATA_PRIVILEGES.includes(row.privilege_type)), [], "privilegios de datos");
});
