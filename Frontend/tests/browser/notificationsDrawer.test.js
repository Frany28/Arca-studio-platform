import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const COMMENT = {
  id: 21, name: "Ana Pérez", timestamp: "Hace 2 horas", message: "Revisar el área",
  type: "comment", createdAt: "2026-07-10T10:00:00Z", projectId: 7,
  commentType: "image", imageComment: true, image: { id: "imagen-original" },
  imageId: "imagen-7", selection: { kind: "image-area", imagePixels: { x: 0, y: 0, width: 20, height: 30 } },
  navigationMetadata: { preserve: true },
};
const ACTIVITY = {
  id: "file-7", name: "Luis Rivas", action: "subió un archivo", projectName: "Casa Norte",
  timestamp: "Hace 1 hora", type: "file", fileType: "PDF", fileName: "Plano.pdf", fileSize: "2 MB",
  roleCode: "architect", projectId: 7, to: "/proyectos/7", extra: { preserve: true },
};
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], server: { host: "127.0.0.1", port: 0 },
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
 * Monta el drawer real y sus dependencias en una página aislada con props públicas.
 * Los errores de ejecución y las peticiones API inesperadas hacen fallar la prueba.
 * @param {import("node:test").TestContext} context Propietario del navegador aislado.
 * @param {Object} [props={}] Props iniciales del consumidor.
 * @param {Object} [options={}] Viewport, tema y capacidad táctil.
 * @returns {Promise<import("playwright").Page>} Página con fixture listo.
 */
async function openPage(context, props = {}, { theme = "light", consumer = "", ...options } = {}) {
  const session = await browser.newContext({ viewport: { width: 1024, height: 900 }, ...options });
  const page = await session.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Los imports de src/api forman parte del componente; solo se bloquean endpoints.
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    errors.push(`API inesperada: ${route.request().url()}`);
    await route.abort();
  });
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, [], "El drawer no debe lanzar errores ni consultar APIs");
  });
  await page.goto(`${origin}/tests/browser/fixtures/notifications-drawer.html?theme=${theme}&consumer=${consumer}&props=${encodeURIComponent(JSON.stringify(props))}`);
  await page.getByRole("button", { name: "Abrir notificaciones", exact: true }).waitFor();
  return page;
}

/** Lee argumentos de callbacks públicos, sin consultar estado interno de React. */
async function values(page, type) {
  return page.evaluate((type) => window.drawerHarness.events.filter((event) => event.type === type).map((event) => event.value), type);
}

/** Abre mediante el trigger y espera el foco y la transición reales del drawer base. */
async function openDrawer(page) {
  await page.getByRole("button", { name: "Abrir notificaciones", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('aside[role="dialog"]') === document.activeElement);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('aside[role="dialog"]')).transform === "matrix(1, 0, 0, 1, 0, 0)");
  return page.getByRole("dialog");
}

/** Activa la acción real de respuesta por su relación accesible con el comentario. */
async function reply(page, id = COMMENT.id) {
  await page.locator(`button[aria-controls="reply-action-${id}"]`).click();
  await page.locator(`[id="reply-action-${id}"]`).click();
  const field = page.getByPlaceholder("Escribe tu mensaje...", { exact: true });
  await field.waitFor();
  return field;
}

test("Drawer: cerrado, apertura, Escape, overlay, callbacks y restauración de foco", async (context) => {
  const page = await openPage(context);
  assert.equal(await page.getByRole("dialog").count(), 0);
  const drawer = await openDrawer(page);
  assert.equal(await drawer.getAttribute("aria-modal"), "true");
  assert.equal(await drawer.getAttribute("aria-label"), "Panel lateral");
  assert.equal(await drawer.getByText("Actividad Reciente", { exact: true }).count(), 1);
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });
  assert.deepEqual(await values(page, "close"), [null]);
  assert.equal(await page.getByRole("button", { name: "Abrir notificaciones" }).evaluate((element) => element === document.activeElement), true);
  await openDrawer(page);
  await page.mouse.click(10, 300);
  await drawer.waitFor({ state: "detached" });
  assert.deepEqual(await values(page, "close"), [null, null]);
});

test("Drawer: desmontar abierto restaura foco al trigger", async (context) => {
  const page = await openPage(context);
  await openDrawer(page);
  await page.evaluate(() => window.drawerHarness.unmount());
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Abrir notificaciones" }).evaluate((element) => element === document.activeElement), true);
});

