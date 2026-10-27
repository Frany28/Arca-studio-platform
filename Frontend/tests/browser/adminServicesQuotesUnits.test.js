import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";
import { observeStatusDialog, readStatusDialogPalette } from "../helpers/statusConfirmationDialog.js";
import { assertHorizontalTableScroll, touchSwipeTable, waitForScrollBarSync } from "../helpers/horizontalTableScroll.js";

// Módulo «Servicios y cotizaciones» (Figma 5790:339391, 5771:487550, 5790:359521) contra un
// backend simulado con estado: nunca se usan Supabase ni datos reales.
const BASE_UNITS = [
  { id: 1, code: "square_meter", name: "Metro cuadrado", symbol: "m²", allowsDecimals: true, isActive: true, sortOrder: 101 },
  { id: 6, code: "linear_meter", name: "Metro lineal", symbol: "m.l.", allowsDecimals: true, isActive: true, sortOrder: 201 },
  { id: 13, code: "cubic_meter", name: "Metro cúbico", symbol: "m³", allowsDecimals: true, isActive: true, sortOrder: 301 },
  { id: 20, code: "hour", name: "Hora", symbol: "hrs", allowsDecimals: true, isActive: true, sortOrder: 601 },
  { id: 21, code: "unit", name: "Unidad", symbol: "und.", allowsDecimals: false, isActive: true, sortOrder: 501 },
  { id: 22, code: "piece", name: "Pieza", symbol: "pza.", allowsDecimals: false, isActive: true, sortOrder: 502 },
];
const SERVICES = [{ id: 1, isActive: true }, { id: 2, isActive: true }, { id: 3, isActive: false }];
const BASE_IN_USE_MESSAGE = "La unidad base no se puede cambiar porque la denominación ya se usa en servicios o en su historial. Crea otra denominación con la unidad deseada.";
const BASE_LOCKED_NOTE = "UNID-001 · La abreviatura no se puede cambiar porque esta unidad ya se usa en servicios o en su historial.";

let browser;
let server;
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
 * Crea una denominación simulada con la forma del contrato (publicCode generado como PostgreSQL).
 *
 * @param {number} id - Identificador.
 * @param {number} unitId - Unidad base.
 * @param {string} text - Denominación.
 * @param {Object} [overrides] - Campos sustituidos.
 * @returns {Object} Denominación.
 */
function denomination(id, unitId, text, overrides = {}) {
  const unit = BASE_UNITS.find((item) => item.id === unitId);
  return {
    id,
    publicCode: `UNID-${String(id).padStart(3, "0")}`,
    denomination: text,
    label: `${unit.symbol} ${text}`,
    isActive: true,
    activeServiceCount: 0,
    baseUnitEditable: true,
    measurementUnit: unit,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Backend simulado: aplica búsqueda literal y paginación por cursor sobre un arreglo en memoria,
 * crea, edita (texto y, si `baseUnitEditable`, unidad base) y cambia estado como el contrato, y
 * permite inyectar fallos por operación.
 *
 * @param {Array<Object>} initial - Denominaciones iniciales.
 * @returns {Object} Estado, registro de peticiones y manejador de rutas.
 */
function createBackend(initial) {
  const state = {
    items: initial.map((item) => ({ ...item })),
    nextId: Math.max(0, ...initial.map((item) => item.id)) + 1,
    requests: [],
    failures: {},
    delays: {},
    pageSize: null,
    // Catálogo base servido; las pruebas de scroll lo amplían a 48 unidades como el seed.
    baseUnits: BASE_UNITS,
  };
  const json = (route, status, body) => route.fulfill({ status, json: body });

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    state.requests.push({ method, path, search: url.search, body });
    const operation = `${method} ${path.replace(/\d+/g, ":id")}`;
    const failure = state.failures[operation];
    const delay = state.delays[operation] ?? state.delays[url.searchParams.get("search") ?? ""];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    if (path === "/api/auth/me") return json(route, 200, { user: { id: 1, firstName: "Ana", lastName: "Admin", email: "ana@example.test", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { projects: [], nextCursor: null });
    // `abort` simula un fallo de red: fetch rechaza sin respuesta HTTP.
    if (failure) return failure.abort ? route.abort("failed") : json(route, failure.status, failure.body);
    if (path === "/api/admin/services") return json(route, 200, { services: SERVICES, nextCursor: null });
    if (path === "/api/admin/quotes") return json(route, 200, { quotes: [], nextCursor: null });
    if (path === "/api/admin/quotes/summary") return json(route, 200, { summary: { total: 24 } });
    if (path === "/api/admin/measurement-units") return json(route, 200, { measurementUnits: state.baseUnits });
    // Gestión de usuarios: solo para abrir el selector telefónico de referencia del modal «Nuevo usuario».
    if (path === "/api/admin/users") return json(route, 200, { users: [], nextCursor: null, metrics: { total: 0, active: 0, suspended: 0, disabled: 0 } });
    if (path === "/api/admin/roles") return json(route, 200, { roles: [{ id: 1, code: "client", name: "Cliente" }] });

    if (path === "/api/admin/measurement-unit-denominations" && method === "GET") {
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const limit = Number(url.searchParams.get("limit") || 25);
      const start = Number(url.searchParams.get("cursor") || 0);
      const matches = state.items.filter((item) => !search
        || [item.publicCode, item.denomination, item.measurementUnit.symbol].some((text) => text.toLowerCase().includes(search)));
      const page = matches.slice(start, start + limit);
      return json(route, 200, { unitDenominations: page, nextCursor: start + limit < matches.length ? String(start + limit) : null });
    }
    if (path === "/api/admin/measurement-unit-denominations" && method === "POST") {
      const created = denomination(state.nextId, body.measurementUnitId, body.denomination);
      state.nextId += 1;
      state.items.unshift(created);
      return json(route, 201, { message: "Unidad de medida creada correctamente.", unitDenomination: created });
    }
    const match = /^\/api\/admin\/measurement-unit-denominations\/(\d+)(\/status)?$/.exec(path);
    if (match && method === "PATCH") {
      const item = state.items.find((candidate) => candidate.id === Number(match[1]));
      if (!item) return json(route, 404, { code: "MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND", message: "La denominación seleccionada no existe." });
      if (match[2]) item.isActive = body.isActive;
      else {
        if (body.measurementUnitId !== undefined && body.measurementUnitId !== item.measurementUnit.id) {
          if (!item.baseUnitEditable) return json(route, 409, { code: "MEASUREMENT_UNIT_BASE_IN_USE", message: BASE_IN_USE_MESSAGE });
          item.measurementUnit = state.baseUnits.find((unit) => unit.id === body.measurementUnitId);
        }
        Object.assign(item, { denomination: body.denomination, label: `${item.measurementUnit.symbol} ${body.denomination}` });
      }
      return json(route, 200, { changed: true, message: "Unidad de medida actualizada correctamente.", unitDenomination: { ...item } });
    }
    state.requests.push({ unexpected: true, method, path });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" });
  };
  return state;
}

/**
 * Abre el módulo con sesión de administrador y el backend simulado; vigila errores de página
 * y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} backend - Backend de createBackend.
 * @param {Object} [options] - Viewport, tema y soporte táctil (`hasTouch`, para gestos con el dedo).
 * @returns {Promise<import("playwright").Page>} Página.
 */
async function openModule(context, backend, { path = "/servicios-cotizaciones", theme = "light", viewport = { width: 1440, height: 1000 }, hasTouch = false } = {}) {
  const browserContext = await browser.newContext({ viewport, hasTouch });
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
  return page;
}

/**
 * Abre «Nuevo usuario» desde /usuarios para comparar con su selector telefónico. La primera
 * visita a la ruta compila en frío su grafo de módulos en el servidor Vite del archivo, así que
 * el botón se espera con el límite de navegación; la interacción conserva el límite corto.
 *
 * @param {import("playwright").Page} page - Página recién abierta en /usuarios.
 * @returns {Promise<import("playwright").Locator>} Diálogo «Nuevo usuario» visible.
 */
async function openNewUserDialog(page) {
  const newUser = page.getByRole("button", { name: "Nuevo", exact: true });
  await newUser.waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  await newUser.click();
  const dialog = page.getByRole("dialog", { name: "Nuevo usuario" });
  await dialog.waitFor();
  return dialog;
}

const rowCodes = (page) => page.locator("tbody tr th[scope=row]").allTextContents();
// Celda «Estado» de una fila (después de N° y Unidad).
const statusCell = (page, code) => page.locator("tbody tr", { hasText: code }).locator("td").nth(1);
const denominationGets = (backend) => backend.requests.filter((request) => request.method === "GET" && request.path === "/api/admin/measurement-unit-denominations");

test("contenedor: título, indicadores reales, pestañas de Figma y redirección a Cotizaciones", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend);
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`, { timeout: NAVIGATION_TIMEOUT_MS });
  await page.getByRole("heading", { name: "Servicios y cotizaciones", level: 1 }).waitFor();
  const metrics = page.getByLabel("Indicadores de servicios y cotizaciones");
  await metrics.getByText("Servicios totales").waitFor();
  const values = await metrics.locator("strong").allTextContents();
  assert.deepEqual(values.slice(0, 3), ["3", "2", "1"], "Totales derivados del catálogo real de servicios");
  assert.equal(values[3], "24", "Cotizaciones totales proviene de /api/admin/quotes/summary");

  const tabs = page.getByRole("tablist", { name: "Secciones de servicios y cotizaciones" });
  assert.deepEqual(await tabs.getByRole("tab").allInnerTexts(), ["Cotizaciones", "Tabulador de servicios", "Unidades"]);
  assert.equal(await tabs.getByRole("tab", { name: "Cotizaciones" }).getAttribute("aria-selected"), "true");
  assert.equal(await tabs.getByRole("tab", { name: "Cotizaciones" }).evaluate((tab) => getComputedStyle(tab).borderBottomWidth), "2px");
  // Una subruta desconocida vuelve a Cotizaciones sin pantalla vacía.
  await page.goto(`${origin}/servicios-cotizaciones/inexistente`);
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  await page.getByText("Aún no hay cotizaciones", { exact: true }).waitFor();
});

test("pestañas: clic y teclado navegan sin recargar, con Atrás/Adelante y enlaces directos", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.evaluate(() => { window.__arcaNoReload = true; });
  const tabs = page.getByRole("tablist", { name: "Secciones de servicios y cotizaciones" });

  await tabs.getByRole("tab", { name: "Tabulador de servicios" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/tabulador`);
  await page.getByRole("heading", { name: "Tabulador de servicios", level: 2 }).waitFor();
  // Teclado del tablist: flecha izquierda activa Cotizaciones y la enfoca.
  await page.keyboard.press("ArrowLeft");
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  await page.getByText("Aún no hay cotizaciones", { exact: true }).waitFor();
  assert.equal(await tabs.getByRole("tab", { name: "Cotizaciones" }).evaluate((tab) => tab === document.activeElement), true);

  await page.goBack();
  await page.waitForURL(`${origin}/servicios-cotizaciones/tabulador`);
  assert.equal(await tabs.getByRole("tab", { name: "Tabulador de servicios" }).getAttribute("aria-selected"), "true");
  await page.goBack();
  await page.waitForURL(`${origin}/servicios-cotizaciones/unidades`);
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.goForward();
  await page.waitForURL(`${origin}/servicios-cotizaciones/tabulador`);
  assert.equal(await page.evaluate(() => window.__arcaNoReload), true, "Las pestañas no deben recargar la aplicación");

  // El destino del riel permanece activo en todas las pestañas.
  const navItem = page.locator('aside[aria-label="Navegación lateral"]:visible nav[aria-label="Secciones"] button[aria-label="Servicios y cotizaciones"]');
  const selectedColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-neutral-200)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await page.mouse.move(1300, 900);
  assert.equal(await navItem.evaluate((element) => getComputedStyle(element).backgroundColor), selectedColor);
  // Cotizaciones solo lee su listado y el total del indicador; ninguna pestaña escribe cotizaciones.
  const quoteRequests = backend.requests.filter((request) => /quotes/.test(request.path));
  assert.ok(quoteRequests.length > 0, "La pestaña Cotizaciones lee datos reales");
  assert.deepEqual([...new Set(quoteRequests.map((request) => `${request.method} ${request.path}`))].sort(), ["GET /api/admin/quotes", "GET /api/admin/quotes/summary"]);
});

