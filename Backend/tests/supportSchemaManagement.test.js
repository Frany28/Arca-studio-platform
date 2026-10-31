import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const {
  createSupportRequestForUser,
  findSupportRequestForUpload,
  uploadSupportRequestFile,
} = await import("../src/repositories/supportRepository.js");

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATION_PATH = path.join(backendDirectory, "prisma", "migrations", "20261014120000_support_tables", "migration.sql");
const DDL_PATTERN = /\b(?:create|alter|drop)\s+(?:table|index|schema|type|extension|sequence|view|function|trigger|policy)\b|\btruncate\b/i;
const user = { id: 5, role: { code: "client" } };

/**
 * Sustituye el pool por un transporte que registra cada sentencia SQL y responde filas mínimas.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @returns {Array<string>} Sentencias ejecutadas, tanto en `query` como en clientes del pool.
 */
function recordSql(context) {
  const statements = [];
  const respond = async (sql) => {
    statements.push(String(sql));
    if (/insert into public\.support_requests/i.test(sql)) {
      return { rows: [{ created_at: new Date(), description: "d", id: "11", issue_type: null, status: "open", subject: "s", user_id: "5" }] };
    }
    if (/from public\.support_requests/i.test(sql)) return { rows: [{ id: "11", status: "open", user_id: "5" }] };
    if (/nextval\(pg_get_serial_sequence\('public\.support_request_files'/i.test(sql)) return { rows: [{ id: "21" }] };
    if (/insert into public\.support_request_files/i.test(sql)) {
      return { rows: [{ created_at: new Date(), file_extension: "pdf", file_size: "4", file_type: "application/pdf", id: "21", original_name: "a.pdf", support_request_id: "11" }] };
    }
    return { rows: [] };
  };
  context.mock.method(pool, "query", respond);
  context.mock.method(pool, "connect", async () => ({ query: respond, release() {} }));
  context.mock.method(objectStorage, "put", async () => ({}));
  return statements;
}

/**
 * Lista recursivamente los archivos JavaScript del código de producción del backend.
 *
 * @param {string} directory - Directorio a recorrer.
 * @returns {Promise<Array<string>>} Rutas absolutas de archivos `.js`.
 */
async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : listSourceFiles(fullPath);
    return entry.name.endsWith(".js") ? [fullPath] : [];
  }));
  return files.flat();
}

/**
 * Extrae los nombres de columna de una sentencia CREATE TABLE de la migración.
 *
 * @param {string} sql - Contenido de la migración.
 * @param {string} table - Tabla buscada.
 * @returns {Array<string>} Columnas en orden de declaración.
 */
function migrationColumns(sql, table) {
  const body = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`))[1];
  return body.split("\n").map((line) => line.trim()).filter((line) => /^[a-z_]+ [A-Z]/.test(line)).map((line) => line.split(" ")[0]);
}

/**
 * Extrae los campos escalares de un modelo de `schema.prisma`, sin relaciones.
 *
 * @param {string} schema - Contenido del esquema.
 * @param {string} model - Modelo buscado.
 * @returns {Array<string>} Campos escalares en orden de declaración.
 */
function prismaColumns(schema, model) {
  const body = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))[1];
  return body.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .filter(([name, type]) => name && type && /^(BigInt|String|DateTime)\??$/.test(type))
    .map(([name]) => name);
}

test("crear una solicitud de soporte no ejecuta DDL", async (context) => {
  const statements = recordSql(context);
  const request = await createSupportRequestForUser({ description: "d", issueType: "", subject: "s", user });
  assert.equal(request.id, 11);
  assert.ok(statements.length > 0);
  assert.deepEqual(statements.filter((sql) => DDL_PATTERN.test(sql)), []);
});

test("buscar y adjuntar archivos de soporte no ejecuta DDL", async (context) => {
  const statements = recordSql(context);
  assert.equal(Number((await findSupportRequestForUpload(11, user)).id), 11);
  const file = await uploadSupportRequestFile({
    body: Readable.from([Buffer.from("%PDF")]),
    contentType: "application/pdf",
    originalName: "a.pdf",
    size: 4,
    supportRequestId: 11,
    user,
  });
  assert.equal(file.id, 21);
  // P0-1: el adjunto se registra con una sola sentencia tras transferir el objeto, sin transacción abierta.
  assert.match(statements.at(-1), /insert into public\.support_request_files/i);
  assert.equal(pool.connect.mock.callCount(), 0);
  assert.deepEqual(statements.filter((sql) => DDL_PATTERN.test(sql)), []);
});

test("ningún módulo del backend crea ni altera estructura en runtime", async () => {
  const offenders = [];
  for (const file of await listSourceFiles(path.join(backendDirectory, "src"))) {
    if (DDL_PATTERN.test(await readFile(file, "utf8"))) offenders.push(path.relative(backendDirectory, file));
  }
  assert.deepEqual(offenders, []);
});

test("la migración versionada y Prisma declaran las mismas tablas de soporte", async () => {
  const [sql, schema] = await Promise.all([
    readFile(MIGRATION_PATH, "utf8"),
    readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8"),
  ]);
  for (const table of ["support_requests", "support_request_files"]) {
    assert.deepEqual(migrationColumns(sql, table), prismaColumns(schema, table), table);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.deepEqual(migrationColumns(sql, "support_requests"), [
    "id", "user_id", "issue_type", "subject", "description", "status", "created_at", "updated_at", "deleted_at",
  ]);
  assert.match(sql, /CONSTRAINT support_request_files_support_request_id_fkey[\s\S]*ON DELETE CASCADE ON UPDATE NO ACTION/);
  assert.match(schema, /map: "support_request_files_support_request_id_fkey"/);

  // Si una tabla ya existía, la verificación estructural debe esperar exactamente las columnas de Prisma.
  const expectedByGuard = [...sql.match(/expected_columns text\[\] := ARRAY\[([\s\S]*?)\];/)[1].matchAll(/'([a-z_]+)\.([a-z_]+):/g)]
    .map(([, table, column]) => `${table}.${column}`).sort();
  const expectedByPrisma = ["support_requests", "support_request_files"]
    .flatMap((table) => prismaColumns(schema, table).map((column) => `${table}.${column}`)).sort();
  assert.deepEqual(expectedByGuard, expectedByPrisma);
  assert.match(sql, /IF actual_columns IS DISTINCT FROM expected_columns THEN\s+RAISE EXCEPTION/);
  assert.match(sql, /confdeltype = 'c'/);
  // Solo crea estructura: ninguna sentencia elimina, vacía ni modifica datos existentes.
  const statementsWithoutComments = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(statementsWithoutComments, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
  assert.doesNotMatch(statementsWithoutComments, /\bDROP\b/i);
});