test("Estados: loading prevalece sobre error, contenido y vacío en ambas secciones", async (context) => {
  const page = await openPage(context, {
    comments: [COMMENT], recentActivity: [ACTIVITY], commentsLoading: true, recentActivityLoading: true,
    commentsError: "Error de comentarios", recentActivityError: "Error de actividad",
  });
  const drawer = await openDrawer(page);
  assert.equal(await drawer.getByRole("status").count(), 2);
  assert.equal(await drawer.getByText("Cargando observaciones", { exact: true }).count(), 1);
  assert.equal(await drawer.getByText("Cargando actividad reciente", { exact: true }).count(), 1);
  assert.equal(await drawer.getByText(COMMENT.message, { exact: true }).count(), 0);
  assert.equal(await drawer.getByText("Error de comentarios", { exact: true }).count(), 0);
  assert.equal(await drawer.getByRole("textbox").count(), 0);
  await page.evaluate(() => window.drawerHarness.setProps({ commentsLoading: false, recentActivityLoading: false }));
  assert.equal(await drawer.getByRole("status").count(), 0);
  assert.equal(await drawer.getByText("Error de comentarios", { exact: true }).count(), 1);
  assert.equal(await drawer.getByText("Error de actividad", { exact: true }).count(), 1);
  assert.equal(await drawer.getByText(COMMENT.message, { exact: true }).count(), 0);
  assert.equal(await drawer.getByText(ACTIVITY.fileName, { exact: true }).count(), 0);
  await drawer.getByRole("button", { name: "Reintentar", exact: true }).nth(0).click();
  await drawer.getByRole("button", { name: "Reintentar", exact: true }).nth(1).click();
  assert.deepEqual(await values(page, "refresh-comments"), [null]);
  assert.deepEqual(await values(page, "refresh-activity"), [null]);
  await page.evaluate(() => window.drawerHarness.setProps({ commentsError: "", recentActivityError: "" }));
  assert.equal(await drawer.getByText(COMMENT.message, { exact: true }).count(), 1);
  assert.equal(await drawer.getByText(ACTIVITY.fileName, { exact: true }).count(), 1);
  await page.evaluate(() => window.drawerHarness.setProps({ comments: [], recentActivity: [] }));
  assert.equal(await drawer.getByText("No hay comentarios", { exact: true }).count(), 1);
  assert.equal(await drawer.getByText("No hay eventos recientes", { exact: true }).count(), 1);
});

test("Vacío: Añadir enfoca el compositor, Actualizar refresca y Cerrar notifica", async (context) => {
  const page = await openPage(context);
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Añadir", exact: true }).click();
  assert.equal(await drawer.getByRole("textbox", { name: "Observación general" }).evaluate((element) => element === document.activeElement), true);
  for (const action of await drawer.getByRole("button", { name: "Actualizar", exact: true }).all()) await action.click();
  assert.deepEqual(await values(page, "refresh-comments"), [null]);
  assert.deepEqual(await values(page, "refresh-activity"), [null]);
  await drawer.getByRole("button", { name: "Cerrar", exact: true }).click();
  await drawer.waitFor({ state: "detached" });
  assert.deepEqual(await values(page, "close"), [null]);
});

test("Comentarios: tres raíces recientes, respuestas cronológicas y huérfanas", async (context) => {
  const comments = [
    { ...COMMENT, id: 1, message: "Raíz antigua", createdAt: "2026-07-01" },
    { ...COMMENT, id: 2, message: "Raíz intermedia", createdAt: "2026-07-02" },
    { ...COMMENT, id: 3, message: "Raíz reciente", createdAt: "2026-07-03" },
    { ...COMMENT, id: 4, message: "Raíz nueva", createdAt: "2026-07-04" },
    { ...COMMENT, id: 5, message: "Respuesta nueva", type: "reply", parentCommentId: 4, createdAt: "2026-07-06" },
    { ...COMMENT, id: 6, message: "Respuesta antigua", type: "reply", parentCommentId: 4, createdAt: "2026-07-05" },
    { ...COMMENT, id: 7, message: "Respuesta excluida", type: "reply", parentCommentId: 1, createdAt: "2026-07-07" },
    { ...COMMENT, id: 8, message: "Respuesta huérfana", type: "reply", parentCommentId: 99, createdAt: "2026-07-08" },
  ];
  const page = await openPage(context, { comments });
  const drawer = await openDrawer(page);
  const displayed = await drawer.locator("article").evaluateAll((elements) => elements.map((element) => element.querySelector(":scope > p").textContent));
  assert.deepEqual(displayed, ["Raíz nueva", "Respuesta antigua", "Respuesta nueva", "Raíz reciente", "Raíz intermedia", "Respuesta huérfana"]);
  assert.equal(await drawer.getByText("Observación sobre imagen", { exact: true }).count(), 3, "Las respuestas no muestran preview");
});

