import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

const WIDTHS = [375, 768, 1024, 1440];
const DETAIL_PATH = "/api/admin/project-requests/9";
const SHELL_READS = new Set(["/api/auth/me", "/api/projects"]);
// Detalle ficticio con la forma de GET /admin/project-requests/:id (datos aislados).
const REQUEST = Object.freeze({
  assignees: [{ hasProfilePhoto: false, id: 5, name: "Ana Pérez", roleCode: "architect" }],
  capitalAvailability: "available_now",
  clientId: 3,
  compatibility: { level: "excellent", score: 92 },
  completeness: { answered: 12, applicable: 13, missingFields: ["experience"], score: 92.3 },
  convertedProject: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  decisionMaker: "self",
  description: "Remodelación integral de una vivienda con áreas abiertas y materiales sostenibles.",
  developmentMode: "full",
  files: [
    { createdAt: "2026-10-01T12:05:00.000Z", fileType: "application/pdf", id: 31, name: "plano.pdf", size: 2048 },
    { createdAt: "2026-10-01T12:06:00.000Z", fileType: "image/png", id: 32, name: "fachada.png", size: 5242880 },
  ],
  financialViability: {
    findings: [{ code: "CAPITAL_TIMING_MISMATCH", explanation: "El capital no coincide con el inicio previsto.", outcome: "REVIEW_REQUIRED" }],
    score: null,
    status: "REVIEW_REQUIRED",
  },
  formattedAddress: "Maracaibo, Zulia, Venezuela",
  hasPlans: true,
  id: 9,
  investmentRange: "10k_50k",
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"],
  location: "Maracaibo, Zulia",
  projectName: "Casa Prueba",
  projectSize: "medium_80_200",
  projectType: "residential",
  quality: "standard",
  referenceLink: "https://example.com/referencia",
  requestedBy: 11,
  reviewObservations: [],
  reviews: [{ meetingRecommendation: "SCHEDULE_MEETING", note: "Viable.", recommendation: "approve", reviewer: { id: 5, name: "Ana Pérez" }, updatedAt: "2026-10-02T12:00:00.000Z" }],
  standRequirements: null,
  startTime: "immediate",
  status: "pending_review",
});
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre la consulta real aislando HTTP: cualquier mutación o lectura no prevista falla la prueba.
 *
 * @param {Object} context - Contexto de node:test.
 * @param {Object} [options] - Ruta, tema, viewport, respuesta del detalle, otros detalles por ruta,
 *   rol de la sesión, reloj simulado y si una lectura no prevista debe fallar la prueba.
 * @returns {Promise<{page: import("playwright").Page, reads: Array<string>}>} Página y lecturas registradas.
 */
