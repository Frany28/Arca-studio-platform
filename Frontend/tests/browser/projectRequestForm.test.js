import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REQUEST_ID = 31;
// Código que el backend simulado acepta; cualquier otro responde VERIFICATION_CODE_INVALID.
const VALID_CODE = "482913";
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

// Solicitud que el backend simulado devuelve tras el envío (y en su consulta por id).
const SUBMITTED_REQUEST = { id: REQUEST_ID, projectName: "Casa Lago", status: "pending_verification", compatibility: { level: "excellent", score: 84, observations: [] }, files: [] };

/**
 * Abre la solicitud como cliente con la API simulada: registra cada llamada y responde
 * al borrador, la carga de archivos y el envío final como lo hace el backend real.
 * Con `viewRequest` abre su consulta persistente (`/solicitudes/:id`), que el backend simulado
 * responde con esa solicitud salvo que `detailResponses` indique otra cosa; `readyHeading`
 * es el encabezado que marca la vista lista (null para no esperar ninguno).
 */
async function openRequestPage(context, { viewport = { width: 1440, height: 1000 }, touch = false, addressSuggestions = [], uploadResponses = [], initialRequest, viewRequest, readyHeading, detailResponses = [], deleteResponses = [], verificationResponses = [] } = {}) {
  const session = await browser.newContext(touch ? { hasTouch: true, isMobile: true, viewport } : { viewport });
  const page = await session.newPage();
  const calls = [];
  const errors = [];
  if (initialRequest) {
    await page.addInitScript((state) => {
      window.history.replaceState({ usr: state, key: "stand-test", idx: 0 }, "");
    }, { initialRequest });
  }
  const defaultDetail = { json: { projectRequest: viewRequest || SUBMITTED_REQUEST } };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    calls.push({ body: (method === "POST" && path === "/api/project-requests") || (method === "PATCH" && path === `/api/project-requests/${REQUEST_ID}`) || path.endsWith("/submit") ? request.postDataJSON() : null, fileName: request.headers()["x-file-name"], method, path });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: 5, firstName: "Cliente", email: "cliente@example.test", role: { code: "client", name: "Cliente" }, status: "active" } } });
    if (path === "/api/geoapify/address-suggestions") return route.fulfill({ json: { suggestions: addressSuggestions } });
    if (method === "POST" && path === "/api/project-requests") return route.fulfill({ status: 201, json: { projectRequest: { id: REQUEST_ID, status: "draft" } } });
    // Subidas: cada respuesta de uploadResponses se usa una vez; después, éxito.
    if (method === "POST" && path === `/api/project-requests/${REQUEST_ID}/files`) {
      const upload = uploadResponses.shift() || { status: 201, json: { file: { id: 1 } } };
      return typeof upload === "function" ? upload(route) : route.fulfill(upload);
    }
    // Detalle de consulta: cada respuesta de detailResponses se usa una vez; después, la última.
    // Una función decide la respuesta en cada lectura (StrictMode repite la primera en desarrollo).
    if (method === "GET" && path === `/api/project-requests/${REQUEST_ID}`) {
      const response = typeof detailResponses === "function"
        ? detailResponses()
        : detailResponses.length > 1 ? detailResponses.shift() : detailResponses[0];
      return route.fulfill(response || defaultDetail);
    }
    // Eliminación de adjuntos: cada respuesta de deleteResponses se usa una vez; después, éxito.
    if (method === "DELETE" && path.startsWith(`/api/project-requests/${REQUEST_ID}/files/`)) {
      return route.fulfill(deleteResponses.shift() || { json: { id: Number(path.split("/").pop()) } });
    }
    // Emisión del código: el backend lo envía al correo; la prueba usa VALID_CODE.
    if (method === "POST" && path === `/api/project-requests/${REQUEST_ID}/verification-code`) {
      return route.fulfill(verificationResponses.shift() || { status: 201, json: { verification: { expiresAt: "2030-01-01T00:00:00Z", resendAvailableAt: "2030-01-01T00:00:00Z" } } });
    }
    if (method === "POST" && path === `/api/project-requests/${REQUEST_ID}/submit`) {
      const { verificationCode } = request.postDataJSON() || {};
      if (verificationCode !== VALID_CODE) {
        return route.fulfill({ status: 400, json: { code: "VERIFICATION_CODE_INVALID", message: "El código no es correcto. Te quedan 4 intentos." } });
      }
      // El envío no devuelve adjuntos (la serialización JSON omite `files: undefined`).
      return route.fulfill({ json: { projectRequest: { ...SUBMITTED_REQUEST, files: undefined } } });
    }
    return route.fulfill({ json: {} });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(viewRequest ? `${origin}/solicitudes/${REQUEST_ID}` : `${origin}/solicitudes/nueva`);
  const heading = readyHeading !== undefined ? readyHeading : viewRequest ? "Solicitud recibida" : "Solicitud de proyecto";
  if (heading) await page.getByRole("heading", { name: heading }).waitFor();
  return { calls, page };
}

/** Elige una opción de un SelectField (DropdownMenu de selección única). */
async function choose(page, fieldLabel, optionLabel) {
  await page.getByRole("button", { name: fieldLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: optionLabel, exact: true }).click();
}

const UPLOADED_LABEL = "Subido · Pendiente de enviar solicitud";
const pngFile = (name) => ({ name, mimeType: "image/png", buffer: Buffer.from(`fake-${name}`) });

const LEGAL_HEADING = "Documentación legal del inmueble";
const LEGAL_STATUS_LABEL = "¿Cuenta con documentación que acredite la situación legal del inmueble?";
const OWNERS_LABEL = "¿El inmueble tiene más de un propietario?";

/** Completa los campos obligatorios que no dependen del inmueble. */
async function fillCommonFields(page) {
  await page.getByRole("textbox", { name: "Nombre del proyecto" }).fill("Casa Lago");
  await choose(page, "Tipo de proyecto", "Residencial");
  await page.getByRole("combobox", { name: "Ubicación del proyecto" }).fill("Maracaibo, Estado Zulia");
  await page.getByRole("textbox", { name: "Descripción del proyecto" }).fill("Vivienda unifamiliar de dos plantas frente al lago, con terraza.");
  await choose(page, "¿Cómo desea desarrollar el proyecto?", "Por fases");
  await choose(page, "Rango de inversión estimado", "$10,000 - $50,000 USD");
  await choose(page, "Disponibilidad del capital", "Disponible ahora");
  await page.getByRole("button", { name: "De inmediato", exact: true }).click();
}

