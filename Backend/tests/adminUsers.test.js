import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adminUserCreateSchema,
  adminUserDetailSchema,
  adminUserListSchema,
  adminUserNoteArchiveSchema,
  adminUserNoteCreateSchema,
  adminUserNoteDeleteSchema,
  adminUserNoteListSchema,
  adminUserNoteUpdateSchema,
  adminUserPhotoSchema,
  adminUserStatusSchema,
  adminUserUpdateSchema,
} from "../src/validation/adminUserSchemas.js";
import { encodeCursor } from "../src/utils/pagination.js";
import { mapAdminUser, mapAdminUserDetails, mapAdminUserMetrics, mapAdminUserNote } from "../src/utils/adminUsers.js";

test("admin user filters validate cursor, role and database statuses", () => {
  const result = adminUserListSchema.safeParse({
    query: {
      cursor: encodeCursor(["2026-08-19T12:00:00.000Z", "42"]),
      limit: "10",
      role: "architect,admin",
      search: "Ana",
      status: "blocked,inactive",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.query.limit, 10);
  assert.equal(adminUserListSchema.safeParse({ query: { limit: "11" } }).success, false);
  assert.deepEqual(result.data.query.role, ["architect", "admin"]);
  assert.deepEqual(result.data.query.status, ["blocked", "inactive"]);
  assert.equal(adminUserListSchema.safeParse({ query: { status: "deleted" } }).success, false);
  assert.equal(adminUserListSchema.safeParse({ query: { status: "active,blocked,inactive,active" } }).success, true);
});

test("admin users expose the public management fields and normalized metrics", () => {
  assert.deepEqual(mapAdminUser({
    id: "12",
    first_name: "Ana",
    last_name: "Pérez",
    email: "ana@example.com",
    role_code: "architect",
    role_name: "Arquitecto",
    status: "active",
    has_profile_photo: true,
    last_login_at: null,
    created_at: "2026-08-19T12:00:00.000Z",
  }), {
    id: 12,
    name: "Ana Pérez",
    email: "ana@example.com",
    role: { code: "architect", name: "Arquitecto" },
    status: "active",
    hasProfilePhoto: true,
    lastLoginAt: null,
    createdAt: "2026-08-19T12:00:00.000Z",
  });
  assert.deepEqual(mapAdminUserMetrics({ total: "20", active: "10", suspended: "5", disabled: "3", pending: "2" }), {
    total: 20,
    active: 10,
    suspended: 5,
    disabled: 3,
    pending: 2,
  });
});

test("admin user creation validates identity, roles, status and optional phones", () => {
  const result = adminUserCreateSchema.safeParse({
    body: {
      fullName: "Ana Pérez",
      companyName: "ARCA Studio",
      email: "ANA@EXAMPLE.COM",
      roleCode: "architect",
      phone: "+58 414-123-4567",
      secondaryPhone: "+1 (305) 555-0142",
      status: "active",
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.fullName, { firstName: "Ana", lastName: "Pérez" });
  assert.equal(result.data.body.email, "ana@example.com");
  assert.equal(result.data.body.phone, "+584141234567");
  assert.equal(result.data.body.secondaryPhone, "+13055550142");
  assert.equal(adminUserCreateSchema.safeParse({ body: { ...result.data.body, fullName: "Ana" } }).success, false);
  assert.equal(adminUserCreateSchema.safeParse({ body: { ...result.data.body, status: "deleted" } }).success, false);
});

test("admin user editing validates the identifier and the shared account fields", () => {
  const result = adminUserUpdateSchema.safeParse({
    params: { userId: "42" },
    body: {
      fullName: "Armando Carroz",
      companyName: "ARCA Studio",
      email: "ARMANDO@ARCASTUDIO.COM",
      roleCode: "architect",
      phone: "+1 (444) 1234-5678",
      secondaryPhone: "+58 412-123-4567",
      status: "active",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.params.userId, 42);
  assert.deepEqual(result.data.body.fullName, { firstName: "Armando", lastName: "Carroz" });
  assert.equal(result.data.body.email, "armando@arcastudio.com");
  assert.equal(adminUserUpdateSchema.safeParse({ params: { userId: "0" }, body: result.data.body }).success, false);
});

test("admin user editing accepts an optional password that follows the shared security policy", () => {
  const body = {
    fullName: "Armando Carroz",
    companyName: "ARCA Studio",
    email: "armando@arcastudio.com",
    roleCode: "architect",
    status: "active",
  };

  assert.equal(adminUserUpdateSchema.safeParse({ params: { userId: "42" }, body }).success, true);
  assert.equal(adminUserUpdateSchema.safeParse({ params: { userId: "42" }, body: { ...body, password: "Nueva2026*" } }).success, true);
  assert.equal(adminUserUpdateSchema.safeParse({ params: { userId: "42" }, body: { ...body, password: "nueva2026*" } }).success, false);
  assert.equal(adminUserUpdateSchema.safeParse({ params: { userId: "42" }, body: { ...body, password: "NuevaClave*" } }).success, false);
  assert.equal(adminUserUpdateSchema.safeParse({ params: { userId: "42" }, body: { ...body, password: "Nueva2026" } }).success, false);
});

test("admin user password changes are hashed and persisted without exposing plaintext", () => {
  const service = readFileSync(new URL("../src/services/adminUserService.js", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/repositories/adminUserRepository.js", import.meta.url), "utf8");

  assert.match(service, /payload\.password[\s\S]*bcrypt\.hash\(payload\.password, 10\)/);
  assert.match(repository, /password_hash = coalesce\(\$11, u\.password_hash\)/);
  assert.doesNotMatch(repository, /password\s*=\s*\$11/);
});

test("admin user creation persists during staging without requiring activation email", () => {
  const service = readFileSync(new URL("../src/services/adminUserService.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../src/controllers/adminUserController.js", import.meta.url), "utf8");

  assert.match(service, /Staging temporal:[\s\S]*creación debe persistir/);
  assert.doesNotMatch(service, /sendPasswordResetEmail|createPasswordResetToken|deleteCreatedAdminUser/);
  assert.match(controller, /message: "Usuario creado correctamente\."/);
  assert.doesNotMatch(controller, /Enviamos un enlace/);
});

test("admin user status changes accept suspend, disable and enable actions", () => {
  const suspended = adminUserStatusSchema.safeParse({
    params: { userId: "42" },
    body: { status: "blocked" },
  });

  assert.equal(suspended.success, true);
  assert.equal(suspended.data.params.userId, 42);
  assert.equal(adminUserStatusSchema.safeParse({ params: { userId: "0" }, body: { status: "inactive" } }).success, false);
  assert.equal(adminUserStatusSchema.safeParse({ params: { userId: "42" }, body: { status: "active" } }).success, true);
  assert.equal(adminUserStatusSchema.safeParse({ params: { userId: "42" }, body: { status: "deleted" } }).success, false);
});

test("admin user profile photos require a positive user identifier", () => {
  assert.equal(adminUserPhotoSchema.safeParse({ params: { userId: "42" } }).success, true);
  assert.equal(adminUserPhotoSchema.safeParse({ params: { userId: "0" } }).success, false);
});

test("admin user details validate identifiers and expose real related data", () => {
  assert.equal(adminUserDetailSchema.safeParse({ params: { userId: "42" } }).success, true);
  assert.equal(adminUserDetailSchema.safeParse({ params: { userId: "0" } }).success, false);

  assert.deepEqual(mapAdminUserDetails({
    id: "42",
    first_name: "Esteban",
    last_name: "Ruiz",
    email: "esteban@example.com",
    role_code: "client",
    role_name: "Cliente",
    status: "active",
    created_at: "2026-03-22T12:00:00.000Z",
    company_name: "Nextj",
    phone: "+14441234567",
    secondary_phone: null,
    notes: [{ id: "7", content: "Cliente referido.", created_at: "2026-08-30T12:00:00.000Z", updated_at: "2026-08-30T12:00:00.000Z" }],
    notes_total: "1",
    projects: [{ id: "9", name: "Torre Empresarial Nextj" }],
  }), {
    id: 42,
    name: "Esteban Ruiz",
    email: "esteban@example.com",
    role: { code: "client", name: "Cliente" },
    status: "active",
    hasProfilePhoto: false,
    lastLoginAt: null,
    createdAt: "2026-03-22T12:00:00.000Z",
    companyName: "Nextj",
    phone: "+14441234567",
    secondaryPhone: null,
    notes: [{ id: 7, content: "Cliente referido.", createdAt: "2026-08-30T12:00:00.000Z", updatedAt: "2026-08-30T12:00:00.000Z" }],
    notesTotal: 1,
    projects: [{ id: 9, name: "Torre Empresarial Nextj" }],
  });
});

test("admin user notes validate private, bounded and paginated content", () => {
  assert.equal(adminUserNoteCreateSchema.safeParse({ params: { userId: "42" }, body: { content: " Seguimiento privado " } }).success, true);
  assert.equal(adminUserNoteCreateSchema.safeParse({ params: { userId: "42" }, body: { content: " " } }).success, false);
  assert.equal(adminUserNoteCreateSchema.safeParse({ params: { userId: "42" }, body: { content: "x".repeat(1001) } }).success, false);
  assert.equal(adminUserNoteUpdateSchema.safeParse({ params: { userId: "42", noteId: "7" }, body: { content: "Actualizada" } }).success, true);
  assert.equal(adminUserNoteArchiveSchema.safeParse({ params: { userId: "42", noteId: "7" } }).success, true);
  assert.equal(adminUserNoteArchiveSchema.safeParse({ params: { userId: "42", noteId: "0" } }).success, false);
  assert.equal(adminUserNoteDeleteSchema.safeParse({ params: { userId: "42", noteId: "7" } }).success, true);
  assert.equal(adminUserNoteDeleteSchema.safeParse({ params: { userId: "42", noteId: "0" } }).success, false);
  assert.equal(adminUserNoteListSchema.safeParse({ params: { userId: "42" }, query: { limit: "25" } }).success, true);
  assert.equal(adminUserNoteListSchema.safeParse({ params: { userId: "42" }, query: { limit: "26" } }).success, false);
  assert.deepEqual(mapAdminUserNote({ id: "7", content: "Nota", created_at: "2026-08-30T12:00:00.000Z", updated_at: "2026-08-31T12:00:00.000Z" }), {
    id: 7,
    content: "Nota",
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-31T12:00:00.000Z",
  });
});

test("admin user note queries are scoped to the authenticated administrator", () => {
  const repository = readFileSync(new URL("../src/repositories/adminUserRepository.js", import.meta.url), "utf8");
  assert.match(repository, /where admin_user_id = \$1\s+and target_user_id = \$2/);
  assert.match(repository, /where id = \$3 and admin_user_id = \$1 and target_user_id = \$2/);
  assert.match(repository, /update public\.admin_user_notes\s+set archived_at = now\(\), updated_at = now\(\)[\s\S]*where id = \$3 and admin_user_id = \$1 and target_user_id = \$2/);
  assert.doesNotMatch(repository, /delete from public\.admin_user_notes/);
  assert.match(repository, /and archived_at is null/);
  assert.match(repository, /where admin_user_id = \$2 and target_user_id = u\.id/);
  assert.match(repository, /private_note[\s\S]*limit 2/);
});

test("admin user notes use recoverable archival and keep the legacy endpoint non-destructive", () => {
  const [schema, migration, routes, controller] = [
    readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFileSync(new URL("../prisma/migrations/20260902120000_archive_admin_user_notes/migration.sql", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/admin.js", import.meta.url), "utf8"),
    readFileSync(new URL("../src/controllers/adminUserController.js", import.meta.url), "utf8"),
  ];

  assert.match(schema, /model admin_user_notes \{[\s\S]*archived_at\s+DateTime\?/);
  assert.match(migration, /ADD COLUMN archived_at TIMESTAMPTZ\(6\)/);
  assert.match(migration, /WHERE archived_at IS NULL/);
  assert.match(routes, /"\/users\/:userId\/notes\/:noteId\/archive"[\s\S]*archiveAdminUserNoteById/);
  assert.match(routes, /router\.delete[\s\S]*archiveAdminUserNoteByLegacyDelete/);
  assert.match(controller, /antiguo DELETE conserva su contrato, pero nunca elimina datos/);
});
