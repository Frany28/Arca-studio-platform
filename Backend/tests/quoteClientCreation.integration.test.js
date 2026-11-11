import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";
import { listMigrations } from "./helpers/migrationSchema.js";

// Clientes y cuentas pendientes creados desde cotizaciones, contra PostgreSQL real. Opcional y
// aislada como las demás pruebas de cotizaciones: ARCA_SERVICE_CATALOG_DB_TESTS=1 y
// ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost). Aplica el historial hasta antes de las
// migraciones de cuentas pendientes, registra cuentas existentes y comprueba que no cambian.
// El correo de activación nunca sale: `fetch` se sustituye por un registro en memoria.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const PENDING_MIGRATIONS = ["20261110130000_user_pending_status", "20261110131000_pending_client_accounts"];
const STRONG_PASSWORD = "Activa2026*";

let database;
let db;
let quotes;
let schemas;
let adminUsers;
let adminSchemas;
let activation;
let credentials;
let ids;
let existingUsersBefore;
const sentEmails = [];
const originalFetch = globalThis.fetch;

/**
 * Consulta la base aislada con el cliente de preparación (fuera del pool de la aplicación).
 *
 * @param {string} sql - Sentencia SQL.
 * @param {Array<unknown>} [values] - Parámetros.
 * @returns {Promise<Array<object>>} Filas.
 */
async function rows(sql, values = []) {
  return (await database.client.query(sql, values)).rows;
}

/**
 * Valida un alta con quoteCreateSchema, como la ruta HTTP, y devuelve el cuerpo transformado.
 *
 * @param {object} body - Cuerpo enviado por el editor.
 * @returns {object} Cuerpo validado.
 */
function parseCreate(body) {
  return schemas.quoteCreateSchema.parse({ body }).body;
}

/**
 * Alta con un cliente nuevo y un proyecto nuevo.
 *
 * @param {string} name - Nombre del cliente nuevo.
 * @param {object} [options] - Confirmaciones, envío y ajustes.
 * @returns {object} Cuerpo validado.
 */
function newClientBody(name, { acknowledgedClientIds, acknowledgedUserIds, notes = null, projectName = `Proyecto de ${name}`, submissionId = randomUUID() } = {}) {
  return parseCreate({
    items: [{ quantity: "1.000", serviceId: ids.service, unitRate: "10.00" }],
    newClient: { acknowledgedClientIds, acknowledgedUserIds, name },
    newProjectName: projectName,
    notes,
    submissionId,
  });
}

/**
 * Guarda una cotización como el administrador de la prueba.
 *
 * @param {object} payload - Cuerpo validado.
 * @returns {Promise<{ quote: object, replayed: boolean }>} Resultado del servicio.
 */
function createQuote(payload) {
  return quotes.createQuote({ payload, user: { id: ids.admin } });
}

/**
 * Espera un rechazo con el código indicado y lo devuelve para inspeccionarlo.
 *
 * @param {Promise<unknown>} promise - Operación que debe fallar.
 * @param {string} code - Código esperado.
 * @returns {Promise<Error>} Error recibido.
 */
async function rejectsWith(promise, code) {
  let caught;
  await assert.rejects(promise, (error) => {
    caught = error;
    return error.code === code;
  });
  return caught;
}

/**
 * Lee la cuenta y la ficha comerciales creadas para un cliente de una cotización.
 *
 * @param {number} clientId - Cliente de la cotización.
 * @returns {Promise<{ client: object, users: Array<object> }>} Ficha y cuentas vinculadas.
 */
async function accountOf(clientId) {
  const [client] = await rows("select id::int, name, email, status::text, company_name from public.clients where id = $1", [clientId]);
  const users = await rows(`select u.id::int, u.client_id::int, u.email, u.first_name, u.last_name, u.password_hash, u.status::text, r.code as role
    from public.users u join public.roles r on r.id = u.role_id where u.client_id = $1 order by u.id`, [clientId]);
  return { client, users };
}