test("Comentarios: previews de imagen, video, panorámica y documento; selección conserva el objeto", async (context) => {
  const page = await openPage(context, { comments: [COMMENT] });
  const drawer = await openDrawer(page);
  let card = drawer.locator("article").first();
  assert.equal(await card.getByText("Observación sobre imagen", { exact: true }).count(), 1);
  await card.click({ position: { x: 12, y: 55 } });
  await card.focus();
  await card.press("Enter");
  await card.press("Space");
  assert.deepEqual(await values(page, "select-comment"), [COMMENT, COMMENT, COMMENT]);
  assert.equal(await page.evaluate(() => window.drawerHarness.events.filter((event) => event.type === "select-comment").every((event) => event.sameReference)), true);
  for (const [commentType, selection, title] of [
    ["video", { kind: "video-time", timeSeconds: 65, durationSeconds: 120 }, "Observación sobre video"],
    ["panorama", { kind: "panorama-point", yaw: 20, pitch: 10 }, "Observación en panorámica 360"],
    ["document", { kind: "document-point", pageNumber: 2 }, "Observación sobre documento"],
  ]) {
    await page.evaluate((comment) => window.drawerHarness.setProps({ comments: [comment] }), { ...COMMENT, commentType, selection, pointNumber: 4, fileType: "PDF" });
    card = drawer.locator("article").first();
    assert.equal(await card.getByText(title, { exact: true }).count(), 1);
    if (commentType === "video") assert.equal(await card.getByText("Momento 1:05", { exact: true }).count(), 1);
    if (commentType === "panorama") assert.equal(await card.getByText("4", { exact: true }).count(), 1);
    if (commentType === "document") assert.equal(await card.getByText("Página 2", { exact: true }).count(), 1);
  }
  await page.evaluate(() => window.drawerHarness.setProps({ onCommentSelect: undefined }));
  assert.equal(await card.getAttribute("role"), null);
  assert.equal(await card.getAttribute("tabindex"), null);
});

test("Actividad: archivo, estado, evento y activación por click, Enter y espacio", async (context) => {
  const page = await openPage(context, { recentActivity: [ACTIVITY] });
  const drawer = await openDrawer(page);
  const item = drawer.getByRole("button").filter({ hasText: ACTIVITY.fileName });
  assert.equal(await item.getByText(ACTIVITY.fileSize, { exact: true }).count(), 1);
  await item.click();
  await item.press("Enter");
  await item.press("Space");
  assert.deepEqual(await values(page, "select-activity"), [ACTIVITY, ACTIVITY, ACTIVITY]);
  assert.equal(await page.evaluate(() => window.drawerHarness.events.filter((event) => event.type === "select-activity").every((event) => event.sameReference)), true);
  await page.evaluate(() => window.drawerHarness.setProps({ onActivitySelect: undefined }));
  assert.equal(await drawer.getByRole("button").filter({ hasText: ACTIVITY.fileName }).count(), 0);
  await drawer.getByText(ACTIVITY.fileName, { exact: true }).click();
  assert.equal((await values(page, "select-activity")).length, 3);
  await page.evaluate((activity) => window.drawerHarness.setProps({ recentActivity: [{ ...activity, type: "status", status: "En revisión" }, { ...activity, id: "event-8", type: "event" }] }), ACTIVITY);
  assert.equal(await drawer.getByText("En revisión", { exact: true }).count(), 1);
  assert.equal(await drawer.getByText(ACTIVITY.fileName, { exact: true }).count(), 0);
});

test("Más opciones: toggle, propagación, cierre exterior y responder conserva el foco actual", async (context) => {
  const page = await openPage(context, { comments: [COMMENT] });
  await openDrawer(page);
  const more = page.getByRole("button", { name: "Más opciones", exact: true });
  await more.click();
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(`[id="reply-action-${COMMENT.id}"] button`).count(), 1, "La deuda de botones anidados permanece sin corregir");
  assert.deepEqual(await values(page, "select-comment"), []);
  await more.click();
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  const field = await reply(page);
  assert.equal(await field.evaluate((element) => element === document.activeElement), false);
  await field.fill("Borrador");
  await page.getByText("Actividad Reciente", { exact: true }).click();
  assert.equal(await field.count(), 0);
  await more.click();
  await page.getByText("Actividad Reciente", { exact: true }).click();
  assert.equal(await more.getAttribute("aria-expanded"), "false");
});

