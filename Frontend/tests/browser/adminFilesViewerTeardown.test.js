import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Regresión del error intermitente de U2: cerrar o cambiar el visor PDF mientras PDF.js todavía
// pide una página dejaba un rechazo sin capturar («Transport destroyed») como error de página.
// Abre y cierra el visor muchas veces con la carga de páginas ralentizada y no admite errores.

let browser;
let server;
let origin;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<<>>>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const ITEM = {
  changeNote: null, contentType: "application/pdf", createdAt: "2026-03-20T14:00:00.000Z", extension: "pdf", fileCategory: "document", fileId: 30,
  folder: { id: 104, name: "Garantías", section: "warranties" }, isCurrent: false, name: "Garantía.pdf", project: { id: 1, name: "Quinta", status: "in_progress" },
  restoredFromVersionId: null, review: { reason: null, reviewedAt: null, reviewerName: null, status: "pending" }, size: PDF.length, uploadedBy: { id: 2, name: "Arq. Armando" },
  versionId: 300, versionNumber: 1,
};

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") }, server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("cerrar el visor PDF mientras PDF.js pide la página no deja errores sin capturar", async (context) => {
  const browserContext = await browser.newContext({ viewport: { height: 900, width: 1280 } });
  context.after(() => browserContext.close());
  const page = applyBrowserTimeouts(await browserContext.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const json = (route, body) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status: 200 });
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") return json(route, { user: { email: "a@x.test", firstName: "Ana", id: 1, lastName: "Admin", role: "admin", status: "active" } });
    if (pathname === "/api/projects") return json(route, { nextCursor: null, projects: [] });
    if (pathname === "/api/admin/files/metrics") return json(route, { metrics: { lastUploadAt: null, objectCount: 1, totalFiles: 1, usedBytes: 1 } });
    if (pathname === "/api/admin/files/tree") return json(route, { nextCursor: null, projects: [] });
    if (pathname === "/api/admin/files/items") return json(route, { items: [ITEM], nextCursor: null });
    if (pathname.endsWith("/versions")) return json(route, { currentVersionId: null, nextCursor: null, versions: [] });
    if (pathname.endsWith("/content")) return route.fulfill({ body: PDF, contentType: "application/pdf", status: 200 });
    return json(route, {});
  });
  await page.goto(`${origin}/archivos`);
  await page.getByRole("heading", { level: 1, name: "Gestión de archivos" }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await page.getByRole("button", { name: "Revisar Garantía.pdf, versión 1" }).click();
    const viewer = page.locator("[data-admin-file-viewer]");
    // Cierra justo cuando el documento está listo y el lienzo empieza a pedir su página.
    await viewer.locator("canvas").first().waitFor({ state: "attached" });
    await viewer.getByRole("button", { name: "Cerrar visor" }).click();
    await viewer.waitFor({ state: "detached" });
  }
  await page.waitForTimeout(500);
  assert.deepEqual(errors, []);
});
