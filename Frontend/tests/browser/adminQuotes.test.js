import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { buildQuoteDocument } from "../../../Backend/src/domain/quoteDocument.js";
import { calculateQuoteTotals } from "../../../Backend/src/domain/quoteTotals.js";
import { loadQuotePdfAssets } from "../../../Backend/src/services/quotePdfAssets.js";
import { renderQuotePdf } from "../../../Backend/src/services/quotePdfRenderer.js";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Pestaña Cotizaciones y formulario de cotización (Figma 5771:488497 y 5771:452483) sobre un
// backend simulado con la forma del contrato: datos en memoria, importes calculados con el motor
// real del backend y PDF generado por su maquetación real. Nunca usa Supabase ni datos de Figma.

let browser;
let server;
let origin;

const SERVICES = [
  { code: "SERV-001", currency: "USD", currentVersion: 1, description: "Planos y memoria descriptiva.", id: 1, isActive: true, kind: "individual", kindLocked: false, measurementUnit: { allowsDecimals: true, code: "square_meter", id: 1, isActive: true, name: "Metro cuadrado", symbol: "m²" }, name: "Anteproyecto arquitectónico", referenceRate: "12.00", sortOrder: 1, unitDenomination: { denomination: "de construcción", id: 10, isActive: true }, unitLabel: "m² de construcción" },
  { code: "SERV-002", currency: "USD", currentVersion: 1, description: null, id: 2, isActive: true, kind: "individual", kindLocked: false, measurementUnit: { allowsDecimals: false, code: "point", id: 30, isActive: true, name: "Punto", symbol: "pt." }, name: "Puntos eléctricos y fuerza", referenceRate: "45.00", sortOrder: 2, unitDenomination: { denomination: "eléctrico", id: 12, isActive: true }, unitLabel: "pt. eléctrico" },
  { code: "SERV-003", currency: "USD", currentVersion: 1, description: null, id: 3, isActive: false, kind: "individual", kindLocked: false, measurementUnit: { allowsDecimals: true, code: "square_meter", id: 1, isActive: true, name: "Metro cuadrado", symbol: "m²" }, name: "Servicio retirado", referenceRate: "8.00", sortOrder: 3, unitDenomination: null, unitLabel: "m²" },
];
const CLIENTS = [
  { companyName: null, contactUser: null, email: "leonel@example.test", id: 3, name: "Leonel Pérez" },
  { companyName: "Arca", contactUser: null, email: "jane@example.test", id: 4, name: "Jane Smith" },
];
const PROJECTS = { 3: [{ id: 9, name: "Apto. 910", status: "pending" }], 4: [{ id: 10, name: "Casa Jane", status: "pending" }] };

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
 * Construye una cotización con la forma de `GET /admin/quotes/:id`, con los importes calculados
 * por el motor real del backend.
 *
 * @param {number} id - Identificador.
 * @param {Object} payload - Cuerpo de alta o edición.
 * @param {number} version - Versión vigente.
 * @param {string} createdAt - Fecha de creación.
 * @returns {Object} Cotización.
 */
function buildQuote(id, payload, version, createdAt) {
  const totals = calculateQuoteTotals({ items: payload.items, referenceVat: { enabled: false } });
  const client = CLIENTS.find((candidate) => candidate.id === payload.clientId);
  const project = PROJECTS[payload.clientId].find((candidate) => candidate.id === payload.projectId);
  return {
    client: { id: client.id, name: client.name },
    code: `COT-${String(id).padStart(3, "0")}`,
    createdAt,
    createdBy: { id: 1, name: "Ana Admin" },
    currency: "USD",
    currentVersion: version,
    id,
    items: payload.items.map((item, index) => {
      const service = SERVICES.find((candidate) => candidate.id === item.serviceId);
      return {
        lineNumber: index + 1,
        quantity: totals.items[index].quantity,
        referenceRate: service.referenceRate,
        service: { code: service.code, description: service.description, id: service.id, isActive: service.isActive, kind: service.kind, name: service.name, versionId: service.id * 10 },
        subtotal: totals.items[index].subtotal,
        unit: { allowsDecimals: service.measurementUnit.allowsDecimals, label: service.unitLabel },
        unitRate: totals.items[index].unitRate,
      };
    }),
    notes: payload.notes ?? null,
    project: { id: project.id, name: project.name },
    servicesTotal: totals.servicesTotal,
    updatedAt: createdAt,
    version: { createdAt, createdBy: { hasProfilePhoto: false, id: 1, name: "Ana Admin" }, id: version },
  };
}

