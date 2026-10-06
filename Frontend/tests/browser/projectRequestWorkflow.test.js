import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REQUEST = { id: 7, projectName: "Casa Norte", status: "pending_review", description: "Detalle técnico de la cola", assignees: [{ id: 9, name: "Ana" }] };
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
 * Intercepta HTTP del hook real y permite resolver lecturas y mutaciones de forma controlada.
 * Registra peticiones y errores; cada prueba dispone de sesión y transportes aislados.
 */
async function openPage(context, { role = "architect", queue = [REQUEST], holdQueue = false, realDashboard = false } = {}) {
  const session = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await session.newPage();
  const calls = [];
  const mutations = [];
  const reads = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path, body: request.postDataJSON() });
    if (request.method() !== "GET") { mutations.push(route); return; }
    if (path === "/api/project-requests/review-queue") {
      if (holdQueue) { reads.push(route); return; }
      await route.fulfill({ json: { projectRequests: queue, nextCursor: "ignored-next-page" } });
      return;
    }
    const fixtures = {
      "/api/auth/me": { user: { id: 1, firstName: "Workflow", email: "workflow@example.test", role, status: "active" } },
      "/api/projects": { projects: [], nextCursor: null },
      "/api/admin/dashboard-metrics": { metrics: {} },
      "/api/admin/dashboard-overview": { overview: { recentActivity: [], newRequests: queue } },
      "/api/admin/assignees": { assignees: [] },
      "/api/admin/users/41": { user: { id: 41, name: "Esteban Ruiz", companyName: "Nextj" } },
    };
    if (realDashboard && fixtures[path]) { await route.fulfill({ json: fixtures[path] }); return; }
    errors.push(`HTTP inesperado: ${path}`);
    await route.fulfill({ status: 404, json: { message: "Fixture no definida" } });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(realDashboard
    ? `${origin}/dashboard-arquitecto`
    : `${origin}/tests/browser/fixtures/project-request-workflow.html?role=${role}`);
  if (!realDashboard) {
    await page.waitForFunction(() => Boolean(window.workflowHarness?.result));
    if (!holdQueue) await waitState(page, (state) => !state.reviewQueue.loading);
  }
  return { page, calls, mutations, reads };
}

/** Espera una condición sobre la salida pública del hook, sin inspeccionar internals de React. */
async function waitState(page, predicate) {
  await page.waitForFunction(`(${predicate.toString()})(window.workflowHarness.result)`);
}
/** Lee únicamente datos serializables del contrato público. */
async function state(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.workflowHarness.result)));
}
/** Invoca apertura pública; la selección y el borrador se presentan en el modal real. */
async function openRequest(page, request = { id: "7", projectName: "Resumen del overview" }) {
  await page.evaluate((request) => window.workflowHarness.result.workflow.open(request), request);
  await page.getByRole("dialog").waitFor();
}
/** Cuenta consultas a la cola para comprobar que admin y architect no la duplican. */
function queueCalls(calls) {
  return calls.filter((call) => call.path === "/api/project-requests/review-queue").length;
}
/** Espera una mutación registrada antes de resolverla, sin retardos fijos. */
async function waitMutation(page, mutations, count = 1) {
  await page.waitForFunction(() => window.workflowHarness.result.workflow.submitting || window.workflowHarness.result.assignment.submitting);
  assert.equal(mutations.length, count);
}

for (const role of ["admin", "architect"]) {
  test(`Cola ${role}: una lectura, detalle por ID numérico y fallback sin HTTP adicional`, async (context) => {
    const { page, calls } = await openPage(context, { role });
    await openRequest(page);
    assert.equal((await state(page)).workflow.selectedRequest.description, REQUEST.description);
    assert.equal(queueCalls(calls), 1);
    await page.evaluate(() => window.workflowHarness.result.workflow.close());
    await openRequest(page, { id: 80, projectName: "Solicitud fuera de la primera página" });
    assert.equal((await state(page)).workflow.selectedRequest.id, 80);
    assert.equal(queueCalls(calls), 1);
  });
}

