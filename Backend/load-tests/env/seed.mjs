// Datos ficticios para las pruebas de carga (Fase 3). Reproducible: misma semilla, mismos datos.
//
//   node load-tests/env/seed.mjs --reset [--skip-objects]
//
// - Exige el entorno aislado (isolation.mjs): base arca_loadtest* local y MinIO local.
// - --reset elimina y recrea la base indicada en DATABASE_URL (solo arca_loadtest*), aplica todas las
//   migraciones de prisma/migrations con pg (sin la CLI de Prisma, que leería .env) y siembra.
// - --skip-objects no sube objetos a MinIO (comprobaciones sin almacenamiento); las descargas y la
//   comprobación de huérfanos necesitan los objetos.
// - Servicios y cotizaciones se crean con los servicios reales de la aplicación, que aplican sus reglas.
// - Escribe las cuentas en LOADTEST_OUTPUT_DIR/accounts.json (ignorado por git). Todas usan el dominio
//   reservado loadtest.invalid y una contraseña ficticia (LOADTEST_PASSWORD).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectIsolationViolations, failOnViolations } from "./isolation.mjs";

const args = new Set(process.argv.slice(2));
const skipObjects = args.has("--skip-objects");
failOnViolations(collectIsolationViolations(process.env, { requireStorage: !skipObjects }), "el sembrado");
if (!args.has("--reset")) {
  console.error("El sembrado recrea la base: ejecutar con --reset para confirmarlo.");
  process.exit(2);
}

const backendDirectory = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(backendDirectory, "package.json"));
const pg = require("pg");
const bcrypt = require("bcrypt");

const SCALE = Object.freeze({
  admins: Number(process.env.SEED_ADMINS || 5),
  architects: Number(process.env.SEED_ARCHITECTS || 25),
  clients: Number(process.env.SEED_CLIENTS || 90),
  commentsPerActiveProject: Number(process.env.SEED_COMMENTS_PER_PROJECT || 60),
  filesPerProject: Number(process.env.SEED_FILES_PER_PROJECT || 12),
  notificationsPerUser: 20,
  projectsPerClient: 4,
  quotes: 60,
  services: 30,
});
const PASSWORD = process.env.LOADTEST_PASSWORD || "Carga-Ficticia-2026!";
const OUTPUT_DIRECTORY = process.env.LOADTEST_OUTPUT_DIR || join(backendDirectory, "load-tests", "env", ".out");
const PERMISSIONS = {
  admin: ["projects.read", "projects.publish", "projects.files.upload", "projects.files.delete", "support.requests.create", "support.files.upload"],
  architect: ["projects.read", "projects.publish", "projects.files.upload", "projects.files.delete", "support.requests.create", "support.files.upload"],
  client: ["projects.read", "projects.files.upload", "support.requests.create", "support.files.upload"],
};

/**
 * Generador pseudoaleatorio con semilla (mulberry32) para datos reproducibles.
 *
 * @param {number} seed - Semilla.
 * @returns {() => number} Números en [0, 1).
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const random = createRandom(20261102);
const pick = (list) => list[Math.floor(random() * list.length)];

/**
 * Recrea la base de pruebas y aplica el historial completo de migraciones.
 *
 * @param {URL} databaseUrl - Base arca_loadtest*.
 * @returns {Promise<void>}
 */
async function recreateDatabase(databaseUrl) {
  const databaseName = databaseUrl.pathname.replace(/^\//, "");
  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: maintenance.toString(), ssl: false });
  await admin.connect();
  // El nombre ya está validado por isolation.mjs (arca_loadtest*).
  await admin.query(`drop database if exists "${databaseName}" with (force)`);
  await admin.query(`create database "${databaseName}"`);
  await admin.end();

  const client = new pg.Client({ connectionString: databaseUrl.toString(), ssl: false });
  await client.connect();
  await client.query(`create table public._prisma_migrations (
    id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
    migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
    started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`);
  const migrationsDirectory = join(backendDirectory, "prisma", "migrations");
  const migrations = readdirSync(migrationsDirectory).filter((name) => /^\d{14}_/.test(name)).sort();
  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDirectory, migration, "migration.sql"), "utf8");
    // Un valor de enum nuevo no puede usarse en la misma transacción implícita que lo crea.
    for (const chunk of sql.split(/(?<=ADD VALUE[^;]*;)/i)) if (chunk.trim()) await client.query(chunk);
  }
  await client.end();
  console.log(JSON.stringify({ migrations: migrations.length, type: "loadtest_schema_ready" }));
}

/**
 * Inserta filas en bloque con un único INSERT ... SELECT FROM unnest.
 *
 * @param {import("pg").Client} client - Conexión.
 * @param {string} table - Tabla.
 * @param {Array<[string, string]>} columns - Pares [columna, tipo SQL del array].
 * @param {Array<Array<unknown>>} rows - Filas en el orden de las columnas.
 * @returns {Promise<void>}
 */