test("tabla: sin selección de filas; código público, etiqueta de la API, columna Estado y columnas alineadas", async (context) => {
  const backend = createBackend([
    denomination(1, 1, "de construcción"),
    denomination(2, 1, "a intervenir", { isActive: false }),
    denomination(3, 20, "de supervisión", { activeServiceCount: 2 }),
  ]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  assert.deepEqual(await rowCodes(page), ["UNID-001", "UNID-002", "UNID-003"]);
  assert.deepEqual(await page.locator("thead th").allInnerTexts(), ["N°", "Unidad", "Estado", "Acciones"]);
  await page.getByText("m² de construcción", { exact: true }).waitFor();
  // «Estado» es su propia columna con el Badge de Servicios; «Unidad» solo muestra la etiqueta.
  assert.deepEqual(await page.locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].slice(0, 2).map((cell) => cell.innerText.trim()))), [
    ["m² de construcción", "Activo"],
    ["m² a intervenir", "Inactivo"],
    ["pto. de supervisión", "Activo"],
  ]);
  assert.equal(await page.getByText("Inactiva", { exact: true }).count(), 0, "El estado ya no acompaña a la denominación");
  // En uso por servicios activos: edición bloqueada con el motivo en el nombre accesible.
  const inUseEdit = page.getByRole("button", { name: /Editar UNID-003 .*En uso por 2 servicios activos/ });
  assert.equal(await inUseEdit.isDisabled(), true);

  // Sin selección: ni casillas (cabecera o filas), ni contador, ni filas marcadas como seleccionadas.
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.equal(await page.getByText(/seleccionad[oa]s?/i).count(), 0);
  assert.equal(await page.locator("tbody tr[data-selected]").count(), 0);
  // El menú de acciones por fila se conserva.
  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).waitFor();
  await page.keyboard.press("Escape");

  // Columnas alineadas: cada celda empieza y termina como su encabezado, N° arranca en el borde
  // de la tabla (sin hueco de la antigua columna de selección) y «Unidad» absorbe el ancho libre.
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const columns = await page.evaluate(() => {
      const table = document.querySelector("table").getBoundingClientRect();
      const headers = [...document.querySelectorAll("thead th")].map((cell) => cell.getBoundingClientRect());
      const rows = [...document.querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => cell.getBoundingClientRect()));
      return {
        firstAtEdge: Math.abs(headers[0].left - table.left) < 0.5,
        lastAtEdge: Math.abs(headers.at(-1).right - table.right) < 0.5,
        aligned: rows.every((cells) => cells.length === headers.length
          && cells.every((cell, index) => Math.abs(cell.left - headers[index].left) < 0.5 && Math.abs(cell.width - headers[index].width) < 0.5)),
        widths: headers.map((cell) => Math.round(cell.width)),
      };
    });
    assert.deepEqual({ firstAtEdge: columns.firstAtEdge, lastAtEdge: columns.lastAtEdge, aligned: columns.aligned }, { firstAtEdge: true, lastAtEdge: true, aligned: true }, `${width} px: ${JSON.stringify(columns)}`);
    assert.deepEqual([columns.widths[0], columns.widths[2], columns.widths[3]], [154, 116, 128], `${width} px: N°, Estado y Acciones conservan su ancho`);
    assert.ok(columns.widths[1] >= 230, `${width} px: «Unidad» ocupa el resto (${columns.widths[1]} px)`);
    // Los Badges de Estado caben sin recorte y las filas conservan su altura.
    const fit = await page.evaluate(() => [...document.querySelectorAll("tbody tr")].map((row) => {
      const cell = row.querySelectorAll("td")[1];
      const badge = cell.firstElementChild;
      const cellBox = cell.getBoundingClientRect();
      const badgeBox = badge.getBoundingClientRect();
      return {
        inside: badgeBox.left >= cellBox.left && badgeBox.right <= cellBox.right - 24 + 0.5,
        notClipped: badge.scrollWidth <= badge.clientWidth,
        rowHeight: Math.round(row.getBoundingClientRect().height),
      };
    }));
    assert.ok(fit.every((row) => row.inside && row.notClipped && row.rowHeight === 68), `${width} px: ${JSON.stringify(fit)}`);
  }
  assert.equal(await page.getByRole("button", { name: "Anterior" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);
});

test("búsqueda: debounce, una sola petición por pausa, respuestas obsoletas descartadas y sin coincidencias", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción"), denomination(2, 20, "de supervisión"), denomination(3, 6, "de muro")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-003", { exact: true }).waitFor();
  const search = page.getByRole("textbox", { name: "Buscar unidades por código, abreviatura o texto" });
  const before = denominationGets(backend).length;

  // "de" responde tarde; "de muro" llega antes y debe prevalecer.
  backend.delays.de = 900;
  await search.pressSequentially("de", { delay: 40 });
  await page.waitForTimeout(400);
  await search.pressSequentially(" muro", { delay: 40 });
  await page.waitForFunction(() => [...document.querySelectorAll("tbody tr th[scope=row]")].map((cell) => cell.textContent).join() === "UNID-003");
  await page.waitForTimeout(1100);
  assert.deepEqual(await rowCodes(page), ["UNID-003"], "Una respuesta antigua no sustituye la búsqueda reciente");
  const searches = denominationGets(backend).slice(before).map((request) => new URLSearchParams(request.search).get("search"));
  assert.deepEqual(searches, ["de", "de muro"], "Cada pausa genera una única petición con la búsqueda de la API");

  await search.fill("UNID-002");
  await page.waitForFunction(() => [...document.querySelectorAll("tbody tr th[scope=row]")].map((cell) => cell.textContent).join() === "UNID-002");
  await search.fill("zzz");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await page.getByText("UNID-001", { exact: true }).waitFor();
  assert.equal(await search.inputValue(), "");
});

test("paginación por cursor: Siguiente usa nextCursor y Anterior vuelve a la primera página", async (context) => {
  const items = Array.from({ length: 13 }, (_, index) => denomination(index + 1, 1, `variante ${String(index + 1).padStart(2, "0")}`));
  const backend = createBackend(items);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-010", { exact: true }).waitFor();
  assert.equal((await rowCodes(page)).length, 10);
  await page.getByRole("button", { name: "Siguiente pág." }).click();
  await page.getByText("UNID-013", { exact: true }).waitFor();
  assert.deepEqual(await rowCodes(page), ["UNID-011", "UNID-012", "UNID-013"]);
  assert.equal(new URLSearchParams(denominationGets(backend).at(-1).search).get("cursor"), "10");
  assert.equal(await page.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);

  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByText("UNID-001", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Anterior" }).isDisabled(), true);
  assert.equal((await rowCodes(page)).length, 10);
  assert.equal(await page.getByRole("checkbox").count(), 0);
});

test("alta: selector de abreviaturas desde la API, teclado, un único envío y código devuelto por el backend", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await dialog.waitFor();
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  assert.equal(backend.requests.filter((request) => request.path === "/api/admin/measurement-units").length, 1);

  // Foco inicial en el texto; el selector se abre con teclado y Escape no cierra el modal.
  await page.waitForFunction(() => document.activeElement?.matches?.("input[type='text']"));
  await combobox.focus();
  await page.keyboard.press("ArrowDown");
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  assert.equal(await listbox.getByRole("option").count(), BASE_UNITS.length);
  // Solo la abreviatura es visible; el nombre completo queda en el nombre accesible.
  const selectedOption = listbox.getByRole("option", { selected: true });
  assert.equal(await selectedOption.textContent(), "m²");
  assert.equal(await selectedOption.getAttribute("aria-label"), "m², Metro cuadrado");
  assert.equal(await listbox.getByRole("option", { name: "m.l., Metro lineal" }).count(), 1);
  assert.equal(await listbox.getByText("Metro cuadrado").count(), 0, "La descripción no se muestra");
  await page.keyboard.press("Escape");
  await listbox.waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.startsWith("m.l."));
  // Búsqueda por letras y selección con el puntero.
  await combobox.click();
  await listbox.getByRole("option", { name: /hrs/ }).click();
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.startsWith("hrs"));

  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  await text.fill("   ");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("Escribe el nombre de la unidad.").waitFor();
  await text.fill("  de   asesoría ");
  await dialog.getByText("Se mostrará como «hrs de asesoría».").waitFor();

  const create = dialog.getByRole("button", { name: "Crear" });
  await create.dblclick();
  await page.getByRole("alert").getByText("UNID-002 · hrs de asesoría").waitFor();
  const posts = backend.requests.filter((request) => request.method === "POST");
  assert.equal(posts.length, 1, "Un doble clic no crea dos registros");
  assert.deepEqual(posts[0].body, { denomination: "de asesoría", measurementUnitId: 20 });
  await dialog.waitFor({ state: "detached" });
  // La tabla se recarga desde la primera página con el código generado por el backend.
  await page.getByText("UNID-002", { exact: true }).waitFor();
});

