import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { applyBrowserTimeouts } from "../helpers/browserTimeouts.js";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

// Cuentas pendientes (clientes creados desde una cotización) en la gestión de usuarios y página
// pública de activación, con la aplicación real y una API simulada en memoria.
const PENDING_NO_EMAIL = { createdAt: "2026-11-10T12:00:00Z", email: null, id: 201, lastLoginAt: null, name: "Constructora Los Andes", role: { code: "client", name: "Cliente" }, status: "pending" };
const PENDING_WITH_EMAIL = { ...PENDING_NO_EMAIL, email: "ana@example.test", id: 202, name: "Ana Ruiz" };
const ACTIVE = { ...PENDING_NO_EMAIL, email: "jose@example.test", id: 203, lastLoginAt: "2026-11-09T12:00:00Z", name: "José Pérez", status: "active" };
const USERS = [PENDING_NO_EMAIL, PENDING_WITH_EMAIL, ACTIVE];

let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre una ruta de la aplicación con la API simulada; registra peticiones y falla ante errores.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {string} path - Ruta inicial.
 * @param {Object} options - Escenario.
 * @param {boolean} [options.authenticated=true] - Sesión de administrador o visitante.
 * @param {Record<string, {status?: number, json: Object}>} [options.responses] - Respuestas por `MÉTODO /ruta`.
 * @param {{width: number, height: number}} [options.viewport] - Ventana.
 * @returns {Promise<{page: import("playwright").Page, requests: Array<Object>}>} Página y peticiones.
 */
async function openApp(context, path, { authenticated = true, responses = {}, viewport = { height: 900, width: 1440 } } = {}) {
  const session = await browser.newContext({ viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    requests.push({ body: request.postDataJSON?.() ?? null, key });
    if (pathname === "/api/auth/me") {
      return authenticated
        ? route.fulfill({ json: { user: { email: "admin@example.test", firstName: "Ana", id: 1, lastName: "Admin", role: "admin", status: "active" } } })
        : route.fulfill({ json: { code: "UNAUTHENTICATED", message: "Inicia sesión." }, status: 401 });
    }
    const response = responses[key];
    if (!response) {
      errors.push(`Petición no prevista: ${key}`);
      return route.fulfill({ json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" }, status: 404 });
    }
    return route.fulfill({ json: response.json, status: response.status ?? 200 });
  });
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}${path}`);
  return { page, requests };
}

const USERS_RESPONSES = {
  "GET /api/projects": { json: { nextCursor: null, projects: [] } },
  "GET /api/admin/roles": { json: { roles: [{ code: "client", id: 3, name: "Cliente" }, { code: "admin", id: 1, name: "Administrador" }] } },
  "GET /api/admin/users": { json: { metrics: { active: 1, disabled: 0, pending: 2, suspended: 0, total: 3 }, nextCursor: null, users: USERS } },
};

test("usuarios: una cuenta pendiente se identifica y no cambia de estado desde el menú ni en bloque", async (context) => {
  const { page } = await openApp(context, "/usuarios", { responses: USERS_RESPONSES });
  const row = page.locator("tr", { hasText: "Constructora Los Andes" });
  await row.getByText("Pendiente", { exact: true }).waitFor();
  await row.getByText("Sin correo", { exact: true }).waitFor();
  if (process.env.ARCA_PENDING_CAPTURE_DIR) await page.screenshot({ path: `${process.env.ARCA_PENDING_CAPTURE_DIR}/pending-users-table.png` });

  // Sin acciones de estado en el menú: una cuenta pendiente se activa desde «Editar usuario».
  assert.equal(await row.getByRole("button", { name: "Más opciones para Constructora Los Andes" }).isDisabled(), true);
  assert.equal(await page.locator("tr", { hasText: "José Pérez" }).getByRole("button", { name: "Más opciones para José Pérez" }).isEnabled(), true);
  // Las acciones masivas de estado no incluyen cuentas pendientes.
  await page.getByRole("checkbox", { name: "Seleccionar Ana Ruiz", exact: true }).click();
  const bulk = page.getByRole("group", { name: "Acciones para usuarios seleccionados" });
  for (const label of ["Suspender", "Deshabilitar", "Activar"]) {
    assert.equal(await bulk.getByRole("button", { name: label, exact: true }).isDisabled(), true, label);
  }
});

test("usuarios: editar una cuenta pendiente ofrece todos los estados y, sin contraseña, la conserva pendiente", async (context) => {
  const details = { ...PENDING_NO_EMAIL, companyName: null, notes: [], notesTotal: 0, phone: null, projects: [], secondaryPhone: null };
  const { page, requests } = await openApp(context, "/usuarios", {
    responses: {
      ...USERS_RESPONSES,
      "GET /api/admin/users/201": { json: { user: details } },
      "PATCH /api/admin/users/201": { json: { message: "Usuario actualizado.", user: { ...PENDING_NO_EMAIL, email: "andes@example.test" } } },
    },
  });
  await page.getByRole("button", { name: "Editar Constructora Los Andes" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar usuario" });
  await dialog.waitFor();
  await dialog.getByText("Pendiente de activación").first().waitFor();
  if (process.env.ARCA_PENDING_CAPTURE_DIR) {
    // La captura espera al final de la animación de entrada del Modal.
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${process.env.ARCA_PENDING_CAPTURE_DIR}/pending-user-edit.png` });
  }
  // El selector de estado incluye Pendiente y los demás estados.
  await dialog.getByText("Pendiente de activación").first().click();
  for (const label of ["Activo", "Suspendido", "Deshabilitado"]) await dialog.getByText(label, { exact: true }).first().waitFor();
  await dialog.getByText("Pendiente de activación").last().click();
  // El nombre comercial completo es válido aunque no tenga apellido; el correo puede quedar vacío.
  await dialog.getByLabel("Email").fill("ANDES@example.test");
  await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
  await dialog.getByText("Al definir una contraseña, la cuenta pasará a Activo.").waitFor();
  await dialog.getByRole("button", { name: "Confirmar cambios", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const patch = requests.find((request) => request.key === "PATCH /api/admin/users/201");
  assert.deepEqual(
    { email: patch.body.email, fullName: patch.body.fullName, password: patch.body.password, roleCode: patch.body.roleCode, status: patch.body.status },
    { email: "andes@example.test", fullName: "Constructora Los Andes", password: undefined, roleCode: "client", status: "pending" },
  );
});