test("Architect: recomendación, pending, cierre bloqueado y refresco de la cola", async (context) => {
  const { page, calls, mutations } = await openPage(context);
  await openRequest(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("  Recomiendo aprobar el proyecto  ");
  await dialog.getByRole("button", { name: "Guardar revisión", exact: true }).click();
  await waitMutation(page, mutations);
  assert.equal(await dialog.getByRole("button", { name: "Guardar revisión", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "Guardando...", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.workflowHarness.result.workflow.close());
  assert.equal((await state(page)).workflow.selectedRequest.id, 7);
  assert.deepEqual(calls.find((call) => call.method === "PUT"), {
    method: "PUT", path: "/api/project-requests/7/review", body: { note: "Recomiendo aprobar el proyecto", recommendation: "approve" },
  });
  await mutations[0].fulfill({ json: {} });
  await waitState(page, (result) => !result.workflow.selectedRequest && !result.workflow.submitting && !result.reviewQueue.loading);
  assert.equal(queueCalls(calls), 2);
  assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), []);
});

for (const role of ["architect", "admin"]) {
  test(`${role}: error conserva selección y nota; reintento cierra solo tras éxito`, async (context) => {
    const { page, calls, mutations } = await openPage(context, { role });
    await openRequest(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("Nota conservada para reintentar");
    await dialog.getByRole("button", { name: role === "admin" ? "Confirmar decisión" : "Guardar revisión", exact: true }).click();
    await waitMutation(page, mutations);
    await mutations[0].fulfill({ status: 409, json: { code: "REVIEW_CONFLICT", message: "La revisión debe reintentarse." } });
    await waitState(page, (result) => !result.workflow.submitting && Boolean(result.workflow.error));
    assert.equal(await dialog.getByRole("textbox").inputValue(), "Nota conservada para reintentar");
    assert.equal((await state(page)).workflow.selectedRequest.id, 7);
    assert.equal(queueCalls(calls), 1);
    await dialog.getByRole("button", { name: role === "admin" ? "Confirmar decisión" : "Guardar revisión", exact: true }).click();
    await waitMutation(page, mutations, 2);
    await mutations[1].fulfill({ json: {} });
    await waitState(page, (result) => !result.workflow.selectedRequest && !result.reviewQueue.loading);
    await page.waitForLoadState("networkidle");
    assert.equal(queueCalls(calls), 2);
    assert.equal((await page.evaluate(() => window.workflowHarness.events)).length, role === "admin" ? 1 : 0);
  });
}

for (const [action, label, expected] of [
  ["approve", "Aprobar", { action: "approve", internalNotes: "Nota de decisión" }],
  ["reject", "Rechazar", { action: "reject", reason: "Nota de decisión" }],
  ["changes_requested", "Solicitar correcciones", { action: "request_changes", reason: "Nota de decisión" }],
]) {
  test(`Admin: payload ${action} y notificación de invalidación tras confirmación`, async (context) => {
    const { page, calls, mutations } = await openPage(context, { role: "admin" });
    await openRequest(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await dialog.getByRole("textbox").fill("Nota de decisión");
    await dialog.getByRole("button", { name: "Confirmar decisión", exact: true }).click();
    await waitMutation(page, mutations);
    assert.deepEqual(calls.find((call) => call.method === "PATCH"), { method: "PATCH", path: "/api/admin/project-requests/7/decision", body: expected });
    assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), []);
    await mutations[0].fulfill({ json: {} });
    await waitState(page, (result) => !result.workflow.selectedRequest && !result.reviewQueue.loading);
    assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), [{ type: "decision" }]);
    assert.equal(queueCalls(calls), 2);
  });
}

test("Login admin: overview prioritario, detalle de cola y fallback al primer registro", async (context) => {
  const { page, calls } = await openPage(context, { role: "admin" });
  await page.evaluate(() => window.workflowHarness.setProps({ firstAdminRequest: { id: "7", projectName: "Resumen" } }));
  await page.evaluate(() => window.workflowHarness.result.loginActions.view());
  await waitState(page, (result) => Boolean(result.workflow.selectedRequest));
  assert.equal((await state(page)).workflow.selectedRequest.description, REQUEST.description);
  await page.evaluate(() => window.workflowHarness.setProps({ firstAdminRequest: { id: 80, projectName: "Prioritaria" } }));
  await page.evaluate(() => window.workflowHarness.result.loginActions.view());
  await waitState(page, (result) => result.workflow.selectedRequest?.id === 80);
  await page.evaluate(() => window.workflowHarness.setProps({ firstAdminRequest: null }));
  await page.evaluate(() => window.workflowHarness.result.loginActions.view());
  await waitState(page, (result) => result.workflow.selectedRequest?.id === 7);
  assert.equal(queueCalls(calls), 1);
});