for (const scope of ["project", "environment"]) {
  test(`Respuestas ${scope}: padre raíz, proyecto, referencias y callback correcto`, async (context) => {
    const item = { ...COMMENT, scope, id: scope === "environment" ? "environment:21" : 21, parentCommentId: scope === "environment" ? "environment:10" : 10, type: "reply", targetId: "target-original" };
    const page = await openPage(context, { comments: [item] });
    await openDrawer(page);
    const field = await reply(page, item.id);
    await field.fill("  Respuesta  ");
    await field.press("Enter");
    await field.waitFor({ state: "detached" });
    const type = scope === "environment" ? "submit-environment" : "submit-project";
    assert.deepEqual(await values(page, type), [{
      commentType: item.commentType, image: item.image, selection: item.selection, targetId: item.targetId,
      message: "Respuesta", parentCommentId: item.parentCommentId, projectId: item.projectId,
    }]);
    assert.deepEqual(await values(page, scope === "environment" ? "submit-project" : "submit-environment"), []);
  });
}

test("Respuesta raíz: fallback imageId, padre propio, envío por botón y disabled según origen", async (context) => {
  const page = await openPage(context, { comments: [COMMENT] });
  await openDrawer(page);
  const field = await reply(page);
  await field.fill("Respuesta");
  await page.getByRole("button", { name: "Enviar mensaje", exact: true }).click();
  await field.waitFor({ state: "detached" });
  assert.deepEqual(await values(page, "submit-project"), [{ commentType: COMMENT.commentType, image: COMMENT.image, selection: COMMENT.selection, targetId: COMMENT.imageId, message: "Respuesta", parentCommentId: COMMENT.id, projectId: COMMENT.projectId }]);
  await page.evaluate(() => window.drawerHarness.setProps({ onSubmitComment: undefined }));
  const disabledField = await reply(page);
  assert.equal(await disabledField.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Enviar mensaje", exact: true }).isDisabled(), true);
});

test("Composer general: vacío, trim, Enter, Shift+Enter, fallback y disabled", async (context) => {
  const page = await openPage(context);
  const drawer = await openDrawer(page);
  const field = drawer.getByRole("textbox", { name: "Observación general" });
  const send = drawer.getByRole("button", { name: "Enviar observación", exact: true });
  await field.fill("   ");
  await field.press("Enter");
  assert.equal(await send.isDisabled(), true);
  assert.deepEqual(await values(page, "submit-environment"), []);
  await field.fill("  General  ");
  await field.press("Enter");
  assert.deepEqual(await values(page, "submit-environment"), [{ message: "General", parentCommentId: null, projectId: null }]);
  assert.equal(await field.inputValue(), "");
  await field.fill("Primera");
  await field.press("Shift+Enter");
  assert.equal(await field.inputValue(), "Primera\n");
  assert.equal((await values(page, "submit-environment")).length, 1);
  await page.evaluate(() => window.drawerHarness.setProps({ onSubmitEnvironmentComment: undefined }));
  await send.click();
  assert.deepEqual(await values(page, "submit-project"), [{ message: "Primera", parentCommentId: null, projectId: null }]);
  await field.fill("Conservar");
  await page.evaluate(() => window.drawerHarness.setProps({ onSubmitComment: undefined }));
  assert.equal(await field.isDisabled(), true);
  assert.equal(await send.isDisabled(), true);
  await field.dispatchEvent("keydown", { key: "Enter" });
  assert.equal((await values(page, "submit-project")).length, 1);
  assert.equal(await field.inputValue(), "Conservar");
});

test("Envío general: conserva el borrador pendiente, bloquea repeticiones y limpia solo al resolver", async (context) => {
  const page = await openPage(context);
  const drawer = await openDrawer(page);
  await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
  const field = drawer.getByRole("textbox", { name: "Observación general" });
  const send = drawer.getByRole("button", { name: "Enviar observación", exact: true });
  await field.fill("  Primero  ");
  // Dos eventos en el mismo turno también deben quedar protegidos antes del render.
  await field.evaluate((element) => {
    for (let index = 0; index < 2; index++) element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.equal((await values(page, "submit-environment")).length, 1);
  assert.equal(await field.inputValue(), "  Primero  ");
  assert.equal(await send.isDisabled(), true);
  await field.dispatchEvent("keydown", { key: "Enter" });
  await send.evaluate((element) => element.click());
  assert.equal((await values(page, "submit-environment")).length, 1);
  await page.evaluate(() => window.drawerHarness.settle(0));
  await page.waitForFunction(() => document.querySelector("textarea").value === "");
  assert.equal(await field.inputValue(), "");
});

for (const kind of ["general", "reply"]) {
  test(`Envío ${kind}: rechazo conserva texto, muestra error y permite reintento`, async (context) => {
    const page = await openPage(context, { comments: [COMMENT] });
    const drawer = await openDrawer(page);
    await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
    const field = kind === "general" ? drawer.getByRole("textbox", { name: "Observación general" }) : await reply(page);
    const send = drawer.getByRole("button", { name: kind === "general" ? "Enviar observación" : "Enviar mensaje", exact: true });
    await field.fill("  Conservar borrador  ");
    await field.press("Enter");
    assert.equal(await field.inputValue(), "  Conservar borrador  ");
    assert.equal(await send.isDisabled(), true);
    await page.evaluate(() => window.drawerHarness.settle(0, true));
    await drawer.getByText("Fallo simulado", { exact: true }).waitFor();
    assert.equal(await field.inputValue(), "  Conservar borrador  ");
    assert.equal(await send.isEnabled(), true);
    await field.press("Enter");
    assert.equal((await values(page, kind === "general" ? "submit-environment" : "submit-project")).length, 2);
    await page.evaluate(() => window.drawerHarness.settle(1));
    if (kind === "reply") await field.waitFor({ state: "detached" });
    else await page.waitForFunction(() => document.querySelector("textarea").value === "");
    assert.equal(await drawer.getByText("Fallo simulado", { exact: true }).count(), 0);
  });
}

for (const fail of [false, true]) {
test(`Respuestas: finalizar A con ${fail ? "error" : "éxito"} conserva B abierto y su borrador`, async (context) => {
  const page = await openPage(context, { comments: [COMMENT, { ...COMMENT, id: 22, message: "Otra raíz" }] });
  await openDrawer(page);
  await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
  const field = await reply(page);
  await field.fill("Pendiente");
  await field.press("Enter");
  const fieldB = await reply(page, 22);
  await fieldB.fill("Borrador B");
  await page.evaluate((fail) => window.drawerHarness.settle(0, fail), fail);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await fieldB.inputValue(), "Borrador B");
  assert.equal(await page.getByRole("button", { name: "Enviar mensaje", exact: true }).isEnabled(), true);
  assert.equal(await page.getByText("Fallo simulado", { exact: true }).count(), 0, "El fallo de A no pertenece a B");
});
}

test("Respuestas: terminar una apertura anterior de A no cierra una nueva apertura de A", async (context) => {
  const page = await openPage(context, { comments: [COMMENT, { ...COMMENT, id: 22 }] });
  await openDrawer(page);
  await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
  const first = await reply(page);
  await first.fill("A anterior");
  await first.press("Enter");
  await reply(page, 22);
  const current = await reply(page);
  await current.fill("A nuevo");
  await page.evaluate(() => window.drawerHarness.settle(0));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await current.inputValue(), "A nuevo");
});

for (const firstKind of ["general", "reply"]) {
  test(`Pending independiente: ${firstKind} permite enviar desde el otro compositor`, async (context) => {
    const page = await openPage(context, { comments: [COMMENT] });
    const drawer = await openDrawer(page);
    await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
    const general = drawer.getByRole("textbox", { name: "Observación general" });
    const response = await reply(page);
    const first = firstKind === "general" ? general : response;
    const second = firstKind === "general" ? response : general;
    await first.fill("Primero");
    await second.fill("Segundo");
    // Mantiene los eventos mousedown existentes fuera de este contrato de envío.
    await first.press("Enter");
    assert.equal(await second.isEnabled(), true);
    await second.press("Enter");
    assert.equal((await values(page, "submit-project")).length, 1);
    assert.equal((await values(page, "submit-environment")).length, 1);
    await page.evaluate(() => { window.drawerHarness.settle(0); window.drawerHarness.settle(1); });
    await response.waitFor({ state: "detached" });
    assert.equal(await general.inputValue(), "");
  });
}

for (const mode of ["sync", "void", "immediate"]) {
  test(`Callbacks: éxito ${mode} limpia general y cierra respuesta`, async (context) => {
    const page = await openPage(context, { comments: [COMMENT] });
    const drawer = await openDrawer(page);
    await page.evaluate((mode) => window.drawerHarness.setSubmissionMode(mode), mode);
    const general = drawer.getByRole("textbox", { name: "Observación general" });
    await general.fill("General");
    await general.press("Enter");
    await page.waitForFunction(() => document.querySelector("textarea").value === "");
    const response = await reply(page);
    await response.fill("Respuesta");
    await response.press("Enter");
    await response.waitFor({ state: "detached" });
    assert.equal((await values(page, "submit-project")).length, 1);
    assert.equal((await values(page, "submit-environment")).length, 1);
  });
}

test("Callbacks: throw síncrono conserva el borrador y habilita reintento", async (context) => {
  const page = await openPage(context, { comments: [COMMENT] });
  await openDrawer(page);
  await page.evaluate(() => window.drawerHarness.setSubmissionMode("throw"));
  const field = await reply(page);
  await field.fill("Recuperable");
  await field.press("Enter");
  await page.getByText("Fallo síncrono", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "Recuperable");
  assert.equal(await page.getByRole("button", { name: "Enviar mensaje", exact: true }).isEnabled(), true);
  await page.evaluate(() => window.drawerHarness.setSubmissionMode("sync"));
  await field.press("Enter");
  await field.waitFor({ state: "detached" });
});

for (const fail of [false, true]) {
  test(`Ciclo de vida: envío ${fail ? "fallido" : "exitoso"} previo al cierre no afecta la reapertura`, async (context) => {
    const page = await openPage(context, { comments: [COMMENT] });
    const drawer = await openDrawer(page);
    await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
    const old = await reply(page);
    await old.fill("Anterior");
    await old.press("Enter");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
    await openDrawer(page);
    const current = await reply(page);
    await current.fill("Nuevo");
    await page.evaluate((fail) => window.drawerHarness.settle(0, fail), fail);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await current.inputValue(), "Nuevo");
  });
}

