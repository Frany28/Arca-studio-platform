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

/**
 * Controla el reloj de frames del navegador sin inspeccionar el estado de Input.
 * Permite observar si un trabajo pendiente roba foco o repite su acción pública.
 * @param {import("playwright").Page} page Página propietaria del reloj aislado.
 * @returns {Promise<void>} Instala una cola que respeta cancelAnimationFrame.
 */
async function pauseFrames(page) {
  await page.evaluate(() => {
    let sequence = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => {
      const id = ++sequence;
      callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => callbacks.delete(id);
    window.inputHarness.flushFrames = () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      pending.forEach(([, callback]) => callback(performance.now()));
    };
  });
}

test("Tags: eliminaciones rápidas restauran foco una sola vez y el desmontaje cancela el foco pendiente", async (context) => {
  const page = await openInput(context, { type: "Tags", tags: TAG_OPTIONS });
  await pauseFrames(page);
  await page.evaluate(() => {
    const field = window.inputHarness.inputRef.current;
    const originalFocus = field.focus.bind(field);
    field.focus = () => { window.inputHarness.record("restore-focus", null); originalFocus(); };
    document.querySelector('[aria-label="Quitar Ána Pérez"]').click();
    document.querySelector('[aria-label="Quitar Luis Rivas"]').click();
    window.inputHarness.flushFrames();
  });
  assert.equal((await values(page, "restore-focus")).length, 1);
  assert.equal(await page.locator("#contract-input").evaluate((element) => element === document.activeElement), true);
  await page.locator("#contract-input").fill("Otro");
  await page.locator("#contract-input").press("Enter");
  await page.evaluate(() => {
    document.querySelector('[aria-label="Quitar Otro"]').click();
    window.inputHarness.unmountInput();
    window.inputHarness.flushFrames();
  });
  assert.equal(await page.getByRole("textbox", { name: "Campo reemplazo" }).evaluate((element) => element === document.activeElement), false);
});

test("Tags: si onTagsChange desmonta Input no se programa un foco sobre su reemplazo", async (context) => {
  const page = await openInput(context, { type: "Tags", tags: TAG_OPTIONS });
  await pauseFrames(page);
  await page.evaluate(() => {
    window.inputHarness.setProps({ onTagsChange: () => window.inputHarness.unmountInput() });
    document.querySelector('[aria-label="Quitar Ána Pérez"]').click();
    window.inputHarness.flushFrames();
  });
  assert.equal(await page.getByRole("textbox", { name: "Campo reemplazo" }).evaluate((element) => element === document.activeElement), false);
});

test("Input: information legado no llega al DOM y conserva atributos HTML y showLabelInfo", async (context) => {
  const page = await openInput(context, {
    information: "legado", showLabelInfo: true,
    name: "contacto", autoComplete: "email", "data-contract": "conservado", "aria-label": "Contacto",
  });
  const field = page.locator("#contract-input");
  assert.equal(await field.getAttribute("information"), null);
  assert.equal(await field.getAttribute("name"), "contacto");
  assert.equal(await field.getAttribute("autocomplete"), "email");
  assert.equal(await field.getAttribute("data-contract"), "conservado");
  assert.equal(await field.getAttribute("aria-label"), "Contacto");
  await page.evaluate(() => window.inputHarness.setProps({ information: false }));
  assert.equal(await page.locator('label[for="contract-input"] svg').count(), 1);
  await page.evaluate((phoneOptions) => window.inputHarness.setProps({
    type: "Phone number", phoneOptions, information: "legado", showLabelInfo: false,
  }), PHONE_OPTIONS);
  assert.equal(await field.getAttribute("information"), null);
  assert.equal(await field.getAttribute("name"), "contacto");
  assert.equal(await page.locator('label[for="contract-input"] svg').count(), 0);
});

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