async function bulkInsert(client, table, columns, rows) {
  for (let start = 0; start < rows.length; start += 2000) {
    const batch = rows.slice(start, start + 2000);
    const arrays = columns.map((_, index) => batch.map((row) => row[index]));
    const casts = columns.map(([, type], index) => `$${index + 1}::${type}[]`).join(", ");
    await client.query(
      `insert into public.${table} (${columns.map(([name]) => name).join(", ")}) select * from unnest(${casts})`,
      arrays,
    );
  }
}

/**
 * Contenido mínimo con la firma del tipo, para que las descargas sirvan un objeto coherente.
 *
 * @param {string} extension - Extensión del archivo.
 * @param {number} size - Tamaño en bytes.
 * @returns {Buffer} Contenido ficticio.
 */
function fileBody(extension, size) {
  const signature = { docx: Buffer.from("504b0304", "hex"), pdf: Buffer.from("%PDF-1.7\n"), png: Buffer.from("89504e470d0a1a0a", "hex") }[extension];
  const body = Buffer.alloc(size, 0x20);
  signature.copy(body);
  return body;
}

const databaseUrl = new URL(process.env.DATABASE_URL);
await recreateDatabase(databaseUrl);
const client = new pg.Client({ connectionString: databaseUrl.toString(), ssl: false });
await client.connect();

// Roles y permisos (matriz ficticia aproximada; ajustar si la de producción difiere).
const roleIds = {};
for (const [code, name] of [["admin", "Administrador"], ["architect", "Arquitecto"], ["client", "Cliente"]]) {
  roleIds[code] = (await client.query("insert into public.roles (code, name) values ($1, $2) returning id", [code, name])).rows[0].id;
}
const permissionIds = {};
for (const code of new Set(Object.values(PERMISSIONS).flat())) {
  permissionIds[code] = (await client.query("insert into public.permissions (code, name, module) values ($1, $1, $2) returning id", [code, code.split(".")[0]])).rows[0].id;
}
for (const [role, codes] of Object.entries(PERMISSIONS)) {
  for (const code of codes) await client.query("insert into public.role_permissions (role_id, permission_id) values ($1, $2)", [roleIds[role], permissionIds[code]]);
}

// Usuarios y clientes.
const passwordHash = await bcrypt.hash(PASSWORD, 10);
const users = [];
const clients = [];
const phone = 4120000000;
const addUser = (role, index, clientId = null) => {
  const user = { clientId, email: `${role}-${String(index).padStart(3, "0")}@loadtest.invalid`, id: users.length + 1, role };
  users.push(user);
  return user;
};
for (let index = 1; index <= SCALE.admins; index += 1) addUser("admin", index);
for (let index = 1; index <= SCALE.architects; index += 1) addUser("architect", index);
for (let index = 1; index <= SCALE.clients; index += 1) {
  const clientRow = { id: index, name: `Cliente ficticio ${index}` };
  clients.push(clientRow);
  addUser("client", index, clientRow.id);
}
await bulkInsert(client, "clients", [["id", "bigint"], ["name", "text"], ["email", "text"], ["phone", "text"], ["city", "text"], ["country", "text"]],
  clients.map((row) => [row.id, row.name, `cliente-${row.id}@loadtest.invalid`, `+58${phone + row.id}`, "Caracas", "VE"]));
await bulkInsert(client, "users", [["id", "bigint"], ["role_id", "bigint"], ["client_id", "bigint"], ["email", "text"], ["first_name", "text"], ["last_name", "text"], ["password_hash", "text"], ["phone", "text"], ["status", "user_status"]],
  users.map((user) => [user.id, roleIds[user.role], user.clientId, user.email, user.role, `Carga ${user.id}`, passwordHash, `+58${phone + 1000 + user.id}`, "active"]));