for (const [consumer, kind, apiType] of [
  ["environment", "general", "api-environment"],
  ["environment", "reply", "api-project"],
  ["environment", "reply-environment", "api-environment"],
  ["details", "reply", "api-project"],
]) {
  test(`Consumidor ${consumer}/${kind}: no desmonta al enviar, conserva errores y permite reintento`, async (context) => {
    const page = await openPage(context, { comments: [{ ...COMMENT, scope: kind === "reply-environment" ? "environment" : "project" }] }, { consumer });
    const drawer = await openDrawer(page);
    await drawer.getByText(COMMENT.message, { exact: true }).first().waitFor();
    await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
    const field = kind === "general" ? drawer.getByRole("textbox", { name: "Observación general" }) : await reply(page, kind === "reply-environment" ? "environment:21" : 21);
    await field.fill("Borrador real");
    await field.press("Enter");
    assert.equal(await field.count(), 1, "El loading de envío no debe desmontar el compositor");
    assert.equal(await field.inputValue(), "Borrador real");
    await field.dispatchEvent("keydown", { key: "Enter" });
    assert.equal((await values(page, apiType)).length, 1);
    await page.evaluate(() => window.drawerHarness.settle(0, true));
    await drawer.getByText("Fallo simulado", { exact: true }).waitFor();
    assert.equal(await field.inputValue(), "Borrador real");
    if (kind === "reply") assert.equal(await page.locator("[data-consumer-error]").textContent(), "Fallo simulado");
    assert.equal(await drawer.getByText("No se pudieron cargar los comentarios", { exact: true }).count(), 0);
    await field.press("Enter");
    assert.equal((await values(page, apiType)).length, 2);
    await page.evaluate(() => window.drawerHarness.settle(1));
    if (kind !== "general") await field.waitFor({ state: "detached" });
    else await page.waitForFunction(() => document.querySelector("textarea").value === "");
  });
}