test("alta: un duplicado 409 marca el campo, conserva lo escrito y no cierra el formulario", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  backend.failures["POST /api/admin/measurement-unit-denominations"] = {
    status: 409,
    body: { code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", message: "Ya existe una denominación equivalente para esa unidad de medida." },
  };
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  await text.fill("DE CONSTRUCCIÓN");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("Ya hay una denominación equivalente para la unidad base seleccionada", { exact: true }).waitFor();
  assert.equal(await text.inputValue(), "DE CONSTRUCCIÓN");
  assert.equal(await text.getAttribute("aria-invalid"), "true");
  assert.equal(await dialog.getByRole("button", { name: "Crear" }).isEnabled(), true);
  // Escape cierra el formulario y devuelve el foco al disparador.
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

/**
 * Abre la edición de UNID-001 desde la tabla.
 *
 * @param {import("playwright").Page} page - Página del módulo.
 * @returns {Promise<import("playwright").Locator>} Diálogo de edición.
 */
async function openEditDialog(page) {
  await page.getByRole("button", { name: /Editar UNID-001/ }).click();
  const dialog = page.getByRole("dialog", { name: "Editar unidad de medida" });
  await dialog.waitFor();
  return dialog;
}

/**
 * Espera a que el selector de abreviaturas del formulario se habilite (catálogo cargado).
 *
 * @param {import("playwright").Page} page - Página del módulo.
 * @returns {Promise<void>}
 */
async function waitForEnabledBaseSelector(page) {
  await page.waitForFunction(() => document.querySelector('[data-measurement-unit-form] [role="combobox"]')?.disabled === false);
}

const baseUnitGets = (backend) => backend.requests.filter((request) => request.path === "/api/admin/measurement-units");

test("edición: sin referencias la abreviatura se cambia, se previsualiza y solo se envía si cambia", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  const dialog = await openEditDialog(page);
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  // El catálogo se pide al abrir y la base actual sigue seleccionada.
  await waitForEnabledBaseSelector(page);
  assert.equal(baseUnitGets(backend).length, 1);
  assert.equal((await combobox.textContent()).startsWith("m²"), true);
  assert.equal(await dialog.getByText(/Puedes cambiar la abreviatura/).count(), 0);
  await dialog.getByText("Se mostrará como «m² de construcción».").waitFor();

  await combobox.click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  assert.equal(await listbox.getByRole("option").count(), BASE_UNITS.length);
  await listbox.getByRole("option", { name: "m.l., Metro lineal" }).click();
  await dialog.getByText("Se mostrará como «m.l. de construcción».").waitFor();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("m.l. de construcción", { exact: true }).waitFor();
  await page.getByText("UNID-001", { exact: true }).waitFor();
  const patches = () => backend.requests.filter((request) => request.method === "PATCH");
  assert.equal(patches()[0].path, "/api/admin/measurement-unit-denominations/1");
  assert.deepEqual(patches()[0].body, { denomination: "de construcción", measurementUnitId: 6 });

  // Sin tocar la abreviatura, el PATCH solo lleva el texto.
  const again = await openEditDialog(page);
  await waitForEnabledBaseSelector(page);
  assert.equal((await again.getByRole("combobox").textContent()).startsWith("m.l."), true);
  await again.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de obra nueva");
  await again.getByRole("button", { name: "Guardar" }).click();
  await again.waitFor({ state: "detached" });
  await page.getByText("m.l. de obra nueva", { exact: true }).waitFor();
  assert.deepEqual(patches()[1].body, { denomination: "de obra nueva" });
  // El catálogo base se conserva entre aperturas.
  assert.equal(baseUnitGets(backend).length, 1);
});

test("edición: con referencias la abreviatura queda bloqueada con su motivo y el texto se sigue editando", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción", { baseUnitEditable: false })]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  const dialog = await openEditDialog(page);
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  assert.equal(await combobox.isDisabled(), true);
  assert.equal((await combobox.textContent()).startsWith("m²"), true);
  await dialog.getByText(BASE_LOCKED_NOTE).waitFor();
  // Sin base editable no hace falta el catálogo.
  assert.equal(baseUnitGets(backend).length, 0);
  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  assert.equal(await text.inputValue(), "de construcción");
  await text.fill("de obra nueva");
  await dialog.getByText("Se mostrará como «m² de obra nueva».").waitFor();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("m² de obra nueva", { exact: true }).waitFor();
  assert.deepEqual(backend.requests.find((request) => request.method === "PATCH").body, { denomination: "de obra nueva" });
});

test("edición: un 409 de base en uso marca la abreviatura, la bloquea, recarga la tabla y conserva el texto", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  const listLoads = denominationGets(backend).length;
  const dialog = await openEditDialog(page);
  await waitForEnabledBaseSelector(page);
  // Otro administrador asignó la unidad a un servicio después de la lectura.
  backend.items[0].baseUnitEditable = false;
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  await combobox.click();
  await page.getByRole("listbox", { name: "Abreviatura de la unidad base" }).getByRole("option", { name: "hrs, Hora" }).click();
  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  await text.fill("de obra");
  await dialog.getByRole("button", { name: "Guardar" }).click();

  await dialog.getByText(BASE_IN_USE_MESSAGE).waitFor();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await text.inputValue(), "de obra");
  assert.equal(await text.getAttribute("aria-invalid"), "true");
  assert.equal(await combobox.isDisabled(), true);
  assert.equal((await combobox.textContent()).startsWith("m²"), true, "Vuelve a la base actual");
  for (let attempt = 0; attempt < 100 && denominationGets(backend).length <= listLoads; attempt += 1) await page.waitForTimeout(20);
  assert.ok(denominationGets(backend).length > listLoads, "La tabla se recarga para reflejar el nuevo uso");

  // Al escribir desaparece el error y se explica el bloqueo; guardar envía solo el texto.
  await text.fill("de obra final");
  await dialog.getByText(BASE_LOCKED_NOTE).waitFor();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("m² de obra final", { exact: true }).waitFor();
  const patches = backend.requests.filter((request) => request.method === "PATCH");
  assert.deepEqual(patches.map((request) => request.body), [
    { denomination: "de obra", measurementUnitId: 20 },
    { denomination: "de obra final" },
  ]);
});

