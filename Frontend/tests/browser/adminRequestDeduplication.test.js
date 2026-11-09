import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Fase 1 de rendimiento: cuenta las lecturas reales del navegador sobre un backend simulado para
// comprobar que Usuarios no repite su listado al montar (F01) y que el dashboard no vuelve a leer
// proyectos ni overview cuando solo cambia la referencia del usuario de la sesión (F04).

const ADMIN = { id: 1, firstName: "Leonel", lastName: "Pérez", email: "leonel@example.test", role: "admin", status: "active" };
const USERS = Array.from({ length: 10 }, (_, index) => ({
  id: 100 + index,
  name: `Usuario ${index}`,
  email: `usuario${index}@example.test`,
  status: "active",
  role: { code: "architect", name: "Arquitecto" },
  lastLoginAt: "2026-03-23T13:00:00Z",
}));
const PAYLOADS = {
  "/api/projects": { projects: [{ id: 30, name: "Proyecto Norte", status: "in_process", progress: 40, client: { id: 50, name: "Diego" }, assignees: [], assignedArchitect: null }], nextCursor: null },
  "/api/project-requests/review-queue": { projectRequests: [], nextCursor: null },
  "/api/environment-comments": { comments: [], nextCursor: null },
  "/api/admin/assignees": { assignees: [] },
  "/api/admin/roles": { roles: [{ id: 1, code: "architect", name: "Arquitecto" }] },
  "/api/admin/users": { users: USERS, nextCursor: "next-page", metrics: { total: 20, active: 20, suspended: 0, disabled: 0 } },
  "/api/admin/dashboard-metrics": { metrics: {
    activeUsers: { total: 3, thisMonth: 1 },
    activeProjects: { total: 1, thisMonth: 0 },
    files: { total: 0, totalBytes: 0, latestUploadAt: null },
    requests: { total: 1, today: 0 },
    criticalEvents: { total: 0, latestAt: null },
  } },
  "/api/admin/dashboard-overview": { overview: {
    recentActivity: [],
    newRequests: [{ id: 7, projectName: "Apto. Noventa y Uno", projectType: "residential", status: "pending_review", assignees: [] }],
  } },
};

let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url),
    configFile: false,
    envDir: false,
    plugins: [react(), tailwindcss()],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
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

/**
 * Abre una ruta administrativa con el backend simulado y registra cada petición a la API.
 * `respond` permite sustituir la respuesta de una petición concreta (por ejemplo, un 401).
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {string} path - Ruta de la aplicación.
 * @param {string} readyText - Texto que indica que la vista terminó su carga inicial.
 * @param {Function} [respond] - Recibe `{ path, search, count }` y devuelve `{ status, json }` o null.
 * @returns {Promise<{ page: import("playwright").Page, calls: Array<{ path: string, search: Object }> }>}
 *   `calls` contiene solo las peticiones completadas: el StrictMode de desarrollo monta dos veces
 *   cada efecto y aborta la primera lectura, que nunca llega a procesarse y no se cuenta.
 */