test("EnvironmentNotificationsDrawer: errores de lectura conservan el estado y la acción Reintentar", async (context) => {
  const page = await openPage(context, { comments: [COMMENT] }, { consumer: "environment" });
  await page.evaluate(() => window.drawerHarness.setReadFailure(true));
  const drawer = await openDrawer(page);
  await drawer.getByText("Fallo de lectura", { exact: true }).waitFor();
  assert.equal(await drawer.getByText("No se pudieron cargar los comentarios", { exact: true }).count(), 1);
  await page.evaluate(() => window.drawerHarness.setReadFailure(false));
  await drawer.getByRole("button", { name: "Reintentar", exact: true }).click();
  await drawer.getByText(COMMENT.message, { exact: true }).first().waitFor();
  assert.equal(await drawer.getByText("Fallo de lectura", { exact: true }).count(), 0);
});

for (const fail of [false, true]) {
  test(`EnvironmentNotificationsDrawer: terminar A con ${fail ? "error" : "éxito"} no desmonta B`, async (context) => {
    const page = await openPage(context, { comments: [COMMENT, { ...COMMENT, id: 22, message: "Otra raíz" }] }, { consumer: "environment" });
    await openDrawer(page);
    await page.getByText(COMMENT.message, { exact: true }).waitFor();
    await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
    const first = await reply(page);
    await first.fill("A");
    await first.press("Enter");
    const current = await reply(page, 22);
    await current.fill("Borrador B");
    await page.evaluate((fail) => window.drawerHarness.settle(0, fail), fail);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await current.inputValue(), "Borrador B");
    assert.equal(await page.getByRole("dialog").getByText("Fallo simulado", { exact: true }).count(), 0);
  });
}

