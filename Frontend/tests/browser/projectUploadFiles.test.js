import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Detalle real en StrictMode: el cliente revisa la selección antes de enviar; las transferencias
// admiten validación, reintento y cancelación sin duplicar las peticiones.
const PROJECT = {
  id: 41, name: "Proyecto de subida", publicSlug: "proyecto-de-subida", status: "in_process", progress: 40,
  client: { id: 7, name: "Cliente del proyecto" }, assignees: [], files: [], filesNextCursor: null,
};
const UPLOAD_PATH = `/api/projects/${PROJECT.id}/files`;
const PROJECT_BY_ID = `/api/projects/${PROJECT.id}`;
const SCREENSHOT_DIR = process.env.ARCA_PROJECT_UPLOAD_SCREENSHOTS;
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

const pdf = (name) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 prueba") });

/**
 * Abre la pestaña «Subir archivos» con la API simulada y registra subidas y recargas del proyecto.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {(uploadNumber: number) => Promise<Object|null>|Object|null} [respondUpload] - Respuesta de
 * cada subida: objeto JSON, `null` para un error 503, o una promesa que no se resuelve (subida en curso).
 * @param {Object} [options] - Rol, proyecto, tema y ancho de viewport.
 * @returns {Promise<{page: import("playwright").Page, refreshes: () => number, uploads: string[]}>} Página y registros.
 */
async function openUploadTab(context, respondUpload = (number) => ({ file: { id: 900 + number } }), {
  project = PROJECT, role = "client", theme = "light", width = 1440,
} = {}) {
  const session = await browser.newContext({ viewport: { width, height: 950 } });
  context.after(() => session.close());
  const page = await session.newPage();
  applyBrowserTimeouts(page);
  await page.addInitScript((value) => localStorage.setItem("arca-theme", value), theme);
  const uploads = [];
  const projectReads = [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/auth/me") {
      return route.fulfill({ json: { user: { id: role === "client" ? project.client.id : 1, firstName: "Usuario", lastName: "Prueba", email: "usuario@example.test", role, status: "active" } } });
    }
    if (pathname.endsWith("/events")) return route.fulfill({ status: 204, body: "" });
    if (pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [], nextCursor: null } });
    if (pathname === "/api/projects") return route.fulfill({ json: { projects: [project], nextCursor: null } });
    if (pathname === UPLOAD_PATH && request.method() === "POST") {
      uploads.push(decodeURIComponent(request.headers()["x-file-name"] || ""));
      const body = await respondUpload(uploads.length);
      if (body === null) return route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "Servicio no disponible" } });
      return route.fulfill({ status: 201, json: body });
    }
    if (/^\/api\/projects\/[^/]+$/.test(pathname)) {
      projectReads.push(pathname);
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`${origin}/proyectos/${PROJECT.publicSlug}`, { timeout: NAVIGATION_TIMEOUT_MS });
  await page.getByRole("heading", { level: 1, name: PROJECT.name }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  await page.getByRole("tab", { name: "Subir archivos" }).click();
  await page.locator('input[type="file"]').first().waitFor({ state: "attached" });
  return { page, refreshes: () => projectReads.filter((path) => path === PROJECT_BY_ID).length, uploads };
}

function selectFiles(page, files) {
  return page.locator('input[type="file"]').first().setInputFiles(files);
}

const sendButton = (page) => page.getByRole("button", { name: "Subir archivos", exact: true });
const successCard = (page) => page.getByRole("status").filter({ hasText: "Tus archivos se están subiendo" });

test("el cliente abre el mismo selector, quita una selección con papelera y envía la restante", async (context) => {
  const { page, uploads } = await openUploadTab(context);
  await page.getByRole("heading", { name: "Subir imágenes o documentos" }).waitFor();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), sendButton(page).click()]);
  await chooser.setFiles([pdf("Quitar.pdf"), pdf("Conservar.pdf")]);
  const remove = page.getByRole("button", { name: "Eliminar archivo Quitar.pdf" });
  await remove.waitFor();
  assert.equal(await remove.locator("svg").getAttribute("width"), "20");
  await remove.click();
  await remove.waitFor({ state: "detached" });
  const nextRemove = page.getByRole("button", { name: "Eliminar archivo Conservar.pdf" });
  assert.equal(await nextRemove.evaluate((button) => button === document.activeElement), true);
  assert.deepEqual(uploads, []);
  assert.equal(await successCard(page).count(), 0);
  await sendButton(page).click();
  const status = successCard(page);
  await status.getByText("Tus archivos se están subiendo", { exact: true }).waitFor();
  assert.equal(await status.count(), 1);
  assert.equal(await status.locator("svg").getAttribute("width"), "20");
  assert.equal(await status.getAttribute("aria-live"), "polite");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("region", { name: "Selección de archivos del proyecto" }).getByText("Completado", { exact: true }).waitFor();
  assert.deepEqual(uploads, ["Conservar.pdf"]);
  assert.equal(await page.getByRole("button", { name: "Eliminar archivo Conservar.pdf" }).count(), 0);
  await status.waitFor({ state: "detached" });
});