test("edición responsive: en móvil y tema oscuro el selector editable cabe y abre dentro del viewport", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme: "dark", viewport: { width: 375, height: 720 } });
  const dialog = await openEditDialog(page);
  await waitForEnabledBaseSelector(page);
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 375, `Diálogo dentro del viewport: ${JSON.stringify(box)}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await dialog.getByText(/Puedes cambiar la abreviatura/).count(), 0);
  await dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ }).click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  const panel = await listbox.boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 375 && panel.y + panel.height <= 720, `Listado dentro del viewport: ${JSON.stringify(panel)}`);
  await listbox.getByRole("option", { name: "m³, Metro cúbico" }).click();
  await dialog.getByText("Se mostrará como «m³ de construcción».").waitFor();
});

test("estado: desactivar y activar con confirmación; los errores 409 y 429 se comunican con el aviso", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción"), denomination(2, 20, "de supervisión", { activeServiceCount: 1 })]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Desactivar unidad de medida?" });
  await confirm.waitFor();
  await confirm.getByRole("button", { name: "Desactivar" }).click();
  await statusCell(page, "UNID-001").getByText("Inactivo", { exact: true }).waitFor();
  assert.deepEqual(backend.requests.find((request) => request.path.endsWith("/1/status")).body, { isActive: false });

  // Una unidad inactiva ofrece Activar.
  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Activar" }).click();
  await page.getByRole("dialog", { name: "¿Activar unidad de medida?" }).getByRole("button", { name: "Activar" }).click();
  await statusCell(page, "UNID-001").getByText("Activo", { exact: true }).waitFor();

  // En uso: solo se muestra la opción deshabilitada, sin encabezado informativo.
  await page.getByRole("button", { name: "Más opciones para UNID-002" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Desactivar" }).isDisabled(), true);
  assert.equal(await page.getByRole("menu").innerText(), "Desactivar");
  await page.keyboard.press("Escape");

  backend.failures["PATCH /api/admin/measurement-unit-denominations/:id/status"] = {
    status: 429,
    body: { code: "RATE_LIMITED", message: "Demasiadas solicitudes." },
  };
  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await page.getByRole("dialog", { name: "¿Desactivar unidad de medida?" }).getByRole("button", { name: "Desactivar" }).click();
  await page.getByText("Realizaste demasiados cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo.").waitFor();
  backend.failures["PATCH /api/admin/measurement-unit-denominations/:id/status"] = {
    status: 409,
    body: { code: "MEASUREMENT_UNIT_IN_USE", message: "La denominación está asignada a 1 servicio(s) activo(s). Crea otra denominación y reasigna esos servicios." },
  };
  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await page.getByRole("dialog", { name: "¿Desactivar unidad de medida?" }).getByRole("button", { name: "Desactivar" }).click();
  // El 409 IN_USE se traduce con su motivo real, sin presentarlo como duplicado.
  await page.getByRole("alert").getByText("No se pudo desactivar la unidad", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Está siendo utilizada por servicios activos", { exact: true }).waitFor();
  // Ninguna llamada de eliminación física.
  assert.equal(backend.requests.some((request) => request.method === "DELETE"), false);
});

const UNIT_DIALOG = { dialogAttribute: "data-measurement-unit-status-modal", iconAttribute: "data-measurement-unit-status-icon" };
const STATUS_PATCH = "PATCH /api/admin/measurement-unit-denominations/:id/status";
const SUCCESS_NODE = "2068:22275";
const DANGER_NODE = "2068:22253";

/**
 * Abre la confirmación de estado de una unidad desde su menú «Más opciones» y espera su entrada.
 *
 * @param {import("playwright").Page} page - Página del módulo.
 * @param {string} code - Código público de la fila.
 * @param {"Activar"|"Desactivar"} action - Acción del menú.
 * @returns {Promise<import("playwright").Locator>} Diálogo visible.
 */
async function openUnitStatusDialog(page, code, action) {
  await page.getByRole("button", { name: `Más opciones para ${code}`, exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `¿${action} unidad de medida?`, exact: true });
  await dialog.waitFor();
  await dialog.evaluate(async (element) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  return dialog;
}

/**
 * Cierra el aviso visible con su botón y espera a que se desmonte.
 *
 * @param {import("playwright").Page} page - Página del módulo.
 * @returns {Promise<void>}
 */
async function closeAlert(page) {
  const alert = page.getByRole("alert");
  await alert.getByRole("button", { name: "Cerrar alerta", exact: true }).click();
  await alert.waitFor({ state: "detached" });
}

for (const variant of [
  { label: "claro, escritorio", theme: "light", viewport: { width: 1440, height: 1000 } },
  { label: "oscuro, móvil", theme: "dark", viewport: { width: 375, height: 812 } },
]) {
  test(`estado unificado con Servicios (${variant.label}): variantes, identidad larga, carga, un cierre y avisos reales`, async (context) => {
    const code = "UNID-0000000000123456789";
    const text = "de supervisión técnica extendida para obras de restauración patrimonial";
    const backend = createBackend([denomination(1, 1, text, { publicCode: code })]);
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme: variant.theme, viewport: variant.viewport });
    await page.getByText(code, { exact: true }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
    const readLog = await observeStatusDialog(page, UNIT_DIALOG);
    const identity = `${code} · m² ${text}`;
    const patches = () => backend.requests.filter((request) => request.method === "PATCH");
    backend.delays[STATUS_PATCH] = 600;

    // Desactivar: variante Danger, textos de Unidades e identidad discreta que no desborda.
    let dialog = await openUnitStatusDialog(page, code, "Desactivar");
    await dialog.getByText("Esta unidad dejará de estar disponible para nuevas asignaciones. Podrás activarla nuevamente").waitFor();
    const detail = dialog.locator("[data-status-confirmation-detail]");
    assert.equal(await detail.innerText(), identity);
    assert.equal(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth), true, "El código largo se envuelve");
    assert.doesNotMatch(await dialog.innerText(), /elimina/i);
    let palette = await readStatusDialogPalette(dialog, UNIT_DIALOG.iconAttribute, false);
    assert.deepEqual([palette.icon, palette.iconColor, palette.buttonColor, palette.cancelColor, palette.cancelBorder],
      ["deactivate", palette.expectedMain, palette.expectedMain, palette.expectedCancel, palette.expectedCancel]);
    // Cancelar no envía nada.
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(patches().length, 0);

    dialog = await openUnitStatusDialog(page, code, "Desactivar");
    await dialog.getByRole("button", { name: "Desactivar", exact: true }).dblclick();
    await dialog.getByRole("button", { name: "Confirmando...", exact: true }).waitFor();
    assert.equal(await dialog.getAttribute("aria-busy"), "true");
    for (const button of await dialog.getByRole("button").all()) assert.equal(await button.isDisabled(), true);
    assert.equal(await page.getByRole("alert").count(), 0, "Sin aviso antes de la respuesta de la API");
    let alert = page.getByRole("alert");
    await alert.getByText("Unidad desactivada correctamente", { exact: true }).waitFor();
    await alert.getByText(identity, { exact: true }).waitFor();
    await alert.getByText("Ya no está disponible para nuevas asignaciones", { exact: true }).waitFor();
    assert.equal(await alert.getAttribute("data-node-id"), SUCCESS_NODE);
    await page.locator(`[${UNIT_DIALOG.dialogAttribute}]`).waitFor({ state: "detached" });
    assert.equal(patches().length, 1, "Un doble clic envía un solo cambio");
    await statusCell(page, code).getByText("Inactivo", { exact: true }).waitFor();
    await closeAlert(page);

    // Activar: variante Success, sin colores destructivos.
    dialog = await openUnitStatusDialog(page, code, "Activar");
    await dialog.getByText("Esta unidad volverá a estar disponible para nuevas asignaciones").waitFor();
    palette = await readStatusDialogPalette(dialog, UNIT_DIALOG.iconAttribute, true);
    assert.deepEqual([palette.icon, palette.iconColor, palette.buttonColor, palette.cancelColor, palette.cancelBorder],
      ["activate", palette.expectedMain, palette.expectedMain, palette.expectedCancel, palette.expectedCancel]);
    await dialog.getByRole("button", { name: "Activar", exact: true }).click();
    alert = page.getByRole("alert");
    await alert.getByText("Unidad activada correctamente", { exact: true }).waitFor();
    await alert.getByText("Vuelve a estar disponible para nuevas asignaciones", { exact: true }).waitFor();
    await page.locator(`[${UNIT_DIALOG.dialogAttribute}]`).waitFor({ state: "detached" });
    assert.deepEqual(patches().map((request) => request.body), [{ isActive: false }, { isActive: true }]);

    // Una instancia por apertura, una entrada y una salida que nunca repinta otra variante.
    const log = await readLog();
    assert.deepEqual({ mounts: log.mounts, unmounts: log.unmounts, entries: log.entries, maxInstances: log.maxInstances },
      { mounts: 3, unmounts: 3, entries: 3, maxInstances: 1 }, JSON.stringify(log));
    assert.deepEqual(log.titles, ["¿Desactivar unidad de medida?", "¿Activar unidad de medida?"]);
    assert.deepEqual(log.icons, ["deactivate", "activate"]);
    assert.deepEqual(log.labels, ["Desactivar", "Confirmando...", "Activar", "Confirmando..."]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `Sin desborde horizontal (${overflow}px)`);
  });
}

test("avisos de alta y edición: título, código y nombre devueltos por la API y consecuencia", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });

  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const create = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  await create.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de prueba nueva");
  await create.getByRole("button", { name: "Crear" }).click();
  let alert = page.getByRole("alert");
  await alert.getByText("Unidad creada correctamente", { exact: true }).waitFor();
  await alert.getByText("UNID-002 · m² de prueba nueva", { exact: true }).waitFor();
  await alert.getByText("Ya está disponible para asignarla a servicios", { exact: true }).waitFor();
  assert.equal(await alert.getAttribute("data-node-id"), SUCCESS_NODE);
  // La identidad cabe completa: no abre un Tooltip que repita lo visible ni recibe foco.
  const identity = alert.getByText("UNID-002 · m² de prueba nueva", { exact: true });
  await identity.hover();
  await page.waitForTimeout(400);
  assert.equal(await page.getByRole("tooltip").filter({ hasText: "UNID-002" }).count(), 0);
  assert.equal(await identity.getAttribute("tabindex"), null);
  await closeAlert(page);

  const edit = await openEditDialog(page);
  await edit.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de obra nueva");
  await edit.getByRole("button", { name: "Guardar" }).click();
  alert = page.getByRole("alert");
  await alert.getByText("Unidad actualizada correctamente", { exact: true }).waitFor();
  await alert.getByText("UNID-001 · m² de obra nueva", { exact: true }).waitFor();
  // La edición solo informa el nombre vigente: no reserva una descripción vacía.
  assert.deepEqual((await alert.innerText()).split("\n").filter(Boolean), ["Unidad actualizada correctamente", "UNID-001 · m² de obra nueva"]);
});

test("errores reales: en uso, conflicto, validación y red sin aviso de éxito; duplicado y red del formulario junto al campo", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción"), denomination(2, 6, "de canalización", { isActive: false })]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });

  for (const [code, action, failure, title, message] of [
    ["UNID-001", "Desactivar", { status: 409, body: { code: "MEASUREMENT_UNIT_IN_USE", message: "La denominación está asignada a 2 servicio(s) activo(s)." } },
      "No se pudo desactivar la unidad", "Está siendo utilizada por servicios activos"],
    ["UNID-001", "Desactivar", { status: 409, body: { code: "MEASUREMENT_UNIT_CONCURRENT_UPDATE", message: "La unidad de medida se está modificando en este momento." } },
      "No se pudo desactivar la unidad", "La información cambió. Actualiza el listado e inténtalo nuevamente"],
    ["UNID-002", "Activar", { status: 400, body: { code: "VALIDATION_ERROR", message: "Datos inválidos.", fields: { measurementUnitId: "La unidad de medida está inactiva." } } },
      "No se pudo activar la unidad", "La unidad de medida está inactiva."],
    ["UNID-002", "Activar", { abort: true }, "No se pudo completar la operación", "Comprueba tu conexión e inténtalo nuevamente"],
  ]) {
    backend.failures[STATUS_PATCH] = failure;
    const dialog = await openUnitStatusDialog(page, code, action);
    await dialog.getByRole("button", { name: action, exact: true }).click();
    const alert = page.getByRole("alert");
    await alert.getByText(title, { exact: true }).waitFor();
    await alert.getByText(message, { exact: true }).waitFor();
    assert.equal(await alert.getAttribute("data-node-id"), DANGER_NODE);
    assert.equal(await page.getByRole("alert").count(), 1, "Un único aviso por error");
    assert.doesNotMatch(await alert.innerText(), /correctamente|ya existe/i, `${failure.body?.code ?? "red"} no es éxito ni duplicado`);
    await page.locator(`[${UNIT_DIALOG.dialogAttribute}]`).waitFor({ state: "detached" });
    await closeAlert(page);
  }
  delete backend.failures[STATUS_PATCH];
  // Los fallos no cambian el estado mostrado en la columna Estado.
  assert.equal(await statusCell(page, "UNID-001").innerText(), "Activo");
  await statusCell(page, "UNID-002").getByText("Inactivo", { exact: true }).waitFor();

  // En el formulario, el duplicado y la red se muestran junto al campo, sin duplicarlos en un aviso.
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const create = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  const textbox = create.getByRole("textbox", { name: "Nombre de la unidad" });
  await textbox.fill("de construcción nueva");
  for (const [failure, message] of [
    [{ status: 409, body: { code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", message: "Ya existe una denominación equivalente para esa unidad de medida." } },
      "Ya hay una denominación equivalente para la unidad base seleccionada"],
    [{ abort: true }, "Comprueba tu conexión e inténtalo nuevamente"],
  ]) {
    backend.failures["POST /api/admin/measurement-unit-denominations"] = failure;
    await create.getByRole("button", { name: "Crear" }).click();
    await create.getByText(message, { exact: true }).waitFor();
    // La pista del campo usa role=alert; el aviso flotante (AlertToast) se identifica por su nodo de Figma.
    assert.equal(await page.locator(`[role="alert"][data-node-id="${DANGER_NODE}"]`).count(), 0, "Sin aviso duplicado del error del formulario");
    assert.equal(await textbox.inputValue(), "de construcción nueva");
  }
});

test("menú compartido: descarta su tooltip al abrir, no lo restaura al cerrar y conserva hover y foco", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  const trigger = page.getByRole("button", { name: "Más opciones para UNID-001" });
  await trigger.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const tooltip = page.getByRole("tooltip");
  await trigger.hover();
  await tooltip.getByText("Más opciones", { exact: true }).waitFor();
  await trigger.click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await tooltip.waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await tooltip.count(), 0);
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await page.mouse.move(5, 5);
  await trigger.hover();
  await tooltip.getByText("Más opciones", { exact: true }).waitFor();
  await page.mouse.move(5, 5);
  await tooltip.waitFor({ state: "detached" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "Desactivar" }).focus();
  await page.getByRole("heading", { name: "Servicios y cotizaciones", level: 1 }).click();
  await menu.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Más opciones para UNID-001");
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  assert.equal(await tooltip.count(), 0);
});

test("estados: carga, vacío con acción, error recuperable y 403 comprensible", async (context) => {
  const backend = createBackend([]);
  backend.failures["GET /api/admin/measurement-unit-denominations"] = { status: 500, body: { code: "INTERNAL_SERVER_ERROR", message: "Ocurrió un error inesperado." } };
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("No se pudieron cargar las unidades de medida", { exact: true }).waitFor();
  delete backend.failures["GET /api/admin/measurement-unit-denominations"];
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByText("Aún no hay unidades de medida", { exact: true }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Paginación de unidades" }).count(), 0);
  await page.getByRole("button", { name: "Añadir unidad" }).last().click();
  await page.getByRole("dialog", { name: "Nueva unidad de medida" }).waitFor();
  await page.keyboard.press("Escape");

  backend.failures["POST /api/admin/measurement-unit-denominations"] = { status: 403, body: { code: "FORBIDDEN", message: "No tienes permisos para realizar esta acción." } };
  await page.getByRole("button", { name: "Añadir unidad" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  await dialog.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de prueba");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("No tienes permisos para gestionar unidades de medida.").waitFor();
});

/**
 * Mide la presentación de un listado unido a un selector del Input y de su primera opción.
 *
 * @param {import("playwright").Locator} listbox - Listado abierto.
 * @returns {Promise<Object>} Estilos calculados comparables entre selectores.
 */
function measureOptionsPanel(listbox) {
  return listbox.evaluate((panel) => {
    const style = getComputedStyle(panel);
    const viewport = panel.firstElementChild;
    const option = panel.querySelector('[role="option"]');
    const optionStyle = getComputedStyle(option);
    return {
      background: style.backgroundColor,
      borderColor: style.borderLeftColor,
      borderTop: style.borderTopWidth,
      boxShadow: style.boxShadow,
      optionFont: `${optionStyle.fontSize}/${optionStyle.lineHeight}`,
      optionGap: optionStyle.columnGap,
      optionHeight: option.getBoundingClientRect().height,
      optionPadding: `${optionStyle.paddingLeft} ${optionStyle.paddingRight}`,
      optionRadius: optionStyle.borderTopLeftRadius,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      radius: `${style.borderBottomLeftRadius} ${style.borderBottomRightRadius}`,
      scrollbarHidden: getComputedStyle(viewport).scrollbarWidth,
      selectedBackground: getComputedStyle(panel.querySelector('[aria-selected="true"]')).backgroundColor,
      viewportHeight: viewport.getBoundingClientRect().height,
    };
  });
}

for (const theme of ["light", "dark"]) {
  test(`consistencia (${theme}): el listado de unidades replica el del selector telefónico`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de construcción")]);
    const page = await openModule(context, backend, { path: "/usuarios", theme });
    const phoneDialog = await openNewUserDialog(page);
    await phoneDialog.getByRole("combobox", { name: /Buscar código de país/ }).first().focus();
    const phoneList = page.getByRole("listbox", { name: "Países y códigos telefónicos" });
    await phoneList.waitFor();
    const phone = await measureOptionsPanel(phoneList);
    assert.equal(await page.getByRole("scrollbar", { name: "Desplazar países" }).count(), 1);
    // Relación del menú telefónico con su segmento: envoltorio del prefijo y divisor bajo él.
    const phoneAnchor = await phoneList.evaluate((list) => {
      const segment = list.parentElement.getBoundingClientRect();
      const rect = list.getBoundingClientRect();
      return {
        dx: Math.round(rect.left - segment.left),
        dy: Math.round(rect.top - segment.bottom),
        extraWidth: Math.round(rect.width - segment.width),
        divider: getComputedStyle(list.parentElement.firstElementChild, "::after").height,
      };
    });

    await page.goto(`${origin}/servicios-cotizaciones/unidades`);
    await page.getByText("UNID-001", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Añadir unidad" }).click();
    await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
    await page.getByRole("dialog", { name: "Nueva unidad de medida" }).getByRole("combobox").click();
    const unitList = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
    await unitList.waitFor();
    const units = await measureOptionsPanel(unitList);

    assert.deepEqual(units, phone, "Carcasa, filas, tipografía, colores, scroll y altura idénticos");
    // El menú de unidades es una extensión del segmento m², con el mismo anclaje que el teléfono;
    // solo el ancho crece lo necesario para abreviatura y nombre, sin ocupar el campo completo.
    const unitAnchor = await unitList.evaluate((list) => {
      const trigger = document.querySelector('[data-measurement-unit-form] [role="combobox"]');
      const segment = trigger.getBoundingClientRect();
      const field = trigger.closest("[data-input-shell]").getBoundingClientRect();
      const rect = list.getBoundingClientRect();
      return {
        dx: Math.round(rect.left - segment.left),
        dy: Math.round(rect.top - segment.bottom),
        extraWidth: Math.round(rect.width - segment.width),
        divider: getComputedStyle(trigger, "::after").height,
        narrowerThanField: rect.width < field.width,
        fitsContent: [...list.querySelectorAll('[role="option"] span:last-child')].every((span) => span.scrollWidth <= span.clientWidth),
      };
    });
    assert.deepEqual({ dx: unitAnchor.dx, dy: unitAnchor.dy, divider: unitAnchor.divider }, { dx: phoneAnchor.dx, dy: phoneAnchor.dy, divider: phoneAnchor.divider });
    assert.equal(phoneAnchor.extraWidth, 1);
    assert.ok(unitAnchor.extraWidth >= 1, "Nunca más estrecho que el segmento");
    assert.equal(unitAnchor.narrowerThanField, true);
    assert.equal(unitAnchor.fitsContent, true, "Los nombres completos caben sin recortarse");
    assert.equal(units.viewportHeight, 113);
    assert.equal(units.optionHeight, 35);
    assert.equal(units.borderTop, "0px");
    // Diferencia deliberada: el listado de unidades no muestra ScrollBar (el telefónico sí) y
    // conserva las 6 unidades simuladas.
    assert.equal(await page.getByRole("scrollbar").count(), 0);
    assert.equal(await unitList.getByRole("option").count(), BASE_UNITS.length);
    // Abreviatura y descripción en cada opción.
    assert.deepEqual(await unitList.getByRole("option").allTextContents(), BASE_UNITS.map((unit) => unit.symbol));
    // Compacto: proporcional a la abreviatura más larga, no a nombres completos.
    assert.ok(unitAnchor.extraWidth <= 40, `Demasiado ancho para solo abreviaturas (+${unitAnchor.extraWidth} px)`);

    // Teclado: anillo primary-10 en la opción activa, como el foco visible del telefónico; el
    // puntero solo aplica hover y retira el anillo.
    await page.keyboard.press("ArrowDown");
    const ring = await unitList.getByRole("option").nth(1).evaluate((option) => getComputedStyle(option).boxShadow);
    assert.notEqual(ring, "none");
    await unitList.getByRole("option").nth(2).hover();
    assert.equal(await unitList.getByRole("option").nth(1).evaluate((option) => getComputedStyle(option).boxShadow), "none");
    // Desplazarse hasta la última opción mueve también el ScrollBar.
    await page.keyboard.press("End");
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[role="listbox"]').firstElementChild;
      return viewport.scrollTop > 0;
    });
  });
}

// 48 unidades base como el catálogo aprobado: muchas quedan fuera de las tres filas visibles.
const FORTY_EIGHT_UNITS = Array.from({ length: 48 }, (_, index) => ({
  id: 100 + index,
  code: `unit_${index}`,
  name: `Unidad de prueba ${index + 1}`,
  symbol: `u${index + 1}`,
  allowsDecimals: true,
  isActive: true,
  sortOrder: index + 1,
}));

/**
 * Lee el desplazamiento del área de opciones del listado abierto.
 *
 * @param {import("playwright").Page} page - Página con un listado abierto.
 * @returns {Promise<number>} scrollTop del área desplazable.
 */
function optionsScrollTop(page) {
  return page.getByRole("listbox").evaluate((list) => list.firstElementChild.scrollTop);
}

/**
 * Arrastra el thumb del ScrollBar con el ratón real (pointerdown, pointermove, pointerup).
 *
 * @param {import("playwright").Page} page - Página con un listado abierto.
 * @param {string} name - Nombre accesible del ScrollBar.
 * @param {number} deltaY - Desplazamiento vertical del puntero.
 * @returns {Promise<void>}
 */
async function dragScrollThumb(page, name, deltaY) {
  const thumb = page.getByRole("scrollbar", { name }).locator("div").first();
  // El thumb anima `top` (150 ms): se espera a que su posición se estabilice antes de agarrarlo.
  let box = await thumb.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(50);
    const next = await thumb.boundingBox();
    if (Math.abs(next.y - box.y) < 0.5) break;
    box = next;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + deltaY, { steps: 8 });
  await page.mouse.up();
}

/**
 * Describe cómo se desplaza el listado de abreviaturas abierto: barras visibles (ScrollBar del
 * sistema y barra nativa), overflow del área, espacio lateral reservado y filas completamente
 * visibles. Sirve para comprobar que no hay barra pero el área sigue siendo desplazable.
 *
 * @param {import("playwright").Page} page - Página con el listado abierto.
 * @returns {Promise<Object>} Estado real del área desplazable.
 */
function measureHiddenScroll(page) {
  return page.getByRole("listbox").evaluate((list) => {
    const area = list.firstElementChild;
    const style = getComputedStyle(area);
    const visible = area.getBoundingClientRect();
    return {
      systemScrollbars: list.querySelectorAll('[role="scrollbar"]').length,
      nativeScrollbarWidth: area.offsetWidth - area.clientWidth,
      scrollbarWidth: style.scrollbarWidth,
      overflowY: style.overflowY,
      paddingRight: style.paddingRight,
      scrollable: area.scrollHeight > area.clientHeight,
      fullyVisibleRows: [...list.querySelectorAll('[role="option"]')].filter((option) => {
        const rect = option.getBoundingClientRect();
        return rect.top >= visible.top - 0.5 && rect.bottom <= visible.bottom + 0.5;
      }).length,
    };
  });
}

/**
 * Indica si la opción activa por teclado (aria-activedescendant del disparador) queda
 * completamente dentro del área visible del listado.
 *
 * @param {import("playwright").Locator} combobox - Disparador del selector.
 * @returns {Promise<boolean>} Opción activa visible.
 */
function isActiveOptionVisible(combobox) {
  return combobox.evaluate((trigger) => {
    const option = document.getElementById(trigger.getAttribute("aria-activedescendant"));
    const area = document.querySelector('[role="listbox"]').firstElementChild.getBoundingClientRect();
    const rect = option.getBoundingClientRect();
    return rect.top >= area.top - 0.5 && rect.bottom <= area.bottom + 0.5;
  });
}

/**
 * Arrastra un dedo sobre la página con eventos táctiles reales del navegador (touchStart, diez
 * touchMove y touchEnd). Requiere un contexto creado con `hasTouch`: sin él el navegador
 * descarta los gestos táctiles incluso en un contenedor desplazable sin código propio.
 *
 * @param {import("playwright").Page} page - Página de un contexto con `hasTouch: true`.
 * @param {{x: number, y: number}} point - Punto donde se apoya el dedo.
 * @param {number} distance - Recorrido vertical del dedo; negativo desplaza el contenido hacia abajo.
 * @returns {Promise<void>}
 */
async function touchDrag(page, point, distance) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y + (distance * step) / 10 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

for (const [label, viewport, theme] of [["escritorio claro", { width: 1440, height: 1000 }, "light"], ["móvil oscuro", { width: 375, height: 812 }, "dark"]]) {
  test(`scroll (${label}): sin barra visible, rueda, touchpad y teclado recorren las 48 unidades`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de construcción")]);
    backend.baseUnits = FORTY_EIGHT_UNITS;
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport });
    await page.getByText("UNID-001", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Añadir unidad" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
    await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
    const combobox = dialog.getByRole("combobox");
    await combobox.click();
    const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
    await listbox.waitFor();

    // Sin barra visible (ni ScrollBar del sistema ni nativa), pero con overflow desplazable,
    // tres filas visibles y las 48 unidades disponibles; solo se muestran las abreviaturas.
    assert.deepEqual(await measureHiddenScroll(page), {
      systemScrollbars: 0, nativeScrollbarWidth: 0, scrollbarWidth: "none", overflowY: "auto",
      paddingRight: "0px", scrollable: true, fullyVisibleRows: 3,
    });
    // Solo el listado: en móvil la tabla de unidades de fondo muestra su propio ScrollBar horizontal.
    assert.equal(await listbox.getByRole("scrollbar").count(), 0);
    assert.equal(await listbox.getByRole("option").count(), 48);
    assert.equal(await listbox.getByRole("option").first().textContent(), "u1");

    // Rueda del ratón, deltas pequeños como un touchpad y rueda hacia arriba.
    const box = await listbox.boundingBox();
    await page.mouse.move(box.x + 16, box.y + 30);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop > 0);
    const afterWheel = await optionsScrollTop(page);
    for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, 10);
    await page.waitForFunction((start) => document.querySelector('[role="listbox"]').firstElementChild.scrollTop >= start + 50, afterWheel);
    const afterTouchpad = await optionsScrollTop(page);
    await page.mouse.wheel(0, -60);
    await page.waitForFunction((start) => document.querySelector('[role="listbox"]').firstElementChild.scrollTop < start, afterTouchpad);
    assert.equal(await combobox.getAttribute("aria-expanded"), "true", "Desplazar no cierra el menú");

    // Ratón: seleccionar una unidad que no era visible al abrir (después de u3).
    const hiddenAtOpen = await listbox.evaluate((list) => {
      const area = list.firstElementChild.getBoundingClientRect();
      return [...list.querySelectorAll('[role="option"]')].slice(3).find((option) => {
        const rect = option.getBoundingClientRect();
        return rect.top >= area.top - 0.5 && rect.bottom <= area.bottom + 0.5;
      })?.textContent;
    });
    assert.ok(hiddenAtOpen, "Tras desplazar hay opciones antes ocultas a la vista");
    await listbox.getByRole("option").filter({ hasText: new RegExp(`^${hiddenAtOpen}$`) }).click();
    await listbox.waitFor({ state: "detached" });
    assert.equal(await combobox.textContent(), hiddenAtOpen);

    // Teclado: la opción activa siempre queda dentro del área visible.
    await combobox.click();
    await listbox.waitFor();
    assert.equal(await isActiveOptionVisible(combobox), true, "Al abrir se revela la seleccionada");
    const selectedIndex = Number((await combobox.getAttribute("aria-activedescendant")).match(/-prefix-option-(\d+)$/)[1]);
    await page.keyboard.press("ArrowDown");
    assert.match(await combobox.getAttribute("aria-activedescendant"), new RegExp(`-prefix-option-${selectedIndex + 1}$`));
    await page.keyboard.press("ArrowUp");
    assert.match(await combobox.getAttribute("aria-activedescendant"), new RegExp(`-prefix-option-${selectedIndex}$`));
    await page.keyboard.press("End");
    await page.waitForFunction(() => {
      const area = document.querySelector('[role="listbox"]').firstElementChild;
      return area.scrollTop + area.clientHeight >= area.scrollHeight - 1;
    });
    assert.match(await combobox.getAttribute("aria-activedescendant"), /-prefix-option-47$/);
    assert.equal(await isActiveOptionVisible(combobox), true, "End revela la última");
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop === 0);
    assert.match(await combobox.getAttribute("aria-activedescendant"), /-prefix-option-0$/);
    // Bajar hasta u6, que no cabe entre las tres primeras filas: el área la acompaña.
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press("ArrowDown");
      assert.equal(await isActiveOptionVisible(combobox), true, `ArrowDown ${step + 1} mantiene visible la activa`);
    }
    assert.ok(await optionsScrollTop(page) > 0, "La navegación desplazó el área");
    await page.keyboard.press("Enter");
    await listbox.waitFor({ state: "detached" });
    assert.equal(await combobox.textContent(), "u6");
    assert.equal(await combobox.evaluate((element) => element === document.activeElement), true, "El foco vuelve al disparador");
    await page.keyboard.press("ArrowDown");
    await listbox.waitFor();
    await page.keyboard.press("Escape");
    await listbox.waitFor({ state: "detached" });
    assert.equal(await dialog.isVisible(), true);
  });
}

test("táctil (móvil): arrastrar el dedo desplaza las 48 unidades sin barra, sin cerrar ni seleccionar", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  backend.baseUnits = FORTY_EIGHT_UNITS;
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", viewport: { width: 375, height: 812 }, hasTouch: true });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
  const combobox = dialog.getByRole("combobox");
  await combobox.click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  assert.equal((await measureHiddenScroll(page)).systemScrollbars, 0);
  const box = await listbox.boundingBox();
  // Arrastrar hacia arriba desplaza hacia abajo; después, hacia abajo vuelve atrás.
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height - 20 }, -60);
  await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop > 0);
  const afterUp = await optionsScrollTop(page);
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + 20 }, 40);
  await page.waitForFunction((start) => document.querySelector('[role="listbox"]').firstElementChild.scrollTop < start, afterUp);
  // El gesto no es un toque: el menú sigue abierto y la selección no cambia.
  assert.equal(await combobox.getAttribute("aria-expanded"), "true");
  assert.equal(await combobox.textContent(), "u1");
  // Un toque sobre una unidad que no era visible al abrir la selecciona: antes se arrastra hasta
  // dejar atrás las tres primeras filas (35 px + 4 px de gap cada una).
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height - 10 }, -90);
  await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop >= 3 * 39);
  const target = await listbox.evaluate((list) => {
    const area = list.firstElementChild.getBoundingClientRect();
    return [...list.querySelectorAll('[role="option"]')].slice(3).find((option) => {
      const rect = option.getBoundingClientRect();
      return rect.top >= area.top - 0.5 && rect.bottom <= area.bottom + 0.5;
    })?.textContent;
  });
  assert.ok(target, "Tras el gesto hay unidades antes ocultas a la vista");
  await listbox.getByRole("option").filter({ hasText: new RegExp(`^${target}$`) }).tap();
  await listbox.waitFor({ state: "detached" });
  assert.equal(await combobox.textContent(), target);
});

/**
 * Mide el modal «Nueva unidad de medida» y su footer, y, si el listado está abierto, su relación
 * con el segmento m² y con el viewport. Para comprobar que el listado flota por encima sin
 * recortarse muestrea con elementFromPoint sus esquinas interiores y su centro: si el modal, su
 * footer u otro ancestro lo taparan o recortaran, esos puntos no pertenecerían al listado.
 *
 * @param {import("playwright").Page} page - Página con el formulario abierto.
 * @returns {Promise<Object>} Geometría real del modal, de sus acciones y del listado.
 */
function measureFloatingDropdown(page) {
  return page.evaluate(() => {
    const round = (rect) => ({ top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) });
    const dialog = document.querySelector("[data-measurement-unit-form]");
    const buttons = [...dialog.querySelector("footer").querySelectorAll("button")];
    const closed = {
      dialog: round(dialog.getBoundingClientRect()),
      buttons: buttons.map((button) => round(button.getBoundingClientRect())),
      reserve: Boolean(document.querySelector("[data-input-options-reserve]")),
      buttonsReachable: buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }),
    };
    const listbox = document.querySelector('[role="listbox"]');
    if (!listbox) return closed;
    const list = listbox.getBoundingClientRect();
    const segment = dialog.querySelector('[role="combobox"]').getBoundingClientRect();
    // Puntos medios de cada borde (2 px hacia dentro) y centro: las esquinas son redondeadas y el
    // hit testing respeta border-radius, así que un punto en ellas no pertenece al panel.
    const inset = 2;
    const centerX = (list.left + list.right) / 2;
    const centerY = (list.top + list.bottom) / 2;
    const samples = [
      [centerX, list.top + inset], [centerX, list.bottom - inset],
      [list.left + inset, centerY], [list.right - inset, centerY], [centerX, centerY],
    ];
    const describe = (element) => (element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${String(element.className).slice(0, 60)}` : "ninguno");
    const covered = samples
      .map(([x, y]) => ({ x: Math.round(x), y: Math.round(y), hit: document.elementFromPoint(x, y) }))
      .filter((sample) => !listbox.contains(sample.hit))
      .map((sample) => ({ x: sample.x, y: sample.y, hit: describe(sample.hit) }));
    const footer = dialog.querySelector("footer").getBoundingClientRect();
    return {
      ...closed,
      list: round(list),
      optionsAreaHeight: Math.round(listbox.firstElementChild.clientHeight),
      onTop: covered.length === 0,
      covered,
      insideViewport: list.top >= 0 && list.left >= 0 && list.bottom <= window.innerHeight + 0.5 && list.right <= window.innerWidth + 0.5,
      anchored: Math.abs(list.left - (segment.left - 1)) < 0.5
        && (Math.abs(list.top - segment.bottom) < 0.5 || Math.abs(list.bottom - segment.top) < 0.5),
      // Solo informativo: se admite que el listado flotante cubra temporalmente el footer.
      coversFooter: list.bottom > footer.top && list.top < footer.bottom,
    };
  });
}

