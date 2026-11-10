import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";
import { SESSION_CONFIRMATION_WINDOW_MS } from "../../src/hooks/useRetryAfterSessionConfirmation.js";

// Fase 3 de rendimiento: cuenta las lecturas reales del navegador en las vistas del cliente
// (Home: useHomeProjects y useHomeProjectRequests; /proyectos: PublicProjectsGallery) sobre un
// backend simulado. AuthContext publica un objeto `user` nuevo cuando /auth/me desmiente un 401;
// eso no debe repetir lecturas si la sesión (cuenta, rol y cliente) es la misma, y sí debe
// repetirlas cuando cambia. Solo se cuentan peticiones completadas (`requestfinished`): el
// StrictMode de desarrollo monta dos veces cada efecto y la lectura abortada no se completa.

const ACCOUNTS = {
  diego: { id: 5, firstName: "Diego", lastName: "Mora", email: "diego@example.test", role: "client", clientId: 50, status: "active" },
  ana: { id: 6, firstName: "Ana", lastName: "Ruiz", email: "ana@example.test", role: "client", clientId: 51, status: "active" },
};
const PUBLIC_PROJECT = { id: 90, name: "Museo Público", projectType: "commercial", status: "finished", isPublic: true, progress: 100, client: { id: 99, name: "Otro" }, assignees: [], assignedArchitect: null };
const ownedProject = (id, name, clientId) => ({ id, name, projectType: "residential", status: "in_process", isPublic: false, progress: 40, client: { id: clientId, name }, assignees: [], assignedArchitect: null });
const request = (id, projectName) => ({ id, projectName, status: "pending_review", createdAt: "2026-11-01T10:00:00Z" });

/**
 * Backend simulado: los datos dependen de la cuenta que representa la cookie (`state.account`)
 * y, para el cliente vinculado, de `state.clientId`. Los proyectos llegan en dos páginas para
 * que cada lectura completa cueste dos peticiones, como en el recorrido real por cursor.
 */
function createBackend() {
  const state = { account: "diego", role: null, clientId: null };
  const sessionUser = () => {
    const base = ACCOUNTS[state.account];
    return { ...base, role: state.role || base.role, clientId: state.clientId ?? base.clientId };
  };
  const payload = (path, search) => {
    const user = sessionUser();
    if (path === "/api/auth/me") return { user };
    if (path === "/api/auth/logout") return { ok: true };
    if (path === "/api/projects" && search.scope === "owned") return { projects: [ownedProject(user.id * 10, `Casa ${user.firstName} ${user.clientId}`, user.clientId)], nextCursor: null };
    if (path === "/api/projects") {
      if (search.cursor === "p2") return { projects: [PUBLIC_PROJECT], nextCursor: null };
      // Cada cuenta puede ver además una vitrina pública distinta: una respuesta calculada para
      // otra cuenta se reconoce en la galería.
      const showcase = { ...PUBLIC_PROJECT, id: 900 + user.id, name: `Vitrina ${user.firstName}` };
      return { projects: [ownedProject(user.id * 10, `Casa ${user.firstName} ${user.clientId}`, user.clientId), showcase], nextCursor: "p2" };
    }
    if (path === "/api/project-requests") {
      if (state.account !== "diego") return { projectRequests: [request(60, "Solicitud Ana")], nextCursor: null };
      if (search.cursor === "r2") return { projectRequests: [request(2, "Solicitud Dos")], nextCursor: null };
      return { projectRequests: [request(1, "Solicitud Uno")], nextCursor: "r2" };
    }
    if (path.startsWith("/api/projects/") && path.endsWith("/comments")) return { comments: [], nextCursor: null };
    if (path === "/api/project-requests/review-queue") return { projectRequests: [], nextCursor: null };
    if (path === "/api/environment-comments") return { comments: [], nextCursor: null };
    return null;
  };
  return { payload, state };
}

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
 * Abre una vista del cliente con el backend simulado y registra las peticiones a la API.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {string} path - Ruta de la aplicación.
 * @param {string} readyText - Texto que indica que la vista terminó su carga inicial.
 * @param {Function} [respond] - Recibe `{ path, search, count }` y devuelve `{ status, json }`,
 *   `{ delayMs }` para retrasar la respuesta normal, o null.
 * @param {Object} [options] - Opciones de apertura.
 * @param {boolean} [options.waitForIdle=true] - Espera a que la red quede inactiva; desactivarlo
 *   deja pendiente una respuesta retrasada de la carga inicial.
 * @returns {Promise<Object>} page, backend, `calls` completadas, `aborted` canceladas en curso y
 *   `held` retrasadas. Playwright no notifica `requestfailed` para una petición retenida por
 *   `route`, así que su cancelación se comprueba con `isFinished`: una retenida que la página
 *   abortó nunca llega a completarse aunque la ruta la responda después.
 */