/**
 * Cuenta fichas, cuentas y auditorías de creación con un nombre exacto.
 *
 * @param {string} name - Nombre guardado.
 * @returns {Promise<{ clients: number, users: number, audits: number }>} Recuento.
 */
async function countByName(name) {
  const [counts] = await rows(`select
      (select count(*)::int from public.clients where name = $1) as clients,
      (select count(*)::int from public.users where first_name = $1 and last_name = '') as users,
      (select count(*)::int from public.audit_logs a join public.users u on u.id = a.entity_id
        where a.action = 'user.create_pending_from_quote' and u.first_name = $1) as audits`, [name]);
  return counts;
}

/**
 * Edición administrativa validada con adminUserUpdateSchema, como la ruta HTTP.
 *
 * @param {number} userId - Cuenta editada.
 * @param {object} body - Campos del formulario.
 * @returns {Promise<object>} Usuario editado.
 */
function editUser(userId, body) {
  const payload = adminSchemas.adminUserUpdateSchema.parse({ body, params: { userId: String(userId) } }).body;
  return adminUsers.updateAdminUser({ actorUserId: ids.admin, payload, userId });
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    prefix: "arca_quote_clients",
    stopBefore: PENDING_MIGRATIONS[0],
  });
  const [adminRole] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [clientRole] = await rows("insert into public.roles (code, name) values ('client', 'Cliente') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'admin@arca.test', 'Admin', 'Clientes', '!integration-login-disabled!') returning id::int`, [adminRole.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('José Pérez', 'jose@arca.test') returning id::int");
  const [clientUser] = await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, 'jose@arca.test', 'José', 'Pérez', '!integration-login-disabled!') returning id::int`, [clientRole.id, client.id]);
  // Usuario cliente registrado sin ficha comercial: debe aparecer como coincidencia, nunca vincularse solo.
  const [orphan] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'marta@arca.test', 'Marta', 'Gómez', '!integration-login-disabled!') returning id::int`, [clientRole.id]);
  existingUsersBefore = await rows("select * from public.users order by id");

  for (const migration of PENDING_MIGRATIONS) await applyMigration(database.client, migration);
  for (const migration of (await listMigrations()).filter((name) => name > PENDING_MIGRATIONS.at(-1))) {
    await applyMigration(database.client, migration);
  }

  const [unit] = await rows("select id::int from public.measurement_units where code = 'square_meter'");
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "integration-secret-only-for-tests",
    DATABASE_POOL_MAX: "8",
    DATABASE_URL: database.databaseUrl,
    FRONTEND_URL: "https://app.arca.test",
    MAIL_FROM: "ARCA <no-reply@arca.test>",
    NODE_ENV: "test",
    RESEND_API_KEY: "integration-key-not-real",
  });
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      sentEmails.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  db = await import("../src/config/db.js");
  quotes = await import("../src/services/quoteService.js");
  schemas = await import("../src/validation/quoteSchemas.js");
  adminUsers = await import("../src/services/adminUserService.js");
  adminSchemas = await import("../src/validation/adminUserSchemas.js");
  activation = await import("../src/services/accountActivationService.js");
  credentials = await import("../src/services/credentialService.js");
  const catalog = await import("../src/services/serviceCatalogService.js");
  const service = await catalog.createService({
    payload: { changeNote: null, description: null, isActive: true, measurementUnitId: unit.id, name: "Anteproyecto", referenceRate: "10.00", sortOrder: 0 },
    user: { id: admin.id },
  });
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, public_slug, has_plans)
    values ($1, $2, 'Casa Norte', '2026-01-15', 'residential', 'Caracas', 'casa-norte-clients', true) returning id::int`, [client.id, admin.id]);
  ids = { admin: admin.id, client: client.id, clientUser: clientUser.id, orphan: orphan.id, project: project.id, service: service.id };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("migración: las cuentas existentes no cambian y las restricciones quedan validadas", { skip }, async () => {
  assert.deepEqual(await rows("select * from public.users where id = any($1::bigint[]) order by id", [existingUsersBefore.map((user) => user.id)]), existingUsersBefore);
  const constraints = await rows(`select conname, convalidated from pg_constraint
    where conname in ('chk_users_identity_unless_pending', 'chk_users_pending_without_password') order by conname`);
  assert.deepEqual(constraints.map((row) => row.convalidated), [true, true]);
  const [{ labels }] = await rows("select enum_range(null::public.user_status)::text[] as labels");
  assert.deepEqual(labels, ["active", "inactive", "blocked", "pending"]);
});

test("1 y 13. cliente existente: la cotización se guarda como antes y no crea cuentas", { skip }, async () => {
  const [{ users: before }] = await rows("select count(*)::int as users from public.users");
  const { quote } = await createQuote(parseCreate({
    clientId: ids.client,
    items: [{ quantity: "2.000", serviceId: ids.service, unitRate: "10.00" }],
    notes: null,
    projectId: ids.project,
    submissionId: randomUUID(),
  }));
  assert.deepEqual(quote.client, { id: ids.client, name: "José Pérez" });
  const [{ users: afterCount }] = await rows("select count(*)::int as users from public.users");
  assert.equal(afterCount, before);
});

test("2, 3, 4, 5 y 9. cliente nuevo solo con nombre: ficha, cuenta pendiente, draft y cotización enlazados", { skip }, async () => {
  const { quote, replayed } = await createQuote(newClientBody("Constructora Los Andes"));
  assert.equal(replayed, false);
  const { client, users } = await accountOf(quote.client.id);
  // El nombre comercial se guarda completo: no se divide en nombre y apellido ni se inventan datos.
  assert.deepEqual(client, { company_name: null, email: null, id: quote.client.id, name: "Constructora Los Andes", status: "active" });
  assert.equal(users.length, 1);
  assert.deepEqual(users[0], {
    client_id: quote.client.id, email: null, first_name: "Constructora Los Andes", id: users[0].id,
    last_name: "", password_hash: null, role: "client", status: "pending",
  });
  const [version] = await rows("select client_id::int, client_name, project_id::int from public.quote_versions where quote_id = $1", [quote.id]);
  assert.deepEqual(version, { client_id: quote.client.id, client_name: "Constructora Los Andes", project_id: quote.project.id });
  const [project] = await rows("select client_id::int, status::text from public.projects where id = $1", [quote.project.id]);
  assert.deepEqual(project, { client_id: quote.client.id, status: "draft" });
  const [audit] = await rows("select user_id::int, new_values from public.audit_logs where action = 'user.create_pending_from_quote' and entity_id = $1", [users[0].id]);
  assert.equal(audit.user_id, ids.admin);
  assert.equal(audit.new_values.clientId, quote.client.id);
  assert.equal(audit.new_values.quoteId, quote.id);
});

test("7. coincidencias normalizadas: mayúsculas, acentos, espacios, parecidas y usuarios sin ficha", { skip }, async () => {
  const exact = await quotes.getQuoteClientNameMatches({ name: "  jose   PEREZ " });
  assert.deepEqual(exact.matches.map((match) => [match.kind, match.id, match.exact]), [["client", ids.client, true]]);
  const similar = await quotes.getQuoteClientNameMatches({ name: "José Pérez Rondón" });
  assert.deepEqual(similar.matches.map((match) => [match.kind, match.id, match.exact]), [["client", ids.client, false]]);
  const orphan = await quotes.getQuoteClientNameMatches({ name: "marta gomez" });
  assert.deepEqual(orphan.matches.map((match) => [match.kind, match.id, match.exact]), [["user", ids.orphan, true]]);
  assert.deepEqual((await quotes.getQuoteClientNameMatches({ name: "Ricardo Lima" })).matches, []);
  // La búsqueda del selector también ignora acentos y mayúsculas.
  const options = await quotes.getQuoteClientOptions({ search: "PEREZ" });
  assert.ok(options.clients.some((client) => client.id === ids.client));
});

test("6. dos personas con el mismo nombre: se pide confirmación y, confirmada, se crea otra distinta", { skip }, async () => {
  const error = await rejectsWith(createQuote(newClientBody("Jose Perez")), "CLIENT_NAME_MATCHES");
  assert.equal(error.status, 409);
  assert.deepEqual(error.details.matches.map((match) => [match.kind, match.id]), [["client", ids.client]]);
  assert.deepEqual(await countByName("Jose Perez"), { audits: 0, clients: 0, users: 0 });

  const { quote } = await createQuote(newClientBody("Jose Perez", { acknowledgedClientIds: [ids.client] }));
  assert.notEqual(quote.client.id, ids.client);
  assert.deepEqual(await countByName("Jose Perez"), { audits: 1, clients: 1, users: 1 });
  // El usuario sin ficha también exige confirmación y nunca se modifica.
  await rejectsWith(createQuote(newClientBody("Marta Gómez")), "CLIENT_NAME_MATCHES");
  const { quote: marta } = await createQuote(newClientBody("Marta Gómez", { acknowledgedUserIds: [ids.orphan] }));
  assert.notEqual(marta.client.id, null);
  const [orphanAfter] = await rows("select client_id, status::text from public.users where id = $1", [ids.orphan]);
  assert.deepEqual(orphanAfter, { client_id: null, status: "active" });
});

test("12. concurrencia: el mismo envío dos veces crea una sola cuenta; dos altas del mismo nombre se ordenan", { skip }, async () => {
  const payload = newClientBody("Lucía Rivas");
  const [first, second] = await Promise.all([createQuote(payload), createQuote(payload)]);
  assert.equal(first.quote.id, second.quote.id);
  assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
  assert.deepEqual(await countByName("Lucía Rivas"), { audits: 1, clients: 1, users: 1 });

  const results = await Promise.allSettled([createQuote(newClientBody("Tomás Lara")), createQuote(newClientBody("tomas  lara"))]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "CLIENT_NAME_MATCHES");
  const [{ count }] = await rows("select count(*)::int from public.clients where public.person_name_key(name) = 'tomas lara'");
  assert.equal(count, 1);
});

test("11. fallo transaccional: si la cotización falla no quedan ficha, cuenta ni auditoría", { skip }, async () => {
  await rows(`create function public.test_fail_quote_version() returns trigger language plpgsql as $$
    begin if new.notes = 'forzar fallo' then raise exception 'fallo forzado'; end if; return new; end $$`);
  await rows("create trigger test_fail_quote_version before insert on public.quote_versions for each row execute function public.test_fail_quote_version()");
  try {
    await assert.rejects(createQuote(newClientBody("Elena Prado", { notes: "forzar fallo" })));
    assert.deepEqual(await countByName("Elena Prado"), { audits: 0, clients: 0, users: 0 });
    const [{ count }] = await rows("select count(*)::int from public.projects where name = 'Proyecto de Elena Prado'");
    assert.equal(count, 0);
  } finally {
    await rows("drop trigger test_fail_quote_version on public.quote_versions");
    await rows("drop function public.test_fail_quote_version()");
  }
});

test("10. edición: muestra el cliente creado, no crea otra cuenta y permite cambiar a un cliente existente", { skip }, async () => {
  const { quote } = await createQuote(newClientBody("Hugo Salas"));
  const update = (body) => quotes.updateQuote({
    payload: schemas.quoteUpdateSchema.parse({ body, params: { quoteId: String(quote.id) } }).body,
    quoteId: quote.id,
    user: { id: ids.admin },
  });
  const edited = await update({
    clientId: quote.client.id, expectedVersion: 1, items: [{ quantity: "3.000", serviceId: ids.service, unitRate: "10.00" }],
    notes: "Ajuste", projectId: quote.project.id,
  });
  assert.equal(edited.quote.client.id, quote.client.id);
  assert.deepEqual(await countByName("Hugo Salas"), { audits: 1, clients: 1, users: 1 });
  const moved = await update({
    clientId: ids.client, expectedVersion: 2, items: [{ quantity: "3.000", serviceId: ids.service, unitRate: "10.00" }],
    notes: "Ajuste", projectId: ids.project,
  });
  assert.deepEqual(moved.quote.client, { id: ids.client, name: "José Pérez" });
  assert.deepEqual(await countByName("Hugo Salas"), { audits: 1, clients: 1, users: 1 });
  // El esquema de edición no admite crear clientes.
  const validEdit = { clientId: ids.client, expectedVersion: 3, items: [{ quantity: "1.000", serviceId: ids.service, unitRate: "10.00" }], projectId: ids.project };
  assert.equal(schemas.quoteUpdateSchema.safeParse({ body: validEdit, params: { quoteId: "1" } }).success, true);
  assert.equal(schemas.quoteUpdateSchema.safeParse({ body: { ...validEdit, newClient: { name: "Otro" } }, params: { quoteId: "1" } }).success, false);
});

test("8. cuenta pendiente: sin acceso, sin recuperación y sin cambios de estado manuales", { skip }, async () => {
  const { quote } = await createQuote(newClientBody("Paula Ortiz"));
  const [{ id: userId }] = (await accountOf(quote.client.id)).users;
  await editUser(userId, { email: "paula@arca.test", fullName: "Paula Ortiz", roleCode: "client", status: "pending" });
  // Con el correo completado sigue sin contraseña: el inicio de sesión falla como credencial inválida.
  assert.equal((await credentials.verifyUserCredentials({ email: "paula@arca.test", password: STRONG_PASSWORD })).status, "invalid");
  const userRepository = await import("../src/repositories/userRepository.js");
  assert.equal(await userRepository.findActiveUserById(userId), null);
  await rejectsWith(adminUsers.updateAdminUserStatus({ actorUserId: ids.admin, status: "active", userId }), "PENDING_ACCOUNT_STATUS_LOCKED");
  await rejectsWith(editUser(userId, { email: "paula@arca.test", fullName: "Paula Ortiz", roleCode: "client", status: "active" }), "PENDING_ACCOUNT_STATUS_LOCKED");
  await rejectsWith(editUser(userId, { email: "paula@arca.test", fullName: "Paula Ortiz", roleCode: "admin", status: "pending" }), "PENDING_ACCOUNT_ROLE_LOCKED");
  await rejectsWith(
    editUser(userId, { email: "paula@arca.test", fullName: "Paula Ortiz", password: STRONG_PASSWORD, roleCode: "client", status: "pending" }),
    "PENDING_ACCOUNT_PASSWORD_LOCKED",
  );
  const [stored] = await rows("select status::text, password_hash, role_id = (select id from public.roles where code = 'client') as is_client from public.users where id = $1", [userId]);
  assert.deepEqual(stored, { is_client: true, password_hash: null, status: "pending" });
  // La ficha comercial sigue activa (se puede seguir cotizando) y con el correo completado.
  assert.deepEqual((await accountOf(quote.client.id)).client.status, "active");
});

test("13. cuentas activas: siguen exigiendo correo, apellido y no pueden pasar a pendientes", { skip }, async () => {
  await rejectsWith(editUser(ids.clientUser, { email: "", fullName: "José Pérez", roleCode: "client", status: "active" }), "VALIDATION_ERROR");
  await rejectsWith(editUser(ids.clientUser, { email: "jose@arca.test", fullName: "José", roleCode: "client", status: "active" }), "VALIDATION_ERROR");
  await rejectsWith(editUser(ids.clientUser, { email: "jose@arca.test", fullName: "José Pérez", roleCode: "client", status: "pending" }), "PENDING_ACCOUNT_STATUS_LOCKED");
  assert.equal(adminSchemas.adminUserStatusSchema.safeParse({ body: { status: "pending" }, params: { userId: "1" } }).success, false);
  assert.equal(adminSchemas.adminUserCreateSchema.safeParse({ body: { email: "n@arca.test", fullName: "Nuevo Usuario", roleCode: "client", status: "pending" } }).success, false);
  const [jose] = await rows("select email, status::text from public.users where id = $1", [ids.clientUser]);
  assert.deepEqual(jose, { email: "jose@arca.test", status: "active" });
});

test("14. activación posterior: enlace al correo, contraseña propia, un solo uso y acceso", { skip }, async () => {
  const { quote } = await createQuote(newClientBody("Andrés Mena"));
  const [{ id: userId }] = (await accountOf(quote.client.id)).users;
  await rejectsWith(activation.sendAccountActivationLink({ actorUserId: ids.admin, userId }), "ACCOUNT_EMAIL_REQUIRED");
  await editUser(userId, { email: "andres@arca.test", fullName: "Andrés Mena", roleCode: "client", status: "pending" });

  sentEmails.length = 0;
  const sent = await activation.sendAccountActivationLink({ actorUserId: ids.admin, userId });
  assert.equal(sent.email, "andres@arca.test");
  assert.equal(sentEmails.length, 1);
  assert.deepEqual(sentEmails[0].to, ["andres@arca.test"]);
  const token = new URL(sentEmails[0].text.match(/https:\/\/app\.arca\.test\/activar-cuenta\?token=\S+/)[0]).searchParams.get("token");
  assert.equal(await activation.isActivationTokenValid(token), true);

  // Un enlace de activación no sirve como enlace de recuperación ni de sesión.
  const tokens = await import("../src/utils/tokens.js");
  assert.equal(tokens.isSessionTokenPayload(tokens.verifyAuthToken(token, { secret: process.env.AUTH_TOKEN_SECRET })), false);

  assert.equal(await activation.activateAccount({ password: STRONG_PASSWORD, token }), true);
  const [account] = await rows("select status::text, password_hash is not null as has_password from public.users where id = $1", [userId]);
  assert.deepEqual(account, { has_password: true, status: "active" });
  assert.equal((await credentials.verifyUserCredentials({ email: "andres@arca.test", password: STRONG_PASSWORD })).status, "valid");
  assert.equal(await activation.activateAccount({ password: "Otra2026*", token }), false, "el enlace es de un solo uso");
  assert.equal(await activation.isActivationTokenValid(token), false);
  await rejectsWith(activation.sendAccountActivationLink({ actorUserId: ids.admin, userId }), "ACCOUNT_NOT_PENDING");
  const audits = await rows("select action from public.audit_logs where entity_id = $1 and entity_type = 'user' order by id", [userId]);
  assert.deepEqual(audits.map((row) => row.action), ["user.create_pending_from_quote", "user.activation_link_sent", "user.activate"]);
});

test("HTTP: coincidencias, 409 con detalles, alta confirmada, login bloqueado y activación por la API", { skip }, async () => {
  const { default: app } = await import("../src/app.js");
  const { issueUserSession } = await import("../src/services/sessionService.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const session = await issueUserSession(ids.admin);
    const admin = { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
    const post = (path, body, headers = admin) => fetch(`${base}${path}`, { body: JSON.stringify(body), headers, method: "POST" });

    const matches = await fetch(`${base}/admin/quotes/clients/matches?name=${encodeURIComponent("JOSÉ  pérez")}`, { headers: admin });
    assert.equal(matches.status, 200);
    assert.ok((await matches.json()).matches.some((match) => match.kind === "client" && match.id === ids.client && match.exact));

    const body = {
      items: [{ quantity: "1.000", serviceId: ids.service, unitRate: "10.00" }],
      newClient: { name: "José Pérez" },
      newProjectName: "Casa HTTP",
      submissionId: randomUUID(),
    };
    const conflict = await post("/admin/quotes", body);
    assert.equal(conflict.status, 409);
    const conflictBody = await conflict.json();
    assert.equal(conflictBody.code, "CLIENT_NAME_MATCHES");
    const acknowledgedClientIds = conflictBody.details.matches.filter((match) => match.kind === "client").map((match) => match.id);
    assert.ok(acknowledgedClientIds.includes(ids.client));

    const created = await post("/admin/quotes", { ...body, newClient: { acknowledgedClientIds, name: "José Pérez" } });
    assert.equal(created.status, 201);
    const { quote } = await created.json();
    const [{ id: userId }] = (await accountOf(quote.client.id)).users;

    // Sin correo ni contraseña la cuenta no puede iniciar sesión ni pedir recuperación por la API.
    await editUser(userId, { email: "jose.http@arca.test", fullName: "José Pérez", roleCode: "client", status: "pending" });
    const login = await post("/auth/login", { email: "jose.http@arca.test", password: STRONG_PASSWORD }, { "Content-Type": "application/json" });
    assert.equal(login.status, 401);
    sentEmails.length = 0;
    const forgot = await post("/auth/forgot-password", { email: "jose.http@arca.test" }, { "Content-Type": "application/json" });
    assert.equal(forgot.status, 202);
    assert.equal(sentEmails.length, 0, "una cuenta pendiente no recibe enlaces de recuperación");

    const link = await post(`/admin/users/${userId}/activation-link`, {});
    assert.equal(link.status, 202);
    const token = new URL(sentEmails[0].text.match(/https:\/\/app\.arca\.test\/activar-cuenta\?token=\S+/)[0]).searchParams.get("token");
    const json = { "Content-Type": "application/json" };
    assert.equal((await post("/auth/activation/verify", { token }, json)).status, 200);
    // Un enlace de activación no sirve para restablecer contraseña.
    assert.equal((await post("/auth/reset-password", { password: STRONG_PASSWORD, token }, json)).status, 400);
    const weak = await post("/auth/activation/complete", { password: "debil", token }, json);
    assert.equal(weak.status, 400);
    assert.equal((await weak.json()).code, "VALIDATION_ERROR");
    assert.equal((await post("/auth/activation/complete", { password: STRONG_PASSWORD, token }, json)).status, 200);
    const reused = await post("/auth/activation/complete", { password: STRONG_PASSWORD, token }, json);
    assert.equal(reused.status, 400);
    assert.equal((await reused.json()).code, "INVALID_ACTIVATION_TOKEN");
    assert.equal((await post("/auth/login", { email: "jose.http@arca.test", password: STRONG_PASSWORD }, json)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("14. activación: cambiar el correo invalida el enlace enviado al anterior", { skip }, async () => {
  const { quote } = await createQuote(newClientBody("Sara Vidal"));
  const [{ id: userId }] = (await accountOf(quote.client.id)).users;
  await editUser(userId, { email: "sara@arca.test", fullName: "Sara Vidal", roleCode: "client", status: "pending" });
  sentEmails.length = 0;
  await activation.sendAccountActivationLink({ actorUserId: ids.admin, userId });
  const token = new URL(sentEmails[0].text.match(/https:\/\/app\.arca\.test\/activar-cuenta\?token=\S+/)[0]).searchParams.get("token");
  // Editar solo el teléfono conserva el enlace; cambiar el correo lo invalida.
  await editUser(userId, { email: "sara@arca.test", fullName: "Sara Vidal", phone: "+584121234567", roleCode: "client", status: "pending" });
  assert.equal(await activation.isActivationTokenValid(token), true);
  await editUser(userId, { email: "sara.vidal@arca.test", fullName: "Sara Vidal", roleCode: "client", status: "pending" });
  assert.equal(await activation.isActivationTokenValid(token), false);
  assert.equal(await activation.activateAccount({ password: STRONG_PASSWORD, token }), false);
  const [account] = await rows("select status::text, password_hash from public.users where id = $1", [userId]);
  assert.deepEqual(account, { password_hash: null, status: "pending" });
});
