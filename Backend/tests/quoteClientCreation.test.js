import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.AUTH_TOKEN_SECRET = "test-secret-with-sufficient-entropy";

const { clientNameKey, describeClientNameError, normalizeClientName } = await import("../src/domain/clientName.js");
const { buildQuoteSubmissionContent } = await import("../src/domain/quote.js");
const { quoteCreateSchema, quoteClientMatchesSchema, quoteUpdateSchema } = await import("../src/validation/quoteSchemas.js");
const { adminUserCreateSchema, adminUserListSchema, adminUserStatusSchema, adminUserUpdateSchema } = await import("../src/validation/adminUserSchemas.js");
const { resolveAdminEditRevocationReason } = await import("../src/repositories/adminUserRepository.js");
const { SESSION_REVOCATION_REASONS } = await import("../src/repositories/sessionRepository.js");
const { ACCOUNT_ACTIVATION_PURPOSE, parseActivationToken } = await import("../src/services/accountActivationService.js");
const { createPasswordResetPayload } = await import("../src/services/passwordResetEmailService.js");
const { createAuthToken } = await import("../src/utils/tokens.js");
const { activateAccountSchema } = await import("../src/validation/schemas.js");

const ITEMS = [{ quantity: "1.000", serviceId: 3, unitRate: "10.00" }];
const SUBMISSION = "6f1d2c3b-4a59-4e7d-8c1b-2a3f4e5d6c7b";

/**
 * Valida un cuerpo de alta y devuelve el resultado de Zod.
 *
 * @param {object} body - Cuerpo enviado.
 * @returns {import("zod").ZodSafeParseResult<object>} Resultado.
 */
function parseCreate(body) {
  return quoteCreateSchema.safeParse({ body });
}

/**
 * Rutas de los errores de un resultado inválido.
 *
 * @param {import("zod").ZodSafeParseResult<object>} result - Resultado de Zod.
 * @returns {Array<string>} Rutas con puntos.
 */
function issuePaths(result) {
  return result.error.issues.map((issue) => issue.path.join(".").replace(/^body./, ""));
}

test("nombre de cliente: conserva el texto, normaliza espacios y compara sin acentos ni mayúsculas", () => {
  assert.equal(normalizeClientName("  Constructora   Los Ándes "), "Constructora Los Ándes");
  assert.equal(clientNameKey("  JOSÉ   Pérez "), "jose perez");
  assert.equal(clientNameKey("Peña"), "pena");
  assert.equal(describeClientNameError("Pepsi"), null, "una sola palabra (empresa) es válida");
  assert.match(describeClientNameError(" a "), /al menos 2/);
  assert.match(describeClientNameError("x".repeat(151)), /como máximo 150/);
  assert.match(describeClientNameError("-- ··"), /letras o números/);
});

test("alta: exactamente un cliente (existente o nuevo); el nuevo exige proyecto nuevo y submissionId", () => {
  const base = { items: ITEMS, newProjectName: "Casa del Lago", submissionId: SUBMISSION };
  const created = parseCreate({ ...base, newClient: { name: "  Constructora   Los Andes " } });
  assert.equal(created.success, true);
  assert.deepEqual(created.data.body.newClient, { acknowledgedClientIds: [], acknowledgedUserIds: [], name: "Constructora Los Andes" });

  assert.deepEqual(issuePaths(parseCreate({ ...base, clientId: 4, newClient: { name: "Ana Ruiz" } })), ["newClient.name"]);
  assert.deepEqual(issuePaths(parseCreate(base)), ["clientId"]);
  assert.deepEqual(issuePaths(parseCreate({ items: ITEMS, newClient: { name: "Ana Ruiz" }, projectId: 9, submissionId: SUBMISSION })), ["projectId"]);
  assert.deepEqual(issuePaths(parseCreate({ items: ITEMS, newClient: { name: "Ana Ruiz" }, newProjectName: "Casa" })), ["submissionId", "submissionId"]);
  assert.equal(parseCreate({ ...base, newClient: { name: "Ana Ruiz", role: "admin" } }).success, false, "newClient es estricto");
  // El alta con un cliente existente no cambia.
  assert.equal(parseCreate({ clientId: 4, items: ITEMS, projectId: 9 }).success, true);
});

