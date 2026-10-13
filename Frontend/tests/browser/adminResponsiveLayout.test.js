import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ADMIN_PAGES = ["/dashboard-arquitecto", "/usuarios", "/archivos"];
const CHECKPOINT_WIDTHS = [320, 375, 430, 768, 1024, 1280, 1440, 1920];
const PROJECT = {
  id: 30,
  name: "Proyecto residencial con un nombre bastante largo",
  status: "in_process",
  progress: 90,
  endDate: "2026-03-24T00:00:00.000Z",
  client: { id: 50, name: "Diego Jiménez Hernández" },
  assignees: [],
  assignedArchitect: null,
};
// Diez usuarios (tamaño real de página) con nombres y correos largos para forzar truncados.
const USERS = Array.from({ length: 10 }, (_, index) => ({
  id: 100 + index,
  name: `Usuario Con Nombre Largo ${index}`,
  email: `usuario.con.correo.muy.largo${index}@arcastudio2025.com`,
  status: ["active", "blocked", "inactive"][index % 3],
  role: { code: "architect", name: "Arquitecto" },
  lastLoginAt: "2026-03-23T13:00:00Z",
}));
// Dos responsables con nombres largos: sus tags en una línea superan el ancho móvil.
const REQUEST_ASSIGNEES = [
  { id: 3, name: "Administrador Sistema" },
  { id: 4, name: "Laura Rivas Hernández" },
];
const PAYLOADS = {
  "/api/projects": { projects: [PROJECT], nextCursor: null },
  "/api/project-requests/review-queue": { projectRequests: [], nextCursor: null },
  "/api/environment-comments": { comments: [], nextCursor: null },
  "/api/admin/assignees": { assignees: [{ id: 2, name: "Diego Jiménez" }, ...REQUEST_ASSIGNEES] },
  "/api/admin/roles": { roles: [{ id: 1, code: "architect", name: "Arquitecto" }] },
  "/api/admin/users": { users: USERS, nextCursor: "next-page", metrics: { total: 1200, active: 1000, suspended: 150, disabled: 50 } },
  // Valores de cuatro dígitos y la fecha con hora son los contenidos más anchos de las métricas.
  "/api/admin/dashboard-metrics": { metrics: {
    activeUsers: { total: 32, thisMonth: 12 },
    activeProjects: { total: 12, thisMonth: 2 },
    files: { total: 3500, totalBytes: 2500000000, latestUploadAt: "2026-06-19T13:34:00Z" },
    requests: { total: 4, today: 2 },
    criticalEvents: { total: 2, latestAt: null },
  } },
  "/api/admin/dashboard-overview": { overview: {
    recentActivity: [{ id: 1, title: "Entrega finalizada", userName: "Arq. Sofía Tapia", projectName: PROJECT.name, projectId: 30, createdAt: "2026-03-23T13:00:00" }],
    newRequests: [
      { id: 7, projectName: "Apto. Noventa y Uno", projectType: "residential", status: "pending_review", assignees: [] },
      { id: 8, projectName: "Solicitud con responsables", projectType: "commercial", status: "pending_review", assignees: REQUEST_ASSIGNEES },
    ],
  } },
};

let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    envDir: false,
    plugins: [react(), tailwindcss()],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
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
 * Abre una vista administrativa real con sesión de administrador y respuestas HTTP de prueba,
 * y espera a que su contenido de datos esté renderizado.
 *
 * @param {import("node:test").TestContext} context Prueba propietaria del navegador.
 * @param {string} path Ruta administrativa.
 * @param {number} width Ancho inicial del viewport.
 * @returns {Promise<import("playwright").Page>} Página lista para medir.
 */
