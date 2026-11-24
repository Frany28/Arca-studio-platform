import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Notificaciones reales del cliente en «Actividad Reciente» del drawer (campana «Notificaciones"):
// lectura paginada de /api/notifications, nuevas frente a leídas, motivo del rechazo, marca de lectura
// y navegación al proyecto solo cuando la API lo devuelve (acceso vigente). Backend simulado en memoria.

let browser;
let server;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url),
    configFile: false, envDir: false, plugins: [react(), tailwindcss()],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const PROJECT = { id: 21, name: "Casa Norte", publicSlug: "casa-norte", status: "in_progress", progress: 40, clientName: "Cliente Uno" };

/**
 * Notificación con la forma de GET /api/notifications.
 *
 * @param {number} id - Identificador.
 * @param {Object} values - Campos variables.
 * @returns {Object} Notificación.
 */
function notification(id, { isRead = false, message, project = null, title, type }) {
  return { createdAt: `2026-11-2${id % 10}T10:00:00.000Z`, entity: { id: 300 + id, type: "file_version" }, id, isRead, message, project, readAt: isRead ? "2026-11-20T10:00:00.000Z" : null, title, type };
}

/**
 * Abre la aplicación como cliente con un backend simulado de notificaciones paginadas.
 *
 * @param {import("node:test").TestContext} context - Prueba.
 * @param {{ theme?: string, width?: number, failList?: boolean }} [options] - Tema, ancho y fallo inicial.
 * @returns {Promise<{ page: import("playwright").Page, state: Object }>} Página y estado.
 */
async function openAsClient(context, { failList = false, theme = "light", width = 1440 } = {}) {
  const session = await browser.newContext({ viewport: { height: 900, width } });
  const page = applyBrowserTimeouts(await session.newPage());
  await page.addInitScript((value) => {
    localStorage.setItem("arca-theme", value);
    window.EventSource = class { addEventListener() {} close() {} };
  }, theme);
  const state = {
    failList,
    notifications: [
      notification(3, { message: "La versión V2 de «Plano.pdf» fue rechazada. Motivo: Falta la firma del cliente. Puedes subir una versión corregida.", project: { id: 21, name: "Casa Norte" }, title: "Archivo rechazado", type: "project_file.version_rejected" }),
      notification(2, { message: "La versión V1 de «Fachada.jpg» fue aprobada por el equipo de ARCA Studio.", title: "Archivo aprobado", type: "project_file.version_approved" }),
      notification(1, { isRead: true, message: "Tu solicitud ha sido aprobada.", title: "Solicitud aprobada", type: "project_request.converted" }),
    ],
    requests: [],
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.requests.push({ method: request.method(), path: url.pathname, search: Object.fromEntries(url.searchParams) });
    if (url.pathname === "/api/auth/me") {
      return route.fulfill({ json: { user: { email: "cliente@example.test", firstName: "Cliente", id: 7, lastName: "Uno", permissionCodes: ["projects.read", "projects.files.upload"], role: "client", status: "active" } } });
    }
    if (url.pathname === "/api/notifications") {
      if (state.failList) return route.fulfill({ json: { code: "INTERNAL", message: "Error temporal." }, status: 500 });
      const offset = url.searchParams.get("cursor") ? Number(url.searchParams.get("cursor")) : 0;
      const limit = Number(url.searchParams.get("limit") || 20);
      const page = state.notifications.slice(offset, offset + Math.min(limit, 2));
      return route.fulfill({ json: {
        nextCursor: offset + 2 < state.notifications.length ? String(offset + 2) : null,
        notifications: page,
        unreadCount: state.notifications.filter((candidate) => !candidate.isRead).length,
      } });
    }
    const read = /^\/api\/notifications\/(\d+)\/read$/.exec(url.pathname);
    if (read && request.method() === "PATCH") {
      const target = state.notifications.find((candidate) => candidate.id === Number(read[1]));
      target.isRead = true;
      return route.fulfill({ json: { notification: { id: target.id, isRead: true, readAt: "2026-11-23T12:00:00.000Z" }, unreadCount: state.notifications.filter((candidate) => !candidate.isRead).length } });
    }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { nextCursor: null, projects: [PROJECT] } });
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [], nextCursor: null } });
    return route.fulfill({ json: {} });
  });
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, [], "errores de ejecución");
  });
  await page.goto(`${origin}/`);
  await page.getByRole("button", { name: "Notificaciones", exact: true }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return { page, state };
}