/** Responde la pregunta del terreno (ChoiceGroup con botones aria-pressed). */
async function chooseLand(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

const legalSection = (page) => page.getByRole("heading", { name: LEGAL_HEADING });
const landQuestion = (page) => page.getByRole("group", { name: "¿Tiene terreno o inmueble disponible?" });

const STAND_STATUS_LABEL = "¿El evento cuenta con normas o requisitos para el montaje del stand?";
const STAND_SPACE_LABEL = "¿Ya tienes asignado el espacio dentro del evento?";
const STAND_PLANS_LABEL = "¿Tienes las medidas o plano del espacio asignado?";
const standSection = (page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Requisitos del stand", exact: true }) });

/** Completa las declaraciones del evento con los controles reales del formulario. */
async function fillStandSection(page) {
  await choose(page, STAND_STATUS_LABEL, "Sí, tengo los requisitos");
  const documents = standSection(page).getByRole("button", { name: "Documentación disponible" });
  await documents.click();
  for (const name of ["Manual del expositor", "Reglamento del evento", "Otro"]) {
    await page.getByRole("menuitemcheckbox", { name, exact: true }).click();
  }
  await documents.click();
  await choose(page, STAND_SPACE_LABEL, "Sí, ya está asignado");
  await page.getByRole("checkbox", { name: STAND_PLANS_LABEL, exact: true }).click();
}

test("Stand: únicamente Stand publicitario muestra la sección; excluye la categoría histórica", async (context) => {
  const { page } = await openRequestPage(context);
  await page.getByRole("button", { name: "Tipo de proyecto", exact: true }).click();
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Residencial", "Comercial", "Corporativo", "Stand publicitario"]);
  assert.equal(await page.getByText("Stands y exhibiciones", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Tipo de proyecto", exact: true }).click();
  for (const label of ["Residencial", "Comercial", "Corporativo"]) {
    await choose(page, "Tipo de proyecto", label);
    assert.equal(await standSection(page).count(), 0, label);
    assert.equal(await landQuestion(page).count(), 1, label);
  }
  await choose(page, "Tipo de proyecto", "Stand publicitario");
  await standSection(page).waitFor();
  assert.equal(await legalSection(page).count(), 0);
  // El inmueble no aplica a un stand: el espacio se declara en sus requisitos.
  assert.equal(await landQuestion(page).count(), 0);
});

test("Stand: elegirlo con inmueble disponible descarta la pregunta y la sección legal; volver las muestra vacías", async (context) => {
  const { page } = await openRequestPage(context);
  await choose(page, "Tipo de proyecto", "Residencial");
  await chooseLand(page, "Sí, disponible");
  await legalSection(page).waitFor();
  await choose(page, "Tipo de proyecto", "Stand publicitario");
  await standSection(page).waitFor();
  assert.equal(await landQuestion(page).count(), 0);
  assert.equal(await legalSection(page).count(), 0);
  await choose(page, "Tipo de proyecto", "Residencial");
  await landQuestion(page).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sí, disponible", exact: true }).getAttribute("aria-pressed"), "false");
  assert.equal(await legalSection(page).count(), 0);
});

test("Stand → otro → Stand: limpia respuestas y errores, conserva el resto y omite datos al enviar otro tipo", async (context) => {
  const { page, calls } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await choose(page, "Tipo de proyecto", "Stand publicitario");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Indica si ya tienes asignado el espacio dentro del evento.", { exact: true }).waitFor();
  await fillStandSection(page);
  await choose(page, "Tipo de proyecto", "Comercial");
  await standSection(page).waitFor({ state: "detached" });
  await choose(page, "Tipo de proyecto", "Stand publicitario");
  assert.equal((await page.getByRole("button", { name: STAND_STATUS_LABEL, exact: true }).textContent()).trim(), "Selecciona una opción");
  assert.equal((await page.getByRole("button", { name: STAND_SPACE_LABEL, exact: true }).textContent()).trim(), "Selecciona una opción");
  assert.match(await standSection(page).getByRole("button", { name: "Documentación disponible" }).textContent(), /Selecciona la documentación/);
  assert.equal(await page.getByRole("checkbox", { name: STAND_PLANS_LABEL, exact: true }).getAttribute("aria-checked"), "mixed");
  assert.equal(await page.getByRole("textbox", { name: "Nombre del proyecto" }).inputValue(), "Casa Lago");
  await choose(page, "Tipo de proyecto", "Corporativo");
  // El stand descartó la respuesta del terreno: el otro tipo vuelve a pedirla.
  await chooseLand(page, "No todavía");
  const body = await submitWithCode(page, calls);
  assert.equal(body.projectType, "corporate");
  assert.equal(body.landStatus, "unavailable");
  assert.equal("standRequirements" in body, false);
});

test("Stand: volver de confirmación conserva respuestas y envía el bloque con inmueble N/A", async (context) => {
  const { page, calls } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await choose(page, "Tipo de proyecto", "Stand publicitario");
  await fillStandSection(page);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.match(await page.getByRole("button", { name: STAND_SPACE_LABEL, exact: true }).textContent(), /Sí, ya está asignado/);
  assert.match(await standSection(page).getByRole("button", { name: "Documentación disponible" }).textContent(), /Manual del expositor, Reglamento del evento, otros/);
  const body = await submitWithCode(page, calls);
  assert.deepEqual(body.standRequirements, { requirementsStatus: "available", documentTypes: ["exhibitor_manual", "event_regulations", "other"], spaceStatus: "assigned", hasSpacePlans: true });
  assert.equal(body.landStatus, null);
  assertNoPropertyData(body);
});

test("Stand: un borrador devuelto con inmueble guardado lo descarta y lo envía como N/A", async (context) => {
  const { page, calls } = await openRequestPage(context, { initialRequest: {
    id: REQUEST_ID, status: "changes_requested", projectType: "advertising_stand", projectName: "Stand anterior",
    location: "Maracaibo, Estado Zulia", description: "Stand modular para feria con zona de demostración.",
    developmentMode: "full", investmentRange: "10k_50k", capitalAvailability: "available_now", startTime: "immediate",
    landStatus: "available", legalDocumentationStatus: "available", legalDocumentTypes: ["property_deed"], hasMultipleOwners: true, hasPlans: false,
    standRequirements: { requirementsStatus: "unavailable", documentTypes: [], spaceStatus: "assigned", hasSpacePlans: null },
  } });
  await standSection(page).waitFor();
  assert.equal(await landQuestion(page).count(), 0);
  assert.equal(await legalSection(page).count(), 0);
  const body = await submitWithCode(page, calls);
  assert.equal(body.projectType, "advertising_stand");
  assert.equal(body.landStatus, null);
  assertNoPropertyData(body);
  assert.deepEqual(body.standRequirements, { requirementsStatus: "unavailable", documentTypes: [], spaceStatus: "assigned", hasSpacePlans: null });
});

test("Stand: restaura solicitudes devueltas y descarta documentos al cambiar disponibilidad", async (context) => {
  const { page } = await openRequestPage(context, { initialRequest: {
    id: REQUEST_ID, status: "changes_requested", projectType: "advertising_stand", projectName: "Stand restaurado",
    standRequirements: { requirementsStatus: "available", documentTypes: ["event_regulations"], spaceStatus: "in_process", hasSpacePlans: false },
  } });
  await standSection(page).waitFor();
  assert.match(await page.getByRole("button", { name: STAND_SPACE_LABEL, exact: true }).textContent(), /La asignación está en proceso/);
  assert.equal(await page.getByRole("checkbox", { name: STAND_PLANS_LABEL, exact: true }).getAttribute("aria-checked"), "false");
  await choose(page, STAND_STATUS_LABEL, "Estoy gestionando los requisitos");
  await choose(page, STAND_STATUS_LABEL, "Sí, tengo los requisitos");
  assert.match(await standSection(page).getByRole("button", { name: "Documentación disponible" }).textContent(), /Selecciona la documentación/);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1000 }, { width: 375, height: 812 }]) {
  test(`Stand ${viewport.width}px: responsive sin desbordamiento y con estilos claro/oscuro`, async (context) => {
    const { page } = await openRequestPage(context, { viewport });
    await choose(page, "Tipo de proyecto", "Stand publicitario");
    await fillStandSection(page);
    const section = standSection(page);
    const artifacts = path.join(tmpdir(), "arca-stand-requirements");
    await mkdir(artifacts, { recursive: true });
    let lightBackground;
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-bg"));
      if (theme === "light") lightBackground = background;
      else assert.notEqual(background, lightBackground);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
      const geometry = await section.evaluate((element) => ({ width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth }));
      assert.ok(geometry.scrollWidth <= Math.ceil(geometry.width));
      const documents = section.getByRole("button", { name: "Documentación disponible" });
      const bounds = await documents.locator("p").first().boundingBox();
      const arrow = await documents.locator(":scope > span").boundingBox();
      assert.ok(bounds.x + bounds.width <= arrow.x, "El texto no debe invadir la flecha");
      await documents.click();
      const menuBounds = await section.getByRole("menu").boundingBox();
      const spaceBounds = await section.getByRole("button", { name: STAND_SPACE_LABEL, exact: true }).boundingBox();
      assert.ok(spaceBounds.y >= menuBounds.y + menuBounds.height, "El menú debe ocupar espacio sin tapar preguntas");
      await section.screenshot({ path: path.join(artifacts, `stand-${viewport.width}-${theme}.png`) });
      await documents.click();
    }
    assert.ok(await page.locator(".content-reveal").count());
  });
}

/** Completa la sección legal con documentos y propietarios. */
async function fillLegalSection(page) {
  await choose(page, LEGAL_STATUS_LABEL, "Sí, tengo la documentación disponible");
  const documents = page.getByRole("button", { name: "Documentación disponible" });
  await documents.click();
  for (const name of ["Documento de propiedad", "Contrato de compra", "Otro documento"]) {
    await page.getByRole("menuitemcheckbox", { name }).click();
  }
  await documents.click();
  await page.getByText("Documento de propiedad, Contrato de compra, otros", { exact: true }).waitFor();
  await choose(page, OWNERS_LABEL, "No");
}

/** Envía con el código temporal y devuelve el formulario completo guardado en el borrador (PATCH). */
async function submitWithCode(page, calls) {
  const codeIssued = page.waitForResponse((response) => response.url().endsWith(`/project-requests/${REQUEST_ID}/verification-code`));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await codeIssued;
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByText("Enviamos un código a tu correo", { exact: true }).waitFor();
  await codeDialog.getByRole("textbox", { name: "Código" }).fill(VALID_CODE);
  const submitted = page.waitForRequest((request) => request.url().endsWith(`/project-requests/${REQUEST_ID}/submit`));
  await codeDialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await submitted;
  await page.getByRole("heading", { name: "Solicitud recibida" }).waitFor();
  return calls.filter((call) => call.body && call.method === "PATCH").at(-1).body;
}

test("Tipo histórico: se edita como Stand publicitario y se reenvía renombrado sobre la misma solicitud", async (context) => {
  const { page, calls } = await openRequestPage(context, { initialRequest: {
    id: REQUEST_ID, status: "changes_requested", projectName: "Exhibición anterior", projectType: "stands_exhibitions",
    location: "Maracaibo, Estado Zulia", description: "Diseño del espacio de exposición para el evento.",
    developmentMode: "full", landStatus: "unavailable", investmentRange: "10k_50k",
    capitalAvailability: "available_now", startTime: "over_6_months",
  } });
  const selector = page.getByRole("button", { name: "Tipo de proyecto", exact: true });
  assert.match(await selector.textContent(), /Stand publicitario/);
  assert.equal(await page.getByText("Stands y exhibiciones", { exact: true }).count(), 0);
  // Mismo servicio (Propuesta V3.3 §11): reglas del stand, sin inmueble ni sección legal.
  await standSection(page).waitFor();
  assert.equal(await landQuestion(page).count(), 0);
  assert.equal(await legalSection(page).count(), 0);
  await choose(page, STAND_SPACE_LABEL, "Sí, ya está asignado");
  const body = await submitWithCode(page, calls);
  assert.equal(body.projectType, "advertising_stand");
  assert.equal(body.landStatus, null);
  assert.equal(body.standRequirements.spaceStatus, "assigned");
  assert.equal(calls.some((call) => call.method === "POST" && call.path === "/api/project-requests"), false);
  assert.ok(calls.some((call) => call.method === "PATCH" && call.path === `/api/project-requests/${REQUEST_ID}`));
});

/** Afirma que la solicitud no transporta datos del inmueble. */
function assertNoPropertyData(body) {
  assert.equal(body.legalDocumentationStatus, null);
  assert.deepEqual(body.legalDocumentTypes, []);
  assert.equal(body.hasMultipleOwners, null);
  assert.equal(body.hasBlueprints, null);
}

test("Solicitud: enviar sin datos muestra errores, enfoca el primer campo y no llama a la API", async (context) => {
  const { calls, page } = await openRequestPage(context);
  // Sin respuesta sobre el terreno, la sección legal no existe en el formulario.
  assert.equal(await legalSection(page).count(), 0);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();

  await page.getByText("Por favor, proporcione la información necesaria.").waitFor();
  const nameInput = page.getByRole("textbox", { name: "Nombre del proyecto" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-invalid") === "true");
  assert.equal(await nameInput.getAttribute("aria-invalid"), "true");
  await page.getByText("Ingresa al menos 3 caracteres.").waitFor();
  assert.equal(await page.getByRole("group", { name: "¿Tiene terreno o inmueble disponible?" }).getAttribute("aria-invalid"), "true");
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0);

  await nameInput.fill("Casa Lago");
  assert.equal(await page.getByText("Ingresa al menos 3 caracteres.").count(), 0);
});

test("Caso 1 · Tiene inmueble: la sección aparece, se valida y se envía con archivos y confirmación", async (context) => {
  const { calls, page } = await openRequestPage(context, {
    uploadResponses: [{ status: 201, json: { file: { id: 51 } } }, { status: 201, json: { file: { id: 52 } } }],
  });
  await fillCommonFields(page);
  await chooseLand(page, "Sí, disponible");
  await legalSection(page).waitFor();

  // La validación aplica: sin datos legales no se abre el código ni se llama a la API.
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Selecciona el estado de la documentación.").waitFor();
  await page.getByText("Indica si el inmueble tiene más de un propietario.").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);

  await fillLegalSection(page);

  // Cada selección se sube al momento al mismo borrador; quitar un archivo subido lo elimina en el
  // servidor y la tarjeta desaparece tras confirmarse (la tarjeta omite la extensión).
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([pngFile("fachada.png")]);
  await fileInput.setInputFiles([pngFile("terraza.png")]);
  await page.getByText(UPLOADED_LABEL, { exact: true }).nth(1).waitFor();
  await page.getByRole("button", { name: "Eliminar archivo terraza.png" }).click();
  await page.getByText("terraza", { exact: true }).waitFor({ state: "detached" });
  assert.deepEqual(calls.filter((call) => call.method === "DELETE").map((call) => call.path), [`/api/project-requests/${REQUEST_ID}/files/52`]);

  // Abrir el código guarda el formulario en el borrador y pide el código al backend; cerrar no
  // pierde datos ni vuelve a subir archivos, y reabrirlo actualiza el mismo borrador.
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByText("Enviamos un código a tu correo", { exact: true }).waitFor();
  await codeDialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await codeDialog.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("textbox", { name: "Nombre del proyecto" }).inputValue(), "Casa Lago");
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/api/project-requests").length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith("/verification-code")).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith("/files")).length, 2, "solo las subidas de la selección");

  const body = await submitWithCode(page, calls);
  await page.getByText("Excelente compatibilidad").first().waitFor();
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/api/project-requests").length, 1, "un solo borrador");
  assert.deepEqual(calls.find((call) => call.path.endsWith("/submit")).body, { verificationCode: VALID_CODE });
  assert.equal(body.projectName, "Casa Lago");
  assert.equal(body.landStatus, "available");
  assert.equal(body.legalDocumentationStatus, "available");
  assert.deepEqual(body.legalDocumentTypes, ["property_deed", "purchase_contract", "other"]);
  assert.equal(body.hasMultipleOwners, false);
  assert.equal(body.startTime, "immediate");
  // El borrador se creó vacío (solo submissionId) al adjuntar; «Enviar» no vuelve a subir archivos.
  const draftBody = calls.find((call) => call.method === "POST" && call.path === "/api/project-requests").body;
  assert.deepEqual(Object.keys(draftBody), ["submissionId"]);
  assert.match(draftBody.submissionId, /^[0-9a-f-]{36}$/);
  const uploads = calls.filter((call) => call.path === `/api/project-requests/${REQUEST_ID}/files`);
  assert.deepEqual(uploads.map((call) => decodeURIComponent(call.fileName || "")), ["fachada.png", "terraza.png"]);
});

test("Caso 2 · No tiene inmueble: la sección no aparece, no bloquea y no envía datos legales", async (context) => {
  const { calls, page } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  assert.equal(await legalSection(page).count(), 0);
  assert.equal(await page.getByRole("button", { name: LEGAL_STATUS_LABEL }).count(), 0);

  const body = await submitWithCode(page, calls);
  assert.equal(body.landStatus, "unavailable");
  assertNoPropertyData(body);
});

test("Caso 3 · Sí → No: los datos legales se descartan y no se envían", async (context) => {
  const { calls, page } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "Sí, disponible");
  await fillLegalSection(page);

  await chooseLand(page, "No todavía");
  await legalSection(page).waitFor({ state: "detached" });

  // Volver a "Sí" muestra la sección vacía: los datos anteriores no siguen activos.
  await chooseLand(page, "Sí, disponible");
  await legalSection(page).waitFor();
  assert.equal((await page.getByRole("button", { name: LEGAL_STATUS_LABEL }).textContent()).trim(), "Selecciona una opción");
  assert.equal(await page.getByText("Documento de propiedad, Contrato de compra, otros", { exact: true }).count(), 0);

  await chooseLand(page, "En proceso de adquirirlo");
  await legalSection(page).waitFor({ state: "detached" });
  const body = await submitWithCode(page, calls);
  assert.equal(body.landStatus, "acquiring");
  assertNoPropertyData(body);
});