test("usuarios: al definir la contraseña de una cuenta pendiente, se guarda como Activo", async (context) => {
  const details = { ...PENDING_WITH_EMAIL, companyName: null, notes: [], notesTotal: 0, phone: null, projects: [], secondaryPhone: null };
  const { page, requests } = await openApp(context, "/usuarios", {
    responses: {
      ...USERS_RESPONSES,
      "GET /api/admin/users/202": { json: { user: details } },
      "PATCH /api/admin/users/202": { json: { message: "Usuario actualizado.", user: { ...PENDING_WITH_EMAIL, status: "active" } } },
    },
  });
  await page.getByRole("button", { name: "Editar Ana Ruiz" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar usuario" });
  await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
  await dialog.getByLabel("Cambiar contraseña", { exact: true }).fill("Activa2026*");
  await dialog.getByLabel("Confirmar contraseña").fill("Activa2026*");
  await dialog.getByRole("button", { name: "Confirmar cambios", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const patch = requests.find((request) => request.key === "PATCH /api/admin/users/202");
  assert.deepEqual({ password: patch.body.password, status: patch.body.status }, { password: "Activa2026*", status: "active" });
});

test("activación: el titular define su contraseña con el enlace y vuelve al inicio de sesión con la cuenta activa", async (context) => {
  const { page, requests } = await openApp(context, "/activar-cuenta?token=enlace-valido", {
    authenticated: false,
    responses: {
      "POST /api/auth/activation/complete": { json: { message: "Tu cuenta está activa." } },
      "POST /api/auth/activation/verify": { json: { valid: true } },
    },
    viewport: { height: 900, width: 390 },
  });
  await page.getByRole("heading", { name: "Activa tu cuenta" }).waitFor();
  await page.getByLabel("Nueva contraseña").fill("Activa2026*");
  await page.getByLabel("Confirmar contraseña").fill("Activa2026*");
  if (process.env.ARCA_PENDING_CAPTURE_DIR) await page.screenshot({ path: `${process.env.ARCA_PENDING_CAPTURE_DIR}/activation-page-mobile.png` });
  await page.getByRole("button", { name: "Activar cuenta" }).click();
  await page.getByText("Cuenta activada").waitFor();
  assert.deepEqual(requests.find((request) => request.key === "POST /api/auth/activation/complete").body, { password: "Activa2026*", token: "enlace-valido" });
  assert.equal(requests.some((request) => request.key.includes("reset")), false);
});

test("activación: un enlace usado o vencido no ofrece pedir otro por autoservicio", async (context) => {
  const { page } = await openApp(context, "/activar-cuenta?token=usado", {
    authenticated: false,
    responses: { "POST /api/auth/activation/verify": { json: { code: "INVALID_ACTIVATION_TOKEN", message: "El enlace de activación no es válido." }, status: 400 } },
  });
  await page.getByRole("heading", { name: "El enlace ha expirado" }).waitFor();
  await page.getByText("Pide a ARCA Studio que te envíe un nuevo enlace de activación.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Solicitar nuevo enlace" }).count(), 0);
  await page.getByRole("button", { name: "Volver al inicio de sesión" }).waitFor();
});