test("alta: las coincidencias confirmadas se deduplican y están acotadas", () => {
  const result = parseCreate({
    items: ITEMS,
    newClient: { acknowledgedClientIds: [4, 4, 7], acknowledgedUserIds: [9], name: "Ana Ruiz" },
    newProjectName: "Casa",
    submissionId: SUBMISSION,
  });
  assert.deepEqual(result.data.body.newClient.acknowledgedClientIds, [4, 7]);
  assert.equal(parseCreate({
    items: ITEMS,
    newClient: { acknowledgedClientIds: Array.from({ length: 51 }, (_, index) => index + 1), name: "Ana Ruiz" },
    newProjectName: "Casa",
    submissionId: SUBMISSION,
  }).success, false);
});

test("edición: no admite clientes nuevos y sigue exigiendo clientId", () => {
  const body = { clientId: 4, expectedVersion: 1, items: ITEMS, projectId: 9 };
  assert.equal(quoteUpdateSchema.safeParse({ body, params: { quoteId: "1" } }).success, true);
  assert.equal(quoteUpdateSchema.safeParse({ body: { ...body, newClient: { name: "Ana" } }, params: { quoteId: "1" } }).success, false);
  assert.equal(quoteUpdateSchema.safeParse({ body: { ...body, clientId: undefined }, params: { quoteId: "1" } }).success, false);
});

test("coincidencias: el nombre buscado se normaliza y se acota", () => {
  assert.equal(quoteClientMatchesSchema.parse({ query: { name: "  José   Pérez " } }).query.name, "José Pérez");
  assert.equal(quoteClientMatchesSchema.safeParse({ query: { name: " a " } }).success, false);
  assert.equal(quoteClientMatchesSchema.safeParse({ query: {} }).success, false);
});

test("huella del envío: igual que antes con cliente existente y distinta con un cliente nuevo", () => {
  const existing = { clientId: 4, items: ITEMS, notes: null, projectId: 9 };
  const [clientPart, ...rest] = JSON.parse(buildQuoteSubmissionContent(existing));
  assert.equal(clientPart, 4, "con cliente existente el primer elemento sigue siendo su id numérico");
  const fresh = buildQuoteSubmissionContent({
    items: ITEMS, newClient: { acknowledgedClientIds: [4], name: "Ana Ruiz" }, newProjectName: "Casa", notes: null,
  });
  const [freshClient, freshProject, ...freshRest] = JSON.parse(fresh);
  assert.deepEqual(freshClient, ["newClient", "Ana Ruiz"]);
  assert.deepEqual(freshProject, ["newProject", "Casa"]);
  assert.deepEqual(freshRest, rest.slice(1), "observaciones y conceptos se comparan igual");
  // Confirmar coincidencias en un reintento no cambia la operación.
  assert.equal(buildQuoteSubmissionContent({ items: ITEMS, newClient: { name: "Ana Ruiz" }, newProjectName: "Casa", notes: null }), fresh);
});

test("usuarios: el alta y el cambio de estado no admiten pending; la edición lo conserva con correo opcional", () => {
  const user = { email: "ana@arca.test", fullName: "Ana Ruiz", roleCode: "client", status: "pending" };
  assert.equal(adminUserCreateSchema.safeParse({ body: user }).success, false);
  assert.equal(adminUserStatusSchema.safeParse({ body: { status: "pending" }, params: { userId: "4" } }).success, false);
  const edit = adminUserUpdateSchema.parse({ body: { ...user, email: "", fullName: "Constructora" }, params: { userId: "4" } }).body;
  assert.equal(edit.email, null);
  assert.deepEqual(edit.fullName, { firstName: "Constructora", lastName: "" });
  assert.deepEqual(adminUserListSchema.parse({ query: { status: "pending,active" } }).query.status, ["pending", "active"]);
  // El alta sigue exigiendo nombre y apellido y un correo.
  assert.equal(adminUserCreateSchema.safeParse({ body: { ...user, fullName: "Ana", status: "active" } }).success, false);
  assert.equal(adminUserCreateSchema.safeParse({ body: { ...user, email: "", status: "active" } }).success, false);
});

