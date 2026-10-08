import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REQUEST_ID = 31;
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre la solicitud como cliente con la API simulada: registra cada llamada y responde
 * al borrador, la carga de archivos y el envío final como lo hace el backend real.
 */
async function openRequestPage(context, { viewport = { width: 1440, height: 1000 }, initialRequest } = {}) {
  const session = await browser.newContext({ viewport });
  const page = await session.newPage();
  const calls = [];
  const errors = [];
  if (initialRequest) {
    await page.addInitScript((request) => {
      window.history.replaceState({ usr: { initialRequest: request }, key: "stand-test", idx: 0 }, "");
    }, initialRequest);
  }
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    calls.push({ body: (method === "POST" && path === "/api/project-requests") || (method === "PATCH" && path === `/api/project-requests/${REQUEST_ID}`) ? request.postDataJSON() : null, fileName: request.headers()["x-file-name"], method, path });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: 5, firstName: "Cliente", email: "cliente@example.test", role: { code: "client", name: "Cliente" }, status: "active" } } });
    if (path === "/api/geoapify/address-suggestions") return route.fulfill({ json: { suggestions: [] } });
    if (method === "POST" && path === "/api/project-requests") return route.fulfill({ status: 201, json: { projectRequest: { id: REQUEST_ID, status: "draft" } } });
    if (method === "POST" && path === `/api/project-requests/${REQUEST_ID}/files`) return route.fulfill({ status: 201, json: { file: { id: 1 } } });
    if (method === "POST" && path === `/api/project-requests/${REQUEST_ID}/submit`) {
      return route.fulfill({ json: { projectRequest: { id: REQUEST_ID, projectName: "Casa Lago", status: "pending_verification", compatibility: { level: "excellent", score: 84, observations: [] } } } });
    }
    return route.fulfill({ json: {} });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}/solicitudes/nueva`);
  await page.getByRole("heading", { name: "Solicitud de proyecto" }).waitFor();
  return { calls, page };
}

/** Elige una opción de un SelectField (DropdownMenu de selección única). */
async function choose(page, fieldLabel, optionLabel) {
  await page.getByRole("button", { name: fieldLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: optionLabel, exact: true }).click();
}

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

/** Envía con el código temporal y devuelve el cuerpo guardado al crear o editar el borrador. */
async function submitWithCode(page, calls) {
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByRole("textbox", { name: "Código" }).fill("123456");
  const submitted = page.waitForRequest((request) => request.url().endsWith(`/project-requests/${REQUEST_ID}/submit`));
  await codeDialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await submitted;
  await page.getByRole("heading", { name: "Solicitud recibida" }).waitFor();
  return calls.find((call) => call.body && ["POST", "PATCH"].includes(call.method)).body;
}

test("Tipo histórico: restaura, muestra la etiqueta sin opción seleccionable y conserva el tipo al reenviar", async (context) => {
  const { page, calls } = await openRequestPage(context, { initialRequest: {
    id: REQUEST_ID, status: "changes_requested", projectName: "Exhibición anterior", projectType: "stands_exhibitions",
    location: "Maracaibo, Estado Zulia", description: "Diseño del espacio de exposición para el evento.",
    developmentMode: "full", landStatus: "unavailable", investmentRange: "10k_50k",
    capitalAvailability: "available_now", startTime: "over_6_months",
  } });
  const selector = page.getByRole("button", { name: "Tipo de proyecto", exact: true });
  assert.match(await selector.textContent(), /Stands y exhibiciones/);
  await selector.click();
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Residencial", "Comercial", "Corporativo", "Stand publicitario"]);
  assert.equal(await page.getByRole("menuitem", { name: "Stands y exhibiciones", exact: true }).count(), 0);
  await selector.click();
  assert.equal(await standSection(page).count(), 0);
  const body = await submitWithCode(page, calls);
  assert.equal(body.projectType, "stands_exhibitions");
  assert.equal("standRequirements" in body, false);
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
  const { calls, page } = await openRequestPage(context);
  await fillCommonFields(page);
  await chooseLand(page, "Sí, disponible");
  await legalSection(page).waitFor();

  // La validación aplica: sin datos legales no se abre el código ni se llama a la API.
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Selecciona el estado de la documentación.").waitFor();
  await page.getByText("Indica si el inmueble tiene más de un propietario.").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);

  await fillLegalSection(page);

  // Las selecciones se agregan; un adjunto pendiente se puede quitar (la tarjeta omite la extensión).
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([pngFile("fachada.png")]);
  await fileInput.setInputFiles([pngFile("terraza.png")]);
  await page.getByText("terraza", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Eliminar archivo" }).count(), 2);
  await page.getByRole("button", { name: "Eliminar archivo" }).last().click();
  assert.equal(await page.getByText("terraza", { exact: true }).count(), 0);

  // Abrir el código y volver atrás no pierde datos ni crea el borrador.
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const codeDialog = page.getByRole("dialog");
  await codeDialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await codeDialog.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("textbox", { name: "Nombre del proyecto" }).inputValue(), "Casa Lago");
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);

  const body = await submitWithCode(page, calls);
  await page.getByText("Excelente compatibilidad").first().waitFor();
  assert.equal(body.projectName, "Casa Lago");
  assert.equal(body.landStatus, "available");
  assert.equal(body.legalDocumentationStatus, "available");
  assert.deepEqual(body.legalDocumentTypes, ["property_deed", "purchase_contract", "other"]);
  assert.equal(body.hasMultipleOwners, false);
  assert.equal(body.startTime, "immediate");
  assert.match(body.submissionId, /^[0-9a-f-]{36}$/);
  const uploads = calls.filter((call) => call.path === `/api/project-requests/${REQUEST_ID}/files`);
  assert.deepEqual(uploads.map((call) => decodeURIComponent(call.fileName || "")), ["fachada.png"]);
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