test("Input: required expresa obligatoriedad nativa y visual sin bloquear formularios noValidate", async (context) => {
  const page = await openInput(context);
  const field = page.locator("#contract-input");
  const label = page.locator('label[for="contract-input"]');
  for (const type of ["Default input", "Phone number", "Password"]) {
    await page.evaluate((type) => window.inputHarness.setProps({ type, required: true }), type);
    await field.fill("");
    assert.equal(await field.evaluate((element) => element.required), true);
    assert.match(await label.innerText(), /\*/);
    assert.equal(await field.evaluate((element) => element.validity.valueMissing), true);
    await field.evaluate((element) => { element.form.noValidate = false; element.form.requestSubmit(); });
    assert.deepEqual(await values(page, "submit"), []);
    await field.fill("12345678");
    assert.equal(await field.evaluate((element) => element.checkValidity()), true);
  }
  await field.fill("");
  await field.evaluate((element) => { element.form.noValidate = true; element.form.requestSubmit(); });
  assert.equal((await values(page, "submit")).length, 1, "El handler con preventDefault conserva la validación personalizada");
  await page.evaluate(() => window.inputHarness.setProps({ required: false }));
  assert.equal(await field.getAttribute("required"), null);
  assert.doesNotMatch(await label.innerText(), /\*/);
  assert.equal(await field.evaluate((element) => element.checkValidity()), true);
});

test("Input: búsqueda, label, hints, error y disabled conservan semántica", async (context) => {
  const page = await openInput(context, { type: "Search bar", state: "Error", "aria-describedby": "extra" });
  const field = page.getByRole("searchbox", { name: "Campo de prueba" });
  assert.equal(await field.getAttribute("aria-describedby"), "extra contract-input-hint");
  assert.equal(await field.getAttribute("aria-invalid"), "true");
  assert.equal(await field.evaluate((element) => element.required), true);
  await page.getByRole("alert").getByText("Ayuda del campo").waitFor();
  await field.fill("consulta");
  await field.press("Escape");
  assert.equal((await values(page, "keydown")).at(-1).key, "Escape");
  await page.evaluate(() => window.inputHarness.setProps({ state: "Disabled" }));
  assert.equal(await field.isDisabled(), true);
  await page.evaluate(() => window.inputHarness.setProps({ disabled: true }));
  assert.equal(await field.isDisabled(), true);
});

test("Input: state Disabled y disabled bloquean campo, teclado, password y eliminación de tags", async (context) => {
  const page = await openInput(context, { state: "Disabled", disabled: false, defaultValue: "Secreto1!", tags: TAG_OPTIONS });
  const field = page.locator("#contract-input");
  for (const type of ["Default input", "Password", "Tags"]) {
    await page.evaluate((type) => window.inputHarness.setProps({ type, showPasswordStrength: type === "Password" }), type);
    assert.equal(await field.isDisabled(), true);
    await field.evaluate((element) => {
      element.focus();
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(await field.evaluate((element) => element === document.activeElement), false);
    if (type === "Password") {
      const toggle = page.getByRole("button", { name: "Mostrar contraseña", exact: true });
      assert.equal(await toggle.isDisabled(), true);
      await toggle.evaluate((element) => element.click());
      assert.equal(await field.getAttribute("type"), "password");
      assert.deepEqual(await values(page, "right-icon"), []);
      const disabledColor = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-neutral-300)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      assert.equal(await page.getByText("Debe contener al menos:", { exact: true }).evaluate((element) => getComputedStyle(element).color), disabledColor);
    }
  }
  await page.evaluate(() => window.inputHarness.setProps({ state: "Filled", disabled: true, value: "" }));
  assert.equal(await field.isDisabled(), true);
  await field.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
  assert.equal(await page.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).count(), 0, "Disabled conserva la presentación previa sin tags visibles");
  assert.deepEqual(await values(page, "keydown"), []);
  await page.evaluate(() => window.inputHarness.setProps({ state: "Default", disabled: false }));
  assert.equal(await field.isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Quitar Ána Pérez", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Quitar Luis Rivas", exact: true }).count(), 1);
});

test("Teléfono: deshabilitar con menú abierto bloquea prefijo, país y callbacks", async (context) => {
  const page = await openInput(context, { type: "Phone number", phoneOptions: [
    ...PHONE_OPTIONS,
    { ...PHONE_OPTIONS[0], countryCode: "CO", dialCode: "+57", abbreviation: "CO", label: "Colombia" },
    { ...PHONE_OPTIONS[0], countryCode: "AR", dialCode: "+54", abbreviation: "AR", label: "Argentina" },
  ] });
  const prefix = page.getByRole("combobox");
  await prefix.fill("");
  await page.getByRole("option").first().waitFor();
  const scroll = page.getByRole("scrollbar", { name: "Desplazar países" });
  await scroll.waitFor();
  const scrollBounds = await scroll.boundingBox();
  await page.evaluate(() => window.inputHarness.setProps({ state: "Disabled" }));
  assert.equal(await page.locator("#contract-input").isDisabled(), true);
  assert.equal(await prefix.isDisabled(), true);
  assert.equal(await scroll.count(), 0, "El scrollbar del menú disabled queda visual sin acción accesible");
  await page.mouse.click(scrollBounds.x + scrollBounds.width / 2, scrollBounds.y + scrollBounds.height - 4);
  assert.equal(await page.getByRole("listbox").evaluate((element) => element.querySelector('[role="option"]').parentElement.scrollTop), 0);
  const option = page.getByRole("option").filter({ hasText: "VE" });
  assert.equal(await option.isDisabled(), true);
  await option.evaluate((element) => element.click());
  await prefix.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert.deepEqual(await values(page, "country"), []);
  assert.deepEqual(await values(page, "change"), []);
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
  assert.deepEqual(await values(page, "keydown"), [{ key: "ArrowLeft", defaultPrevented: false }]);
});