// Proyectos: activos, pendientes, finalizados, archivados y cancelados; con responsables variados.
const architects = users.filter((user) => user.role === "architect");
const admins = users.filter((user) => user.role === "admin");
const projects = [];
const assignees = [];
for (const clientRow of clients) {
  for (let index = 1; index <= SCALE.projectsPerClient; index += 1) {
    const roll = random();
    const status = roll < 0.6 ? "in_process" : roll < 0.75 ? "pending" : roll < 0.9 ? "finished" : roll < 0.95 ? "archived" : "cancelled";
    const architect = pick(architects);
    const project = { architectId: architect.id, clientId: clientRow.id, id: projects.length + 1, status };
    projects.push(project);
    if (random() < 0.5) {
      const extra = pick(architects);
      if (extra.id !== architect.id) assignees.push([project.id, extra.id, admins[0].id]);
    }
    assignees.push([project.id, architect.id, admins[0].id]);
  }
}
await bulkInsert(client, "projects",
  [["id", "bigint"], ["client_id", "bigint"], ["created_by", "bigint"], ["assigned_architect_id", "bigint"], ["name", "text"], ["status", "project_status"], ["archived_from_status", "project_status"], ["start_date", "date"], ["project_type", "project_type"], ["location", "text"], ["city", "text"], ["country", "text"], ["progress", "bigint"], ["is_public", "boolean"], ["public_slug", "text"]],
  projects.map((project) => [project.id, project.clientId, admins[0].id, project.architectId, `Proyecto ficticio ${project.id}`, project.status,
    project.status === "archived" ? "in_process" : null, "2026-01-01", pick(["residential", "commercial", "corporate"]), "Caracas", "Caracas", "VE",
    project.status === "finished" ? 100 : Math.floor(random() * 90), project.status === "finished" && random() < 0.5, `proyecto-ficticio-${project.id}`]));
await bulkInsert(client, "project_assignees", [["project_id", "bigint"], ["user_id", "bigint"], ["assigned_by", "bigint"]], assignees);

// Archivos y versiones: el primero de cada proyecto (PDF de 512 KB) sirve para las descargas. Solo PDF y
// PNG: files.file_type es varchar(50) y no admite el tipo MIME de DOCX/XLSX (ver informe de la Fase 3).
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "arca-loadtest-files";
const files = [];
const versions = [];
const now = new Date();
for (const project of projects) {
  for (let index = 0; index < SCALE.filesPerProject; index += 1) {
    const extension = index === 0 ? "pdf" : pick(["png", "pdf", "png"]);
    const type = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", png: "image/png" }[extension];
    const id = files.length + 1;
    const uploader = random() < 0.5 ? project.architectId : users.find((user) => user.clientId === project.clientId).id;
    const name = `archivo-${id}.${extension}`;
    const key = ["projects", project.id, "users", uploader, now.getUTCFullYear(), String(now.getUTCMonth() + 1).padStart(2, "0"), "files", id, "v1", name].join("/");
    const size = index === 0 ? 512 * 1024 : 4 * 1024;
    files.push({ extension, id, key, projectId: project.id, size });
    versions.push([id, uploader, 1, key, name, `s3://${bucket}/${key}`, extension, size, true]);
    files.at(-1).row = [id, project.id, uploader, `Archivo ficticio ${id}.${extension}`, type, extension === "png" ? "image" : "document", 1, "active"];
  }
}
await bulkInsert(client, "files", [["id", "bigint"], ["project_id", "bigint"], ["uploaded_by", "bigint"], ["title", "text"], ["file_type", "text"], ["file_category", "file_category"], ["current_version", "integer"], ["status", "file_status"]], files.map((file) => file.row));
await bulkInsert(client, "file_versions", [["file_id", "bigint"], ["uploaded_by", "bigint"], ["version_number", "integer"], ["file_name", "text"], ["original_name", "text"], ["file_url", "text"], ["file_extension", "text"], ["file_size", "bigint"], ["is_current", "boolean"]], versions);

// Comentarios con respuestas en los proyectos activos y pendientes.
const activeProjects = projects.filter((project) => ["in_process", "pending"].includes(project.status));
const comments = [];
for (const project of activeProjects) {
  const clientUser = users.find((user) => user.clientId === project.clientId);
  for (let index = 0; index < SCALE.commentsPerActiveProject; index += 1) {
    const createdAt = new Date(Date.UTC(2026, 0, 1) + (project.id * 1000 + index) * 60000);
    comments.push([project.id, index % 2 ? project.architectId : clientUser.id, `Observación ficticia ${index} del proyecto ${project.id}`, "general", "active", createdAt.toISOString()]);
  }
}
await bulkInsert(client, "project_comments", [["project_id", "bigint"], ["user_id", "bigint"], ["content", "text"], ["comment_type", "comment_type"], ["status", "comment_status"], ["created_at", "timestamptz"]], comments);
await client.query(`insert into public.project_comments (project_id, user_id, parent_comment_id, content, comment_type, status, created_at)
  select project_id, user_id, id, 'Respuesta ficticia', 'general', 'active', created_at + interval '5 minutes'
  from public.project_comments where id % 10 = 0`);

// Notificaciones por usuario.
const notifications = [];
for (const user of users) {
  for (let index = 0; index < SCALE.notificationsPerUser; index += 1) {
    const project = pick(projects);
    notifications.push([user.id, project.id, "Notificación ficticia", `Actividad ficticia ${index}`, "comment", "project", project.id, random() < 0.5]);
  }
}
await bulkInsert(client, "notifications", [["user_id", "bigint"], ["project_id", "bigint"], ["title", "text"], ["message", "text"], ["type", "text"], ["entity_type", "text"], ["entity_id", "bigint"], ["is_read", "boolean"]], notifications);