for (const firstKind of ["general", "reply"]) {
  test(`EnvironmentNotificationsDrawer: pending de ${firstKind} no bloquea el otro envío`, async (context) => {
    const page = await openPage(context, { comments: [COMMENT] }, { consumer: "environment" });
    const drawer = await openDrawer(page);
    await drawer.getByText(COMMENT.message, { exact: true }).waitFor();
    await page.evaluate(() => window.drawerHarness.setSubmissionMode("deferred"));
    const general = drawer.getByRole("textbox", { name: "Observación general" });
    const response = await reply(page);
    const first = firstKind === "general" ? general : response;
    const second = firstKind === "general" ? response : general;
    await first.fill("Primero");
    await second.fill("Segundo");
    await first.press("Enter");
    assert.equal(await second.isEnabled(), true);
    await second.press("Enter");
    assert.equal((await values(page, "api-project")).length, 1);
    assert.equal((await values(page, "api-environment")).length, 1);
    await page.evaluate(() => { window.drawerHarness.settle(0); window.drawerHarness.settle(1); });
    await response.waitFor({ state: "detached" });
    assert.equal(await general.inputValue(), "");
  });
}

test("Consumidor environment: destino de proyecto ausente conserva la respuesta sin invocar API", async (context) => {
  const page = await openPage(context, { projectId: null, comments: [{ ...COMMENT, projectId: null }] }, { consumer: "environment" });
  await openDrawer(page);
  const field = await reply(page);
  await field.fill("Sin destino");
  await field.press("Enter");
  await page.getByRole("dialog").getByText("No se encontro el proyecto para comentar.", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "Sin destino");
  assert.equal((await values(page, "api-project")).length, 0);
});

test("Consumidor details: proyecto finalizado rechaza, conserva respuesta y no invoca API", async (context) => {
  const page = await openPage(context, { project: { status: "completed" }, comments: [COMMENT] }, { consumer: "details" });
  const drawer = await openDrawer(page);
  await drawer.getByText(COMMENT.message, { exact: true }).waitFor();
  const field = await reply(page);
  await field.fill("Conservar respuesta");
  await field.press("Enter");
  await drawer.getByText("El proyecto finalizado es de solo lectura.", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "Conservar respuesta");
  assert.equal((await values(page, "api-project")).length, 0);
});

test("Consumidor details: sin proyecto rechaza, conserva texto y no invoca la API", async (context) => {
  const page = await openPage(context, { projectId: null }, { consumer: "details" });
  const drawer = await openDrawer(page);
  const field = drawer.getByRole("textbox", { name: "Observación general" });
  await field.fill("Sin destino");
  await field.press("Enter");
  await drawer.getByText("No se encontro el proyecto para comentar.", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "Sin destino");
  assert.equal((await values(page, "api-project")).length, 0);
});

test("Mouse/touch: pointerdown solo no cierra; mousedown exterior y tap compatible sí", async (context) => {
  const page = await openPage(context, { comments: [COMMENT] }, { hasTouch: true });
  await openDrawer(page);
  const more = page.getByRole("button", { name: "Más opciones", exact: true });
  await more.tap();
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  const outside = page.getByText("Actividad Reciente", { exact: true });
  await outside.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  await outside.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 1, clientY: 1 }], bubbles: true });
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  await outside.tap();
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  const field = await reply(page);
  await field.tap();
  assert.equal(await field.count(), 1, "El marcador protege el compositor");
  await outside.dispatchEvent("mousedown", { bubbles: true });
  assert.equal(await field.count(), 0);
});

test("Cierre y carga: desmontan compositores y no restauran acciones de respuesta", async (context) => {
  const page = await openPage(context, { comments: [COMMENT] });
  let drawer = await openDrawer(page);
  const general = drawer.getByRole("textbox", { name: "Observación general" });
  await general.fill("Borrador general");
  await reply(page);
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });
  drawer = await openDrawer(page);
  assert.equal(await general.inputValue(), "");
  assert.equal(await page.getByPlaceholder("Escribe tu mensaje...", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Más opciones", exact: true }).getAttribute("aria-expanded"), "false");
  await general.fill("Carga lo reemplaza");
  await page.evaluate(() => window.drawerHarness.setProps({ commentsLoading: true }));
  assert.equal(await general.count(), 0);
  await page.evaluate(() => window.drawerHarness.setProps({ commentsLoading: false }));
  assert.equal(await general.inputValue(), "");
});

