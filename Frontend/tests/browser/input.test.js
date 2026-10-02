import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PHONE_OPTIONS = [
  { countryCode: "US", dialCode: "+1", label: "Estados Unidos", abbreviation: "USA", mask: "(###) ####-####", placeholder: "(444) 1234-5678" },
  { countryCode: "VE", dialCode: "+58", label: "Venezuela", abbreviation: "VE", mask: "(###) ###-####", placeholder: "(412) 123-4567" },
  { countryCode: "ES", dialCode: "+34", label: "España", abbreviation: "ES", mask: "### ### ###", placeholder: "612 345 678" },
];
const TAG_OPTIONS = [
  { id: "ana", label: "Ána Pérez", avatarText: "AP" },
  { id: "luis", label: "Luis Rivas", avatarText: "LR" },
];
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    envDir: false,
    plugins: [react(), tailwindcss()],
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
 * Monta el Input real en un contexto aislado con props desde el primer render.
 * Vigila errores y bloquea peticiones API; las imágenes de banderas usan el fallback existente.
 *
 * @param {import("node:test").TestContext} context Prueba propietaria del contexto.
 * @param {Object} [props] Props iniciales del componente.
 * @param {Object} [options] Viewport, tema o capacidad táctil.
 * @returns {Promise<import("playwright").Page>} Página lista para interacción pública.
 */
async function openInput(context, props = {}, options = {}) {
  const session = await browser.newContext({ viewport: { width: 1024, height: 800 }, ...options });
  const page = await session.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    errors.push(`API inesperada: ${route.request().url()}`);
    await route.abort();
  });
  await page.route("**/*", (route) => route.request().resourceType() === "image" ? route.abort() : route.fallback());
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, [], "Input no debe lanzar errores ni consultar APIs");
  });
  await page.goto(`${origin}/tests/browser/fixtures/input.html?props=${encodeURIComponent(JSON.stringify(props))}`, { waitUntil: "domcontentloaded" });
  await page.locator("#contract-input").waitFor();
  return page;
}

/**
 * Lee únicamente los callbacks públicos observados en la sesión del fixture.
 * Conserva su orden para detectar cambios en el consumo de eventos.
 *
 * @param {import("playwright").Page} page Página de prueba.
 * @param {string} type Nombre del callback.
 * @returns {Promise<Array>} Argumentos registrados de ese callback.
 */
async function values(page, type) {
  return page.evaluate((type) => window.inputHarness.events.filter((event) => event.type === type).map((event) => event.value), type);
}

test("Input: value controla incluso vacío y defaultValue solo inicializa el estado interno", async (context) => {
  const page = await openInput(context, { value: "controlado", defaultValue: "semilla" });
  const field = page.locator("#contract-input");
  await field.fill("nuevo");
  assert.equal(await field.inputValue(), "controlado");
  assert.deepEqual((await values(page, "change")).at(-1), { target: "nuevo", currentTarget: "nuevo", nativeTarget: "nuevo" });
  await page.evaluate(() => window.inputHarness.setProps({ value: "", defaultValue: "ignorado" }));
  await field.fill("texto");
  assert.equal(await field.inputValue(), "");
  await page.evaluate(() => window.inputHarness.setProps({ value: undefined }));
  assert.equal(await field.inputValue(), "semilla");
  await field.fill("interno");
  await page.evaluate(() => window.inputHarness.setProps({ defaultValue: "otra semilla" }));
  assert.equal(await field.inputValue(), "interno");
});

test("Input: búsqueda, label, hints, error y disabled conservan semántica", async (context) => {
  const page = await openInput(context, { type: "Search bar", state: "Error", "aria-describedby": "extra" });
  const field = page.getByRole("searchbox", { name: "Campo de prueba" });
  assert.equal(await field.getAttribute("aria-describedby"), "extra contract-input-hint");
  assert.equal(await field.getAttribute("aria-invalid"), "true");
  assert.equal(await field.getAttribute("required"), null);
  await page.getByRole("alert").getByText("Ayuda del campo").waitFor();
  await field.fill("consulta");
  await field.press("Escape");
  assert.equal((await values(page, "keydown")).at(-1).key, "Escape");
  await page.evaluate(() => window.inputHarness.setProps({ state: "Disabled" }));
  assert.equal(await field.isEnabled(), true);
  await page.evaluate(() => window.inputHarness.setProps({ disabled: true }));
  assert.equal(await field.isDisabled(), true);
});

