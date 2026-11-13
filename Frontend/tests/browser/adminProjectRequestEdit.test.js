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
const FORM_PATH = "/api/admin/project-requests/9/form";
const DETAIL_PATH = "/api/admin/project-requests/9";
const EDIT_ROUTE = "/solicitudes-proyecto/9/editar";
const VERSION = "2026-10-02T12:00:00.123Z";
// Solicitud ficticia con la forma de GET /admin/project-requests/:id/form (datos aislados). Incluye
// un false (propietarios), opcionales vacíos (null) y dos adjuntos.
const FORM_REQUEST = Object.freeze({
  capitalAvailability: "available_now",
  clientId: 3,
  compatibility: { level: "excellent", score: 92 },
  completeness: { answered: 12, applicable: 13, missingFields: ["experience"], score: 92.3 },
  createdAt: "2026-10-01T12:00:00.000Z",
  decisionMaker: "self",
  description: "Remodelación integral de una vivienda con áreas abiertas y materiales sostenibles.",
  developmentMode: "full",
  editable: true,
  experience: null,
  files: [
    { createdAt: "2026-10-01T12:05:00.000Z", fileType: "application/pdf", id: 31, name: "plano.pdf", size: 2048 },
    { createdAt: "2026-10-01T12:06:00.000Z", fileType: "image/png", id: 32, name: "fachada.png", size: 5242880 },
  ],
  financialViability: { findings: [], score: 100, status: "VIABLE" },
  formattedAddress: "Maracaibo, Zulia, Venezuela",
  hasMultipleOwners: false,
  hasPlans: true,
  id: 9,
  investmentRange: "10k_50k",
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"],
  location: "Maracaibo, Zulia",
  locationCoordinates: { latitude: 10.6545, longitude: -71.6406 },
  projectName: "Casa Prueba",
  projectSize: null,
  projectType: "residential",
  providerPlaceId: "place-1",
  quality: null,
  referenceLink: null,
  requestedBy: 11,
  standRequirements: null,
  startTime: "immediate",
  status: "pending_review",
  updatedAt: VERSION,
});
// Consulta administrativa a la que se vuelve tras guardar o cancelar.
const DETAIL_REQUEST = Object.freeze({
  ...FORM_REQUEST,
  assignees: [],
  convertedProject: null,
  reviewObservations: [],
  reviews: [],
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
 * Abre «Editar solicitud» aislando HTTP: toda mutación pasa por `save` (sin él, falla la prueba)
 * y cualquier lectura no prevista (incluida la búsqueda de direcciones, que pasa por /api) también.
 *
 * @param {Object} context - Contexto de node:test.
 * @param {Object} [options] - Viewport, respuesta del formulario, manejador del guardado y espera inicial.
 * @returns {Promise<{page: import("playwright").Page, reads: Array<string>, mutations: Array<Object>}>} Página y tráfico.
 */
async function openEdit(context, { form = { json: { projectRequest: FORM_REQUEST } }, save = null, viewport = { height: 1000, width: 1440 }, waitFor = "Editar solicitud" } = {}) {
  const session = await browser.newContext({ viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  const reads = [];
  const mutations = [];
  await page.addInitScript(() => {
    localStorage.setItem("arca-theme", "light");
    history.replaceState({ usr: { from: { label: "Gestión de proyectos", to: "/gestion-proyectos" } }, key: "test", idx: 0 }, "");
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      const call = { body: route.request().postDataJSON(), method: route.request().method(), path: pathname };
      mutations.push(call);
      if (save && pathname === FORM_PATH && call.method === "PUT") return save(route, call);
      errors.push(`Mutación no autorizada: ${call.method} ${pathname}`);
      return route.abort();
    }
    reads.push(pathname);
    if (pathname === FORM_PATH) return route.fulfill(typeof form === "function" ? await form() : form);
    if (pathname === DETAIL_PATH) return route.fulfill({ json: { projectRequest: DETAIL_REQUEST } });
    if (/^\/api\/project-requests\/9\/files\/\d+\/content$/.test(pathname)) return route.fulfill({ body: Buffer.alloc(0), status: 404 });
    const payload = {
      "/api/auth/me": { user: { email: "admin@example.test", firstName: "Admin", id: 1, lastName: "Prueba", role: "admin", status: "active" } },
      "/api/projects": { nextCursor: null, projects: [] },
    }[pathname];
    if (!payload) errors.push(`Lectura no prevista: ${pathname}`);
    return route.fulfill({ json: payload || {}, status: payload ? 200 : 404 });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}${EDIT_ROUTE}`);
  await page.getByRole("heading", { name: waitFor }).first().waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready);
  return { mutations, page, reads };
}

/** Elige una opción de un SelectField (DropdownMenu de selección única). */
async function choose(page, fieldLabel, optionLabel) {
  await page.getByRole("button", { name: fieldLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: optionLabel, exact: true }).click();
}

const saveButton = (page) => page.getByRole("button", { name: "Guardar cambios" });
const nameField = (page) => page.getByRole("textbox", { name: "Nombre del proyecto" });
const descriptionField = (page) => page.getByRole("textbox", { name: "Descripción del proyecto" });

for (const width of WIDTHS) {
  test(`${width}px: precarga la solicitud real en el mismo formulario, sin desbordes ni búsquedas de direcciones`, async (context) => {
    const { mutations, page, reads } = await openEdit(context, { viewport: { height: 900, width } });
    assert.equal(await nameField(page).inputValue(), "Casa Prueba");
    assert.equal(await page.getByRole("combobox", { name: "Ubicación del proyecto" }).inputValue(), "Maracaibo, Zulia");
    assert.equal(await descriptionField(page).inputValue(), FORM_REQUEST.description);
    await page.getByRole("button", { name: "Tipo de proyecto", exact: true }).filter({ hasText: "Residencial" }).waitFor();
    await page.getByRole("button", { name: "¿El inmueble tiene más de un propietario?", exact: true }).filter({ hasText: "No" }).waitFor();
    await page.getByRole("heading", { name: "Documentación legal del inmueble" }).waitFor();
    // Opcionales sin dato: vacíos, no con un valor inventado.
    assert.equal(await page.getByRole("textbox", { name: /Link de referencia/ }).inputValue(), "");
    // Adjuntos guardados, como parte de la solicitud y sin acciones.
    // Las tarjetas muestran el nombre sin extensión.
    for (const name of ["plano", "fachada"]) await page.getByText(name, { exact: true }).first().waitFor();
    assert.equal(await page.getByText("Adjunto de la solicitud").count(), 2);
    assert.equal(await page.getByRole("button", { name: /Eliminar archivo/ }).count(), 0);
    await page.getByText(/Solo el cliente puede añadir o eliminar archivos/).waitFor();
    // Acciones del modo edición y navegación administrativa.
    assert.equal(await saveButton(page).isDisabled(), true, "sin cambios no hay nada que guardar");
    await page.getByRole("button", { name: "Cancelar" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Enviar" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Limpiar formulario" }).count(), 0);
    await page.getByRole("link", { name: "Gestión de proyectos" }).first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `desborde horizontal de ${overflow}px`);
    assert.deepEqual(reads.filter((read) => read === FORM_PATH), [FORM_PATH], "una sola lectura de la solicitud");
    assert.deepEqual(mutations, []);
  });
}

test("guardar envía solo las respuestas con la versión, no cambia el estado y vuelve a la consulta con confirmación", async (context) => {
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const { mutations, page, reads } = await openEdit(context, {
    save: async (route, call) => {
      await saveGate;
      return route.fulfill({ json: { changedFields: ["description"], projectRequest: { ...FORM_REQUEST, description: call.body.description, updatedAt: "2026-10-03T08:00:00.000Z" } } });
    },
  });
  await descriptionField(page).fill("Remodelación integral de una vivienda con áreas abiertas, piscina y materiales sostenibles.");
  assert.equal(await saveButton(page).isEnabled(), true);
  await saveButton(page).click();
  await page.getByRole("button", { name: "Guardando" }).waitFor();
  // Un segundo intento mientras guarda no genera otra petición.
  await page.getByRole("button", { name: "Guardando" }).click({ force: true });
  releaseSave();
  await page.getByText("Solicitud actualizada").first().waitFor();
  await page.waitForURL(`${origin}/solicitudes-proyecto/9`);
  assert.equal(mutations.length, 1);
  const [{ body, method, path }] = mutations;
  assert.equal(method, "PUT");
  assert.equal(path, FORM_PATH);
  assert.equal(body.expectedUpdatedAt, VERSION);
  assert.equal(body.description, "Remodelación integral de una vivienda con áreas abiertas, piscina y materiales sostenibles.");
  assert.equal(body.hasMultipleOwners, false, "el false existente se conserva");
  assert.equal(body.experience, null);
  for (const field of ["status", "clientId", "submissionId", "assigneeIds"]) assert.equal(field in body, false, field);
  assert.ok(reads.includes(DETAIL_PATH), "la consulta vuelve a leer el estado vigente");
  // «Atrás» no regresa al formulario guardado (navegación con replace).
  assert.equal(await page.evaluate(() => window.history.state?.usr?.projectRequestSaved), undefined, "el aviso no queda en el historial");
});

test("cancelar con cambios pide confirmación, permite seguir editando y no modifica nada", async (context) => {
  const { mutations, page } = await openEdit(context);
  await nameField(page).fill("Casa Prueba Ampliada");
  await page.getByRole("button", { name: "Cancelar" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "¿Deseas descartar los cambios?" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Volver" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await nameField(page).inputValue(), "Casa Prueba Ampliada", "lo escrito se conserva");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await dialog.getByRole("button", { name: "Descartar" }).click();
  await page.waitForURL(`${origin}/solicitudes-proyecto/9`);
  assert.deepEqual(mutations, []);
});

test("cancelar sin cambios vuelve a la consulta sin confirmación", async (context) => {
  const { mutations, page } = await openEdit(context);
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.waitForURL(`${origin}/solicitudes-proyecto/9`);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(mutations, []);
});

test("los errores de validación y de conflicto se muestran sin perder lo ingresado", async (context) => {
  const { mutations, page } = await openEdit(context, {
    save: (route) => route.fulfill({ json: { code: "PROJECT_REQUEST_EDIT_CONFLICT", message: "La solicitud cambió." }, status: 409 }),
  });
  await nameField(page).fill("");
  await saveButton(page).click();
  await page.getByText("Ingresa al menos 3 caracteres.").first().waitFor();
  await page.getByText("Por favor, proporcione la información necesaria.").first().waitFor();
  assert.deepEqual(mutations, [], "con errores del formulario no se llama a la API");
  await nameField(page).fill("Casa Prueba Renovada");
  await saveButton(page).click();
  await page.getByText("La solicitud cambió", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Recargar" }).waitFor();
  assert.equal(await nameField(page).inputValue(), "Casa Prueba Renovada");
  assert.equal(page.url(), `${origin}${EDIT_ROUTE}`);
  assert.equal(mutations.length, 1);
});

test("cambiar el tipo de proyecto y volver conserva la información del inmueble", async (context) => {
  const { page } = await openEdit(context);
  await choose(page, "Tipo de proyecto", "Stand publicitario");
  await page.getByRole("heading", { name: "Documentación legal del inmueble" }).waitFor({ state: "detached" });
  await choose(page, "Tipo de proyecto", "Residencial");
  await page.getByRole("heading", { name: "Documentación legal del inmueble" }).waitFor();
  await page.getByRole("button", { name: "¿El inmueble tiene más de un propietario?", exact: true }).filter({ hasText: "No" }).waitFor();
  assert.equal(await saveButton(page).isDisabled(), true, "volver al valor original no deja cambios pendientes");
});

test("una solicitud con decisión no ofrece el formulario y enlaza a su consulta", async (context) => {
  const { mutations, page } = await openEdit(context, {
    form: { json: { projectRequest: { ...FORM_REQUEST, editable: false, status: "rejected" } } },
    waitFor: "Esta solicitud ya no se puede editar",
  });
  assert.equal(await nameField(page).count(), 0);
  await page.getByRole("button", { name: "Ver solicitud" }).click();
  await page.waitForURL(`${origin}/solicitudes-proyecto/9`);
  assert.deepEqual(mutations, []);
});

test("muestra la carga con la geometría del formulario y un 404 sin formulario", async (context) => {
  let respond;
  const pending = new Promise((resolve) => { respond = resolve; });
  const session = await browser.newContext({ viewport: { height: 900, width: 1024 } });
  context.after(() => session.close());
  const page = applyBrowserTimeouts(await session.newPage());
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === FORM_PATH) {
      await pending;
      return route.fulfill({ json: { code: "PROJECT_REQUEST_NOT_FOUND", message: "Solicitud de proyecto no encontrada." }, status: 404 });
    }
    if (pathname === "/api/auth/me") return route.fulfill({ json: { user: { email: "admin@example.test", firstName: "Admin", id: 1, lastName: "Prueba", role: "admin", status: "active" } } });
    return route.fulfill({ json: { nextCursor: null, projects: [] } });
  });
  await page.goto(`${origin}${EDIT_ROUTE}`);
  await page.locator('[data-skeleton-preset="projectRequestForm"]').waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  assert.equal(await nameField(page).count(), 0, "el formulario no se monta vacío antes de los datos");
  respond();
  await page.locator('[data-state="not_found"]').waitFor();
  assert.equal(await nameField(page).count(), 0);
});
