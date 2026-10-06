import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PROJECT = { id: 21, name: "Proyecto del dashboard", status: "in_process", progress: 35, assignedArchitect: { id: 1, name: "Dashboard Test" }, assignees: [{ id: 1, name: "Dashboard Test" }] };
const REQUEST = { id: 7, projectName: "Solicitud del dashboard", status: "pending_review", description: "Detalle de la solicitud", assignees: [{ id: 1, name: "Dashboard Test" }] };
let server;
let browser;
let origin;

/**
 * Observa la ejecución de hooks reales mediante instrumentación exclusiva del servidor de tests.
 * Permite distinguir un hook deshabilitado de un hook que la página nunca llega a montar.
 */
function dashboardHookProbe() {
  const modules = new Map([
    ["/hooks/useAdminDashboardData.js", ["useAdminDashboardData"]],
    ["/hooks/useAdminRequestAssignments.js", ["useAdminRequestAssignments"]],
    ["/hooks/useProjectComments.js", ["useProjectComments", "useRecentProjectComments"]],
    ["/Gallery/useImageComments.js", ["useImageCommentNotifications"]],
    ["/components/AdminRequestLoginAlert.jsx", ["AdminRequestLoginAlert"]],
  ]);
  return {
    name: "dashboard-hook-probe",
    enforce: "pre",
    transform(source, id) {
      const modulePath = id.replaceAll("\\", "/").split("?")[0];
      const names = [...modules].find(([suffix]) => modulePath.endsWith(suffix))?.[1];
      if (!names) return null;
      for (const name of names) {
        const signature = new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\)\\s*\\{`);
        assert.ok(signature.test(source), `La instrumentación debe encontrar ${name}`);
        source = source.replace(signature, (match) => `${match}\nwindow.__dashboardHooks.push("${name}");${name === "AdminRequestLoginAlert" ? "\nwindow.__dashboardLoginAlert = { onAssign, onView, trigger };" : ""}`);
      }
      return { code: source, map: null };
    },
  };
}

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, envDir: false,
    // La instrumentación usa una caché propia para no invalidar otros servidores de tests.
    cacheDir: fileURLToPath(new URL("../../node_modules/.vite-internal-dashboards", import.meta.url)),
    plugins: [dashboardHookProbe(), react(), tailwindcss()],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});

after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre la aplicación real con HTTP controlado y observa recursos activos del dashboard.
 * Las sesiones son independientes; SSE simulado evita tráfico y reintentos ajenos a la prueba.
 */
async function openPage(context, role, { path = "/dashboard-arquitecto", login = false, projects = [PROJECT] } = {}) {
  const session = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await session.newPage();
  const calls = [];
  const errors = [];
  let authenticated = !login;
  const user = { id: 1, firstName: "Dashboard", lastName: "Test", email: "dashboard@example.test", role, status: "active", permissionCodes: ["projects.publish"] };
  await page.addInitScript(() => {
    window.__dashboardHooks = [];
    window.__dashboardStreams = [];
    window.__dashboardIntervals = new Map();
    window.EventSource = class {
      constructor(url) { this.url = url; this.closed = false; window.__dashboardStreams.push(this); }
      addEventListener() {}
      close() { this.closed = true; }
    };
    const setInterval = window.setInterval.bind(window);
    const clearInterval = window.clearInterval.bind(window);
    window.setInterval = (callback, milliseconds, ...args) => {
      const id = setInterval(callback, milliseconds, ...args);
      window.__dashboardIntervals.set(id, milliseconds);
      return id;
    };
    window.clearInterval = (id) => { window.__dashboardIntervals.delete(id); clearInterval(id); };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path: endpoint });
    if (endpoint === "/api/auth/me" && !authenticated) {
      await route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED", message: "Sin sesión." } });
      return;
    }
    if (endpoint === "/api/auth/login") authenticated = true;
    if (endpoint === "/api/auth/logout") authenticated = false;
    const payloads = {
      "/api/auth/me": { user: authenticated ? user : null },
      "/api/auth/login": { user },
      "/api/auth/logout": {},
      "/api/projects": { projects, nextCursor: null },
      "/api/project-requests/review-queue": { projectRequests: [REQUEST], nextCursor: null },
      "/api/admin/dashboard-metrics": { metrics: {} },
      "/api/admin/dashboard-overview": { overview: { recentActivity: [], newRequests: [REQUEST] } },
      "/api/admin/assignees": { assignees: REQUEST.assignees },
      "/api/projects/21/comments": { comments: [], nextCursor: null },
      "/api/environment-comments": { comments: [], nextCursor: null },
    };
    if (!payloads[endpoint]) {
      errors.push(`Petición no prevista: ${request.method()} ${endpoint}`);
      await route.fulfill({ status: 404, json: { message: "Fixture no definida" } });
      return;
    }
    await route.fulfill({ json: payloads[endpoint] });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}${login ? "/" : path}`);
  if (!login) await ready(page);
  return { page, calls };
}

/** Espera contenido real y lecturas iniciales antes de contar cargas o recursos activos. */
async function ready(page) {
  await page.getByText("Bienvenido, Dashboard", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
}

/** Cuenta peticiones por endpoint conservando las repeticiones propias de StrictMode. */
function count(calls, path) { return calls.filter((call) => call.path === path).length; }

for (const role of ["admin", "architect"]) {
  test(`${role}: ruta compatible, UI exclusiva y hooks del rol contrario sin montar`, async (context) => {
    const { page, calls } = await openPage(context, role);
    assert.equal(new URL(page.url()).pathname, "/dashboard-arquitecto");
    assert.equal(await page.getByRole("heading", { name: "Solicitudes asignadas", exact: true }).count(), role === "architect" ? 1 : 0);
    assert.equal(await page.getByRole("region", { name: "Resumen de métricas administrativas" }).count(), role === "admin" ? 1 : 0);
    assert.equal(await page.getByText("Proyecto del dashboard", { exact: true }).count() > 0, true);
    assert.equal(count(calls, "/api/projects"), 3);
    assert.equal(count(calls, "/api/project-requests/review-queue"), 2);
    assert.equal(count(calls, "/api/admin/dashboard-metrics"), role === "admin" ? 1 : 0);
    assert.equal(count(calls, "/api/admin/dashboard-overview"), role === "admin" ? 1 : 0);
    const hooks = await page.evaluate(() => window.__dashboardHooks);
    const forbidden = role === "admin"
      ? ["useImageCommentNotifications", "useProjectComments", "useRecentProjectComments"]
      : ["useAdminDashboardData", "useAdminRequestAssignments"];
    for (const hook of forbidden) assert.equal(hooks.includes(hook), false, `${role} no debe montar ${hook}`);
  });
}

for (const [role, path] of [
  ["architect", "/dashboard-arquitecto-vacio"],
  ["admin", "/dashboard-arquitecto-vacio"],
  ["admin", "/dashboard-admin-vacio"],
]) {
  test(`${role} ${path}: empty conserva rol y omite datos del dashboard`, async (context) => {
    const { page, calls } = await openPage(context, role, { path, projects: [] });
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(await page.getByText("Tu espacio de proyectos está listo", { exact: true }).count(), role === "architect" ? 1 : 0);
    assert.equal(await page.getByText("No hay proyectos", { exact: true }).count(), role === "admin" ? 1 : 0);
    assert.equal(await page.getByRole("heading", { name: "Solicitudes asignadas", exact: true }).count(), role === "architect" ? 1 : 0);
    for (const endpoint of ["/api/project-requests/review-queue", "/api/admin/dashboard-metrics", "/api/admin/dashboard-overview", "/api/admin/assignees"]) {
      assert.equal(count(calls, endpoint), 0);
    }
    // El proveedor global de proyectos recientes mantiene su única lectura.
    assert.equal(count(calls, "/api/projects"), 1);
  });
}

for (const role of ["admin", "architect"]) {
  test(`${role}: login conserva URL y muestra la alerta únicamente para admin`, async (context) => {
    const { page } = await openPage(context, role, { login: true, projects: [] });
    await page.getByPlaceholder("ejemplo@dominio.com", { exact: true }).fill("dashboard@example.test");
    await page.locator('input[type="password"]').fill("Dashboard2026*");
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await ready(page);
    assert.equal(new URL(page.url()).pathname, "/dashboard-arquitecto");
    const alertTrigger = await page.evaluate(() => window.__dashboardLoginAlert?.trigger ?? null);
    assert.equal(alertTrigger, role === "admin" ? 1 : null);
    if (role === "admin") {
      // Comprueba el callback real sin depender de los timers del toast durante StrictMode.
      await page.evaluate(() => window.__dashboardLoginAlert.onView());
      await page.getByRole("dialog").waitFor();
      assert.equal(await page.getByRole("dialog").getByRole("button", { name: "Confirmar decisión", exact: true }).count(), 1);
    }
  });
}

for (const role of ["admin", "architect"]) {
  test(`${role}: drawer conserva política, suscripciones y polling sin nuevas cargas`, async (context) => {
    const { page, calls } = await openPage(context, role);
    const resources = await page.evaluate(() => ({
      streams: window.__dashboardStreams.filter((stream) => !stream.closed).length,
      intervals: [...window.__dashboardIntervals.values()].filter((value) => value === 15000).length,
    }));
    assert.deepEqual(resources, role === "admin" ? { streams: 0, intervals: 0 } : { streams: 2, intervals: 2 });
    assert.equal(count(calls, "/api/projects/21/comments"), role === "admin" ? 0 : 2);
    const commentsBefore = count(calls, "/api/projects/21/comments");
    const overviewBefore = count(calls, "/api/admin/dashboard-overview");
    await page.getByRole("button", { name: "Notificaciones", exact: true }).click();
    await page.getByText("Actividad Reciente", { exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(count(calls, "/api/admin/dashboard-overview"), overviewBefore + (role === "admin" ? 1 : 0));
    assert.equal(count(calls, "/api/environment-comments"), role === "admin" ? 0 : 1);
    assert.equal(count(calls, "/api/projects/21/comments"), commentsBefore + (role === "admin" ? 0 : 4));
    const opened = await page.evaluate(() => ({
      streams: window.__dashboardStreams.filter((stream) => !stream.closed).length,
      fastPolling: [...window.__dashboardIntervals.values()].filter((value) => value === 5000).length,
      environmentPolling: [...window.__dashboardIntervals.values()].filter((value) => value === 15000).length,
    }));
    assert.deepEqual(opened, role === "admin"
      ? { streams: 0, fastPolling: 0, environmentPolling: 0 }
      : { streams: 2, fastPolling: 2, environmentPolling: 1 });
  });
}