async function openPage(context, { clock = false, detail = { json: { projectRequest: REQUEST } }, extraDetails = {}, path = "/solicitudes-proyecto/9", role = "admin", state = null, strictReads = true, theme = "light", viewport = { height: 1000, width: 1440 }, waitFor = "Casa Prueba" } = {}) {
  const session = await browser.newContext({ viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  const reads = [];
  await page.addInitScript(({ theme, state }) => {
    localStorage.setItem("arca-theme", theme);
    if (state) history.replaceState({ usr: state, key: "test", idx: 0 }, "");
  }, { state, theme });
  page.on("pageerror", (error) => errors.push(error.message));
  if (clock) await page.clock.install();
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      errors.push(`Mutación no autorizada: ${pathname}`);
      return route.abort();
    }
    reads.push(pathname);
    if (pathname === DETAIL_PATH) {
      const response = typeof detail === "function" ? await detail(reads.filter((read) => read === DETAIL_PATH).length) : detail;
      return response === "abort" ? route.abort() : route.fulfill(response);
    }
    if (extraDetails[pathname]) return route.fulfill(extraDetails[pathname]);
    const payload = {
      "/api/auth/me": { user: { email: "admin@example.test", firstName: "Admin", id: 1, lastName: "Prueba", role, status: "active" } },
      "/api/admin/users/11": { user: { companyName: "Empresa Prueba", id: 11, name: "Cliente Prueba" } },
      // Lo solicita el proveedor compartido de proyectos recientes del shell, no la vista.
      "/api/projects": { nextCursor: null, projects: [] },
    }[pathname];
    if (!payload && strictReads) errors.push(`Lectura no prevista: ${pathname}`);
    return route.fulfill({ json: payload || {}, status: payload ? 200 : 404 });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}${path}`);
  await page.getByText(waitFor, { exact: true }).first().waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready);
  return { page, reads };
}

test("muestra la solicitud real con una única lectura y sin descargar adjuntos", async (context) => {
  const { page, reads } = await openPage(context);

  await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();
  await page.getByText("Proyecto Residencial", { exact: true }).waitFor();
  assert.equal(await page.getByRole("progressbar", { name: /^Compatibilidad: 92 de 100/ }).count(), 1);
  assert.equal(await page.locator("[aria-current='step']").innerText().then((text) => text.includes("Revisión")), true);
  // Coherencia financiera cualitativa en la posición del diseño: sin barra ni porcentaje.
  const financial = page.locator("[data-metric='financial-coherence']");
  assert.match(await financial.innerText(), /Requiere revisión financiera/);
  assert.doesNotMatch(await financial.innerText(), /%/);
  await page.getByText("92%", { exact: true }).last().waitFor();
  for (const text of ["$10,000 - $50,000 USD", "Disponible ahora", "plano.pdf", "fachada.png", "Responsables asignados", "Recomienda aprobar"]) {
    await page.getByText(text, { exact: true }).first().waitFor();
  }
  await page.getByRole("link", { name: "Dashboard" }).waitFor();
  assert.deepEqual(reads.filter((read) => !SHELL_READS.has(read)), [DETAIL_PATH]);
});

test("el resumen reutiliza el drawer y solo entonces consulta al cliente", async (context) => {
  const { page, reads } = await openPage(context);

  await page.getByRole("button", { name: "Ver resumen & recomendación" }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  await drawer.getByText("Cliente Prueba", { exact: true }).waitFor();
  await drawer.getByText("Agendar reunión", { exact: true }).waitFor();
  assert.equal(await drawer.getByRole("button", { name: "Ver solicitud" }).count(), 0);
  assert.deepEqual(reads.filter((read) => !SHELL_READS.has(read)), [DETAIL_PATH, "/api/admin/users/11"]);
});

test("responsive sin desbordamiento horizontal en claro y oscuro", async (context) => {
  for (const theme of ["light", "dark"]) {
    for (const width of WIDTHS) {
      const { page } = await openPage(context, { theme, viewport: { height: 900, width } });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${theme} ${width}px desborda ${overflow}px`);
      const visibleStages = await page.locator("section[aria-label='Solicitud de proyecto'] p:text-is('Revisión')").evaluateAll((nodes) => nodes.filter((node) => node.offsetParent).length);
      assert.equal(visibleStages, 1, `${theme} ${width}px etapa en curso visible`);
      await page.getByRole("group", { name: "Acciones de la solicitud" }).waitFor();
    }
  }
});

test("una solicitud convertida ofrece su proyecto y conserva el contexto de origen", async (context) => {
  const converted = { ...REQUEST, convertedProject: { id: 40, name: "Casa Prueba", publicSlug: "solicitud-9", status: "pending" }, status: "converted" };
  const { page } = await openPage(context, {
    detail: { json: { projectRequest: converted } },
    state: { from: { label: "Gestión", to: "/gestion-proyectos" } },
  });

  await page.getByText("Proyecto creado", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ver proyecto" }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Gestión" }).getAttribute("href"), "/gestion-proyectos");
});

test("estados de inexistencia, permisos, conexión y reintento", async (context) => {
  const notFound = await openPage(context, { detail: { json: { code: "PROJECT_REQUEST_NOT_FOUND", message: "No encontrada" }, status: 404 }, waitFor: "La solicitud no existe" });
  assert.equal(await notFound.page.getByRole("button", { name: "Reintentar" }).count(), 0);

  await openPage(context, { detail: { json: { code: "FORBIDDEN", message: "Sin permiso" }, status: 403 }, waitFor: "No tienes permisos para ver esta solicitud" });

  const invalid = await openPage(context, { path: "/solicitudes-proyecto/abc", waitFor: "La solicitud no existe" });
  assert.deepEqual(invalid.reads.filter((read) => !SHELL_READS.has(read)), []);

  const retry = await openPage(context, {
    detail: (attempt) => (attempt === 1 ? "abort" : { json: { projectRequest: REQUEST } }),
    waitFor: "No se pudo conectar con el servidor",
  });
  await retry.page.getByRole("button", { name: "Reintentar" }).click();
  await retry.page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();
});

// --- Fase 2: revalidación sin tiempo real ---