async function openAdminPage(context, path, readyText, respond = () => null) {
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = applyBrowserTimeouts(await browserContext.newPage());
  const calls = [];
  const received = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfinished", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) calls.push({ path: url.pathname, search: Object.fromEntries(url.searchParams) });
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    const call = { path: url.pathname, search: Object.fromEntries(url.searchParams) };
    received.push(call);
    const override = respond({ ...call, count: received.filter((item) => item.path === call.path).length });
    if (override) return route.fulfill(override);
    const payload = url.pathname === "/api/auth/me" ? { user: ADMIN } : PAYLOADS[url.pathname];
    if (!payload) {
      errors.push(`Petición no prevista: ${route.request().method()} ${url.pathname}`);
      return route.fulfill({ status: 404, json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" } });
    }
    return route.fulfill({ json: payload });
  });
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}${path}`);
  await page.getByText(readyText, { exact: true }).first().waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return { calls, page };
}

const count = (calls, path, predicate = () => true) => calls.filter((call) => call.path === path && predicate(call)).length;
// El debounce de búsqueda de Usuarios espera 300 ms: se deja margen para que cualquier lectura
// diferida del montaje llegue antes de contar.
const settle = (page) => page.waitForTimeout(800);

test("F01 /usuarios: el montaje lee el listado una vez y búsqueda y paginación siguen consultando", async (context) => {
  const { calls, page } = await openAdminPage(context, "/usuarios", USERS[9].name);
  await settle(page);
  assert.equal(count(calls, "/api/admin/users"), 1, "Una sola lectura del listado al montar");

  await page.getByRole("textbox", { name: "Buscar usuarios" }).fill("ana");
  await page.waitForRequest((request) => new URL(request.url()).searchParams.get("search") === "ana");
  await settle(page);
  assert.equal(count(calls, "/api/admin/users"), 2, "Una búsqueda real consulta una vez");

  await page.getByRole("textbox", { name: "Buscar usuarios" }).fill(" ana ");
  await settle(page);
  assert.equal(count(calls, "/api/admin/users"), 2, "Espacios exteriores no cambian la búsqueda efectiva");

  await page.getByRole("textbox", { name: "Buscar usuarios" }).fill("");
  await settle(page);
  assert.equal(count(calls, "/api/admin/users"), 3, "Vaciar la búsqueda vuelve a consultar sin filtro");
  assert.equal(calls.filter((call) => call.path === "/api/admin/users").at(-1).search.search, undefined);

  await page.getByRole("textbox", { name: "Buscar usuarios" }).fill("ana");
  await settle(page);
  assert.equal(count(calls, "/api/admin/users"), 4);
  await page.getByRole("button", { name: "Quitar filtros", exact: true }).first().click();
  await settle(page);
  assert.equal(count(calls, "/api/admin/users"), 5, "Quitar filtros consulta una sola vez");
  assert.equal(calls.filter((call) => call.path === "/api/admin/users").at(-1).search.search, undefined);

  const nextRequest = page.waitForRequest((request) => new URL(request.url()).searchParams.get("cursor") === "next-page");
  await page.getByRole("button", { name: "Siguiente pág.", exact: true }).click();
  await nextRequest;
});

test("F04 dashboard: confirmar la misma sesión tras un 401 no vuelve a leer proyectos ni overview", async (context) => {
  // La revalidación del overview responde 401; /auth/me confirma la misma sesión y AuthContext
  // publica un objeto de usuario nuevo con el mismo id y rol.
  const scenario = { rejectOverview: false };
  const respond = ({ path }) => {
    if (path !== "/api/admin/dashboard-overview" || !scenario.rejectOverview) return null;
    scenario.rejectOverview = false;
    return { status: 401, json: { code: "UNAUTHENTICATED", message: "Sesión requerida." } };
  };
  const { calls, page } = await openAdminPage(context, "/dashboard-arquitecto", "Apto. Noventa y Uno", respond);
  await page.waitForLoadState("networkidle");
  const isDashboardList = (call) => call.search.limit === "100";
  const projectsAtMount = count(calls, "/api/projects", isDashboardList);
  const meBefore = count(calls, "/api/auth/me");
  const overviewBefore = count(calls, "/api/admin/dashboard-overview");

  // Recuperar la conexión revalida siempre el overview con force (useResumeRevalidation).
  scenario.rejectOverview = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (count(calls, "/api/auth/me") <= meBefore && Date.now() < deadline) await page.waitForTimeout(50);
  await settle(page);

  assert.equal(count(calls, "/api/auth/me"), meBefore + 1, "El 401 se confirmó con /auth/me");
  assert.equal(count(calls, "/api/projects", isDashboardList), projectsAtMount, "La misma sesión no relee la colección de proyectos");
  assert.equal(count(calls, "/api/admin/dashboard-overview"), overviewBefore + 1, "Solo la revalidación rechazada");
  assert.equal(await page.getByText("Apto. Noventa y Uno", { exact: true }).first().isVisible(), true);
  // El montaje doble del StrictMode aborta la primera lectura: solo una colección llega a completarse.
  assert.equal(projectsAtMount, 1, "Una sola lectura completada de la colección al montar");
});

test("F04 dashboard: si /auth/me confirma otra cuenta, sí vuelve a leer los proyectos", async (context) => {
  const scenario = { rejectOverview: false, switchAccount: false };
  const respond = ({ path }) => {
    if (path === "/api/auth/me" && scenario.switchAccount) return { json: { user: { ...ADMIN, id: 2, email: "otra@example.test" } } };
    if (path !== "/api/admin/dashboard-overview" || !scenario.rejectOverview) return null;
    scenario.rejectOverview = false;
    return { status: 401, json: { code: "UNAUTHENTICATED", message: "Sesión requerida." } };
  };
  const { calls, page } = await openAdminPage(context, "/dashboard-arquitecto", "Apto. Noventa y Uno", respond);
  await page.waitForLoadState("networkidle");
  const isDashboardList = (call) => call.search.limit === "100";
  const projectsAtMount = count(calls, "/api/projects", isDashboardList);

  scenario.rejectOverview = true;
  scenario.switchAccount = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (count(calls, "/api/projects", isDashboardList) <= projectsAtMount && Date.now() < deadline) await page.waitForTimeout(50);

  assert.equal(count(calls, "/api/projects", isDashboardList), projectsAtMount + 1, "Otra cuenta relee la colección");
});