// Solicitudes de proyecto: un borrador y una pendiente de revisión por cliente.
const requests = [];
for (const user of users.filter((candidate) => candidate.role === "client")) {
  for (const status of ["draft", "pending_review"]) {
    requests.push([user.clientId, user.id, `Solicitud ficticia ${status} ${user.clientId}`, "residential", "Caracas", status, crypto.randomUUID()]);
  }
}
await bulkInsert(client, "project_requests", [["client_id", "bigint"], ["requested_by", "bigint"], ["project_name", "text"], ["project_type", "project_type"], ["location", "text"], ["status", "project_request_status"], ["submission_id", "uuid"]], requests);

for (const [table] of [["users"], ["clients"], ["projects"], ["files"]]) {
  await client.query(`select setval(pg_get_serial_sequence('public.${table}', 'id'), (select max(id) from public.${table}))`);
}
const units = (await client.query("select id from public.measurement_units where is_active order by id limit 5")).rows.map((row) => Number(row.id));
await client.end();

// Servicios y cotizaciones con los servicios reales (aplican versiones, unidades y totales).
process.env.NODE_ENV ||= "test";
const { serviceCreateSchema } = await import("../../src/validation/serviceCatalogSchemas.js");
const { quoteCreateSchema } = await import("../../src/validation/quoteSchemas.js");
const { createService } = await import("../../src/services/serviceCatalogService.js");
const { createQuote } = await import("../../src/services/quoteService.js");
const { pool } = await import("../../src/config/db.js");
const adminUser = { id: admins[0].id, role: { code: "admin" } };
const serviceIds = [];
for (let index = 1; index <= SCALE.services; index += 1) {
  const body = serviceCreateSchema.parse({ body: { description: "Servicio ficticio para pruebas de carga.", measurementUnitId: units[index % units.length], name: `Servicio ficticio ${index}`, referenceRate: "100.00" } }).body;
  serviceIds.push((await createService({ payload: body, user: adminUser })).id);
}
const quoteProjects = projects.filter((project) => project.status === "in_process");
for (let index = 0; index < SCALE.quotes; index += 1) {
  const project = quoteProjects[index % quoteProjects.length];
  const items = [0, 1, 2].map((offset) => ({ quantity: "2", serviceId: serviceIds[(index + offset) % serviceIds.length], unitRate: "100.00" }));
  const body = quoteCreateSchema.parse({ body: { clientId: project.clientId, items, notes: "Cotización ficticia.", projectId: project.id } }).body;
  await createQuote({ payload: body, user: adminUser });
}
await pool.end();

// Objetos en MinIO: uno por archivo, con la firma de su tipo.
if (!skipObjects) {
  const { CreateBucketCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({
    credentials: { accessKeyId: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY },
    endpoint: process.env.SUPABASE_STORAGE_S3_ENDPOINT,
    forcePathStyle: true,
    region: process.env.SUPABASE_STORAGE_S3_REGION || "us-east-1",
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((error) => {
    if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error?.name)) throw error;
  });
  const queue = [...files];
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (queue.length) {
      const file = queue.shift();
      await s3.send(new PutObjectCommand({ Body: fileBody(file.extension, file.size), Bucket: bucket, Key: file.key }));
    }
  }));
}

// Cuentas para el arnés: proyecto con acceso directo, archivo descargable y proyectos de notificaciones.
const accessible = (user) => projects.filter((project) => ["in_process", "pending"].includes(project.status) && (
  user.role === "admin"
  || (user.role === "client" && project.clientId === user.clientId)
  || (user.role === "architect" && assignees.some(([projectId, userId]) => projectId === project.id && userId === user.id))));
const accounts = users.map((user) => {
  const own = accessible(user);
  const project = own[0] || quoteProjects[user.id % quoteProjects.length];
  return {
    email: user.email,
    fileId: files.find((file) => file.projectId === project.id)?.id,
    notificationProjectIds: own.slice(0, 5).map((candidate) => candidate.id),
    password: PASSWORD,
    projectId: project.id,
    role: user.role,
  };
});
mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
writeFileSync(join(OUTPUT_DIRECTORY, "accounts.json"), JSON.stringify(accounts, null, 2));
console.log(JSON.stringify({
  accounts: join(OUTPUT_DIRECTORY, "accounts.json"),
  comments: comments.length,
  files: files.length,
  notifications: notifications.length,
  objects: skipObjects ? 0 : files.length,
  projectRequests: requests.length,
  projects: projects.length,
  quotes: SCALE.quotes,
  services: SCALE.services,
  type: "loadtest_seed_ready",
  users: users.length,
}));