test("ActivityOnly y props reenviadas conservan el contrato del drawer base", async (context) => {
  const page = await openPage(context, { activityOnly: true, comments: [COMMENT], ariaLabel: "Actividad global", side: "left", widthClassName: "w-[280px]", "data-contract": "conservado" });
  const drawer = await openDrawer(page);
  assert.equal(await drawer.getAttribute("aria-label"), "Actividad global");
  assert.equal(await drawer.getByRole("textbox").count(), 0);
  assert.equal(await drawer.getByText(COMMENT.message, { exact: true }).count(), 0);
  assert.equal((await drawer.boundingBox()).width, 280);
  assert.equal((await drawer.boundingBox()).x, 0);
  assert.equal(await page.locator('[data-contract="conservado"]').count(), 1);
});

/**
 * Compara opcionalmente DOM, clases, estilos y geometría con la versión anterior.
 * El directorio temporal se indica por ARCA_DRAWER_BASELINE_DIR; solo una ejecución
 * explícita con ARCA_DRAWER_RECORD_BASELINE=1 crea las referencias originales.
 * @param {import("playwright").Locator} drawer Panel renderizado y estable.
 * @param {string} key Viewport y tema de la referencia.
 * @returns {Promise<void>} Guarda o verifica artefactos sin inspeccionar código fuente.
 */
async function compareBaseline(drawer, key) {
  const directory = process.env.ARCA_DRAWER_BASELINE_DIR;
  if (!directory) return;
  // Espera el revelado real antes de comparar; una captura a mitad de animación
  // puede diferir incluso sin refactor por el rasterizado de capas transformadas.
  await drawer.evaluate(async (element) => {
    await document.fonts.ready;
    await Promise.all(element.getAnimations({ subtree: true })
      .filter((animation) => Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map((animation) => animation.finished));
  });
  const markup = await drawer.evaluate((element) => element.outerHTML.replace(/_r_[a-z0-9]+_/g, "_generated_id_"));
  const presentation = await drawer.evaluate((element) => [element, ...element.querySelectorAll("*")].map((node) => {
    const style = getComputedStyle(node);
    const bounds = node.getBoundingClientRect();
    const properties = ["display", "color", "background-color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "padding", "margin", "gap", "border", "border-radius", "box-shadow", "width", "height", "overflow", "opacity", "transform", "translate", "transition-duration", "animation-name"];
    return {
      tag: node.tagName,
      styles: Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)])),
      bounds: [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => Math.round(value * 100) / 100),
    };
  }));
  const pixels = await drawer.screenshot({ animations: "disabled" });
  if (process.env.ARCA_DRAWER_RECORD_BASELINE === "1") {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${key}.html`), markup);
    await writeFile(join(directory, `${key}.json`), JSON.stringify(presentation));
    await writeFile(join(directory, `${key}.png`), pixels);
  } else {
    assert.equal(markup, await readFile(join(directory, `${key}.html`), "utf8"), "DOM y clases deben conservarse");
    assert.deepEqual(presentation, JSON.parse(await readFile(join(directory, `${key}.json`), "utf8")), "Estilos y geometría deben conservarse");
    // Edge puede rasterizar texto distinto aun con DOM, estilos y geometría idénticos.
    // Las capturas se conservan para revisión visual, sin una igualdad de bytes inestable.
    await writeFile(join(directory, `${key}.after.png`), pixels);
  }
}

for (const width of [375, 768, 1024, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`Presentación: ${width}px, tema ${theme}, DOM, SVG, geometría y animaciones`, async (context) => {
      const page = await openPage(context, { comments: [COMMENT], recentActivity: [ACTIVITY] }, { viewport: { width, height: 1000 }, theme });
      const drawer = await openDrawer(page);
      await page.evaluate(() => document.fonts.ready);
      const bounds = await drawer.boundingBox();
      assert.equal(bounds.width, 312);
      assert.equal(bounds.x, width - 312);
      assert.equal(bounds.height, 1000);
      assert.equal(await drawer.evaluate((element) => element.parentElement.closest("#root")), null, "El portal se monta fuera del layout");
      const styles = await drawer.evaluate((element) => ({
        duration: element.style.transitionDuration,
        animations: [...element.querySelectorAll(".content-reveal")].map((node) => getComputedStyle(node).animationName),
        scrollbar: getComputedStyle(element.firstElementChild).scrollbarWidth,
      }));
      assert.equal(styles.duration, "360ms");
      assert.deepEqual(styles.animations, ["content-reveal", "content-reveal"]);
      assert.equal(styles.scrollbar, "none");
      assert.equal(await drawer.locator('svg[aria-hidden="true"]').count() > 0, true);
      await compareBaseline(drawer, `${width}-${theme}`);
      await reply(page);
      await page.getByRole("button", { name: "Más opciones", exact: true }).focus();
      await compareBaseline(drawer, `${width}-${theme}-reply`);
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.deepEqual(await drawer.locator(".content-reveal").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationName)), ["none", "none"]);
    });
  }
}