test("Caso 4 · No → Sí: la sección aparece y sus validaciones se activan", async (context) => {
  const { calls, page } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await chooseLand(page, "Sí, disponible");
  await legalSection(page).waitFor();

  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Selecciona el estado de la documentación.").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);

  // "Documentación disponible" solo es obligatoria si la documentación está disponible.
  await choose(page, LEGAL_STATUS_LABEL, "Sí, tengo la documentación disponible");
  await page.getByText("Selecciona al menos un documento disponible.").waitFor();
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1000 }, { width: 375, height: 812 }]) {
  test(`Solicitud ${viewport.width}px: la sección legal entra y sale sin huecos ni scroll horizontal`, async (context) => {
    const { page } = await openRequestPage(context, { viewport });
    // Secuencia de hijos del formulario: S = sección, D = divisor decorativo.
    const layout = () => page.locator("form").evaluate((form) => [...form.children]
      .map((child) => (child.tagName === "SECTION" ? "S" : child.getAttribute("aria-hidden") === "true" ? "D" : "x"))
      .join(""));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    const hidden = await layout();
    await chooseLand(page, "Sí, disponible");
    await legalSection(page).waitFor();
    const visible = await layout();
    assert.equal(visible.split("S").length - hidden.split("S").length, 1);
    assert.equal(await overflow(), 0);

    await chooseLand(page, "No todavía");
    await legalSection(page).waitFor({ state: "detached" });
    // Sin la sección no quedan dos divisores seguidos ni espacio reservado.
    assert.equal(await layout(), hidden);
    assert.doesNotMatch(hidden, /DD/);
    assert.equal(await overflow(), 0);

    if (viewport.width < 1024) {
      const [description, fields] = await page.locator("form > section").first().evaluate((section) => (
        [...section.children].map((child) => child.getBoundingClientRect().width)
      ));
      assert.equal(Math.round(description), Math.round(fields));
    }
  });
}

/**
 * Espera a que termine el desplazamiento suave: la posición del documento no cambia en 5 frames.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<void>}
 */