/** Promesa resoluble desde la prueba para retener una respuesta del detalle. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
/** Cuenta las lecturas del detalle registradas hasta el momento. */
function detailReads(reads, path = DETAIL_PATH) {
  return reads.filter((read) => read === path).length;
}
/** Espera a que el detalle se haya leído `count` veces. */
async function waitDetailReads(page, reads, count, path = DETAIL_PATH) {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (detailReads(reads, path) < count) {
    if (Date.now() > deadline) throw new Error(`Se esperaban ${count} lecturas de ${path}`);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

test("al volver a la pestaña revalida en segundo plano y avisa de cambios hechos por otra persona", async (context) => {
  const held = deferred();
  const converted = { ...REQUEST, convertedProject: { id: 40, name: "Casa Prueba", publicSlug: "solicitud-9", status: "pending" }, status: "converted" };
  const { page, reads } = await openPage(context, {
    clock: true,
    detail: (attempt) => (attempt === 1 ? { json: { projectRequest: REQUEST } } : held.promise),
  });
  const showTab = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  // Volver enseguida no repite la lectura (intervalo mínimo desde la carga).
  await showTab();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(detailReads(reads), 1);

  await page.clock.fastForward("00:31");
  await showTab();
  await waitDetailReads(page, reads, 2);
  // Mientras revalida se conserva lo mostrado, sin skeleton.
  await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();
  assert.equal(await page.getByLabel("Cargando solicitud").count(), 0);
  assert.equal(await page.getByText("Solicitud actualizada", { exact: true }).count(), 0);

  held.resolve({ json: { projectRequest: converted } });
  await page.getByText("Solicitud actualizada", { exact: true }).waitFor();
  await page.getByText(/Ahora está en estado «Proyecto creado»/).waitFor();
  await page.getByRole("button", { name: "Ver proyecto" }).waitFor();
  assert.equal(await page.getByText("Solicitud aprobada", { exact: true }).count(), 0);
});

test("sin cambios no avisa; un fallo conserva la solicitud y permite reintentar", async (context) => {
  const withNewReview = {
    ...REQUEST,
    reviews: [...REQUEST.reviews, { meetingRecommendation: "DO_NOT_SCHEDULE_MEETING", note: "Revisar costos.", recommendation: "request_changes", reviewer: { id: 6, name: "Luis Mora" }, updatedAt: "2026-10-03T12:00:00.000Z" }],
  };
  const responses = [{ json: { projectRequest: REQUEST } }, { json: { projectRequest: { ...REQUEST } } }, "abort", { json: { projectRequest: withNewReview } }];
  const { page, reads } = await openPage(context, { detail: (attempt) => responses[attempt - 1] });
  const reconnect = () => page.evaluate(() => window.dispatchEvent(new Event("online")));

  await reconnect();
  await waitDetailReads(page, reads, 2);
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByText("Solicitud actualizada", { exact: true }).count(), 0);

  await reconnect();
  await page.getByText("No se pudo actualizar la solicitud", { exact: true }).waitFor();
  await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();

  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByText("Solicitud actualizada", { exact: true }).waitFor();
  await page.getByText(/responsables o revisiones/).waitFor();
  // La revisión nueva se muestra sin recargar la vista.
  await page.getByText("Revisar costos.", { exact: true }).waitFor();
  assert.equal(detailReads(reads), 4);
});

test("si la solicitud deja de existir, la revalidación sustituye el contenido por su estado", async (context) => {
  const { page } = await openPage(context, {
    detail: (attempt) => (attempt === 1 ? { json: { projectRequest: REQUEST } } : { json: { code: "PROJECT_REQUEST_NOT_FOUND", message: "No encontrada" }, status: 404 }),
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText("La solicitud no existe", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).count(), 0);
  assert.equal(await page.getByText("No se pudo actualizar la solicitud", { exact: true }).count(), 0);
});

test("una revalidación tardía no sobrescribe otra solicitud tras navegar", async (context) => {
  const held = deferred();
  const otherPath = "/api/admin/project-requests/10";
  const { page, reads } = await openPage(context, {
    detail: (attempt) => (attempt === 1 ? { json: { projectRequest: REQUEST } } : held.promise),
    extraDetails: { [otherPath]: { json: { projectRequest: { ...REQUEST, id: 10, projectName: "Casa Diez" } } } },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitDetailReads(page, reads, 2);

  await page.evaluate(() => {
    history.pushState(history.state, "", "/solicitudes-proyecto/10");
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await page.getByRole("heading", { level: 1, name: "Casa Diez" }).waitFor();
  held.resolve({ json: { projectRequest: { ...REQUEST, projectName: "Respuesta obsoleta", status: "rejected" } } });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole("heading", { level: 1, name: "Casa Diez" }).count(), 1);
  assert.equal(await page.getByText("Respuesta obsoleta").count(), 0);
  assert.equal(await page.getByText("Solicitud actualizada", { exact: true }).count(), 0);
});

test("solo administradores: otro rol se redirige sin leer el detalle", async (context) => {
  const { page, reads } = await openPage(context, { role: "architect", strictReads: false, waitFor: "Solicitudes asignadas" });
  assert.notEqual(new URL(page.url()).pathname, "/solicitudes-proyecto/9");
  assert.equal(detailReads(reads), 0);
});