test("Teléfono: teclado público del número respeta preventDefault y selección interna del prefijo", async (context) => {
  const page = await openInput(context, { type: "Phone number", phoneOptions: PHONE_OPTIONS, defaultValue: "123" });
  await page.evaluate(() => {
    window.inputHarness.setProps({ onKeyDown: (event) => {
      window.inputHarness.record("keyboard", { key: event.key, prevented: event.defaultPrevented, id: event.target.id });
      if (event.key === "Enter") event.preventDefault();
      window.inputHarness.record("keyboard-after", event.defaultPrevented);
    } });
    document.querySelector("form").addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.preventDefault();
    }, { capture: true });
  });
  const field = page.locator("#contract-input");
  await field.press("ArrowLeft");
  assert.deepEqual(await values(page, "keyboard"), [{ key: "ArrowLeft", prevented: false, id: "contract-input" }]);
  await field.press("Escape");
  assert.equal((await values(page, "keyboard")).length, 1, "Un evento ya prevenido no llega al callback público");
  await field.press("Enter");
  assert.deepEqual(await values(page, "keyboard-after"), [false, true]);
  assert.deepEqual(await values(page, "submit"), []);
  const prefix = page.getByRole("combobox");
  await prefix.fill("58");
  await prefix.press("Enter");
  assert.equal(await prefix.getAttribute("aria-expanded"), "false");
  assert.equal((await values(page, "country")).at(-1).countryCode, "VE");
  assert.equal((await values(page, "keyboard")).length, 2, "El prefijo conserva su handler auxiliar");
  assert.deepEqual(await values(page, "submit"), []);
});

test("Teléfono: país y prefijo son iniciales; el eco del consumidor no reinicia selección ni genera eventos", async (context) => {
  const page = await openInput(context, {
    type: "Phone number", countryCode: "VE", countryPrefix: "+58",
    phoneOptions: PHONE_OPTIONS, defaultValue: "4121234567",
  });
  const field = page.locator("#contract-input");
  const prefix = page.getByRole("combobox");
  assert.equal(await prefix.inputValue(), "58");
  assert.equal(await field.getAttribute("placeholder"), PHONE_OPTIONS[1].placeholder);
  assert.equal(await field.inputValue(), "4121234567", "Inicializar país no reformatea el valor inicial");
  await page.evaluate(() => window.inputHarness.setProps({
    countryCode: "US", countryPrefix: "+1",
    onPhoneCountryChange: (country) => {
      window.inputHarness.record("country", country);
      window.inputHarness.setProps({ countryCode: country.countryCode, countryPrefix: country.dialCode });
    },
  }));
  assert.equal(await prefix.inputValue(), "58");
  assert.equal(await field.getAttribute("placeholder"), PHONE_OPTIONS[1].placeholder);
  assert.deepEqual(await values(page, "country"), []);
  assert.deepEqual(await values(page, "change"), []);
  await prefix.fill("");
  await page.getByRole("option").filter({ hasText: "ES" }).click();
  assert.equal(await prefix.inputValue(), "34");
  assert.equal(await field.inputValue(), "412 123 456");
  assert.equal((await values(page, "country")).length, 1);
  await page.evaluate(() => window.inputHarness.setProps({ countryCode: "US", countryPrefix: "+1", label: "Editado" }));
  assert.equal(await prefix.inputValue(), "34");
  assert.equal(await field.inputValue(), "412 123 456");
  assert.equal((await values(page, "country")).length, 1);
  assert.deepEqual(await values(page, "change"), []);
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