test("revocación: en una cuenta pendiente solo el cambio de correo invalida el enlace", () => {
  const current = { email: null, role_id: 3, status: "pending" };
  assert.equal(resolveAdminEditRevocationReason({ current, email: null, passwordHash: null, roleId: 3, status: "pending" }), null);
  assert.equal(
    resolveAdminEditRevocationReason({ current, email: "ana@arca.test", passwordHash: null, roleId: 3, status: "pending" }),
    SESSION_REVOCATION_REASONS.securityProfileChanged,
  );
  assert.equal(
    resolveAdminEditRevocationReason({ current: { ...current, email: "ana@arca.test" }, email: "ANA@arca.test", passwordHash: null, roleId: 3, status: "pending" }),
    null,
  );
  // Las cuentas activas conservan su regla actual.
  assert.equal(
    resolveAdminEditRevocationReason({ current: { email: "a@arca.test", role_id: 3, status: "active" }, email: "a@arca.test", passwordHash: null, roleId: 3, status: "inactive" }),
    SESSION_REVOCATION_REASONS.userDisabled,
  );
});

test("activación: solo acepta su propio propósito y una contraseña fuerte de hasta 72 caracteres", () => {
  const secret = process.env.AUTH_TOKEN_SECRET;
  const activationToken = createAuthToken({ email: "ana@arca.test", purpose: ACCOUNT_ACTIVATION_PURPOSE, sub: "4" }, { expiresInSeconds: 60, secret });
  assert.deepEqual(Object.keys(parseActivationToken(activationToken)).sort(), ["email", "tokenHash", "userId"]);
  const resetToken = new URL(createPasswordResetPayload({ email: "ana@arca.test", id: 4 }).resetUrl).searchParams.get("token");
  assert.equal(parseActivationToken(resetToken), null);
  assert.equal(parseActivationToken(createAuthToken({ sid: "x", sub: "4" }, { expiresInSeconds: 60, secret })), null);
  assert.equal(parseActivationToken(createAuthToken({ purpose: ACCOUNT_ACTIVATION_PURPOSE, sub: "4" }, { expiresInSeconds: 60, secret })), null, "exige el correo");
  assert.equal(parseActivationToken(`${activationToken}x`), null);

  assert.equal(activateAccountSchema.safeParse({ body: { password: "Activa2026*", token: activationToken } }).success, true);
  for (const password of ["corta1*", "sinmayuscula1*", "SinNumero*", "SinEspecial1", `A1*${"x".repeat(70)}`]) {
    assert.equal(activateAccountSchema.safeParse({ body: { password, token: activationToken } }).success, false, password);
  }
});

test("migraciones: restricciones validadas, función inmutable solo ASCII e índice de nombres no único", () => {
  const enumMigration = readFileSync(new URL("../prisma/migrations/20261110130000_user_pending_status/migration.sql", import.meta.url), "utf8");
  assert.match(enumMigration, /ALTER TYPE public\.user_status ADD VALUE IF NOT EXISTS 'pending';/);
  const migration = readFileSync(new URL("../prisma/migrations/20261110131000_pending_client_accounts/migration.sql", import.meta.url), "utf8");
  const code = migration.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /[^\x00-\x7F]/, "el SQL ejecutable no depende de la codificación del cliente psql");
  for (const constraint of ["chk_users_identity_unless_pending", "chk_users_pending_without_password"]) {
    assert.match(code, new RegExp(`ADD CONSTRAINT ${constraint} CHECK[\\s\\S]*?NOT VALID`));
    assert.match(code, new RegExp(`VALIDATE CONSTRAINT ${constraint};`));
  }
  assert.match(code, /IMMUTABLE STRICT PARALLEL SAFE/);
  assert.match(code, /CREATE INDEX idx_clients_name_key/);
  assert.doesNotMatch(code, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(code, /\b(UPDATE|DELETE|INSERT)\b/, "la migración no modifica filas");
});

test("cuenta pendiente: se inserta sin correo ni contraseña y con el nombre completo sin dividir", () => {
  const repository = readFileSync(new URL("../src/repositories/adminUserRepository.js", import.meta.url), "utf8");
  const insert = repository.slice(repository.indexOf("export async function insertPendingClientAccount"));
  assert.match(insert, /values \(\$1, \$2, null, \$3, '', null, 'pending'::public\.user_status\)/);
  assert.match(insert, /where code = 'client' and is_active = true/);
});