/**
 * Backend simulado de cotizaciones con estado en memoria y registro de peticiones.
 *
 * @param {Object} [options] - Fallos inyectados por operación (`PATCH /api/admin/quotes/:id`).
 * @returns {Object} Estado y manejador de rutas.
 */
function createBackend({ failures = {} } = {}) {
  const state = {
    quotes: [
      buildQuote(1, { clientId: 3, items: [{ quantity: "200", serviceId: 1, unitRate: "12" }, { quantity: "35", serviceId: 2, unitRate: "45" }], notes: "Incluye visitas.", projectId: 9 }, 1, "2026-03-23T15:00:00.000Z"),
      buildQuote(2, { clientId: 4, items: [{ quantity: "10", serviceId: 1, unitRate: "12" }], projectId: 10 }, 1, "2026-04-12T15:00:00.000Z"),
    ],
    requests: [],
  };
  let pdfAssets;

  const json = (route, status, body) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname: path } = url;
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    state.requests.push({ body, method, path, search: Object.fromEntries(url.searchParams) });
    const operation = `${method} ${path.replace(/\/\d+(?=\/|$)/g, "/:id")}`;
    if (failures[operation]) return json(route, failures[operation].status, failures[operation].body);

    if (path === "/api/auth/me") return json(route, 200, { user: { email: "ana@example.test", firstName: "Ana", id: 1, lastName: "Admin", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { nextCursor: null, projects: [] });
    if (path === "/api/admin/services") return json(route, 200, { nextCursor: null, services: SERVICES });
    if (path === "/api/admin/quotes/summary") return json(route, 200, { summary: { total: state.quotes.length } });
    if (path === "/api/admin/quotes/clients") {
      const search = (url.searchParams.get("search") || "").toLowerCase();
      return json(route, 200, { clients: CLIENTS.filter((client) => client.name.toLowerCase().includes(search)), nextCursor: null });
    }
    const projectsMatch = /^\/api\/admin\/quotes\/clients\/(\d+)\/projects$/.exec(path);
    if (projectsMatch) return json(route, 200, { nextCursor: null, projects: PROJECTS[projectsMatch[1]] || [] });
    if (path === "/api/admin/quotes" && method === "GET") {
      let quotes = [...state.quotes];
      const search = (url.searchParams.get("search") || "").toLowerCase();
      if (search) quotes = quotes.filter((quote) => `${quote.code} ${quote.client.name} ${quote.project.name}`.toLowerCase().includes(search));
      if (url.searchParams.get("sort") === "total") quotes.sort((left, right) => Number(left.servicesTotal) - Number(right.servicesTotal));
      if (url.searchParams.get("direction") === "desc") quotes.reverse();
      return json(route, 200, { nextCursor: null, quotes });
    }
    if (path === "/api/admin/quotes" && method === "POST") {
      const quote = buildQuote(state.quotes.length + 1, body, 1, new Date().toISOString());
      state.quotes.push(quote);
      return json(route, 201, { message: "Cotización creada correctamente.", quote });
    }
    const pdfMatch = /^\/api\/admin\/quotes\/(\d+)\/pdf$/.exec(path);
    if (pdfMatch) {
      const quote = state.quotes.find((candidate) => candidate.id === Number(pdfMatch[1]));
      pdfAssets ??= await loadQuotePdfAssets();
      const chunks = [];
      for await (const chunk of renderQuotePdf(buildQuoteDocument(quote, { timeZone: url.searchParams.get("timeZone") }), pdfAssets)) chunks.push(chunk);
      return route.fulfill({ body: Buffer.concat(chunks), contentType: "application/pdf", headers: { "Content-Disposition": `attachment; filename="${quote.code}.pdf"` }, status: 200 });
    }
    const quoteMatch = /^\/api\/admin\/quotes\/(\d+)$/.exec(path);
    if (quoteMatch) {
      const index = state.quotes.findIndex((candidate) => candidate.id === Number(quoteMatch[1]));
      if (index < 0) return json(route, 404, { code: "QUOTE_NOT_FOUND", message: "La cotización solicitada no existe." });
      if (method === "GET") return json(route, 200, { quote: state.quotes[index] });
      const current = state.quotes[index];
      const { expectedVersion, ...content } = body;
      if (expectedVersion !== current.currentVersion) return json(route, 409, { code: "QUOTE_VERSION_CONFLICT", message: "Otro administrador modificó esta cotización. Recarga los datos antes de guardar." });
      state.quotes[index] = buildQuote(current.id, content, current.currentVersion + 1, current.createdAt);
      return json(route, 200, { changed: true, message: "Cotización actualizada correctamente.", quote: state.quotes[index] });
    }
    state.requests.push({ method, path, unexpected: true });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Ruta no simulada" });
  };
  return state;
}