test("Asignación admin: apertura diferida, borrador local, guards, confirmación y feedback", async (context) => {
  const { page, calls, mutations, reads } = await openPage(context, { role: "admin", holdQueue: true });
  await page.evaluate(() => { window.workflowHarness.result.loginActions.view(); window.workflowHarness.result.loginActions.assign(); });
  assert.equal((await state(page)).assignment.request, null);
  await page.waitForFunction(() => window.workflowHarness.result.reviewQueue.loading);
  await reads[0].fulfill({ json: { projectRequests: [REQUEST] } });
  await waitState(page, (result) => result.assignment.request?.id === 7);
  assert.deepEqual((await state(page)).assignment.draft, REQUEST.assignees);
  assert.equal(mutations.length, 0);
  await page.evaluate(() => window.workflowHarness.result.assignment.setDraft([]));
  await page.evaluate(() => window.workflowHarness.result.assignment.confirm());
  assert.equal(mutations.length, 0);
  await page.evaluate(() => window.workflowHarness.result.assignment.setDraft([{ id: "11", name: "Luis" }]));
  await page.evaluate(() => { void window.workflowHarness.result.assignment.confirm(); });
  await waitMutation(page, mutations);
  await page.evaluate(() => { window.workflowHarness.result.assignment.close(); void window.workflowHarness.result.assignment.confirm(); });
  assert.equal(mutations.length, 1);
  assert.equal((await state(page)).assignment.request.id, 7);
  assert.deepEqual(calls.find((call) => call.method === "PUT").body, { assigneeIds: [11] });
  await mutations[0].fulfill({ json: { assignees: [{ id: 11, name: "Luis" }] } });
  await waitState(page, (result) => !result.assignment.submitting && Boolean(result.assignment.feedback));
  const result = await state(page);
  assert.equal(result.assignment.request, null);
  assert.deepEqual(result.assignment.draft, []);
  assert.equal(result.assignment.feedback.type, "success");
  assert.equal(result.assignment.feedback.message, "Luis revisará Casa Norte.");
  await page.waitForFunction(() => window.workflowHarness.result.reviewQueue.loading);
  assert.equal(queueCalls(calls), 2);
  await reads[1].fulfill({ json: { projectRequests: [REQUEST] } });
  assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), [{ type: "assignees", id: 7, assignees: [{ id: 11, name: "Luis", profilePhotoUrl: "" }] }]);
  await page.evaluate(() => window.workflowHarness.result.assignment.dismissFeedback());
  assert.equal((await state(page)).assignment.feedback, null);
});

test("Asignación fallida: conserva el contrato de cierre/limpieza y permite volver a intentar", async (context) => {
  const { page, calls, mutations } = await openPage(context, { role: "admin" });
  await page.evaluate(() => window.workflowHarness.result.loginActions.assign());
  await waitState(page, (result) => Boolean(result.assignment.request));
  await page.evaluate(() => { void window.workflowHarness.result.assignment.confirm(); });
  await waitMutation(page, mutations);
  await mutations[0].fulfill({ status: 409, json: { code: "ASSIGNMENT_CONFLICT", message: "No se pudo asignar." } });
  await waitState(page, (result) => !result.assignment.submitting && result.assignment.feedback?.type === "error");
  assert.equal((await state(page)).assignment.request, null);
  assert.deepEqual((await state(page)).assignment.draft, []);
  assert.equal(queueCalls(calls), 1);
  await page.evaluate(() => window.workflowHarness.result.loginActions.assign());
  await waitState(page, (result) => Boolean(result.assignment.request));
  await page.evaluate(() => { void window.workflowHarness.result.assignment.confirm(); });
  await waitMutation(page, mutations, 2);
  await mutations[1].fulfill({ json: { assignees: REQUEST.assignees } });
  await waitState(page, (result) => !result.assignment.submitting && result.assignment.feedback?.type === "success");
});

test("Cola: error, reintento y respuesta anterior descartada al cambiar de rol", async (context) => {
  const { page, reads } = await openPage(context, { holdQueue: true });
  await reads[0].fulfill({ status: 503, json: { code: "QUEUE_UNAVAILABLE", message: "Cola no disponible." } });
  await waitState(page, (result) => !result.reviewQueue.loading && Boolean(result.reviewQueue.error));
  await page.evaluate(() => window.workflowHarness.result.reviewQueue.retry());
  await waitState(page, (result) => result.reviewQueue.loading && !result.reviewQueue.error);
  await page.evaluate(() => window.workflowHarness.setProps({ roleCode: "admin" }));
  await page.waitForFunction(() => window.workflowHarness.result.reviewQueue.loading);
  // La respuesta vigente llega primero; la lectura pendiente del rol anterior se ignora.
  await reads[2].fulfill({ json: { projectRequests: [{ ...REQUEST, projectName: "Respuesta vigente" }] } });
  await waitState(page, (result) => result.reviewQueue.requests[0]?.projectName === "Respuesta vigente");
  await reads[1].fulfill({ json: { projectRequests: [{ ...REQUEST, projectName: "Respuesta obsoleta" }] } });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal((await state(page)).reviewQueue.requests[0].projectName, "Respuesta vigente");
});