/**
 * Comprueba que el modal y sus acciones conservan exactamente su geometría de referencia (sin
 * crecer ni desplazarse) y que no existe ningún espaciador de reserva.
 *
 * @param {Object} reference - Medida con el listado cerrado.
 * @param {Object} current - Medida a comparar.
 * @param {string} label - Contexto para el mensaje de error.
 * @returns {void}
 */
function assertModalUnchanged(reference, current, label) {
  const detail = `${label}: ${JSON.stringify({ reference, current })}`;
  assert.deepEqual(current.dialog, reference.dialog, `El modal no cambia de tamaño ni de posición. ${detail}`);
  assert.deepEqual(current.buttons, reference.buttons, `Los botones no se desplazan. ${detail}`);
  assert.equal(current.reserve, false, `No se reserva espacio bajo el campo. ${detail}`);
}

for (const theme of ["light", "dark"]) {
  test(`posicionamiento (${theme}): el listado flota sobre el modal sin cambiar su altura ni mover las acciones en 375–1440 px`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de construcción")]);
    backend.baseUnits = FORTY_EIGHT_UNITS;
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport: { width: 1440, height: 1000 } });
    await page.getByText("UNID-001", { exact: true }).waitFor();
    for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1440, 1000]]) {
      const size = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "Añadir unidad" }).click();
      const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
      await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
      const reference = await measureFloatingDropdown(page);
      assert.equal(reference.buttonsReachable, true, `${size}: acciones accesibles antes de abrir`);

      const combobox = dialog.getByRole("combobox");
      await combobox.click();
      const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
      await listbox.waitFor();
      const open = await measureFloatingDropdown(page);
      assertModalUnchanged(reference, open, `${size} abierto`);
      assert.deepEqual(
        { onTop: open.onTop, insideViewport: open.insideViewport, anchored: open.anchored, optionsAreaHeight: open.optionsAreaHeight },
        { onTop: true, insideViewport: true, anchored: true, optionsAreaHeight: 113 },
        `${size}: el listado flota completo, por encima y unido al segmento m². ${JSON.stringify(open)}`,
      );

      // Todas las opciones siguen accesibles: la rueda desplaza el listado y End alcanza la
      // última, que queda visible y por encima de cualquier contenido del modal.
      const box = await listbox.boundingBox();
      await page.mouse.move(box.x + 16, box.y + 30);
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop > 0);
      await combobox.focus();
      await page.keyboard.press("End");
      const last = listbox.getByRole("option").last();
      await page.waitForFunction(() => {
        const area = document.querySelector('[role="listbox"]').firstElementChild;
        return area.scrollTop + area.clientHeight >= area.scrollHeight - 1;
      });
      assert.equal(await last.evaluate((option) => {
        const rect = option.getBoundingClientRect();
        return option.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }), true, `${size}: la última opción es alcanzable`);
      assertModalUnchanged(reference, await measureFloatingDropdown(page), `${size} tras desplazar`);

      // Escape cierra el listado (no el modal): las acciones vuelven a estar accesibles.
      await page.keyboard.press("Escape");
      await listbox.waitFor({ state: "detached" });
      assert.equal(await dialog.isVisible(), true);
      const afterEscape = await measureFloatingDropdown(page);
      assertModalUnchanged(reference, afterEscape, `${size} tras Escape`);
      assert.equal(afterEscape.buttonsReachable, true, `${size}: acciones accesibles tras Escape`);

      // Un clic fuera también cierra. Quita además el foco del campo, cuyo borde enfocado mide
      // 2 px más: se compara de nuevo con el campo enfocado (sin abrir) para aislar el listado.
      await combobox.click();
      await listbox.waitFor();
      await dialog.getByRole("heading", { name: "Nueva unidad de medida" }).click();
      await listbox.waitFor({ state: "detached" });
      assert.equal((await measureFloatingDropdown(page)).buttonsReachable, true, `${size}: acciones accesibles tras clic exterior`);
      await combobox.focus();
      assert.equal(await listbox.count(), 0, "Enfocar el disparador no abre el listado");
      assertModalUnchanged(reference, await measureFloatingDropdown(page), `${size} tras clic exterior`);

      // Cancelar funciona con normalidad después de haber usado el listado.
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await dialog.waitFor({ state: "detached" });
    }
  });
}