const notificationsRequests = (state) => state.requests.filter((request) => request.path === "/api/notifications");

test("cliente: ve sus notificaciones reales (nuevas y leídas), el motivo del rechazo y pagina con «Mostrar más»", async (context) => {
  const { page, state } = await openAsClient(context);
  await page.getByRole("button", { name: "Notificaciones", exact: true }).click();
  const drawer = page.locator("aside[role='dialog']");
  await drawer.getByText(/Motivo: Falta la firma del cliente/).waitFor();
  assert.equal(await drawer.getByText("Archivo rechazado", { exact: true }).count(), 1);
  assert.equal(await drawer.getByText("Archivo aprobado", { exact: true }).count(), 1);
  assert.equal(await drawer.locator("[data-unread]").count(), 2, "las dos primeras son nuevas");
  assert.equal(await drawer.getByText("Hace 2 minutos").count(), 0, "sin datos de ejemplo");
  assert.equal(notificationsRequests(state)[0].search.limit, "20");

  await drawer.getByRole("button", { name: "Mostrar más" }).click();
  await drawer.getByText("Tu solicitud ha sido aprobada.", { exact: false }).waitFor();
  assert.equal(notificationsRequests(state).at(-1).search.cursor, "2");
  assert.equal(await drawer.locator("[data-unread]").count(), 2, "la leída no se marca como nueva");
  assert.equal(await drawer.getByRole("button", { name: "Mostrar más" }).count(), 0);
});

test("cliente: seleccionar una notificación la marca como leída y abre su proyecto solo si es accesible", async (context) => {
  const { page, state } = await openAsClient(context);
  const startPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Notificaciones", exact: true }).click();
  const drawer = page.locator("aside[role='dialog']");
  await drawer.getByText(/fue aprobada por el equipo/).click();
  await page.waitForFunction(() => document.querySelectorAll("aside[role='dialog'] [data-unread]").length === 1);
  assert.deepEqual(state.requests.filter((request) => request.method === "PATCH").map((request) => request.path), ["/api/notifications/2/read"]);
  assert.equal(new URL(page.url()).pathname, startPath, "sin proyecto accesible no navega");

  await drawer.getByText(/Motivo: Falta la firma del cliente/).click();
  await page.waitForURL((url) => url.pathname === "/proyectos/casa-norte");
  assert.deepEqual(state.requests.filter((request) => request.method === "PATCH").map((request) => request.path), ["/api/notifications/2/read", "/api/notifications/3/read"]);
});

test("cliente: un error de lectura muestra «Reintentar» y recupera la lista", async (context) => {
  const { page, state } = await openAsClient(context, { failList: true });
  await page.getByRole("button", { name: "Notificaciones", exact: true }).click();
  const drawer = page.locator("aside[role='dialog']");
  await drawer.getByText("No se pudieron cargar los eventos").waitFor();
  state.failList = false;
  await drawer.getByRole("button", { name: "Reintentar" }).click();
  await drawer.getByText(/Motivo: Falta la firma del cliente/).waitFor();
});

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 768, 375]) {
    test(`cliente: notificaciones sin desbordar (${theme}, ${width} px)`, async (context) => {
      const { page } = await openAsClient(context, { theme, width });
      await page.getByRole("button", { name: "Notificaciones", exact: true }).click();
      const drawer = page.locator("aside[role='dialog']");
      await drawer.getByText(/Motivo: Falta la firma del cliente/).waitFor();
      const layout = await page.evaluate(() => {
        const aside = document.querySelector("aside[role='dialog']").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > window.innerWidth, right: aside.right, width: window.innerWidth };
      });
      assert.equal(layout.overflow, false);
      assert.ok(layout.right <= layout.width + 0.5, "el drawer cabe en el viewport");
      const dot = await drawer.locator("[data-unread] span[aria-hidden='true']").first().evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.notEqual(dot, "rgba(0, 0, 0, 0)", "el indicador de nueva es visible en el tema");
    });
  }
}