test("la cola del cliente envía cada archivo válido una sola vez y excluye los inválidos", async (context) => {
  const { page, refreshes, uploads } = await openUploadTab(context);

  await selectFiles(page, [pdf("Plano A.pdf"), pdf("Plano B.pdf"), { name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("texto") }]);
  await page.getByText("Solo se permiten archivos JPEG, PNG, PDF y MP4").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Intenta de nuevo" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Eliminar archivo notas.txt" }).count(), 1);
  assert.deepEqual(uploads, [], "elegir archivos solo llena la cola");
  await sendButton(page).click();
  await page.getByText("Completado", { exact: true }).last().waitFor();
  await successCard(page).waitFor();

  assert.equal(uploads.length, 2, "una subida por archivo válido, sin duplicados de StrictMode");
  assert.equal(new Set(uploads).size, uploads.length, "ningún archivo se sube dos veces");
  await page.waitForFunction(() => document.querySelectorAll(".auth-toast--visible").length === 1);
  assert.equal(refreshes(), 2, "cada subida completada actualiza el proyecto una vez");
});

test("un archivo con el mismo nombre que otro ya seleccionado se rechaza sin subirse", async (context) => {
  const { page, uploads } = await openUploadTab(context);

  await selectFiles(page, [pdf("Plano A.pdf")]);
  await selectFiles(page, [pdf("Plano A.pdf")]);
  await page.getByText("Ese archivo ya está seleccionado.").waitFor();
  assert.deepEqual(uploads, []);
  await sendButton(page).click();
  await successCard(page).waitFor();

  assert.equal(uploads.length, 1);
});

test("«Intenta de nuevo» repite solo la subida fallida y actualiza el proyecto al completarse", async (context) => {
  const { page, refreshes, uploads } = await openUploadTab(context, (number) => (number === 1 ? null : { file: { id: 950 } }));

  await selectFiles(page, [pdf("Plano A.pdf")]);
  await sendButton(page).click();
  const error = page.getByRole("alert", { name: "Error de subida" });
  await error.getByText("No se pudo subir el archivo. Inténtalo de nuevo.", { exact: true }).waitFor();
  assert.equal(await successCard(page).count(), 0);
  await page.getByRole("button", { name: "Intenta de nuevo" }).click();
  await successCard(page).waitFor();

  assert.equal(uploads.length, 2, "la subida inicial fallida y un único reintento");
  assert.equal(refreshes(), 1, "solo la subida completada actualiza el proyecto");
});

test("cancelar un archivo durante la subida la aborta y conserva los archivos ya guardados", async (context) => {
  // La primera subida no termina (sigue en curso); las siguientes se guardan.
  const { page, refreshes, uploads } = await openUploadTab(context, (number) => (number === 1 ? new Promise(() => {}) : { file: { id: 900 + number } }));

  await selectFiles(page, [pdf("Plano A.pdf")]);
  await sendButton(page).click();
  await page.getByText("Subiendo...").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Subiendo archivos…" }).isDisabled(), true);
  assert.equal(await successCard(page).count(), 0);
  await page.getByRole("button", { name: "Eliminar archivo Plano A.pdf" }).click();
  await page.getByRole("button", { name: "Eliminar archivo Plano A.pdf" }).waitFor({ state: "detached" });

  assert.equal(uploads.length, 1);
  // Conservación (Fase 1.2, B1): el servidor pudo registrar la carga justo antes de cancelarla, así
  // que cancelar recarga una vez los archivos del proyecto para mostrarla si quedó guardada.
  await page.waitForTimeout(300);
  assert.equal(refreshes(), 1, "la cancelación recarga el proyecto una sola vez");

  // Un archivo ya guardado sigue disponible: se muestra completado y no ofrece eliminarse.
  await selectFiles(page, [pdf("Plano B.pdf")]);
  await sendButton(page).click();
  const savedCard = page.locator("div[id*='-file-']:not([id$='-remove']):not([id$='-message'])").filter({ has: page.getByText("Plano B", { exact: true }) });
  await savedCard.getByText("Completado", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Eliminar archivo Plano B.pdf" }).count(), 0, "un archivo guardado no ofrece eliminarse");
  assert.equal(uploads.length, 2);
  assert.equal(refreshes(), 2, "la subida completada actualiza el proyecto");
});

test("arrastrar y soltar añade un archivo pendiente a la misma cola del cliente", async (context) => {
  const { page, uploads } = await openUploadTab(context);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["%PDF-1.4"], "Arrastrado.pdf", { type: "application/pdf" }));
    return transfer;
  });
  await page.locator("[data-file-upload-dropzone]").dispatchEvent("drop", { dataTransfer });
  await page.getByText("Arrastrado", { exact: true }).waitFor();
  assert.deepEqual(uploads, []);
  await sendButton(page).click();
  await successCard(page).waitFor();
  assert.deepEqual(uploads, ["Arrastrado.pdf"]);
});