/**
 * Espera a que el listado del prefijo quede unido al segmento: 1 px a su izquierda y con su ancho
 * + 1 px (sin abreviaturas más largas que el segmento).
 *
 * @param {import("playwright").Page} page - Página con el listado abierto.
 * @returns {Promise<void>}
 */
async function waitForAnchoredPrefixList(page) {
  await page.waitForFunction(() => {
    const segment = document.querySelector("[data-measurement-unit-form] [role=combobox]").getBoundingClientRect();
    const panel = document.querySelector('[role="listbox"]').getBoundingClientRect();
    return Math.abs(panel.width - (segment.width + 1)) < 0.6 && Math.abs(panel.left - (segment.left - 1)) < 0.6
      && Math.abs(panel.top - segment.bottom) < 0.6;
  });
}

test("anclaje: abierto durante la entrada del modal o con el segmento redimensionado, el panel sigue unido al segmento", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  backend.baseUnits = FORTY_EIGHT_UNITS;
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", viewport: { width: 1440, height: 1000 } });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  const combobox = dialog.getByRole("combobox");
  // Abrir el listado en cuanto aparece el diálogo, durante su transición de entrada (translate +
  // scale): al terminar, el panel debe medirse de nuevo en lugar de quedarse en la geometría intermedia.
  await combobox.click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  await waitForAnchoredPrefixList(page);
  // Reajuste del segmento sin cambiar la ventana (como al cargar la fuente definitiva).
  await combobox.evaluate((element) => { element.style.paddingInline = "40px"; });
  await waitForAnchoredPrefixList(page);
  await page.keyboard.press("Escape");
  await listbox.waitFor({ state: "detached" });
});