/**
 * Abre el módulo con sesión de administrador; vigila errores de página y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} backend - Backend de createBackend.
 * @param {Object} [options] - Ruta, viewport y tema.
 * @returns {Promise<import("playwright").Page>} Página cargada.
 */
async function openQuotes(context, backend, { path = "/servicios-cotizaciones/cotizaciones", theme = "light", viewport = { height: 1000, width: 1440 } } = {}) {
  const browserContext = await browser.newContext({ timezoneId: "America/Caracas", viewport });
  const page = applyBrowserTimeouts(await browserContext.newPage());
  await page.addInitScript((value) => localStorage.setItem("arca-theme", value), theme);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), backend.handle);
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(backend.requests.filter((request) => request.unexpected), []);
  });
  await page.goto(`${origin}${path}`);
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return page;
}

const listRequests = (backend) => backend.requests.filter((request) => request.method === "GET" && request.path === "/api/admin/quotes");

test("listado: filas reales, indicador, orden por Total, búsqueda e intervalo de fechas en la API", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend);
  await page.getByRole("rowheader", { name: "COT-001" }).waitFor();
  const cells = await page.locator("tbody tr").first().locator("td, th").allInnerTexts();
  assert.deepEqual(cells.slice(1, 6), ["COT-001", "Leonel Pérez", "Apto. 910", "23/03/2026", "$3,975.00"]);
  const metrics = page.getByLabel("Indicadores de servicios y cotizaciones");
  assert.equal((await metrics.locator("strong").allTextContents())[3], "2");

  await page.getByRole("button", { name: "Ordenar por Total" }).click();
  await page.waitForFunction(() => document.querySelector("tbody tr th")?.textContent === "COT-002");
  assert.equal(await page.locator("th[aria-sort=ascending]").innerText(), "Total");
  assert.deepEqual(listRequests(backend).at(-1).search, { direction: "asc", limit: "10", sort: "total" });

  await page.getByRole("textbox", { name: "Buscar cotizaciones por número, cliente o proyecto" }).fill("jane");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  assert.equal(listRequests(backend).at(-1).search.search, "jane");

  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);

  await page.getByRole("button", { name: /^Filtrar cotizaciones por fecha/ }).click();
  const picker = page.getByRole("dialog", { name: "Seleccionar intervalo de fechas" });
  await picker.waitFor();
  const firstMonth = picker.getByRole("grid").first();
  const monthTitle = await firstMonth.getAttribute("aria-label");
  await firstMonth.getByRole("button").nth(9).click();
  await firstMonth.getByRole("button").nth(14).click();
  await picker.getByRole("button", { name: "Seleccionar" }).click();
  await picker.waitFor({ state: "detached" });
  const { createdBefore, createdFrom } = listRequests(backend).at(-1).search;
  assert.ok(createdFrom && createdBefore, `Intervalo enviado para ${monthTitle}`);
  // Seis días locales de Caracas (UTC−4): del día 10 a las 00:00 al día 16 a las 00:00.
  assert.equal(Date.parse(createdBefore) - Date.parse(createdFrom), 6 * 24 * 3600 * 1000);
  assert.match(createdFrom, /T04:00:00\.000Z$/);
});