test("Tags: Enter/coma normalizan, deduplican y consumen teclado antes del callback externo", async (context) => {
  const page = await openInput(context, { type: "Tags", tagOptions: TAG_OPTIONS });
  const field = page.locator("#contract-input");
  await field.fill("  ANA  ");
  await field.press("Enter");
  await page.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).waitFor();
  assert.equal(await field.inputValue(), "");
  await field.fill("ana perez");
  await field.press(",");
  assert.equal(await page.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).count(), 1);
  assert.equal(await field.inputValue(), "ana perez");
  await field.fill("  Nuevo equipo  ");
  await field.press(",");
  await page.getByRole("button", { name: "Quitar Nuevo equipo", exact: true }).waitFor();
  await field.press("Backspace");
  assert.equal(await page.getByRole("button", { name: "Quitar Nuevo equipo", exact: true }).count(), 0);
  await field.press("Escape");
  assert.deepEqual(await values(page, "keydown"), [{ key: "Escape", defaultPrevented: false }]);
  assert.deepEqual(await values(page, "submit"), []);
  await page.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === "contract-input");
});

test("Tags: onTagsChange controla la selección y onTagOptionSelect intercepta solo el clic", async (context) => {
  const page = await openInput(context, { type: "Tags", value: "ana", tags: [], tagOptions: TAG_OPTIONS, showTagOptionsOnFocus: true, tagGroupPlacement: "overlay" });
  await page.evaluate(() => window.inputHarness.setProps({
    onTagsChange: (tags) => window.inputHarness.record("tags", tags),
    onTagOptionSelect: (tag) => window.inputHarness.record("option", tag),
  }));
  const field = page.locator("#contract-input");
  await field.focus();
  await field.press("Enter");
  assert.equal(await field.inputValue(), "ana");
  assert.equal(await page.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).count(), 0);
  assert.equal((await values(page, "tags"))[0][0].id, "ana");
  await page.getByRole("button", { name: "Seleccionar Ána Pérez", exact: true }).click();
  assert.equal((await values(page, "option"))[0].id, "ana");
  assert.equal((await values(page, "tags")).length, 1);
  assert.equal(await field.inputValue(), "ana");
  assert.equal(await field.evaluate((element) => element === document.activeElement), true);
  await page.evaluate(() => window.inputHarness.setProps({ tags: [{ id: "ana", label: "Ána Pérez" }] }));
  await field.press("Backspace");
  assert.equal((await values(page, "tags")).length, 1, "Con texto, Backspace no elimina tags");
  await page.evaluate(() => window.inputHarness.setProps({ value: "" }));
  await field.press("Backspace");
  assert.deepEqual((await values(page, "tags")).at(-1), []);
  assert.equal(await page.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).count(), 1);
});