async function openClientPage(context, path, readyText, respond = () => null, { waitForIdle = true } = {}) {
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = applyBrowserTimeouts(await browserContext.newPage());
  const backend = createBackend();
  const calls = [];
  const aborted = [];
  const held = [];
  const finished = new Set();
  const received = [];
  const errors = [];
  const toCall = (request) => {
    const url = new URL(request.url());
    return { method: request.method(), path: url.pathname, search: Object.fromEntries(url.searchParams) };
  };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfinished", (request) => {
    finished.add(request);
    if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(toCall(request));
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) aborted.push(toCall(request));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const call = toCall(route.request());
    received.push(call);
    const override = respond({ ...call, count: received.filter((item) => item.path === call.path).length, backend });
    if (override?.delayMs) {
      // La respuesta retrasada se calcula con la sesión vigente al recibir la petición.
      const json = backend.payload(call.path, call.search);
      held.push({ ...call, request: route.request() });
      await new Promise((resolve) => setTimeout(resolve, override.delayMs));
      return route.fulfill({ json }).catch(() => {});
    }
    if (override) return route.fulfill(override);
    // Sin flujo de eventos en la prueba: un 204 cierra el EventSource sin reconexiones.
    if (call.path.endsWith("/events")) return route.fulfill({ status: 204 });
    const json = backend.payload(call.path, call.search);
    if (!json) {
      errors.push(`Petición no prevista: ${call.method} ${call.path}`);
      return route.fulfill({ status: 404, json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" } });
    }
    return route.fulfill({ json });
  });
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}${path}`);
  await page.getByText(readyText, { exact: true }).first().waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  if (waitForIdle) await page.waitForLoadState("networkidle");
  return { aborted, backend, calls, held, isFinished: (entry) => finished.has(entry.request), page };
}

const count = (calls, path, predicate = () => true) => calls.filter((call) => call.path === path && predicate(call)).length;
const firstPage = (call) => !call.search.cursor;
// Las vistas leen la colección completa con listAll (páginas de 100 sin ámbito). Los accesos
// recientes de la navegación lateral piden aparte `scope=owned` y no forman parte de esta fase.
const isFullListPage = (call) => call.search.limit === "100" && !call.search.scope;
const projectPages = (calls) => count(calls, "/api/projects", isFullListPage);
// Lecturas completas de la colección de proyectos (cada una empieza por la página sin cursor).
const projectReads = (calls) => count(calls, "/api/projects", (call) => isFullListPage(call) && firstPage(call));
const requestReads = (calls) => count(calls, "/api/project-requests", firstPage);
const settle = (page) => page.waitForTimeout(600);
const UNAUTHENTICATED = { status: 401, json: { code: "UNAUTHENTICATED", message: "Sesión requerida." } };

/**
 * Espera a que una condición sobre las peticiones se cumpla o falle por tiempo.
 *
 * @param {import("playwright").Page} page - Página activa.
 * @param {Function} condition - Predicado sin argumentos.
 * @returns {Promise<void>}
 */
async function waitUntil(page, condition) {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (!condition() && Date.now() < deadline) await page.waitForTimeout(50);
}

/**
 * Hace que la sesión reciba un 401 en una petición ajena a la vista y que /auth/me lo desmienta:
 * AuthContext publica entonces un objeto `user` nuevo. Usa el mismo módulo HTTP que la aplicación.
 *
 * @param {import("playwright").Page} page - Página activa.
 * @returns {Promise<void>}
 */
async function triggerSessionConfirmation(page) {
  await page.evaluate(async () => {
    const { api } = await import("/src/api/http.js");
    await api.projectRequests.get("rechazada-401").catch(() => {});
  });
}
const rejectProbe = ({ path }) => (path === "/api/project-requests/rechazada-401" ? UNAUTHENTICATED : null);

test("Home: la carga inicial completa una lectura de proyectos y una de solicitudes", async (context) => {
  const { calls } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno");
  assert.equal(projectReads(calls), 1, `Lecturas completas de proyectos al montar: ${projectReads(calls)}`);
  assert.equal(projectPages(calls), 2, "Una lectura completa recorre sus dos páginas");
  assert.equal(requestReads(calls), 1, `Lecturas de solicitudes al montar: ${requestReads(calls)}`);
});

test("Home: confirmar la misma sesión no relee proyectos ni solicitudes y conserva las páginas cargadas", async (context) => {
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", rejectProbe);
  await page.getByRole("button", { name: "Cargar más", exact: true }).click();
  await page.getByText("Solicitud Dos", { exact: true }).waitFor();
  const before = { me: count(calls, "/api/auth/me"), projects: projectReads(calls), requests: count(calls, "/api/project-requests") };

  await triggerSessionConfirmation(page);
  await waitUntil(page, () => count(calls, "/api/auth/me") > before.me);
  await settle(page);

  assert.equal(count(calls, "/api/auth/me"), before.me + 1, "El 401 se confirmó con /auth/me");
  assert.equal(projectReads(calls), before.projects, "La misma sesión no relee la colección de proyectos");
  assert.equal(count(calls, "/api/project-requests"), before.requests, "La misma sesión no relee solicitudes");
  assert.equal(await page.getByText("Solicitud Dos", { exact: true }).isVisible(), true, "Conserva la segunda página cargada");
  assert.equal(await page.getByText("Casa Diego 50", { exact: true }).first().isVisible(), true);
});

test("Home: un 401 persistente en proyectos no provoca un bucle de lecturas", async (context) => {
  // La lectura de proyectos responde siempre 401 y /auth/me confirma la sesión. Si el efecto
  // dependiera del objeto `user`, cada confirmación relanzaría la lectura rechazada sin fin. Con el
  // reintento acotado: lectura original + un único reintento, y una confirmación por cada 401.
  const respond = ({ path, search }) => (path === "/api/projects" && isFullListPage({ search }) ? UNAUTHENTICATED : null);
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "No pudimos cargar los proyectos", respond);
  await page.waitForTimeout(2000);
  assert.equal(projectReads(calls), 2, `Lecturas de proyectos con 401 persistente: ${projectReads(calls)}`);
  assert.equal(count(calls, "/api/auth/me"), 3, `/auth/me: restauración inicial + una por cada 401 (${count(calls, "/api/auth/me")})`);
  assert.equal(requestReads(calls), 1, "Las solicitudes no se releen por la confirmación");
  assert.equal(await page.getByText("No pudimos cargar los proyectos", { exact: true }).first().isVisible(), true, "Tras el reintento fallido se muestra el error");
});

test("Home: otra cuenta relee proyectos y solicitudes y descarta los datos anteriores", async (context) => {
  const { backend, calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", rejectProbe);
  const before = { projects: projectReads(calls), requests: requestReads(calls) };

  backend.state.account = "ana";
  await triggerSessionConfirmation(page);
  await page.getByText("Solicitud Ana", { exact: true }).waitFor();
  await page.getByText("Casa Ana 51", { exact: true }).first().waitFor();
  await settle(page);

  assert.equal(projectReads(calls), before.projects + 1, "Otra cuenta relee la colección una vez");
  assert.equal(requestReads(calls), before.requests + 1, "Otra cuenta relee las solicitudes una vez");
  assert.equal(await page.getByText("Solicitud Uno", { exact: true }).count(), 0);
});

test("Home: un cambio de cliente vinculado en la misma cuenta relee los datos", async (context) => {
  const { backend, calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", rejectProbe);
  const before = { projects: projectReads(calls), requests: requestReads(calls) };

  backend.state.clientId = 52;
  await triggerSessionConfirmation(page);
  await page.getByText("Casa Diego 52", { exact: true }).first().waitFor();
  await settle(page);

  assert.equal(projectReads(calls), before.projects + 1);
  assert.equal(requestReads(calls), before.requests + 1);
});

test("Home: un cambio de rol saca al usuario de la vista de cliente sin lecturas tardías", async (context) => {
  const { backend, calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", (call) => {
    if (call.path === "/api/projects" && call.backend.state.role) return { delayMs: 300 };
    return rejectProbe(call);
  });
  backend.state.role = "architect";
  const before = { requests: requestReads(calls) };
  await triggerSessionConfirmation(page);
  await page.waitForURL((url) => !url.pathname.startsWith("/dashboard-clientes"));
  await settle(page);
  assert.equal(requestReads(calls), before.requests, "Sin lecturas de solicitudes del cliente tras perder el rol");
});

test("Home: cerrar sesión no deja lecturas pendientes ni nuevas", async (context) => {
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno");
  const before = { projects: projectPages(calls), requests: count(calls, "/api/project-requests") };
  await page.getByRole("button", { name: /Cerrar sesión/ }).first().click();
  await waitUntil(page, () => count(calls, "/api/auth/logout") > 0);
  await settle(page);
  assert.equal(projectPages(calls), before.projects);
  assert.equal(count(calls, "/api/project-requests"), before.requests);
});

test("Home: navegar entre Dashboard, Solicitudes y la galería lee una vez por vista", async (context) => {
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno");
  // /dashboard-clientes y /solicitudes son dos lazy() del mismo módulo: React reutiliza la
  // instancia de Home, conserva lo cargado y no relee. La galería y el regreso desde ella montan
  // de nuevo su vista y leen una sola vez.
  const visit = async (label, pathname, expected) => {
    await page.getByRole("button", { name: label, exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === pathname);
    await waitUntil(page, () => projectReads(calls) >= expected.projects && requestReads(calls) >= expected.requests);
    await settle(page);
    assert.deepEqual(
      { projects: projectReads(calls), requests: requestReads(calls) },
      expected,
      `Lecturas acumuladas tras visitar ${pathname}`,
    );
  };
  await page.getByRole("button", { name: "Cargar más", exact: true }).click();
  await page.getByText("Solicitud Dos", { exact: true }).waitFor();
  await visit("Solicitudes", "/solicitudes", { projects: 1, requests: 1 });
  assert.equal(await page.getByText("Solicitud Dos", { exact: true }).isVisible(), true, "Conserva las páginas cargadas");
  await page.getByText("Solicitud Uno", { exact: true }).waitFor();
  await visit("Ver más proyectos", "/proyectos", { projects: 2, requests: 1 });
  await page.getByText("Museo Público", { exact: true }).first().waitFor();
  await visit("Dashboard", "/dashboard-clientes", { projects: 3, requests: 2 });
  await page.getByText("Solicitud Uno", { exact: true }).waitFor();
});

test("Home: Actualizar vuelve a leer proyectos y solicitudes tras un fallo", async (context) => {
  const scenario = { failProjects: true, failRequests: true };
  const failure = { status: 500, json: { code: "INTERNAL", message: "Error" } };
  const respond = ({ path, search }) => {
    if (path === "/api/project-requests" && scenario.failRequests) return failure;
    if (path === "/api/projects" && isFullListPage({ search }) && scenario.failProjects) return failure;
    return null;
  };
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "No pudimos cargar tus solicitudes", respond);
  await page.getByText("No pudimos cargar los proyectos", { exact: true }).first().waitFor();
  await page.waitForLoadState("networkidle");
  const before = { projects: projectPages(calls), requests: count(calls, "/api/project-requests") };

  scenario.failRequests = false;
  scenario.failProjects = false;
  await page.getByRole("button", { name: "Actualizar", exact: true }).first().click();
  await page.getByText("Solicitud Uno", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Actualizar", exact: true }).first().click();
  await page.getByText("Museo Público", { exact: true }).first().waitFor();
  await page.waitForLoadState("networkidle");

  assert.equal(count(calls, "/api/project-requests") - before.requests, 1, "Actualizar solicitudes lee una vez");
  assert.equal(projectPages(calls) - before.projects, 2, "Actualizar proyectos recorre una vez sus dos páginas");
});

test("Home: salir de la vista cancela las lecturas pendientes", async (context) => {
  // Se entra a Home desde la galería con las lecturas retenidas y se sale antes de que respondan.
  const scenario = { delay: false };
  const respond = ({ path, search }) => {
    const isViewRead = path === "/api/project-requests" || (path === "/api/projects" && isFullListPage({ search }));
    return scenario.delay && isViewRead ? { delayMs: 1500 } : null;
  };
  const { held, isFinished, page } = await openClientPage(context, "/proyectos", "Museo Público", respond);
  scenario.delay = true;
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await waitUntil(page, () => held.some((call) => call.path === "/api/projects") && held.some((call) => call.path === "/api/project-requests"));
  const pending = [...held];
  await page.getByRole("button", { name: "Configuraciones", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/configuraciones");
  await page.waitForTimeout(2000);

  assert.ok(pending.some((call) => call.path === "/api/projects"), "Home inició la lectura de proyectos");
  assert.ok(pending.some((call) => call.path === "/api/project-requests"), "Home inició la lectura de solicitudes");
  assert.deepEqual(pending.filter(isFinished).map((call) => call.path), [], "Ninguna lectura abandonada se completa");
});

test("Galería: la carga inicial completa una sola lectura", async (context) => {
  const { calls } = await openClientPage(context, "/proyectos", "Museo Público");
  assert.equal(projectReads(calls), 1);
});

test("Galería: confirmar la misma sesión no relee los proyectos", async (context) => {
  const { calls, page } = await openClientPage(context, "/proyectos", "Museo Público", rejectProbe);
  const before = { me: count(calls, "/api/auth/me"), projects: projectReads(calls) };
  await triggerSessionConfirmation(page);
  await waitUntil(page, () => count(calls, "/api/auth/me") > before.me);
  await settle(page);
  assert.equal(projectReads(calls), before.projects, `Lecturas tras confirmar la misma sesión: ${projectReads(calls) - before.projects}`);
  assert.equal(await page.getByText("Museo Público", { exact: true }).first().isVisible(), true);
});

test("Galería: un 401 persistente no provoca un bucle de lecturas", async (context) => {
  const respond = ({ path, search }) => (path === "/api/projects" && search.cursor === "p2" ? UNAUTHENTICATED : null);
  const { calls, page } = await openClientPage(context, "/proyectos", "No pudimos cargar los proyectos", respond);
  await page.waitForTimeout(2000);
  assert.equal(projectReads(calls), 2, `Lecturas de proyectos con 401 persistente: ${projectReads(calls)}`);
  assert.equal(count(calls, "/api/auth/me"), 3, `/auth/me: restauración inicial + una por cada 401 (${count(calls, "/api/auth/me")})`);
});

test("Galería: un cambio de rol relee los proyectos", async (context) => {
  const { backend, calls, page } = await openClientPage(context, "/proyectos", "Museo Público", rejectProbe);
  const before = projectReads(calls);
  backend.state.role = "architect";
  await triggerSessionConfirmation(page);
  await waitUntil(page, () => projectReads(calls) > before);
  await page.waitForLoadState("networkidle");
  await settle(page);
  assert.equal(projectReads(calls), before + 1);
});

test("Galería: cambiar de cuenta cancela la lectura de la cuenta anterior y no la muestra", async (context) => {
  // La primera cuenta pide proyectos con una respuesta lenta; mientras tanto la sesión pasa a
  // otra cuenta, cuya lectura responde de inmediato. RecentProjectsProvider ya remonta el árbol al
  // cambiar de cuenta, así que la respuesta antigua nunca se pintaba, pero sí se completaba.
  const scenario = { delayed: false };
  const respond = (call) => {
    if (call.path === "/api/projects" && isFullListPage(call) && !call.search.cursor && !scenario.delayed) {
      scenario.delayed = true;
      return { delayMs: 3000 };
    }
    return rejectProbe(call);
  };
  const { backend, held, isFinished, page } = await openClientPage(context, "/proyectos", "Cargando proyectos públicos", respond, { waitForIdle: false });
  await waitUntil(page, () => held.length > 0);
  backend.state.account = "ana";
  await triggerSessionConfirmation(page);
  await page.getByText("Vitrina Ana", { exact: true }).first().waitFor();
  // La respuesta antigua se entrega a los 3 s de recibirse; se espera a que haya llegado.
  await page.waitForTimeout(3500);
  // "Vitrina Diego" solo aparece si la respuesta antigua, calculada para Diego, sustituyó la de Ana.
  const shown = (await page.locator("article h2").allTextContents()).sort();
  assert.deepEqual(shown, ["Museo Público", "Vitrina Ana"], `Proyectos mostrados: ${shown.join(", ")}`);
  assert.equal(held.length, 1);
  assert.equal(isFinished(held[0]), false, "La lectura de la cuenta anterior se canceló");
});

test("Galería: salir de la vista cancela la lectura pendiente", async (context) => {
  const scenario = { delay: false };
  const respond = ({ path, search }) => (scenario.delay && path === "/api/projects" && isFullListPage({ search }) ? { delayMs: 1500 } : null);
  const { held, isFinished, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", respond);
  scenario.delay = true;
  await page.getByRole("button", { name: "Ver más proyectos", exact: true }).first().click();
  await waitUntil(page, () => held.length > 0);
  const pending = [...held];
  await page.getByRole("button", { name: "Configuraciones", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/configuraciones");
  await page.waitForTimeout(2000);
  assert.ok(pending.length > 0, "La galería inició su lectura");
  assert.deepEqual(pending.filter(isFinished).map((call) => call.path), [], "La lectura abandonada de la galería no se completa");
});

// --- Reintento acotado tras confirmar la sesión (validación final de Fase 3) ---------------------

/**
 * Responde 401 a las `times` primeras peticiones que cumplan `matches` y deja pasar el resto.
 *
 * @param {Function} matches - Recibe la petición (`path`, `search`, `backend`).
 * @param {number} [times=1] - Número de rechazos.
 * @returns {Function} Respuesta para openClientPage.
 */
const rejectFirst = (matches, times = 1) => {
  let remaining = times;
  return (call) => {
    if (remaining > 0 && matches(call)) {
      remaining -= 1;
      return UNAUTHENTICATED;
    }
    return null;
  };
};
/**
 * Rechaza con 401 las lecturas que cumplan `matches` hasta que la aplicación pide la confirmación
 * de sesión (/auth/me tras la restauración inicial). Así el rechazo no se gasta en la lectura que
 * el StrictMode de desarrollo aborta al montar, cuyo 401 nunca llega a la aplicación.
 *
 * @param {Function} matches - Recibe la petición.
 * @param {Function} [onReject] - Se ejecuta en cada rechazo (por ejemplo, para cambiar de cuenta).
 * @returns {Function} Respuesta para openClientPage.
 */
const rejectUntilConfirmation = (matches, onReject = () => {}) => {
  let meRequests = 0;
  return (call) => {
    if (call.path === "/api/auth/me") meRequests += 1;
    if (meRequests < 2 && matches(call)) {
      onReject(call);
      return UNAUTHENTICATED;
    }
    return null;
  };
};
const isFirstFullListPage = ({ path, search }) => path === "/api/projects" && isFullListPage({ search }) && !search.cursor;

test("Home: un 401 transitorio confirmado se reintenta una vez y recupera los datos", async (context) => {
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Museo Público", rejectUntilConfirmation(isFirstFullListPage));
  await settle(page);
  assert.equal(projectReads(calls), 2, "Lectura rechazada + un reintento");
  assert.equal(count(calls, "/api/auth/me"), 2, "Restauración + una confirmación, sin comprobaciones extra");
  assert.equal(requestReads(calls), 1, "Las solicitudes no se releen");
  assert.equal(await page.getByText("No pudimos cargar los proyectos", { exact: true }).count(), 0);
});

test("Home: un 401 transitorio en la primera página de solicitudes se recupera con un reintento", async (context) => {
  const respond = rejectUntilConfirmation(({ path, search }) => path === "/api/project-requests" && !search.cursor);
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", respond);
  await settle(page);
  assert.equal(requestReads(calls), 2);
  assert.equal(projectReads(calls), 1, "La confirmación no relee proyectos");
});

test("Home: un 401 transitorio en «Cargar más» reintenta esa página y conserva la paginación", async (context) => {
  const scenario = { reject: false };
  const respond = (call) => {
    if (scenario.reject && call.path === "/api/project-requests" && call.search.cursor === "r2") {
      scenario.reject = false;
      return UNAUTHENTICATED;
    }
    return null;
  };
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", respond);
  scenario.reject = true;
  await page.getByRole("button", { name: "Cargar más", exact: true }).click();
  await page.getByText("Solicitud Dos", { exact: true }).waitFor();
  await settle(page);
  assert.equal(count(calls, "/api/project-requests", (call) => call.search.cursor === "r2"), 2, "Página adicional + un reintento");
  assert.equal(requestReads(calls), 1, "La primera página no se relee");
  assert.equal(projectReads(calls), 1);
  assert.equal(await page.getByText("Solicitud Uno", { exact: true }).isVisible(), true, "Conserva la página ya cargada");
  assert.equal(await page.getByText("No se pudieron cargar más solicitudes.", { exact: true }).count(), 0);
});

test("Home: una sesión realmente expirada lleva al login sin reintentar", async (context) => {
  const scenario = { expired: false };
  const respond = ({ path, search }) => {
    if (!scenario.expired) return null;
    if (path === "/api/auth/me" || (path === "/api/projects" && isFullListPage({ search }))) return UNAUTHENTICATED;
    return null;
  };
  const { calls, page } = await openClientPage(context, "/proyectos", "Museo Público", respond);
  scenario.expired = true;
  const before = projectReads(calls);
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/");
  await settle(page);
  assert.equal(projectReads(calls) - before, 1, "Solo la lectura rechazada: sin reintento con la sesión expirada");
});

test("Home: si la confirmación trae otra cuenta, no se reintenta la lectura de la anterior", async (context) => {
  const respond = rejectUntilConfirmation(isFirstFullListPage, (call) => {
    call.backend.state.account = "ana";
  });
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Ana", respond);
  await page.getByText("Casa Ana 51", { exact: true }).first().waitFor();
  await settle(page);
  // La lectura rechazada (Diego) y la de Ana por el cambio de ámbito; ningún reintento adicional.
  assert.equal(count(calls, "/api/auth/me"), 2);
  assert.equal(projectReads(calls), 2, `Lecturas de proyectos: ${projectReads(calls)}`);
  assert.equal(await page.getByText("Casa Diego 50", { exact: true }).count(), 0);
});

test("Galería: un 401 transitorio confirmado se reintenta una vez y recupera los datos", async (context) => {
  const { calls, page } = await openClientPage(context, "/proyectos", "Museo Público", rejectFirst(isFirstFullListPage));
  await settle(page);
  assert.equal(projectReads(calls), 2);
  assert.equal(count(calls, "/api/auth/me"), 2);
});

test("Galería: salir de la vista cancela el reintento en curso", async (context) => {
  const scenario = { phase: "idle" };
  const respond = (call) => {
    if (!isFirstFullListPage(call) || scenario.phase === "idle") return null;
    if (scenario.phase === "reject") {
      scenario.phase = "hold";
      return UNAUTHENTICATED;
    }
    return { delayMs: 1500 };
  };
  const { held, isFinished, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", respond);
  scenario.phase = "reject";
  await page.getByRole("button", { name: "Ver más proyectos", exact: true }).first().click();
  await waitUntil(page, () => held.length > 0);
  const pending = [...held];
  await page.getByRole("button", { name: "Configuraciones", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/configuraciones");
  await page.waitForTimeout(2000);
  assert.equal(pending.length, 1, "Se inició exactamente un reintento");
  assert.equal(isFinished(pending[0]), false, "El reintento abandonado no se completa");
});

test("Galería: salir antes de la confirmación descarta el reintento programado", async (context) => {
  const scenario = { phase: "idle" };
  const respond = (call) => {
    if (scenario.phase === "idle") return null;
    if (call.path === "/api/auth/me") return { delayMs: 1000 };
    if (isFirstFullListPage(call) && scenario.phase === "reject") {
      scenario.phase = "rejected";
      return UNAUTHENTICATED;
    }
    return null;
  };
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", respond);
  const before = projectReads(calls);
  scenario.phase = "reject";
  await page.getByRole("button", { name: "Ver más proyectos", exact: true }).first().click();
  await waitUntil(page, () => scenario.phase === "rejected");
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/dashboard-clientes");
  await page.waitForTimeout(2000);
  // La galería hizo una lectura (rechazada) y Home, al montarse de nuevo, otra; la galería
  // abandonada no reintenta aunque la confirmación llegue después.
  assert.equal(projectReads(calls) - before, 2, `Lecturas tras salir: ${projectReads(calls) - before}`);
});

test("Galería: una confirmación ajena y tardía no ejecuta el reintento pendiente", async (context) => {
  // La lectura recibe 401 y su confirmación falla (/auth/me 503 en todos los intentos), así que
  // AuthContext no publica nada. Pasada la ventana de confirmación, otro 401 ajeno sí se confirma:
  // ese objeto `user` nuevo no debe relanzar la lectura original.
  const scenario = { phase: "idle" };
  const respond = (call) => {
    if (scenario.phase === "reject" && isFirstFullListPage(call)) {
      scenario.phase = "unavailable";
      return UNAUTHENTICATED;
    }
    if (scenario.phase === "unavailable" && call.path === "/api/auth/me") {
      return { status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "No disponible." } };
    }
    return rejectProbe(call);
  };
  const { calls, page } = await openClientPage(context, "/dashboard-clientes", "Solicitud Uno", respond);
  scenario.phase = "reject";
  await page.getByRole("button", { name: "Ver más proyectos", exact: true }).first().click();
  await page.getByText("No pudimos cargar los proyectos", { exact: true }).first().waitFor();
  await waitUntil(page, () => count(calls, "/api/auth/me", () => true) >= 4);
  await settle(page);
  const before = projectReads(calls);

  scenario.phase = "available";
  await page.waitForTimeout(SESSION_CONFIRMATION_WINDOW_MS + 500);
  const meBefore = count(calls, "/api/auth/me");
  await triggerSessionConfirmation(page);
  await waitUntil(page, () => count(calls, "/api/auth/me") > meBefore);
  await settle(page);

  assert.equal(projectReads(calls), before, "La confirmación ajena no relanza la lectura fallida");
  assert.equal(await page.getByText("No pudimos cargar los proyectos", { exact: true }).first().isVisible(), true);
});
