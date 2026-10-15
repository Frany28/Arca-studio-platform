import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Manejo global de 401 UNAUTHENTICATED (hallazgo B-3) con AuthProvider y ProtectedRoute reales.
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    envDir: false,
    plugins: [react()],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const SESSION_USER = { email: "cliente@arca.test", id: 7, role: { code: "client", id: 3, name: "Cliente" } };

/**
 * Simula el backend: /auth/me responde según `backend.sessionActive` y el resto según `backend.responses`.
 * Cuenta las llamadas a /auth/me para detectar bucles de restauración o redirección.
 *
 * @param {import("playwright").BrowserContext} session - Contexto del navegador.
 * @returns {Promise<object>} Estado mutable del backend simulado.
 */
async function mockBackend(session) {
  const backend = {
    meCalls: 0,
    responses: {
      "/api/admin/users": { body: { code: "FORBIDDEN", message: "No tienes permisos." }, status: 403 },
      "/api/projects": { body: { code: "UNAUTHENTICATED", message: "Sesión requerida." }, status: 401 },
    },
    sessionActive: true,
  };
  // Solo el prefijo /api/: los módulos que Vite sirve desde /src/api/ no deben interceptarse.
  await session.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") {
      backend.meCalls += 1;
      await route.fulfill(backend.sessionActive
        ? { json: { user: SESSION_USER }, status: 200 }
        : { json: { code: "UNAUTHENTICATED", message: "Sesión requerida." }, status: 401 });
      return;
    }
    const response = backend.responses[pathname] || { body: { code: "NOT_FOUND" }, status: 404 };
    await route.fulfill({ json: response.body, status: response.status });
  });
  return backend;
}

/**
 * Abre el harness en una página del contexto y espera a que la vista privada esté disponible.
 *
 * @param {import("playwright").BrowserContext} session - Contexto del navegador.
 * @param {string[]} errors - Acumulador de errores de página.
 * @returns {Promise<import("playwright").Page>} Página autenticada.
 */
async function openPrivatePage(session, errors) {
  const page = await session.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/tests/browser/fixtures/auth-session.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#private-page").waitFor();
  return page;
}

/**
 * Crea un contexto aislado que se cierra al terminar y verifica que no hubo errores de página.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @returns {Promise<{ errors: string[], session: import("playwright").BrowserContext }>} Contexto listo.
 */
async function newSession(context) {
  const session = await browser.newContext();
  const errors = [];
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, [], "la página no debe lanzar errores");
  });
  return { errors, session };
}

test("una sesión revocada lleva al login una sola vez, sin bucles, y avisa a otras pestañas", async (context) => {
  const { errors, session } = await newSession(context);
  const backend = await mockBackend(session);
  const page = await openPrivatePage(session, errors);
  const otherTab = await openPrivatePage(session, errors);
  assert.equal(backend.meCalls, 2, "una restauración inicial por pestaña");

  backend.sessionActive = false;
  await page.getByRole("button", { name: "Cargar proyectos" }).click();

  await page.locator("#login-page").waitFor();
  await otherTab.locator("#login-page").waitFor();
  assert.ok(await page.evaluate(() => window.localStorage.getItem("arca_auth_logout")), "se difunde el cierre");
  await page.waitForTimeout(500);
  assert.equal(backend.meCalls, 3, "solo una confirmación con /auth/me; ni reintentos ni bucle");
});

test("un 403 muestra el error de permisos sin cerrar la sesión", async (context) => {
  const { errors, session } = await newSession(context);
  const backend = await mockBackend(session);
  const page = await openPrivatePage(session, errors);

  await page.getByRole("button", { name: "Acción administrativa" }).click();
  await assert.doesNotReject(page.locator("#request-result", { hasText: "FORBIDDEN" }).waitFor());
  assert.equal(await page.locator("#private-page").count(), 1);
  assert.equal(backend.meCalls, 1, "un 403 no consulta la sesión");
});

test("un 401 tardío con la sesión aún válida en el servidor no cierra la sesión", async (context) => {
  const { errors, session } = await newSession(context);
  const backend = await mockBackend(session);
  const page = await openPrivatePage(session, errors);

  await page.getByRole("button", { name: "Cargar proyectos" }).click();
  await page.locator("#request-result", { hasText: "UNAUTHENTICATED" }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#private-page").count(), 1);
  assert.equal(backend.meCalls, 2, "se confirmó una vez con /auth/me");
});