test("el panel de un proyecto archivado conserva el bloqueo de selección y envío", async (context) => {
  const { page, uploads } = await openUploadTab(context, undefined, { project: { ...PROJECT, status: "archived" } });
  assert.equal(await page.getByRole("button", { name: "Elige un archivo" }).isDisabled(), true);
  assert.equal(await sendButton(page).isDisabled(), true);
  assert.equal(await page.locator('input[type="file"]').isDisabled(), true);
  assert.deepEqual(uploads, []);
});

test("el administrador conserva la subida automática del detalle del proyecto", async (context) => {
  const { page, uploads } = await openUploadTab(context, undefined, { role: "admin" });
  await selectFiles(page, [pdf("Plano A.pdf")]);
  await successCard(page).waitFor();
  assert.deepEqual(uploads, ["Plano A.pdf"]);
});

for (const theme of ["light", "dark"]) {
  for (const width of [360, 375, 390, 768, 1024, 1440]) {
    test(`el área y la notificación caben en ${width} px (${theme})`, async (context) => {
      const { page } = await openUploadTab(context, undefined, { theme, width });
      const area = page.locator("[data-file-upload-dropzone]");
      const heading = page.getByRole("heading", { name: "Subir imágenes o documentos" });
      await heading.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const areaBox = await area.boundingBox();
      const headingBox = await heading.boundingBox();
      assert.ok(areaBox.x >= 0 && areaBox.x + areaBox.width <= width && areaBox.width <= 512);
      if (width < 768) assert.ok(areaBox.y >= headingBox.y + headingBox.height);
      if (width === 1440) {
        assert.equal(Math.round(areaBox.width), 512);
        assert.equal(Math.round(areaBox.height), 177);
      }
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/empty-${theme}-${width}.png`, animations: "disabled" });

      await selectFiles(page, [pdf("NombreDeArchivoMuyLargoSinEspaciosParaComprobarElAjusteDeLasTarjetas.pdf")]);
      const remove = page.getByRole("button", { name: /Eliminar archivo NombreDeArchivo/ });
      const removeBox = await remove.boundingBox();
      assert.equal(Math.round(removeBox.width), 36);
      assert.ok(removeBox.x + removeBox.width <= areaBox.x + areaBox.width);
      const buttonBox = await sendButton(page).boundingBox();
      assert.ok(buttonBox.y > areaBox.y + areaBox.height);
      assert.ok(buttonBox.x >= areaBox.x && buttonBox.x + buttonBox.width <= areaBox.x + areaBox.width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (SCREENSHOT_DIR && (width === 360 || width === 1440)) {
        await page.screenshot({ path: `${SCREENSHOT_DIR}/pending-${theme}-${width}.png`, animations: "disabled" });
      }

      await sendButton(page).click();
      const status = successCard(page);
      await status.and(page.locator(".auth-toast--visible")).waitFor();
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/complete-${theme}-${width}.png`, animations: "disabled" });
      const geometry = await status.evaluate(async (node) => {
        await Promise.all(node.getAnimations().map((animation) => animation.finished));
        const { left, right, top, width } = node.getBoundingClientRect();
        return { left, right, top, width, dark: document.documentElement.classList.contains("dark") };
      });
      assert.equal(geometry.dark, theme === "dark");
      assert.equal(Math.round(geometry.width), Math.min(width - 48, 347));
      assert.ok(geometry.left >= 24 && geometry.right <= width - 24 && Math.abs(geometry.top - 24) <= 1);
    });
  }
}