test("posicionamiento: tras cerrar el listado flotante, Crear valida y envía con normalidad", async (context) => {
  // Catálogo por defecto: el backend simulado resuelve la unidad enviada en BASE_UNITS.
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", viewport: { width: 1024, height: 768 } });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  const combobox = dialog.getByRole("combobox");
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });

  // Cerrado con Escape: Crear recibe el clic y valida el nombre vacío.
  await combobox.click();
  await listbox.waitFor();
  await page.keyboard.press("Escape");
  await listbox.waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("Escribe el nombre de la unidad.").waitFor();

  // Cerrado al seleccionar con el puntero: Crear envía la unidad elegida una sola vez.
  await combobox.click();
  await listbox.waitFor();
  await listbox.getByRole("option", { name: "hrs, Hora" }).click();
  await listbox.waitFor({ state: "detached" });
  await dialog.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de prueba");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.waitFor({ state: "detached" });
  const posts = backend.requests.filter((request) => request.method === "POST");
  assert.deepEqual(posts.map((request) => request.body), [{ denomination: "de prueba", measurementUnitId: 20 }]);
});

test("posicionamiento: con poco alto el listado acompaña al segmento sin salir del viewport ni cambiar el modal", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  backend.baseUnits = FORTY_EIGHT_UNITS;
  // 250 px: el modal (242 px de contenido) supera su máximo (100dvh − 32 px) y el formulario
  // desplaza por sí mismo; abrir el listado no lo altera.
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", viewport: { width: 1024, height: 250 } });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
  const reference = await measureFloatingDropdown(page);
  await dialog.getByRole("combobox").click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  let layout = await measureFloatingDropdown(page);
  assertModalUnchanged(reference, layout, "1024x250 abierto");
  assert.deepEqual({ insideViewport: layout.insideViewport, anchored: layout.anchored, onTop: layout.onTop }, { insideViewport: true, anchored: true, onTop: true }, JSON.stringify(layout));
  // El modal está limitado al viewport: su formulario desplaza y el listado sigue al segmento.
  const scrolled = await page.evaluate(() => {
    const form = document.querySelector("#measurement-unit-form");
    form.scrollTop = form.scrollHeight;
    return { scrollable: form.scrollHeight > form.clientHeight, scrollTop: form.scrollTop };
  });
  assert.equal(scrolled.scrollable, true, "Con 250 px de alto el formulario debe desplazarse");
  await page.waitForFunction(() => {
    const list = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
    const segment = document.querySelector("[data-measurement-unit-form] [role=combobox]").getBoundingClientRect();
    return list && (Math.abs(list.top - segment.bottom) < 0.5 || Math.abs(list.bottom - segment.top) < 0.5);
  });
  layout = await measureFloatingDropdown(page);
  assert.deepEqual({ insideViewport: layout.insideViewport, anchored: layout.anchored }, { insideViewport: true, anchored: true }, `Tras desplazar el modal: ${JSON.stringify(layout)}`);
  // Sin barra visible, la rueda sigue desplazando el listado en este espacio reducido.
  const before = await optionsScrollTop(page);
  const listBox = await listbox.boundingBox();
  await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
  await page.mouse.wheel(0, 60);
  await page.waitForFunction((start) => document.querySelector('[role="listbox"]').firstElementChild.scrollTop > start, before);
});

/**
 * Mide las proporciones horizontales del listado de abreviaturas abierto: panel, segmento m²,
 * ancho interior disponible para las filas y texto de cada abreviatura.
 *
 * @param {import("playwright").Page} page - Página con el listado abierto.
 * @returns {Promise<Object>} Medidas reales redondeadas a décimas.
 */
function measureDropdownProportions(page) {
  return page.evaluate(() => {
    const tenth = (value) => Math.round(value * 10) / 10;
    const listbox = document.querySelector('[role="listbox"]');
    const list = listbox.getBoundingClientRect();
    const listStyle = getComputedStyle(listbox);
    const segment = document.querySelector("[data-measurement-unit-form] [role=combobox]").getBoundingClientRect();
    const rows = [...listbox.querySelectorAll('[role="option"]')].map((option) => {
      const row = option.getBoundingClientRect();
      const label = option.querySelector("span:last-child") ?? option;
      const text = label.getBoundingClientRect();
      return {
        symbol: option.textContent,
        rowLeft: tenth(row.left),
        rowRight: tenth(row.right),
        textLeftInset: tenth(text.left - row.left),
        textRightInset: tenth(row.right - text.right),
        clipped: label.scrollWidth > label.clientWidth + 0.5,
      };
    });
    return {
      listWidth: tenth(list.width),
      listLeft: tenth(list.left),
      listRight: tenth(list.right),
      innerLeft: tenth(list.left + parseFloat(listStyle.borderLeftWidth) + parseFloat(listStyle.paddingLeft)),
      innerRight: tenth(list.right - parseFloat(listStyle.borderRightWidth) - parseFloat(listStyle.paddingRight)),
      segmentWidth: tenth(segment.width),
      viewportWidth: window.innerWidth,
      systemScrollbars: listbox.querySelectorAll('[role="scrollbar"]').length,
      rows,
    };
  });
}