function waitForScrollEnd(page) {
  return page.evaluate(() => new Promise((resolve) => {
    let last = window.scrollY;
    let stable = 0;
    const check = () => {
      stable = window.scrollY === last ? stable + 1 : 0;
      last = window.scrollY;
      if (stable >= 5) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

/**
 * Estado del foco y de los mensajes del grupo de adjuntos respecto al viewport.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Object>} Foco, invalidez y visibilidad.
 */
function attachmentsFocusState(page) {
  return page.evaluate(() => {
    const inView = (node) => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; };
    const group = document.activeElement.closest("[role='group'][aria-invalid='true']");
    const described = (node) => (node?.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)).filter((message) => message && !message.closest("[role='tooltip']"));
    // Motivos del control enfocado (error de un archivo) y del grupo (error de la sección).
    const messages = [...described(document.activeElement), ...described(group)];
    return {
      focused: document.activeElement.getAttribute("aria-label") || document.activeElement.textContent.trim(),
      groupLabel: group ? document.getElementById(group.getAttribute("aria-labelledby"))?.textContent.trim() : null,
      messages: messages.map((node) => node.textContent.trim()),
      messagesVisible: messages.every(inView),
      targetVisible: inView(document.activeElement),
    };
  });
}

test("Adjuntos: un archivo no permitido lleva a su tarjeta, enfoca su «Eliminar archivo» y muestra el motivo junto a ella", async (context) => {
  const { calls, page } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await page.locator('input[type="file"]').setInputFiles([pngFile("fachada.png"), { buffer: Buffer.from("texto"), mimeType: "text/plain", name: "notas.txt" }]);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.closest("[role='group'][aria-invalid='true']") !== null);
  await page.waitForFunction(() => { const rect = document.activeElement.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; });
  await waitForScrollEnd(page);
  const state = await attachmentsFocusState(page);
  assert.equal(state.groupLabel, "Subir imágenes / archivos (opcional)");
  assert.equal(state.focused, "Eliminar archivo notas.txt", "El control que corrige ese archivo");
  assert.deepEqual(state.messages, ["notas.txt: formato no permitido."]);
  assert.equal(state.targetVisible && state.messagesVisible, true, "Control y motivo visibles");
  assert.equal(await page.getByRole("dialog").count(), 0, "No abre la verificación");
  // El válido se subió al seleccionarlo; el no permitido nunca se transfiere y no se guarda el formulario.
  const writes = calls.filter((call) => call.method !== "GET");
  assert.deepEqual(writes.map((call) => call.path), ["/api/project-requests", `/api/project-requests/${REQUEST_ID}/files`]);
  assert.deepEqual(writes.filter((call) => call.fileName).map((call) => call.fileName), ["fachada.png"]);

  // Quitarlo con el teclado resuelve el error, conserva el válido y el grupo deja de marcarse.
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[role='group'][aria-invalid='true']") === null);
  assert.equal(await page.getByText("fachada", { exact: true }).count(), 1, "El archivo válido se conserva");
});

test("Adjuntos en móvil (375 × 667) con 11 archivos: el motivo general y «Elige un archivo» se ven a la vez", async (context) => {
  const { page } = await openRequestPage(context, { viewport: { height: 667, width: 375 } });
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await page.locator('input[type="file"]').setInputFiles(Array.from({ length: 11 }, (_, index) => pngFile(`vista-${index + 1}.png`)));
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.closest("[role='group'][aria-invalid='true']") !== null);
  await page.waitForFunction(() => { const rect = document.activeElement.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; });
  await waitForScrollEnd(page);
  const state = await attachmentsFocusState(page);
  assert.deepEqual(state.messages, ["Puedes adjuntar un máximo de 10 archivos."]);
  assert.equal(state.focused, "Elige un archivo", "Error de la sección: no se enfoca un «Eliminar» arbitrario");
  assert.equal(state.targetVisible && state.messagesVisible, true, "Control y motivo visibles simultáneamente");
});

const PERSISTED_REQUEST = {
  id: REQUEST_ID, status: "pending_review", projectName: "Casa Lago", projectType: "residential",
  location: "Maracaibo, Estado Zulia", description: "Vivienda unifamiliar de dos plantas frente al lago, con terraza.",
  createdAt: "2026-03-22T12:00:00Z", developmentMode: "phased", landStatus: "unavailable",
  investmentRange: "10k_50k", capitalAvailability: "available_now", startTime: "immediate",
  referenceLink: "https://es.pinterest.com/pin",
  compatibility: { level: "excellent", score: 84, observations: [] },
  files: [
    { id: 7, name: "Plano.pdf", fileType: "application/pdf", size: 5242880, createdAt: "2026-02-12T10:00:00Z" },
    { id: 8, name: "fachada.png", fileType: "image/png", size: 204800, createdAt: "2026-02-12T10:00:00Z" },
  ],
};
const detailCalls = (calls) => calls.filter((call) => call.method === "GET" && call.path === `/api/project-requests/${REQUEST_ID}`);

test("Solicitud recibida: cinco etapas de Figma, evaluación alineada y acciones responsive en ambos temas", async (context) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [375, 768, 1024, 1440]) {
      const { page, calls } = await openRequestPage(context, {
        viewRequest: PERSISTED_REQUEST,
        viewport: { width, height: 1000 },
      });
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
      const steps = page.getByLabel("Progreso de la solicitud");
      assert.deepEqual(await steps.locator(":scope > div > div").evaluateAll((nodes) => nodes.map((node) => node.textContent)), [
        "Solicitud enviadaCompletado", "Evaluación preliminarCompletado", "RevisiónPendiente",
        "Primer contactoPendiente", "Propuesta inicialPendiente",
      ]);
      assert.equal(await steps.locator(".progress-line-reveal").count(), 5, "conserva los cinco revelados");
      const evaluation = page.getByRole("region", { name: "Compatibilidad con nuestros servicios", exact: true });
      assert.equal(await evaluation.getByRole("progressbar").getAttribute("aria-valuenow"), "84");
      await evaluation.getByText(/^La información proporcionada indica una alta compatibilidad/).waitFor();
      // Espera el revelado del contenedor antes de medir alineación y alturas.
      await page.waitForFunction(() => !document.getAnimations().some((animation) =>
        animation.animationName === "content-reveal" && animation.playState === "running"));
      const geometry = await page.evaluate(() => {
        const heading = document.querySelector("h1");
        const view = heading.parentElement.parentElement;
        const section = document.querySelector("[aria-labelledby='received-compatibility-title']");
        const steps = document.querySelector("[aria-label='Progreso de la solicitud']");
        const bounds = (node) => {
          const box = node.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, width: box.width };
        };
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          headingSize: getComputedStyle(heading).fontSize,
          subtitleSize: getComputedStyle(heading.nextElementSibling).fontSize,
          section: bounds(section), fields: bounds(section.children[1]),
          progress: bounds(section.querySelector("[role='progressbar']").parentElement.parentElement),
          steps: [...steps.children].map(bounds), footer: bounds(view.querySelector("footer")),
          stepTitleHeights: [...steps.querySelectorAll(":scope > div > div > span:first-child")].map((node) => node.getBoundingClientRect().height),
          dividers: [...view.querySelectorAll("[aria-hidden='true'] > span")].map((node) => ({
            height: node.getBoundingClientRect().height, mask: getComputedStyle(node).maskImage,
          })),
        };
      });
      assert.equal(geometry.overflow, false, `${theme} ${width}px sin desbordamiento`);
      assert.equal(geometry.dividers.length, 3);
      assert.ok(geometry.dividers.every((divider) => Math.abs(divider.height - 1) < 0.01 && divider.mask !== "none"), JSON.stringify(geometry.dividers));
      for (const step of geometry.steps) {
        assert.ok(step.left >= geometry.section.left - 1 && step.right <= geometry.section.right + 1);
      }
      if (width === 1440) {
        assert.equal(geometry.headingSize, "48px");
        assert.equal(geometry.subtitleSize, "18px");
        assert.equal(geometry.section.width, 850);
        assert.equal(geometry.fields.width, 445);
        assert.equal(geometry.progress.width, 428);
        assert.ok(geometry.steps.every((step) => step.top === geometry.steps[0].top));
        assert.ok(geometry.stepTitleHeights.every((height) => height === 19), "los títulos de las cinco etapas caben en una línea");
        assert.equal(geometry.footer.right, geometry.section.right);
      }
      assert.ok(detailCalls(calls).length >= 1, "el seguimiento se lee del backend por id");
    }
  }
});

test("Solicitud recibida: pendiente de verificación o revisión, sin motivos ni observaciones internas", async (context) => {
  for (const [status, reviewStage, completed] of [["pending_verification", "Pendiente", 1], ["pending_review", "Pendiente", 2]]) {
    const { page } = await openRequestPage(context, {
      viewRequest: {
        ...PERSISTED_REQUEST, status, correctionReason: "Corrección anterior.", rejectionReason: "Rechazo ajeno.",
        compatibility: { level: "low", score: 32.6, observations: ["Completa la información del proyecto."] },
      },
    });
    const stages = page.getByLabel("Progreso de la solicitud");
    await stages.locator(":scope > div").nth(2).getByText(reviewStage, { exact: true }).waitFor();
    const completedSteps = await stages.locator(".progress-line-reveal").evaluateAll((nodes) =>
      nodes.filter((node) => node.className.includes("--color-accent-300")).length);
    assert.equal(completedSteps, completed, status);
    // La pantalla de seguimiento no adelanta decisiones ni muestra motivos.
    for (const text of ["Corrección anterior.", "Rechazo ajeno.", "Completa la información del proyecto.", "Estado de la solicitud"]) {
      assert.equal(await page.getByText(text, { exact: true }).count(), 0, `${status}: ${text}`);
    }
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "33");
    assert.ok(await page.locator(".progress-fill-reveal").evaluate((node) => node.className.includes("--color-danger-200")));
  }
  const { page } = await openRequestPage(context, { viewRequest: { ...PERSISTED_REQUEST, compatibility: null } });
  await page.getByText("Evaluación de compatibilidad pendiente.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("progressbar").count(), 0, "sin evaluación no inventa un 0 %");
});

const LONG_REJECTION_REASON = `El inmueble no cuenta con la documentación legal necesaria para iniciar el proyecto.\n${"El presupuesto indicado no cubre el alcance solicitado ni los acabados descritos en la solicitud. ".repeat(6)}`.trim();
const decisionSection = (page) => page.getByRole("region", { name: /Primer contacto|Motivo del rechazo|Información solicitada/ });
const stageTexts = (page) => page.getByLabel("Progreso de la solicitud").locator(":scope > div > div").evaluateAll((nodes) => nodes.map((node) => node.textContent));