async function openAdminPage(context, path, width) {
  const browserContext = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await browserContext.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const requestPath = new URL(route.request().url()).pathname;
    const payload = requestPath === "/api/auth/me"
      ? { user: { id: 1, firstName: "Leonel", lastName: "Pérez", email: "leonel@example.test", role: "admin", status: "active" } }
      : PAYLOADS[requestPath];
    if (!payload) {
      errors.push(`Petición no prevista: ${route.request().method()} ${requestPath}`);
      await route.fulfill({ status: 404, json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" } });
      return;
    }
    await route.fulfill({ json: payload });
  });
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}${path}`);
  const readyText = {
    "/dashboard-arquitecto": "Apto. Noventa y Uno",
    "/usuarios": USERS[9].name,
    "/archivos": "Última carga",
  }[path];
  await page.getByText(readyText, { exact: true }).first().waitFor();
  // Las medidas dependen de las métricas reales de Inter, no de la fuente de respaldo.
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/**
 * Mide el desborde horizontal del contenedor de scroll del layout. `scrollWidth` incluye el
 * contenido aunque un ancestro lo recortara, así que detecta también desbordes ocultos.
 *
 * @param {import("playwright").Page} page Página en prueba.
 * @returns {Promise<number>} Píxeles que exceden el ancho visible (0 si no hay desborde).
 */
function measureContentOverflow(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector("main > div > .overflow-y-auto");
    return Math.max(scroller.scrollWidth - scroller.clientWidth, document.documentElement.scrollWidth - window.innerWidth);
  });
}

for (const path of ADMIN_PAGES) {
  test(`${path}: sin desborde horizontal y con título de Figma en los anchos de referencia`, async (context) => {
    const page = await openAdminPage(context, path, CHECKPOINT_WIDTHS[0]);
    for (const width of CHECKPOINT_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction((isMobile) => {
        const fontSize = getComputedStyle(document.querySelector("h1")).fontSize;
        return fontSize === (isMobile ? "24px" : "48px");
      }, width < 768);
      assert.equal(await measureContentOverflow(page), 0, `${path} desborda a ${width} px`);
    }
  });
}

test("/usuarios: la tabla muestra las diez filas de la página en cualquier ancho", async (context) => {
  const page = await openAdminPage(context, "/usuarios", 375);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const clipping = await page.evaluate(() => {
      const table = document.querySelector("table");
      const wrapper = table.closest(".overflow-hidden");
      const wrapperBottom = wrapper.getBoundingClientRect().bottom;
      return {
        rows: table.querySelectorAll("tbody tr").length,
        visibleRows: [...table.querySelectorAll("tbody tr")]
          .filter((row) => row.getBoundingClientRect().bottom <= wrapperBottom + 0.5).length,
      };
    });
    assert.deepEqual(clipping, { rows: 10, visibleRows: 10 }, `Filas recortadas a ${width} px`);
  }
});

test("/usuarios móvil: filtros en una fila y pie de selección y paginación (Figma 3727:681942)", async (context) => {
  const page = await openAdminPage(context, "/usuarios", 430);
  const box = (locator) => locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

  const title = await box(page.getByRole("heading", { name: "Gestión de usuarios", level: 1 }));
  const create = await box(page.getByRole("button", { name: "Nuevo", exact: true }));
  assert.ok(create.y >= title.y + title.height, "La acción Nuevo pasa debajo del título");

  // El nombre accesible está en el trigger; el ancho de Figma corresponde al DropdownMenu completo.
  const filterRoot = (name) => page.getByRole("button", { name, exact: true }).locator("xpath=../..");
  const roleFilter = await box(filterRoot("Filtrar usuarios por rol"));
  const statusFilter = await box(filterRoot("Filtrar usuarios por status"));
  assert.ok(Math.abs(roleFilter.y - statusFilter.y) < 1, "Ambos filtros comparten fila");
  assert.ok(Math.abs(roleFilter.width - 180) < 1, "El primer filtro mide 180 px");

  const counterLocator = page.getByText("0 de 10 seleccionados", { exact: true });
  const nextLocator = page.getByRole("button", { name: "Siguiente pág.", exact: true });
  const counter = await box(counterLocator);
  let next = await box(nextLocator);
  assert.ok(Math.abs(counter.y + counter.height / 2 - (next.y + next.height / 2)) < 2, "Contador y paginación comparten fila");

  // A 375 px el contador renderizado es unos px más ancho que en Figma: si no cabe, la
  // paginación pasa a la fila siguiente alineada a la derecha, sin desbordar.
  await page.setViewportSize({ width: 375, height: 900 });
  next = await box(nextLocator);
  const contentRight = await counterLocator.evaluate((element) => {
    const row = element.parentElement;
    return row.getBoundingClientRect().right;
  });
  assert.ok(Math.abs(next.x + next.width - contentRight) < 1, "La paginación se alinea a la derecha del contenido");
  assert.equal(await measureContentOverflow(page), 0);
  assert.equal(await page.getByRole("group", { name: "Acciones para usuarios seleccionados" }).count(), 0, "Sin selección no se renderizan acciones masivas");

  await page.getByRole("checkbox", { name: `Seleccionar ${USERS[0].name}` }).click();
  const actions = await box(page.getByRole("group", { name: "Acciones para usuarios seleccionados" }));
  assert.ok(actions.y > next.y, "Las acciones masivas usan su propia fila en móvil");
  assert.equal(await measureContentOverflow(page), 0);
});

test("Dashboard: las métricas no se superponen al variar el ancho del contenido", async (context) => {
  const page = await openAdminPage(context, "/dashboard-arquitecto", 768);
  for (const width of [768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const collisions = await page.getByRole("region", { name: "Resumen de métricas administrativas" }).evaluate((region) => {
      const items = [...region.querySelectorAll("article")].filter((item) => item.getClientRects().length);
      const contentRight = (item) => Math.max(...[...item.querySelectorAll("*")].map((child) => child.getBoundingClientRect().right));
      const found = [];
      for (let index = 1; index < items.length; index += 1) {
        const previous = items[index - 1];
        const current = items[index];
        const sameRow = Math.abs(previous.getBoundingClientRect().top - current.getBoundingClientRect().top) < 1;
        if (sameRow && contentRight(previous) > current.getBoundingClientRect().left) {
          found.push(`${previous.querySelector("h2").textContent} → ${current.querySelector("h2").textContent}`);
        }
      }
      return found;
    });
    assert.deepEqual(collisions, [], `Métricas superpuestas a ${width} px`);
  }
});

test("Dashboard: las secciones pareadas se apilan hasta disponer de 440 px por columna", async (context) => {
  const page = await openAdminPage(context, "/dashboard-arquitecto", 1024);
  const columnsAt = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    return page.getByText("Próximas entregas", { exact: true }).evaluate((label) => {
      const section = label.closest("section");
      return getComputedStyle(section).gridTemplateColumns.split(" ").length;
    });
  };
  assert.equal(await columnsAt(1024), 1, "Figma 3727:678726 apila las secciones en tablet horizontal");
  assert.equal(await columnsAt(1440), 2, "Figma 3727:677367 usa dos columnas en escritorio");
  assert.equal(await measureContentOverflow(page), 0);
});

test("Drawers abiertos en móvil no generan desborde horizontal ni estados contradictorios", async (context) => {
  const page = await openAdminPage(context, "/usuarios", 375);
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  const navigationDrawer = page.getByRole("dialog", { name: "Menú de navegación" });
  await navigationDrawer.waitFor();
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", "El drawer bloquea el scroll del body");
  await page.keyboard.press("Escape");
  await navigationDrawer.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "Cerrar el drawer restablece el scroll");

  await page.getByRole("button", { name: "Notificaciones", exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await measureContentOverflow(page), 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await navigationDrawer.count(), 0, "El drawer móvil no reaparece en escritorio");
  assert.equal(await measureContentOverflow(page), 0);
});

test("Dashboard móvil: el selector con responsables no empuja la acción fuera de la tarjeta", async (context) => {
  const page = await openAdminPage(context, "/dashboard-arquitecto", 320);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.getByRole("button", { name: "Ver solicitud Solicitud con responsables", exact: true }).evaluate((eye) => {
      const card = eye.closest("[data-admin-new-requests]").getBoundingClientRect();
      const field = eye.previousElementSibling.getBoundingClientRect();
      const action = eye.getBoundingClientRect();
      return {
        actionInside: action.left >= card.left - 0.5 && action.right <= card.right + 0.5,
        fieldBeforeAction: field.right <= action.left,
      };
    });
    assert.deepEqual(layout, { actionInside: true, fieldBeforeAction: true }, `Fila de solicitud rota a ${width} px`);
    assert.equal(await measureContentOverflow(page), 0, `Desborde horizontal a ${width} px`);
  }
});