test("Tags: sin onTagsChange las props posteriores no sustituyen la selección interna", async (context) => {
  const page = await openInput(context, { type: "Tags", tags: [{ id: "inicial", label: "Inicial" }], tagOptions: TAG_OPTIONS, showTagOptionsOnFocus: true });
  await page.evaluate(() => window.inputHarness.setProps({ tags: [{ id: "otro", label: "Otro" }] }));
  const field = page.locator("#contract-input");
  await field.fill("luis");
  await page.getByRole("button", { name: "Seleccionar Luis Rivas", exact: true }).click();
  assert.equal(await field.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Quitar Inicial", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Quitar Luis Rivas", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Quitar Otro", exact: true }).count(), 0);
});

test("Teléfono: onChange modifica el evento y cambiar país reformatea solo valor interno", async (context) => {
  const page = await openInput(context, { type: "Phone number", phoneOptions: PHONE_OPTIONS, defaultValue: "12345678901" });
  const field = page.locator("#contract-input");
  assert.equal(await field.inputValue(), "12345678901", "El valor inicial no se formatea automáticamente");
  await field.fill("4121234567");
  assert.equal(await field.inputValue(), "(412) 1234-567");
  assert.deepEqual((await values(page, "change")).at(-1), { target: "(412) 1234-567", currentTarget: "(412) 1234-567", nativeTarget: "(412) 1234-567" });
  const prefix = page.getByRole("combobox");
  await prefix.fill("58");
  assert.equal(await field.inputValue(), "(412) 123-4567");
  assert.equal((await values(page, "country")).at(-1).countryCode, "VE");
  const changeCount = (await values(page, "change")).length;
  await prefix.press("Enter");
  assert.equal(await prefix.getAttribute("aria-expanded"), "false");
  assert.equal((await values(page, "change")).length, changeCount);
  assert.deepEqual(await values(page, "submit"), []);
  await page.evaluate(() => window.inputHarness.setProps({ countryCode: "ES", countryPrefix: "+34" }));
  assert.equal(await prefix.inputValue(), "58");
  assert.equal(await field.inputValue(), "(412) 123-4567");
  await field.press("ArrowLeft");
  assert.deepEqual(await values(page, "keydown"), [], "La rama phone no conecta onKeyDown al número");
});

test("Teléfono: el padre controla el número y recibe el país sin sincronización adicional", async (context) => {
  const page = await openInput(context, { type: "Phone number", phoneOptions: PHONE_OPTIONS, value: "valor del padre" });
  const field = page.locator("#contract-input");
  await field.fill("4121234567");
  assert.equal(await field.inputValue(), "valor del padre");
  assert.equal((await values(page, "change")).at(-1).target, "(412) 1234-567");
  const prefix = page.getByRole("combobox");
  await prefix.fill("");
  await page.getByRole("option").filter({ hasText: "VE" }).click();
  assert.equal(await field.inputValue(), "valor del padre");
  assert.equal(await prefix.inputValue(), "58");
  assert.equal((await values(page, "country")).at(-1).countryCode, "VE");
  await page.evaluate(() => window.inputHarness.setProps({ value: "(412) 123-4567" }));
  assert.equal(await field.inputValue(), "(412) 123-4567");
  await prefix.focus();
  await prefix.press("Escape");
  assert.equal(await prefix.getAttribute("aria-expanded"), "false");
});

test("Password: toggle conserva valor, foco, nombre accesible y callback", async (context) => {
  const page = await openInput(context, { type: "Password", defaultValue: "Secreto1!", showPasswordStrength: true });
  const field = page.locator("#contract-input");
  await field.focus();
  await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).click();
  assert.equal(await field.getAttribute("type"), "text");
  assert.equal(await field.inputValue(), "Secreto1!");
  assert.equal(await field.evaluate((element) => element === document.activeElement), true);
  await page.getByRole("button", { name: "Ocultar contraseña", exact: true }).click();
  assert.equal(await field.getAttribute("type"), "password");
  assert.equal((await values(page, "right-icon")).length, 2);
  await page.evaluate(() => window.inputHarness.setProps({ disabled: true }));
  assert.equal(await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).isDisabled(), true);
});

test("Password: requisitos y progreso reflejan reglas originales en cada valor", async (context) => {
  const page = await openInput(context, { type: "Password", showPasswordStrength: true });
  const field = page.locator("#contract-input");
  const requirement = page.getByText("Al menos 1 mayúscula", { exact: true });
  const readColor = () => requirement.evaluate((element) => getComputedStyle(element.previousElementSibling).color);
  const pending = await readColor();
  await field.fill("A");
  const met = await readColor();
  assert.notEqual(met, pending);
  await field.fill("a1!abcde");
  assert.equal(await readColor(), pending);
  await field.fill("A1!abcde");
  assert.equal(await readColor(), met);
  await page.getByText("Al menos 8 caracteres", { exact: true }).waitFor();
  const title = page.getByText("Debe contener al menos:", { exact: true });
  assert.equal(await title.evaluate((element) => getComputedStyle(element).color), await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-success-200)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }));
});