test("Estado de la solicitud: aprobada muestra el primer contacto sin inventar etapas y abre el proyecto", async (context) => {
  const { page } = await openRequestPage(context, {
    viewRequest: { ...PERSISTED_REQUEST, status: "converted", convertedProjectId: 77, correctionReason: "Corrección anterior." },
    readyHeading: "Estado de la solicitud",
  });
  await page.getByText("Verifique el progreso de su solicitud aquí.", { exact: true }).waitFor();
  const section = decisionSection(page);
  await section.getByRole("heading", { name: "Primer contacto" }).waitFor();
  await section.getByText(/El siguiente paso es coordinar una reunión inicial/).waitFor();
  assert.equal(await page.getByText(/Hemos enviado un correo/).count(), 0, "no afirma comunicaciones no registradas");
  assert.equal(await page.getByText("Corrección anterior.", { exact: true }).count(), 0);
  assert.deepEqual(await stageTexts(page), [
    "Solicitud enviadaCompletado", "Evaluación preliminarCompletado", "RevisiónAprobada",
    "Primer contactoPendiente", "Propuesta inicialPendiente",
  ]);
  // Sin compatibilidad: la pantalla B no repite la evaluación preliminar.
  assert.equal(await page.getByRole("progressbar").count(), 0);
  await page.getByRole("button", { name: "Ver proyecto", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/proyectos/77");
});

test("Estado de la solicitud: rechazo con correcciones previas muestra el motivo completo y crea una solicitud nueva", async (context) => {
  const rejected = {
    ...PERSISTED_REQUEST, status: "rejected", rejectionReason: LONG_REJECTION_REASON,
    correctionReason: "Agrega fotos de la fachada.", internalReviewNotes: "Nota interna del equipo.",
  };
  const { calls, page } = await openRequestPage(context, { viewRequest: rejected, readyHeading: "Estado de la solicitud", viewport: { width: 375, height: 800 } });
  const section = decisionSection(page);
  await section.getByRole("heading", { name: "Motivo del rechazo" }).waitFor();
  const reason = section.locator("p");
  assert.equal((await reason.textContent()).trim(), LONG_REJECTION_REASON, "motivo completo, sin truncar");
  assert.ok(await reason.evaluate((node) => node.scrollHeight <= node.clientHeight + 1 && getComputedStyle(node).textOverflow !== "ellipsis"));
  for (const hidden of ["Agrega fotos de la fachada.", "Nota interna del equipo."]) {
    assert.equal(await page.getByText(hidden, { exact: true }).count(), 0, hidden);
  }
  assert.deepEqual((await stageTexts(page)).slice(2), ["RevisiónRechazada", "Primer contactoNo aplica", "Propuesta inicialNo aplica"]);

  await page.getByRole("button", { name: "Crear nueva solicitud", exact: true }).click();
  await page.getByRole("heading", { name: "Solicitud de proyecto" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Nombre del proyecto" }).inputValue(), "Casa Lago", "precarga los datos anteriores");
  // La solicitud rechazada no se reabre ni se modifica: ninguna escritura sobre su id.
  assert.equal(calls.filter((call) => call.method !== "GET" && call.path.startsWith(`/api/project-requests/${REQUEST_ID}`)).length, 0);
});

test("Estado de la solicitud: correcciones pendientes muestran correctionReason y abren la corrección", async (context) => {
  const { page } = await openRequestPage(context, {
    viewRequest: { ...PERSISTED_REQUEST, ...CORRECTION_REQUEST, files: PERSISTED_REQUEST.files, rejectionReason: "Rechazo ajeno." },
    readyHeading: "Estado de la solicitud",
  });
  const section = decisionSection(page);
  await section.getByRole("heading", { name: "Información solicitada" }).waitFor();
  await section.getByText("Agrega referencias de la fachada.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Rechazo ajeno.", { exact: true }).count(), 0);
  assert.equal((await stageTexts(page))[2], "RevisiónCorrecciones solicitadas");
  await page.getByRole("button", { name: "Corregir solicitud", exact: true }).click();
  await page.getByRole("heading", { name: "Solicitud de proyecto" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Nombre del proyecto" }).inputValue(), "Casa Lago");
});

test("Estado de la solicitud: sin motivo registrado usa un texto neutral", async (context) => {
  const { page } = await openRequestPage(context, { viewRequest: { ...PERSISTED_REQUEST, status: "rejected", rejectionReason: null, correctionReason: "Corrección anterior." }, readyHeading: "Estado de la solicitud" });
  await page.getByText("El motivo del rechazo no está disponible en este momento.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Corrección anterior.", { exact: true }).count(), 0);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`Estado de la solicitud ${width}px: estructura de Figma, sin desbordamiento, claro y oscuro`, async (context) => {
    const { page } = await openRequestPage(context, {
      viewRequest: { ...PERSISTED_REQUEST, status: "rejected", rejectionReason: LONG_REJECTION_REASON },
      readyHeading: "Estado de la solicitud",
      viewport: { width, height: 900 },
    });
    await page.waitForFunction(() => !document.getAnimations().some((animation) =>
      animation.animationName === "content-reveal" && animation.playState === "running"));
    for (const theme of ["light", "dark"]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
      const geometry = await page.evaluate(() => {
        const section = document.querySelector("[aria-labelledby='request-decision-title']");
        const column = section.children[1];
        const footer = section.parentElement.querySelector("footer");
        return {
          columnWidth: column.getBoundingClientRect().width,
          dividers: section.parentElement.querySelectorAll(":scope > [aria-hidden='true']").length,
          footerButtons: [...footer.querySelectorAll("button")].map((button) => button.getBoundingClientRect()),
          headingSize: getComputedStyle(document.querySelector("h1")).fontSize,
          overflow: document.documentElement.scrollWidth > innerWidth,
          sectionWidth: section.getBoundingClientRect().width,
        };
      });
      assert.equal(geometry.overflow, false, `${theme} ${width}px sin desbordamiento`);
      assert.equal(geometry.dividers, 3);
      assert.equal(geometry.footerButtons.length, 3, "Ver solicitud, Volver al Dashboard y Crear nueva solicitud");
      if (width === 1440) {
        assert.equal(geometry.headingSize, "48px");
        assert.equal(geometry.sectionWidth, 850);
        assert.equal(geometry.columnWidth, 445);
      }
      if (width === 375) {
        // En móvil la acción principal ocupa su propia fila a todo el ancho.
        const [first, , primary] = geometry.footerButtons;
        assert.ok(primary.top > first.top && Math.abs(primary.width - geometry.sectionWidth) < 1);
      }
    }
    const colors = await page.evaluate(async () => {
      const reason = document.querySelector("[aria-labelledby='request-decision-title'] p");
      document.documentElement.classList.remove("dark");
      const light = getComputedStyle(reason).color;
      document.documentElement.classList.add("dark");
      return { dark: getComputedStyle(reason).color, light };
    });
    assert.notEqual(colors.light, colors.dark, "el texto usa tokens del tema");
  });
}

test("Consulta: tras enviar se navega a la ruta persistente y «Ver solicitud» reutiliza la lectura", async (context) => {
  const { calls, page } = await openRequestPage(context, { detailResponses: [{ json: { projectRequest: PERSISTED_REQUEST } }] });
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await submitWithCode(page, calls);
  await page.waitForURL((url) => url.pathname === `/solicitudes/${REQUEST_ID}`);

  await page.getByRole("button", { name: "Ver solicitud", exact: true }).click();
  const summary = page.getByRole("region", { name: "Información de la solicitud" });
  await summary.waitFor();
  // Solo lectura: sin controles de edición ni envío.
  assert.equal(await page.getByRole("textbox").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Enviar", exact: true }).count(), 0);
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  for (const text of ["Casa Lago", "Residencial", "En revisión", "Por fases", "No todavía", "$10,000 - $50,000 USD", "De inmediato", "Plano.pdf", "fachada.png", "5.0MB"]) {
    await summary.getByText(text, { exact: true }).first().waitFor();
  }
  // Los adjuntos provienen del backend, no de la selección local («Plano.pdf» no se adjuntó en la sesión).
  const readsAfterLoad = detailCalls(calls).length;
  assert.ok(readsAfterLoad >= 1);
  assert.equal(await summary.getByRole("link", { name: "Abrir fachada.png en una pestaña nueva" }).getAttribute("href"), `/api/project-requests/${REQUEST_ID}/files/8/content`);
  await summary.getByRole("button", { name: "Ver Plano.pdf" }).waitFor();

  // «Ver estado» vuelve al progreso; alternar vistas no repite la lectura.
  await page.getByRole("button", { name: "Ver estado", exact: true }).click();
  await page.getByRole("heading", { name: "Solicitud recibida" }).waitFor();
  await page.getByRole("button", { name: "Ver solicitud", exact: true }).click();
  await summary.waitFor();
  assert.equal(detailCalls(calls).length, readsAfterLoad);

  await page.getByRole("button", { name: "Volver al Dashboard", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard-clientes");
});

test("Consulta: sobrevive a la recarga y reintenta una lectura fallida", async (context) => {
  // Falla hasta pulsar «Reintentar»: el StrictMode de desarrollo repite la primera lectura.
  let failing = true;
  const { page } = await openRequestPage(context, {
    viewRequest: PERSISTED_REQUEST,
    readyHeading: null,
    detailResponses: () => (failing
      ? { status: 500, json: { code: "INTERNAL_ERROR", message: "Error temporal." } }
      : { json: { projectRequest: { ...PERSISTED_REQUEST, status: "rejected", rejectionReason: "Fuera de alcance." } } }),
  });
  await page.getByText("No pudimos cargar la solicitud", { exact: true }).waitFor();
  await page.getByText("Error temporal.", { exact: true }).waitFor();
  failing = false;
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.getByRole("heading", { name: "Estado de la solicitud" }).waitFor();
  // La vista se recupera por id del backend, sin estado de navegación.
  await page.reload();
  await page.getByRole("heading", { name: "Estado de la solicitud" }).waitFor();
  await page.getByText("Fuera de alcance.", { exact: true }).waitFor();
});

test("Consulta: muestra el loader con la geometría final mientras lee", async (context) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { page } = await openRequestPage(context, {
    viewRequest: PERSISTED_REQUEST,
    readyHeading: null,
    detailResponses: () => ({ json: { projectRequest: PERSISTED_REQUEST } }),
  });
  // Retiene las lecturas siguientes para observar el estado de carga tras recargar.
  await page.route(`**/api/project-requests/${REQUEST_ID}`, async (route) => { await held; await route.fallback(); });
  await page.reload();
  const loader = page.getByRole("status").filter({ hasText: "Cargando solicitud" });
  await loader.waitFor();
  assert.equal(await page.locator("[data-skeleton-preset='projectRequestStatus']").count(), 1);
  release();
  await page.getByRole("heading", { name: "Solicitud recibida" }).waitFor();
  assert.equal(await loader.count(), 0);
});

test("Consulta: una solicitud de otro cliente o inexistente no se muestra", async (context) => {
  const { page } = await openRequestPage(context, {
    viewRequest: PERSISTED_REQUEST,
    readyHeading: null,
    detailResponses: [{ status: 404, json: { code: "PROJECT_REQUEST_NOT_FOUND", message: "Solicitud no encontrada." } }],
  });
  await page.getByText("No encontramos esta solicitud", { exact: true }).waitFor();
  assert.equal(await page.getByText("Casa Lago", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Reintentar", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Volver al Dashboard", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard-clientes");
});

test("Mis proyectos: cada estado navega a su pantalla por id", async (context) => {
  const rows = [
    { id: REQUEST_ID, projectName: "Rechazada", status: "rejected", correctionReason: "Corrección anterior.", rejectionReason: "Fuera de alcance.", createdAt: "2026-11-01T10:00:00Z" },
    { id: 32, projectName: "Aprobada", status: "converted", convertedProjectId: 77, createdAt: "2026-11-01T10:00:00Z" },
    { id: 33, projectName: "En revisión", status: "pending_review", createdAt: "2026-11-01T10:00:00Z" },
    { id: 34, projectName: "Devuelta", status: "changes_requested", correctionReason: "Adjunta planos.", createdAt: "2026-11-01T10:00:00Z" },
  ];
  const { page } = await openRequestPage(context, {
    viewRequest: { ...PERSISTED_REQUEST, status: "rejected", rejectionReason: "Fuera de alcance." },
    readyHeading: "Estado de la solicitud",
  });
  await page.route((url) => url.pathname === "/api/project-requests", (route) => route.fulfill({ json: { projectRequests: rows, nextCursor: null } }));
  await page.goto(`${origin}/solicitudes`);
  const row = (name) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  // El motivo de la fila corresponde al estado: el rechazo no muestra la corrección anterior.
  await row("Rechazada").getByText("Fuera de alcance.", { exact: true }).waitFor();
  assert.equal(await row("Rechazada").getByText("Corrección anterior.").count(), 0);
  assert.deepEqual(await row("Aprobada").getByRole("button").allTextContents(), ["Ver resultado", "Ver proyecto"]);
  assert.deepEqual(await row("En revisión").getByRole("button").allTextContents(), ["Ver solicitud"]);
  assert.deepEqual(await row("Devuelta").getByRole("button").allTextContents(), ["Corregir solicitud"]);

  await row("Rechazada").getByRole("button", { name: "Ver motivo", exact: true }).click();
  await page.waitForURL((url) => url.pathname === `/solicitudes/${REQUEST_ID}`);
  await page.getByRole("heading", { name: "Estado de la solicitud" }).waitFor();
  await page.getByRole("region", { name: "Motivo del rechazo" }).waitFor();

  await page.goto(`${origin}/solicitudes`);
  await row("Aprobada").getByRole("button", { name: "Ver resultado", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/solicitudes/32");
  await page.goto(`${origin}/solicitudes`);
  await row("Devuelta").getByRole("button", { name: "Corregir solicitud", exact: true }).click();
  await page.getByRole("heading", { name: "Solicitud de proyecto" }).waitFor();
  await page.waitForURL((url) => url.pathname === "/solicitudes/nueva");
});

const CORRECTION_REQUEST = {
  id: REQUEST_ID, status: "changes_requested", projectName: "Casa Lago", projectType: "residential",
  location: "Maracaibo, Estado Zulia", description: "Vivienda unifamiliar de dos plantas frente al lago, con terraza.",
  developmentMode: "phased", landStatus: "unavailable", investmentRange: "10k_50k",
  capitalAvailability: "available_now", startTime: "immediate", correctionReason: "Agrega referencias de la fachada.",
};
const CORRECTION_DETAIL = { json: { projectRequest: { ...CORRECTION_REQUEST, files: PERSISTED_REQUEST.files } } };

test("Corrección: conserva los adjuntos guardados, admite agregar y eliminar y reenvía la misma solicitud", async (context) => {
  // Como el backend real: tras reenviar, la misma solicitud vuelve a verificación.
  let resubmitted = false;
  const { calls, page } = await openRequestPage(context, {
    initialRequest: CORRECTION_REQUEST,
    detailResponses: () => (resubmitted ? { json: { projectRequest: SUBMITTED_REQUEST } } : CORRECTION_DETAIL),
  });
  page.on("request", (request) => { if (request.url().endsWith("/submit")) resubmitted = true; });
  // Los adjuntos guardados aparecen como completados y se pueden eliminar.
  await page.getByRole("button", { name: "Eliminar archivo Plano.pdf" }).waitFor();
  await page.getByRole("button", { name: "Eliminar archivo fachada.png" }).waitFor();

  // Agregar con borrador remoto ya no se bloquea; un nombre ya guardado se rechaza como repetido.
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([pngFile("fachada.png")]);
  await page.getByText("fachada.png: está repetido.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Eliminar archivo fachada.png" }).last().click();
  await page.getByText("fachada.png: está repetido.", { exact: true }).waitFor({ state: "detached" });
  await fileInput.setInputFiles([pngFile("terraza.png")]);
  await page.getByRole("button", { name: "Eliminar archivo terraza.png" }).waitFor();

  // Eliminar un adjunto guardado lo borra en el servidor.
  const deleted = page.waitForRequest((request) => request.method() === "DELETE");
  await page.getByRole("button", { name: "Eliminar archivo Plano.pdf" }).click();
  assert.match((await deleted).url(), new RegExp(`/project-requests/${REQUEST_ID}/files/7$`));
  await page.getByRole("button", { name: "Eliminar archivo Plano.pdf" }).waitFor({ state: "detached" });

  await submitWithCode(page, calls);
  // Reenvío sobre la solicitud existente: sin crear otra y subiendo solo el archivo nuevo.
  assert.equal(calls.some((call) => call.method === "POST" && call.path === "/api/project-requests"), false);
  assert.ok(calls.some((call) => call.method === "PATCH" && call.path === `/api/project-requests/${REQUEST_ID}`));
  const uploads = calls.filter((call) => call.path === `/api/project-requests/${REQUEST_ID}/files`);
  assert.deepEqual(uploads.map((call) => decodeURIComponent(call.fileName || "")), ["terraza.png"]);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 1);
});

test("Corrección: si eliminar un adjunto guardado falla, se conserva y se informa el motivo", async (context) => {
  const { page } = await openRequestPage(context, {
    initialRequest: CORRECTION_REQUEST,
    detailResponses: [CORRECTION_DETAIL],
    deleteResponses: [{ status: 409, json: { code: "PROJECT_REQUEST_NOT_EDITABLE", message: "La solicitud ya no admite cambios." } }],
  });
  await page.getByRole("button", { name: "Eliminar archivo Plano.pdf" }).click();
  await page.getByText("Plano.pdf: La solicitud ya no admite cambios.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Eliminar archivo Plano.pdf" }).waitFor();
});

test("Corrección: sin los adjuntos guardados no se envía y se puede reintentar la lectura", async (context) => {
  let failing = true;
  const { calls, page } = await openRequestPage(context, {
    initialRequest: CORRECTION_REQUEST,
    detailResponses: () => (failing ? { status: 500, json: { code: "INTERNAL_ERROR", message: "Error temporal." } } : CORRECTION_DETAIL),
  });
  const message = "No se pudieron cargar los archivos adjuntos: Error temporal.";
  await page.getByText(message, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 0, "no se abre el código de validación");
  assert.equal(await page.getByText(message, { exact: true }).count(), 1, "el motivo no se duplica");
  const readsBeforeRetry = detailCalls(calls).length;
  failing = false;
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.getByRole("button", { name: "Eliminar archivo Plano.pdf" }).waitFor();
  assert.equal(detailCalls(calls).length, readsBeforeRetry + 1);
  assert.equal(await page.getByText(message, { exact: true }).count(), 0, "el aviso desaparece al cargar");
});

test("Validación: un código incorrecto mantiene el modal con el motivo y «Reenviar código» pide otro", async (context) => {
  const { calls, page } = await openRequestPage(context, {
    verificationResponses: [
      { status: 201, json: { verification: {} } },
      { status: 429, json: { code: "VERIFICATION_CODE_RECENTLY_SENT", message: "Ya enviamos un código. Podrás solicitar otro en 42 segundos.", retryAfter: 42 } },
    ],
  });
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByText("Enviamos un código a tu correo", { exact: true }).waitFor();
  const send = codeDialog.getByRole("button", { name: "Enviar", exact: true });
  assert.equal(await send.isDisabled(), true, "sin seis dígitos no se envía");

  await codeDialog.getByRole("textbox", { name: "Código" }).fill("000000");
  await send.click();
  await codeDialog.getByText("El código no es correcto. Te quedan 4 intentos.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Solicitud recibida" }).count(), 0);

  // El reenvío respeta el plazo del backend y muestra su motivo; el código anterior sigue
  // vigente, así que no se anuncia como un fallo del envío.
  await codeDialog.getByRole("button", { name: "Reenviar código", exact: true }).click();
  await codeDialog.getByText("Ya enviamos un código. Podrás solicitar otro en 42 segundos.", { exact: true }).waitFor();
  assert.equal(calls.filter((call) => call.path.endsWith("/verification-code")).length, 2);
  await codeDialog.getByText("Enviamos un código a tu correo", { exact: true }).waitFor();
  assert.equal(await codeDialog.getByText("No pudimos enviar el código. Puedes solicitar otro.", { exact: true }).count(), 0);

  await codeDialog.getByRole("textbox", { name: "Código" }).fill(VALID_CODE);
  await send.click();
  await page.getByRole("heading", { name: "Solicitud recibida" }).waitFor();
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/api/project-requests").length, 1);
});

test("Validación: si el código no se puede enviar, se informa y no se puede confirmar", async (context) => {
  const { page } = await openRequestPage(context, {
    verificationResponses: [{ status: 503, json: { code: "EMAIL_SERVICE_NOT_CONFIGURED", message: "No pudimos enviar el código de validación. Inténtalo de nuevo." } }],
  });
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByText("No pudimos enviar el código de validación. Inténtalo de nuevo.", { exact: true }).waitFor();
  await codeDialog.getByText("No pudimos enviar el código. Puedes solicitar otro.", { exact: true }).waitFor();
  await codeDialog.getByRole("button", { name: "Reenviar código", exact: true }).click();
  await codeDialog.getByText("Enviamos un código a tu correo", { exact: true }).waitFor();
});

/** Disparadores de menú abiertos (excluye la navegación lateral, que también usa aria-expanded). */
const openMenus = (page) => page.locator('[aria-haspopup="menu"][aria-expanded="true"]').evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));

const SINGLE_SELECTS = [
  ["Tipo de proyecto", "Residencial", "Comercial"],
  ["¿Cómo desea desarrollar el proyecto?", "Por fases", "En su totalidad"],
  ["Rango de inversión estimado", "$10,000 - $50,000 USD", "Menos de $10,000 USD"],
  ["Disponibilidad del capital", "Disponible ahora", "En los próximos 3 meses"],
];

test("Desplegables · ratón: elegir cierra el menú, muestra la opción y permite reabrir y cambiarla", async (context) => {
  const { calls, page } = await openRequestPage(context);
  for (const [label, first, second] of SINGLE_SELECTS) {
    const trigger = page.getByRole("button", { name: label, exact: true });
    await trigger.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    await page.getByRole("menuitem", { name: first, exact: true }).click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "false", `${label}: se cierra al elegir`);
    assert.equal(await page.getByRole("menu").count(), 0);
    assert.equal((await trigger.textContent()).trim(), first);
    await trigger.click();
    await page.getByRole("menuitem", { name: second, exact: true }).click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal((await trigger.textContent()).trim(), second);
  }
  // Abrir otro selector cierra el anterior: nunca quedan dos menús abiertos.
  await page.getByRole("button", { name: "Tipo de proyecto", exact: true }).click();
  await page.getByRole("button", { name: "Disponibilidad del capital", exact: true }).click();
  assert.deepEqual(await openMenus(page), ["Disponibilidad del capital"]);
  // Elegir opciones no llama a la API (sin borradores ni consultas por cambio).
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/api/project-requests")), []);
});

test("Desplegables · teclado: Enter abre y elige, Escape cierra y salir con Tab no deja menús abiertos", async (context) => {
  const { page } = await openRequestPage(context);
  const type = page.getByRole("button", { name: "Tipo de proyecto", exact: true });
  await type.focus();
  await page.keyboard.press("Enter");
  assert.equal(await type.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "menuitem");
  await page.keyboard.press("Enter");
  assert.equal(await type.getAttribute("aria-expanded"), "false");
  assert.notEqual((await type.textContent()).trim(), "Selecciona una opción");

  await type.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  assert.equal(await type.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Tipo de proyecto", "Escape devuelve el foco al disparador");

  // Recorrer las opciones y salir del campo con Tab cierra el menú (antes quedaba abierto y se
  // acumulaba con el siguiente).
  await page.keyboard.press("Enter");
  const optionCount = await page.getByRole("menuitem").count();
  for (let index = 0; index <= optionCount; index += 1) await page.keyboard.press("Tab");
  assert.equal(await type.getAttribute("aria-expanded"), "false");
  const development = page.getByRole("button", { name: "¿Cómo desea desarrollar el proyecto?", exact: true });
  await development.focus();
  await page.keyboard.press("Enter");
  assert.deepEqual(await openMenus(page), ["¿Cómo desea desarrollar el proyecto?"]);
  // Mayús+Tab desde la primera opción vuelve al disparador, que pertenece al campo: sigue abierto.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await development.getAttribute("aria-expanded"), "true");
});

test("Desplegables · táctil (375 × 667): tocar una opción la elige y cierra el menú", async (context) => {
  const { page } = await openRequestPage(context, { touch: true, viewport: { width: 375, height: 667 } });
  for (const [label, option] of SINGLE_SELECTS) {
    const trigger = page.getByRole("button", { name: label, exact: true });
    await trigger.tap();
    await page.getByRole("menuitem", { name: option, exact: true }).tap();
    assert.equal(await trigger.getAttribute("aria-expanded"), "false", `${label}: se cierra al tocar la opción`);
    assert.equal((await trigger.textContent()).trim(), option);
  }
  // Tocar fuera cierra un menú abierto sin elegir.
  await page.getByRole("button", { name: "Tipo de proyecto", exact: true }).tap();
  await page.getByRole("heading", { name: "Solicitud de proyecto" }).tap();
  assert.deepEqual(await openMenus(page), []);
});

test("Desplegables · selección múltiple: varias opciones, Escape o clic exterior cierran y conservan la selección", async (context) => {
  const { page } = await openRequestPage(context);
  await choose(page, "Tipo de proyecto", "Stand publicitario");
  await choose(page, STAND_STATUS_LABEL, "Sí, tengo los requisitos");
  const documents = standSection(page).getByRole("button", { name: "Documentación disponible" });
  await documents.click();
  await page.getByRole("menuitemcheckbox", { name: "Manual del expositor", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Reglamento del evento", exact: true }).click();
  assert.equal(await documents.getAttribute("aria-expanded"), "true", "la selección múltiple sigue abierta para marcar varias");
  await page.keyboard.press("Escape");
  assert.equal(await documents.getAttribute("aria-expanded"), "false");
  assert.equal((await documents.textContent()).trim(), "Manual del expositor, Reglamento del evento");

  await documents.click();
  assert.equal(await page.getByRole("menuitemcheckbox", { name: "Reglamento del evento", exact: true }).getAttribute("aria-checked"), "true");
  await page.getByRole("menuitemcheckbox", { name: "Reglamento del evento", exact: true }).click();
  await page.getByRole("heading", { name: "Solicitud de proyecto" }).click();
  assert.equal(await documents.getAttribute("aria-expanded"), "false");
  assert.equal((await documents.textContent()).trim(), "Manual del expositor");

  // Deshabilitar el campo con su menú abierto (cambiando la respuesta con teclado) no lo reabre
  // después al volver a habilitarlo.
  await documents.click();
  const status = page.getByRole("button", { name: STAND_STATUS_LABEL, exact: true });
  await status.focus();
  assert.equal(await documents.getAttribute("aria-expanded"), "false", "salir del campo cierra el menú");
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Aún no tengo los requisitos", exact: true }).click();
  assert.equal(await documents.isDisabled(), true);
  await choose(page, STAND_STATUS_LABEL, "Sí, tengo los requisitos");
  assert.equal(await documents.isDisabled(), false);
  assert.deepEqual(await openMenus(page), []);
});

test("Desplegables · ubicación: elegir una sugerencia la aplica y Escape cierra la lista", async (context) => {
  const { page } = await openRequestPage(context, {
    addressSuggestions: [
      { formattedAddress: "Maracaibo, Zulia, Venezuela", latitude: 10.65, longitude: -71.64, placeId: "maracaibo" },
      { formattedAddress: "Maracay, Aragua, Venezuela", latitude: 10.24, longitude: -67.59, placeId: "maracay" },
    ],
  });
  const location = page.getByRole("combobox", { name: "Ubicación del proyecto" });
  await location.fill("Mara");
  await page.getByRole("listbox", { name: "Sugerencias de ubicación" }).waitFor();
  assert.equal(await location.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Escape");
  await page.getByRole("listbox").waitFor({ state: "detached" });
  assert.equal(await location.inputValue(), "Mara", "Escape conserva el texto");

  await location.fill("Marac");
  await page.getByRole("option", { name: "Maracaibo, Zulia, Venezuela" }).click();
  await page.getByRole("listbox").waitFor({ state: "detached" });
  assert.equal(await location.inputValue(), "Maracaibo, Zulia, Venezuela");
  assert.equal(await location.getAttribute("aria-expanded"), "false");
});

/** Promesa controlable para retener una transferencia simulada. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Retiene una subida hasta `gate` y la confirma con `fileId` (o la rechaza con `response`). */
const heldUpload = (gate, response) => async (route) => {
  await gate.promise;
  return route.fulfill(response).catch(() => {});
};

const attachments = (page) => page.getByRole("group", { name: "Subir imágenes / archivos (opcional)" });

test("Subida automática: seleccionar sube al momento a un único borrador, con progreso y sin enviar la solicitud", async (context) => {
  const gate = deferred();
  const { calls, page } = await openRequestPage(context, {
    uploadResponses: [
      heldUpload(gate, { status: 201, json: { file: { id: 61 } } }),
      heldUpload(gate, { status: 201, json: { file: { id: 62 } } }),
    ],
  });
  // Sin completar el formulario: los archivos se pueden adjuntar desde el principio.
  await page.locator('input[type="file"]').setInputFiles([pngFile("fachada.png"), pngFile("plano.png")]);
  await attachments(page).getByText("Subiendo...", { exact: true }).nth(1).waitFor();
  assert.equal(await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).count(), 0, "no se confirma antes del backend");
  assert.equal(await attachments(page).getByText("100%", { exact: true }).count(), 0, "el progreso no llega a 100 sin respuesta");

  gate.resolve();
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).nth(1).waitFor();
  assert.equal(await attachments(page).getByText("100%", { exact: true }).count(), 2, "100 % solo tras la confirmación");
  const drafts = calls.filter((call) => call.method === "POST" && call.path === "/api/project-requests");
  assert.equal(drafts.length, 1, "un único borrador para varios archivos");
  assert.deepEqual(Object.keys(drafts[0].body), ["submissionId"], "sin datos ficticios");
  assert.equal(calls.filter((call) => call.path.endsWith("/files")).length, 2, "cada archivo se sube una sola vez (StrictMode)");
  for (const suffix of ["/verification-code", "/submit"]) {
    assert.equal(calls.filter((call) => call.path.endsWith(suffix)).length, 0, `no llama a ${suffix}`);
  }
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0, "no guarda el formulario todavía");
  assert.equal(await page.getByRole("heading", { name: "Solicitud de proyecto" }).count(), 1, "sigue en el formulario");
});

test("Enviar: no vuelve a subir los guardados, un código incorrecto conserva el borrador y sus adjuntos", async (context) => {
  const { calls, page } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await page.locator('input[type="file"]').setInputFiles([pngFile("fachada.png")]);
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).waitFor();

  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByText("Enviamos un código a tu correo", { exact: true }).waitFor();
  await codeDialog.getByRole("textbox", { name: "Código" }).fill("000000");
  await codeDialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await codeDialog.getByText("El código no es correcto. Te quedan 4 intentos.", { exact: true }).waitFor();
  await codeDialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await codeDialog.waitFor({ state: "detached" });
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).waitFor();

  await submitWithCode(page, calls);
  assert.equal(calls.filter((call) => call.path.endsWith("/files")).length, 1, "el adjunto se subió una sola vez");
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/api/project-requests").length, 1, "un solo borrador");
  assert.equal(calls.filter((call) => call.path.endsWith("/submit")).length, 2, "reintento del envío sobre la misma solicitud");
});

test("Adjuntos: una subida fallida muestra el motivo y «Intenta de nuevo» reenvía solo ese archivo", async (context) => {
  const { calls, page } = await openRequestPage(context, {
    uploadResponses: [
      { status: 201, json: { file: { id: 71 } } },
      // La plataforma rechaza el cuerpo antes de Express: 413 en texto plano, sin JSON.
      { status: 413, contentType: "text/plain", body: "Request Entity Too Large" },
      { status: 201, json: { file: { id: 72 } } },
    ],
  });
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await page.locator('input[type="file"]').setInputFiles([pngFile("fachada.png"), pngFile("plano.png")]);
  await attachments(page).getByText("Fallido", { exact: true }).waitFor();
  await attachments(page).getByText("El archivo supera el tamaño que el servidor admite en una sola subida.", { exact: true }).waitFor();
  assert.equal(await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).count(), 1);
  assert.equal(await attachments(page).getByRole("button", { name: "Eliminar archivo plano.png" }).count(), 1, "también se puede quitar");

  // Con un archivo fallido no se abre la validación.
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Reintenta o elimina los archivos que no se pudieron subir.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);

  await attachments(page).getByRole("button", { name: "Intenta de nuevo" }).click();
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).nth(1).waitFor();
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/files")).map((call) => call.fileName), ["fachada.png", "plano.png", "plano.png"]);
  await submitWithCode(page, calls);
  assert.equal(calls.filter((call) => call.path.endsWith("/files")).length, 3, "enviar no repite subidas");
});