test("Cola: empty y rol no habilitado no inician lecturas nuevas", async (context) => {
  const { page, calls } = await openPage(context);
  await page.evaluate(() => window.workflowHarness.setProps({ empty: true }));
  await waitState(page, (result) => !result.reviewQueue.loading && result.reviewQueue.requests.length === 0);
  await page.evaluate(() => window.workflowHarness.setProps({ empty: false, roleCode: "other" }));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(queueCalls(calls), 1);
});

test("Dashboard admin real: decidir refresca overview, métricas, proyectos y cola", async (context) => {
  const { page, calls, mutations } = await openPage(context, { role: "admin", realDashboard: true });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  // El ojo abre primero el drawer de detalle; "Ver solicitud" lleva al modal de decisión.
  await page.getByRole("dialog", { name: "Detalles de solicitud" }).getByRole("button", { name: "Ver solicitud", exact: true }).click();
  await page.getByRole("dialog", { name: "Detalles de solicitud" }).waitFor({ state: "detached" });
  const paths =["/api/admin/dashboard-overview", "/api/admin/dashboard-metrics", "/api/projects", "/api/project-requests/review-queue"];
  const before = paths.map((path) => calls.filter((call) => call.path === path).length);
  const decisionRequest = page.waitForRequest((request) => request.url().includes("/decision"));
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar decisión", exact: true }).click();
  await decisionRequest;
  assert.equal(mutations.length, 1);
  const refreshed = paths.map((path) => page.waitForRequest((request) => new URL(request.url()).pathname === path));
  await mutations[0].fulfill({ json: {} });
  await Promise.all(refreshed);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForLoadState("networkidle");
  for (const [index, path] of paths.entries()) {
    assert.equal(calls.filter((call) => call.path === path).length, before[index] + 1, `${path}: ${JSON.stringify(calls)}`);
  }
});

test("Dashboard admin real: el drawer de detalle muestra datos reales y preselecciona la decisión", async (context) => {
  const detailedRequest = {
    ...REQUEST,
    clientId: 41,
    compatibility: { level: "excellent", score: 92 },
    createdAt: "2026-03-22T12:00:00.000Z",
    location: "Maracaibo, Zulia",
    projectType: "residential",
    reviews: [{ note: "El cliente posee terreno y presupuesto adecuado.", recommendation: "approve", reviewer: { id: 9, name: "Ana" }, updatedAt: "2026-03-23T10:00:00.000Z" }],
  };
  const { page, calls, mutations } = await openPage(context, { role: "admin", realDashboard: true, queue: [detailedRequest] });
  await page.waitForLoadState("networkidle");
  const queueReadsBeforeDrawer = queueCalls(calls);
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();

  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  for (const text of ["Excelente compatibilidad", "Score general: 92/100", "Maracaibo, Zulia", "Residencial", "Aprobar", "El cliente posee terreno y presupuesto adecuado.", "Esteban Ruiz", "Nextj"]) {
    await drawer.getByText(text, { exact: true }).first().waitFor();
  }
  // Los indicadores sin backend se rotulan como ejemplo y no se presentan como datos reales.
  assert.equal(await drawer.locator('[data-prototype="true"]').count(), 2);
  assert.equal(calls.filter((call) => call.path === "/api/admin/users/41").length, 1);
  // El drawer reutiliza la cola ya cargada por el dashboard: abrirlo no la vuelve a leer.
  assert.equal(queueCalls(calls), queueReadsBeforeDrawer);

  // Escape cierra solo el menú y conserva el drawer abierto.
  const actionsTrigger = drawer.getByRole("button", { name: "Acciones para Casa Norte", exact: true });
  await actionsTrigger.click();
  await page.getByRole("menu", { name: "Acciones para Casa Norte" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.equal(await drawer.isVisible(), true);

  await actionsTrigger.click();
  await page.getByRole("menuitem", { name: "Rechazar", exact: true }).click();
  await drawer.waitFor({ state: "detached" });
  const decisionDialog = page.getByRole("dialog");
  await decisionDialog.getByText("Motivo", { exact: true }).waitFor();
  assert.equal(await decisionDialog.getByRole("heading", { name: "Casa Norte" }).count(), 1);
  // Abrir una acción no ejecuta la decisión: solo el modal confirma contra la API.
  assert.equal(mutations.length, 0);
});