/**
 * Comprueba la composición compacta sin barra: las filas ocupan todo el ancho interior del
 * panel (no queda hueco reservado para un scrollbar), las abreviaturas se alinean a la izquierda
 * con el padding de 8 px, no se recortan y el panel no desborda el viewport.
 *
 * @param {Object} layout - Resultado de measureDropdownProportions.
 * @param {string} label - Contexto para los mensajes.
 * @returns {void}
 */
function assertCompactProportions(layout, label) {
  const detail = `${label}: ${JSON.stringify(layout)}`;
  assert.equal(layout.systemScrollbars, 0, `Sin ScrollBar visible. ${detail}`);
  for (const row of layout.rows) {
    assert.ok(Math.abs(row.rowLeft - layout.innerLeft) < 0.6 && Math.abs(row.rowRight - layout.innerRight) < 0.6, `La fila ${row.symbol} ocupa todo el ancho interior. ${detail}`);
    assert.equal(row.textLeftInset, 8, `${row.symbol} alineado a la izquierda. ${detail}`);
    assert.ok(row.textRightInset >= 7.5, `${row.symbol} conserva su padding derecho. ${detail}`);
    assert.equal(row.clipped, false, `${row.symbol} sin recortar. ${detail}`);
  }
  assert.ok(layout.listLeft >= 0 && layout.listRight <= layout.viewportWidth, `Sin desborde horizontal. ${detail}`);
}

for (const theme of ["light", "dark"]) {
  test(`proporciones (${theme}): listado compacto sin barra visible en 375–1440 px sin cambiar el modal`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de construcción")]);
    backend.baseUnits = FORTY_EIGHT_UNITS;
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport: { width: 1440, height: 1000 } });
    await page.getByText("UNID-001", { exact: true }).waitFor();
    for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1440, 1000]]) {
      const size = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "Añadir unidad" }).click();
      const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
      await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
      const reference = await measureFloatingDropdown(page);
      const combobox = dialog.getByRole("combobox");
      await combobox.click();
      const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
      await listbox.waitFor();

      const layout = await measureDropdownProportions(page);
      assertCompactProportions(layout, size);
      // Abreviaturas cortas: el panel no crece más allá del segmento m² (+1 px de anclaje).
      assert.ok(Math.abs(layout.listWidth - (layout.segmentWidth + 1)) < 0.6, `${size}: ancho compacto. ${JSON.stringify(layout)}`);
      const open = await measureFloatingDropdown(page);
      assertModalUnchanged(reference, open, `${size} abierto`);
      assert.deepEqual(
        { onTop: open.onTop, anchored: open.anchored, insideViewport: open.insideViewport, optionsAreaHeight: open.optionsAreaHeight },
        { onTop: true, anchored: true, insideViewport: true, optionsAreaHeight: 113 },
        `${size}: tres filas visibles, por encima y unido al segmento m². ${JSON.stringify(open)}`,
      );
      assert.equal((await measureHiddenScroll(page)).fullyVisibleRows, 3, `${size}: tres símbolos visibles`);

      // Sin barra, la rueda sigue desplazando el listado en este ancho.
      const box = await listbox.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 30);
      await page.mouse.wheel(0, 80);
      await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop > 0);

      await page.keyboard.press("Escape");
      await listbox.waitFor({ state: "detached" });
      assertModalUnchanged(reference, await measureFloatingDropdown(page), `${size} tras cerrar`);
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await dialog.waitFor({ state: "detached" });
    }
  });
}

test("proporciones: una abreviatura larga ensancha el panel lo justo, sin recorte ni barra", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  backend.baseUnits = [
    ...FORTY_EIGHT_UNITS.slice(0, 6),
    { id: 400, code: "density", name: "Kilogramo por metro cúbico", symbol: "kg/m³·día", allowsDecimals: true, isActive: true, sortOrder: 99 },
  ];
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", viewport: { width: 375, height: 812 } });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
  await dialog.getByRole("combobox").click();
  await page.getByRole("listbox", { name: "Abreviatura de la unidad base" }).waitFor();
  const layout = await measureDropdownProportions(page);
  assertCompactProportions(layout, "375x812 abreviatura larga");
  const longRow = layout.rows.find((row) => row.symbol === "kg/m³·día");
  assert.ok(layout.listWidth > layout.segmentWidth + 1, `El panel crece por el contenido. ${JSON.stringify(layout)}`);
  // Ajustado al contenido: la fila más larga solo conserva su padding de 8 px.
  assert.ok(longRow.textRightInset < 8.6, `Sin ancho sobrante. ${JSON.stringify(layout)}`);
});

test("scroll: el ScrollBar del selector telefónico sigue arrastrándose (sin regresión)", async (context) => {
  const backend = createBackend([]);
  const page = await openModule(context, backend, { path: "/usuarios" });
  const phoneDialog = await openNewUserDialog(page);
  await phoneDialog.getByRole("combobox", { name: /Buscar código de país/ }).first().focus();
  await page.getByRole("listbox", { name: "Países y códigos telefónicos" }).waitFor();
  await dragScrollThumb(page, "Desplazar países", 40);
  const afterDown = await optionsScrollTop(page);
  assert.ok(afterDown > 100, `scrollTop=${afterDown}`);
  await dragScrollThumb(page, "Desplazar países", -20);
  assert.ok(await optionsScrollTop(page) < afterDown);
  assert.equal(await page.getByRole("listbox", { name: "Países y códigos telefónicos" }).isVisible(), true);
});

for (const theme of ["light", "dark"]) {
  test(`responsive (${theme}): sin desborde de página; tabla, modal y listado dentro del viewport`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de recorrido comercial con un nombre bastante largo para probar el truncado")]);
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport: { width: 375, height: 812 } });
    await page.getByText("UNID-001", { exact: true }).waitFor();
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const scroller = document.querySelector("main > div > .overflow-y-auto");
        const tabs = document.querySelector('[role="tablist"][aria-label="Secciones de servicios y cotizaciones"]');
        const table = document.querySelector("table").closest(".overflow-x-auto");
        return {
          page: Math.max(scroller.scrollWidth - scroller.clientWidth, document.documentElement.scrollWidth - window.innerWidth),
          tabsInside: tabs.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 0.5,
          tableInside: table.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 0.5,
        };
      });
      assert.deepEqual(layout, { page: 0, tabsInside: true, tableInside: true }, `desborde a ${width} px`);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Añadir unidad" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
    await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
    await dialog.getByRole("combobox").click();
    const geometry = await page.evaluate(() => {
      const rect = (element) => element.getBoundingClientRect();
      const dialogRect = rect(document.querySelector("[data-measurement-unit-form]"));
      const listRect = rect(document.querySelector('[role="listbox"]'));
      const segment = rect(document.querySelector('[data-measurement-unit-form] [role="combobox"]'));
      const field = rect(document.querySelector("[data-measurement-unit-form] [data-input-shell]"));
      return {
        dialogInside: dialogRect.left >= 0 && dialogRect.right <= window.innerWidth,
        listInside: listRect.top >= 0 && listRect.bottom <= window.innerHeight && listRect.right <= window.innerWidth,
        // Extensión del segmento m² (no del campo): borde izquierdo y ancho mínimo del segmento.
        listAnchored: Math.abs(listRect.left - (segment.left - 1)) < 0.5 && listRect.width >= segment.width + 0.5,
        notFieldWidth: listRect.width < field.width - 1,
      };
    });
    assert.deepEqual(geometry, { dialogInside: true, listInside: true, listAnchored: true, notFieldWidth: true });

    // Poco espacio vertical: el listado se reubica (abajo o arriba) sin salir del viewport ni
    // quedar por detrás del modal.
    await page.setViewportSize({ width: 1024, height: 360 });
    await page.waitForFunction(() => {
      const list = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
      const segment = document.querySelector('[data-measurement-unit-form] [role="combobox"]')?.getBoundingClientRect();
      return list && segment && Math.abs(list.left - (segment.left - 1)) < 0.5 && list.top >= 0 && list.bottom <= window.innerHeight;
    });
    const stacking = await page.evaluate(() => {
      const list = document.querySelector('[role="listbox"]');
      const rect = list.getBoundingClientRect();
      const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20);
      return list.contains(topElement);
    });
    assert.equal(stacking, true, "El listado queda por encima del modal y su overlay");
  });
}

const UNITS_SCROLLBAR = "Desplazar tabla de unidades horizontalmente";

for (const theme of ["light", "dark"]) {
  test(`ScrollBar horizontal de la tabla de unidades (${theme}): 320–1920 px, cambio de página y gesto táctil`, async (context) => {
    const backend = createBackend(Array.from({ length: 12 }, (_, index) => denomination(index + 1, 1, `de prueba ${index + 1}`)));
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport: { width: 320, height: 700 }, hasTouch: true });
    await page.getByText("UNID-001", { exact: true }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
    const results = {};
    for (const [width, height] of [[320, 700], [375, 812], [390, 844], [768, 1024], [1024, 768], [1440, 1000], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      results[width] = await assertHorizontalTableScroll(page, UNITS_SCROLLBAR, `${theme} ${width}px`);
    }
    // La tabla mide 512 px como mínimo: solo desborda en móvil; desde tablet no hay barra.
    assert.deepEqual([results[320], results[375], results[390], results[768], results[1440], results[1920]], [true, true, true, false, false, false]);

    // Cambiar de página sustituye las filas: la barra se recalcula y la paginación queda fuera.
    await page.setViewportSize({ width: 375, height: 812 });
    await waitForScrollBarSync(page, UNITS_SCROLLBAR);
    assert.equal(await page.locator("[data-horizontal-scroll-viewport] nav[aria-label='Paginación de unidades']").count(), 0);
    await page.getByRole("button", { name: "Siguiente pág.", exact: true }).click();
    await page.getByText("UNID-011", { exact: true }).waitFor();
    assert.equal(await assertHorizontalTableScroll(page, UNITS_SCROLLBAR, `${theme} página 2`), true);
    await touchSwipeTable(page, -150);
    await page.waitForFunction((label) => Number(document.querySelector(`[role="scrollbar"][aria-label="${label}"]`)?.getAttribute("aria-valuenow")) > 0, UNITS_SCROLLBAR);
    // El menú contextual de la última columna sigue abriéndose tras desplazar.
    await page.getByRole("button", { name: "Más opciones para UNID-011", exact: true }).click();
    await page.getByRole("menuitem", { name: "Desactivar", exact: true }).waitFor();
    await page.keyboard.press("Escape");
  });
}