test("Adjuntos: quitar uno en curso cancela la transferencia y no deja el envío bloqueado", async (context) => {
  const gate = deferred();
  const { calls, page } = await openRequestPage(context, { uploadResponses: [heldUpload(gate, { status: 201, json: { file: { id: 81 } } })] });
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  const aborted = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/files"));
  await page.locator('input[type="file"]').setInputFiles([pngFile("fachada.png")]);
  await attachments(page).getByText("Subiendo...", { exact: true }).waitFor();

  // Mientras sube, «Enviar» explica la espera y no abre la validación.
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Espera a que terminen de subirse los archivos antes de enviar.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);

  await attachments(page).getByRole("button", { name: "Eliminar archivo fachada.png" }).click();
  await aborted;
  await page.getByText("fachada", { exact: true }).waitFor({ state: "detached" });
  gate.resolve();
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 0, "nada que eliminar en el servidor");
  await submitWithCode(page, calls);
});

test("Recuperar un borrador muestra sus adjuntos como subidos sin transferirlos y añade otros al mismo", async (context) => {
  const draft = {
    capitalAvailability: "available_now", description: "Vivienda unifamiliar de dos plantas frente al lago, con terraza.",
    developmentMode: "phased", id: REQUEST_ID, investmentRange: "10k_50k", landStatus: "unavailable", location: "Maracaibo, Estado Zulia",
    projectName: "Casa Lago", projectType: "residential", startTime: "immediate", status: "draft",
  };
  const { calls, page } = await openRequestPage(context, {
    detailResponses: [{ json: { projectRequest: { ...draft, files: [{ createdAt: "2026-11-01T10:00:00Z", fileType: "image/png", id: 91, name: "fachada.png", size: 2048 }] } } }],
    initialRequest: draft,
  });
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).waitFor();
  assert.equal(calls.filter((call) => call.path.endsWith("/files")).length, 0, "los guardados no se vuelven a transferir");

  await page.locator('input[type="file"]').setInputFiles([pngFile("terraza.png")]);
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).nth(1).waitFor();
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/api/project-requests").length, 0, "usa el borrador recuperado");
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/files")).map((call) => call.path), [`/api/project-requests/${REQUEST_ID}/files`]);
});