test("visor: PDF real del backend en el visor PDF.js, con archivo, peso y acciones Cerrar y Editar", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend);
  const trigger = page.getByRole("button", { name: "Ver COT-001" });
  await trigger.click();
  const viewer = page.locator("[data-quote-pdf-viewer]");
  await viewer.getByText("COT-001.pdf", { exact: true }).waitFor();
  await viewer.locator("canvas[aria-label='Cotización COT-001, página 1']").waitFor();
  assert.match(await viewer.innerText(), /\d+KB • 23 Mar 2026/);
  const pdfRequest = backend.requests.find((request) => request.path === "/api/admin/quotes/1/pdf");
  assert.equal(pdfRequest.search.timeZone, "America/Caracas");

  await viewer.getByRole("button", { name: "Cerrar" }).click();
  await viewer.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, "El foco vuelve a la fila");

  await trigger.click();
  await viewer.getByRole("button", { name: "Editar" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones/1/editar`);
});

test("alta: validación local, cliente y proyecto reales, servicios del tabulador, total y POST exacto", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend);
  await page.getByRole("button", { name: "Nueva cotización" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones/nueva`);
  await page.getByRole("navigation", { name: "Ruta de navegación" }).getByText("Nueva cotización").waitFor();

  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Selecciona el cliente de la cotización.").waitFor();
  await page.getByText("Añade al menos un servicio a la cotización.").waitFor();
  assert.equal(backend.requests.some((request) => request.method === "POST"), false, "Un borrador inválido no se envía");

  await page.locator("#quote-client").fill("Leo");
  await page.getByRole("button", { name: /Leonel Pérez/ }).first().click();
  await page.locator("#quote-project").click();
  await page.getByRole("button", { name: /Apto\. 910/ }).first().click();

  // El servicio inactivo no se ofrece en cotizaciones nuevas.
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  assert.equal(await picker.getByText("Servicio retirado").count(), 0);
  await picker.getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).click();
  await picker.getByRole("checkbox", { name: "Seleccionar Puntos eléctricos y fuerza" }).click();
  await picker.getByText("2 de 2 seleccionados").waitFor();
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();
  await picker.getByRole("checkbox", { name: "Anteproyecto arquitectónico ya está incluido" }).waitFor();

  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).fill("200");
  await page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" }).fill("2.5");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("La unidad de este servicio solo admite cantidades enteras.").waitFor();
  await page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" }).fill("35");
  await page.getByText("$3,975.00", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Observaciones (opcional)" }).fill("  Incluye dos visitas.  ");

  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Has creado la cotización exitosamente").waitFor();
  const posts = backend.requests.filter((request) => request.method === "POST" && request.path === "/api/admin/quotes");
  assert.equal(posts.length, 1, "Una sola alta");
  assert.deepEqual(posts[0].body, {
    clientId: 3,
    items: [{ quantity: "200", serviceId: 1, unitRate: "12" }, { quantity: "35", serviceId: 2, unitRate: "45" }],
    notes: "Incluye dos visitas.",
    projectId: 9,
  });

  await page.getByRole("button", { name: "Aceptar" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  await page.getByText("Cotización creada", { exact: true }).waitFor();
  await page.getByRole("rowheader", { name: "COT-003" }).waitFor();
});

test("cancelar: con cambios pide confirmación y «Volver» conserva el borrador", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  await page.getByRole("region", { name: "Seleccionar servicios" }).getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).click();
  await page.getByRole("button", { name: "Agregar seleccionados" }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
  const dialog = page.locator("[data-quote-discard-dialog]");
  await dialog.getByText("¿Deseas cancelar la cotización?").waitFor();
  await dialog.getByRole("button", { name: "Volver" }).click();
  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
  await dialog.getByRole("button", { name: "Cancelar cotización" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  assert.equal(backend.requests.some((request) => request.method === "POST"), false);
});

test("edición: datos guardados, PATCH con expectedVersion y conflicto de versión sin perder el borrador", async (context) => {
  const backend = createBackend({ failures: { "PATCH /api/admin/quotes/:id": { body: { code: "QUOTE_VERSION_CONFLICT", message: "Otro administrador modificó esta cotización. Recarga los datos antes de guardar." }, status: 409 } } });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/1/editar" });
  await page.getByRole("heading", { level: 1, name: "Cotización" }).waitFor();
  const quantity = page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" });
  await quantity.waitFor();
  assert.equal(await quantity.inputValue(), "200");
  await page.getByText("$3,975.00", { exact: true }).waitFor();
  await quantity.fill("100");
  await page.getByRole("button", { name: "Actualizar" }).click();
  await page.getByText("La cotización cambió mientras la editabas").waitFor();
  assert.equal(await quantity.inputValue(), "100", "El borrador se conserva");
  const patch = backend.requests.find((request) => request.method === "PATCH");
  assert.equal(patch.body.expectedVersion, 1);
  assert.deepEqual(patch.body.items[0], { quantity: "100", serviceId: 1, unitRate: "12" });
  await page.getByRole("button", { name: "Recargar cotización" }).waitFor();
});

test("responsive y tema oscuro: listado y formulario sin desplazamiento horizontal de la página", async (context) => {
  for (const viewport of [{ height: 812, width: 375 }, { height: 1024, width: 768 }, { height: 900, width: 1024 }]) {
    const backend = createBackend();
    const page = await openQuotes(context, backend, { theme: "dark", viewport });
    await page.getByRole("rowheader", { name: "COT-001" }).waitFor();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(await overflow(), 0, `Listado a ${viewport.width} px`);
    await page.getByRole("button", { name: "Nueva cotización" }).click();
    await page.getByRole("heading", { name: "Seleccionar servicios" }).waitFor();
    assert.equal(await overflow(), 0, `Formulario a ${viewport.width} px`);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
  }
});