test("Teléfono: menú y scrollbar conservan dimensiones y cierre fuera del selector", async (context) => {
  const page = await openInput(context, { type: "Phone number", phoneOptions: [
    ...PHONE_OPTIONS,
    ...["FR", "DE", "CO", "BR", "AR"].map((countryCode, index) => ({ ...PHONE_OPTIONS[0], countryCode, dialCode: `+8${index}`, abbreviation: countryCode, label: countryCode })),
  ] });
  const prefix = page.getByRole("combobox");
  await prefix.fill("");
  const list = page.getByRole("listbox");
  await list.waitFor();
  const row = page.getByRole("option").first();
  assert.equal(Math.round((await row.boundingBox()).height), 35);
  const scroll = page.getByLabel("Desplazar países", { exact: true });
  await scroll.waitFor();
  await list.evaluate((element) => { const row = element.querySelector('[role="option"]'); row.parentElement.scrollTop = 80; });
  await page.mouse.click(700, 500);
  assert.equal(await prefix.getAttribute("aria-expanded"), "false");
  assert.equal(await list.count(), 0);
});

test("Tags: estado Focused explícito conserva seleccionados debajo, avatares y foco al quitar", async (context) => {
  const page = await openInput(context, {
    type: "Tags", state: "Focused", tags: TAG_OPTIONS, showTagOptionsOnFocus: false,
  });
  const group = page.getByRole("group", { name: "Campo de prueba: opciones y elementos seleccionados" });
  assert.equal(await group.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).count(), 1);
  assert.equal(Math.round((await group.boundingBox()).height), 22);
  assert.equal(await group.getByText("AP", { exact: true }).count(), 1);
  assert.equal(await page.locator("#contract-input-hint").count(), 0);
  const field = page.locator("#contract-input");
  assert.equal(await field.getAttribute("placeholder"), "Add tags...");
  await group.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === "contract-input");
  assert.equal(await group.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).count(), 0);
  assert.equal(await group.getByRole("button", { name: "Quitar Luis Rivas", exact: true }).count(), 1);
});

test("Tags: móvil, tema oscuro, scroll horizontal y overlay conservan geometría e interacción", async (context) => {
  const tags = Array.from({ length: 12 }, (_, index) => ({
    id: index, label: `Responsable del proyecto ${index}`, avatarText: "RP",
  }));
  const page = await openInput(context, {
    type: "Tags", tags, tagOptions: TAG_OPTIONS, tagGroupPlacement: "overlay",
  }, { viewport: { width: 360, height: 800 }, hasTouch: true });
  const field = page.locator("#contract-input");
  const layout = await field.evaluate((element) => {
    const row = element.parentElement;
    return {
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      scrollWidth: row.scrollWidth, width: row.clientWidth,
      rows: [...row.querySelectorAll("button")].map((button) => button.getBoundingClientRect().y),
    };
  });
  assert.equal(layout.pageWidth, layout.viewportWidth);
  assert.ok(layout.scrollWidth > layout.width);
  assert.equal(new Set(layout.rows).size, 1);
  const geometry = await field.boundingBox();
  const shellColor = await field.evaluate((element) => getComputedStyle(element.closest("[data-state]")).backgroundColor);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForFunction((lightColor) => getComputedStyle(document.querySelector("#contract-input").closest("[data-state]")).backgroundColor !== lightColor, shellColor);
  assert.deepEqual(await field.boundingBox(), geometry);
  await page.evaluate(() => window.inputHarness.setProps({
    onTagsChange: (selected) => window.inputHarness.record("tags", selected),
  }));
  await field.evaluate((element) => { element.parentElement.scrollLeft = 100; });
  await page.evaluate((tags) => window.inputHarness.setProps({ tags: tags.slice(0, 11) }), tags);
  await page.waitForFunction(() => document.querySelector("#contract-input").parentElement.scrollLeft === 0);
  await field.focus();
  const outside = page.getByRole("button", { name: "Fuera del campo", exact: true });
  const outsideBefore = await outside.boundingBox();
  await page.evaluate(() => window.inputHarness.setProps({ showTagOptionsOnFocus: true }));
  const group = page.getByRole("group", { name: "Campo de prueba: opciones y elementos seleccionados" });
  assert.equal(await group.evaluate((element) => getComputedStyle(element).position), "absolute");
  assert.deepEqual(await outside.boundingBox(), outsideBefore);
  await page.getByRole("button", { name: "Seleccionar Ána Pérez", exact: true }).tap();
  assert.equal((await values(page, "tags")).at(-1).at(-1).id, "ana");
  assert.equal(await field.evaluate((element) => element === document.activeElement), true);
});