test("Validación de pruebas: con el modo informado por el backend no hay correo ni «Reenviar código»", async (context) => {
  const { calls, page } = await openRequestPage(context, {
    verificationResponses: [{ status: 201, json: { verification: { mode: "test" } } }],
  });
  await fillCommonFields(page);
  await chooseLand(page, "No todavía");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByText("Modo de pruebas: introduce cualquier código de 6 dígitos", { exact: true }).waitFor();
  assert.equal(await codeDialog.getByRole("button", { name: "Reenviar código" }).count(), 0);
  assert.equal(await codeDialog.getByText("No pudimos enviar el código. Puedes solicitar otro.", { exact: true }).count(), 0);
  const send = codeDialog.getByRole("button", { name: "Enviar", exact: true });
  assert.equal(await send.isDisabled(), true, "exige el formato de seis dígitos");
  await codeDialog.getByRole("textbox", { name: "Código" }).fill(VALID_CODE);
  await send.click();
  await page.getByRole("heading", { name: "Solicitud recibida" }).waitFor();
  assert.equal(calls.filter((call) => call.path.endsWith("/submit")).length, 1);
});


test("Adjuntos: con más de dos archivos la lista se limita a dos tarjetas y se desplaza", async (context) => {
  const { page } = await openRequestPage(context);
  const input = page.locator('input[type="file"]');
  const listHeight = () => attachments(page).evaluate((group) => {
    const card = group.querySelector("[id*='-file-project-request-file-']:not([id$='-remove']):not([id$='-message'])");
    const list = card.parentElement;
    return { client: Math.round(list.clientHeight), scroll: Math.round(list.scrollHeight) };
  });

  // Con dos archivos la lista conserva su alto natural.
  await input.setInputFiles([pngFile("vista-1.png"), pngFile("vista-2.png")]);
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).nth(1).waitFor();
  const two = await listHeight();
  assert.equal(two.client, two.scroll, "sin desplazamiento con dos archivos");

  // Desde el tercero, el alto queda en dos tarjetas (190 px) y el resto se desplaza.
  await input.setInputFiles([pngFile("vista-3.png")]);
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).nth(2).waitFor();
  const three = await listHeight();
  assert.equal(three.client, 190);
  assert.ok(three.scroll > three.client, "la tercera tarjeta se alcanza desplazando");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, "sin desbordamiento horizontal");
});

test("Adjuntos: los vídeos MOV se suben y un vídeo de más de 4,5 MB se rechaza sin subirse", async (context) => {
  const { calls, page } = await openRequestPage(context);
  const video = (name, mimeType, size) => ({ buffer: Buffer.alloc(size, 1), mimeType, name });
  await page.locator('input[type="file"]').setInputFiles([
    video("recorrido.mov", "video/quicktime", 2048),
    video("largo.mp4", "video/mp4", 4_600_000),
  ]);
  await attachments(page).getByText(UPLOADED_LABEL, { exact: true }).waitFor();
  await attachments(page).getByText("largo.mp4: los vídeos admiten hasta 4,5 MB.", { exact: true }).waitFor();
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/files")).map((call) => call.fileName), ["recorrido.mov"]);
  assert.match(await attachments(page).innerText(), /MP4 y MOV\. Hasta 50 MB y vídeos hasta 4,5 MB\./);
});
