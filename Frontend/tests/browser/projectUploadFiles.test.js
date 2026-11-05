import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Subida de archivos del detalle con la aplicación real, montada en StrictMode como en main.jsx:
// cada archivo seleccionado se sube una sola vez, con validación, reintento y cancelación.
const PROJECT = {
  id: 41, name: "Proyecto de subida", publicSlug: "proyecto-de-subida", status: "in_process", progress: 40,
  client: { id: 7, name: "Cliente del proyecto" }, assignees: [], files: [], filesNextCursor: null,
};
const UPLOAD_PATH = `/api/projects/${PROJECT.id}/files`;
const PROJECT_BY_ID = `/api/projects/${PROJECT.id}`;
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
 * @returns {Promise<{page: import("playwright").Page, refreshes: () => number, uploads: string[]}>} Página y registros.
 */
async function openUploadTab(context, respondUpload = (number) => ({ file: { id: 900 + number } })) {
  const session = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.after(() => session.close());
  const page = await session.newPage();
  applyBrowserTimeouts(page);
  const uploads = [];
  const projectReads = [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/auth/me") {
      return route.fulfill({ json: { user: { id: 1, firstName: "Admin", lastName: "Prueba", email: "admin@example.test", role: "admin", status: "active" } } });
    }
    if (pathname.endsWith("/events")) return route.fulfill({ status: 204, body: "" });
    if (pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [], nextCursor: null } });
    if (pathname === "/api/projects") return route.fulfill({ json: { projects: [PROJECT], nextCursor: null } });
    if (pathname === UPLOAD_PATH && request.method() === "POST") {
      uploads.push(decodeURIComponent(request.headers()["x-file-name"] || ""));
      const body = await respondUpload(uploads.length);
      if (body === null) return route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "Servicio no disponible" } });
      return route.fulfill({ status: 201, json: body });
    }
    if (/^\/api\/projects\/[^/]+$/.test(pathname)) {
      projectReads.push(pathname);
      return route.fulfill({ json: { project: PROJECT } });
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

test("una selección de varios archivos sube cada archivo válido una sola vez", async (context) => {
  const { page, refreshes, uploads } = await openUploadTab(context);

  await selectFiles(page, [pdf("Plano A.pdf"), pdf("Plano B.pdf"), { name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("texto") }]);
  await page.getByText("Solo se permiten archivos JPEG, PNG, PDF y MP4").first().waitFor();
  await page.waitForTimeout(1500);

  assert.equal(uploads.length, 2, "una subida por archivo válido, sin duplicados de StrictMode");
  assert.equal(new Set(uploads).size, uploads.length, "ningún archivo se sube dos veces");
  assert.equal(refreshes(), 2, "cada subida completada actualiza el proyecto una vez");
});

test("un archivo con el mismo nombre que otro ya seleccionado se rechaza sin subirse", async (context) => {
  const { page, uploads } = await openUploadTab(context);

  await selectFiles(page, [pdf("Plano A.pdf")]);
  await page.waitForTimeout(800);
  await selectFiles(page, [pdf("Plano A.pdf")]);
  await page.getByText("Ese archivo ya esta seleccionado").first().waitFor();
  await page.waitForTimeout(800);

  assert.equal(uploads.length, 1);
});

test("«Intenta de nuevo» repite solo la subida fallida y actualiza el proyecto al completarse", async (context) => {
  const { page, refreshes, uploads } = await openUploadTab(context, (number) => (number === 1 ? null : { file: { id: 950 } }));

  await selectFiles(page, [pdf("Plano A.pdf")]);
  await page.getByRole("button", { name: "Intenta de nuevo" }).click();
  await page.waitForTimeout(1200);

  assert.equal(uploads.length, 2, "la subida inicial fallida y un único reintento");
  assert.equal(refreshes(), 1, "solo la subida completada actualiza el proyecto");
});

test("eliminar un archivo durante la subida la cancela sin actualizar el proyecto", async (context) => {
  const { page, refreshes, uploads } = await openUploadTab(context, () => new Promise(() => {}));

  await selectFiles(page, [pdf("Plano A.pdf")]);
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Eliminar archivo Plano A.pdf" }).click();
  await page.waitForTimeout(800);

  assert.equal(uploads.length, 1);
  assert.equal(await page.getByRole("button", { name: "Eliminar archivo Plano A.pdf" }).count(), 0, "el archivo sale de la lista");
  assert.equal(refreshes(), 0);
});
