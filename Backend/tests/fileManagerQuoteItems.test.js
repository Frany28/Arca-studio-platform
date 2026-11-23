import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";
import { decodeCursor, encodeCursor } from "../src/utils/pagination.js";

// PDF de cotizaciones en el administrador de archivos, sin PostgreSQL: comprueba la forma pública de
// los elementos, los parámetros de la consulta unificada y el cursor con origen. El SQL real se cubre
// en fileManager.integration.test.js (PostgreSQL desechable).
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
const { pool } = await import("../src/config/db.js");
const { default: fileRoutes } = await import("../src/routes/fileManager.js");
const { withProjectFileReviewState } = await import("../src/config/projectFileReview.js");

const FILE_ROW = {
  access_policy: 1, content_type: "application/pdf", created_at: "2026-04-01T10:00:00.000Z", cursor_value: "2026-04-01T10:00:00.000000Z",
  file_category: "document", file_extension: "pdf", file_id: "7", file_size: "2000", folder_classification_key: "documents.initial_proposal",
  folder_id: "31", folder_name: "Propuesta inicial", is_current: true, name: "Acta.pdf", pdf_error_code: null, pdf_status: null,
  project_id: "1", project_name: "Quinta Bella Vista", project_status: "in_process", quote_code: null, quote_id: null,
  restored_from_version_id: null, review_reason: null, review_status: "approved", reviewed_at: null, reviewer_name: "Ana Pérez",
  source: "file", source_rank: 0, uploader_id: "3", uploader_name: "Arq. Armando", version_id: "40", version_number: 2,
};
const QUOTE_ROW = {
  ...FILE_ROW, access_policy: null, created_at: "2026-04-02T10:00:00.000Z", cursor_value: "2026-04-02T10:00:00.000000Z",
  file_category: null, file_id: null, file_size: null, folder_classification_key: "documents", folder_id: "30", folder_name: "Documentos",
  name: "COT-012-v3.pdf", pdf_error_code: "QUOTE_PDF_STORAGE_ERROR", pdf_status: "error", quote_code: "COT-012", quote_id: "12",
  review_status: null, reviewer_name: null, source: "quote", source_rank: 1, uploader_id: "2", uploader_name: "Admin Arca", version_id: "40", version_number: 3,
};

/**
 * Levanta el router del administrador con una consulta de elementos simulada que registra sus parámetros.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @param {Array<object>} rows - Filas que devuelve la consulta de elementos.
 * @returns {Promise<{ server: object, calls: Array<Array<unknown>> }>} Cliente y parámetros recibidos.
 */
async function start(context, rows) {
  const calls = [];
  const server = await startAdminRouterServer(context, {
    pool,
    respond(sql, params) {
      if (sql.includes("from public.quote_versions quote_version")) {
        calls.push(params);
        return { rowCount: rows.length, rows };
      }
      return { rowCount: 0, rows: [] };
    },
    // La revisión de archivos activada (su comprobación de esquema se prueba en projectFileReviewActivation).
    routes: [["/api", (_req, _res, next) => withProjectFileReviewState(true, next)], ["/api/admin/files", fileRoutes]],
  });
  server.setUser({ id: 2, role: { code: "admin" } });
  return { calls, server };
}

test("elementos: una cotización se distingue del archivo, sin fileId ni revisión y con el estado de su PDF", async (context) => {
  const { calls, server } = await start(context, [QUOTE_ROW, FILE_ROW]);
  const response = await server.send("GET", "/api/admin/files/items?tab=approved&limit=1&projectId=1");
  assert.equal(response.status, 200);
  const [quote] = response.body.items;
  assert.deepEqual(quote, {
    contentType: "application/pdf", createdAt: "2026-04-02T10:00:00.000Z", extension: "pdf", fileCategory: null, fileId: null,
    folder: { id: 30, name: "Documentos", section: "documents" }, isCurrent: true, name: "COT-012-v3.pdf",
    project: { id: 1, name: "Quinta Bella Vista", status: "in_process" },
    quote: { code: "COT-012", id: 12, pdf: { errorCode: "QUOTE_PDF_STORAGE_ERROR", status: "error" } },
    restoredFromVersionId: null, review: null, size: null, source: "quote",
    uploadedBy: { id: 2, name: "Admin Arca" }, versionId: 40, versionNumber: 3,
  });
  assert.equal(calls[0][10], "documents.quotes", "carpeta «Documentos › Cotizaciones» del catálogo");
  assert.equal(calls[0][11], true, "Aprobados incluye cotizaciones");
  assert.deepEqual(decodeCursor(response.body.nextCursor, 6), ["approved", "date", "desc", QUOTE_ROW.cursor_value, 1, "40"], "el cursor guarda el origen");
});

test("cursor: continúa tras una cotización sin confundirla con un archivo del mismo id; admite cursores anteriores", async (context) => {
  const { calls, server } = await start(context, [FILE_ROW]);
  const first = await server.send("GET", "/api/admin/files/items?tab=approved");
  assert.deepEqual(first.body.items.map((item) => [item.source, item.fileId, item.quote, item.review.status]), [["file", 7, null, "approved"]]);

  const afterQuote = encodeCursor(["approved", "date", "desc", QUOTE_ROW.cursor_value, 1, "40"]);
  assert.equal((await server.send("GET", `/api/admin/files/items?tab=approved&cursor=${afterQuote}`)).status, 200);
  assert.deepEqual([calls[1][5], calls[1][12], calls[1][6]], [QUOTE_ROW.cursor_value, 1, "40"]);

  const legacy = encodeCursor(["approved", "date", "desc", FILE_ROW.cursor_value, "40"]);
  assert.equal((await server.send("GET", `/api/admin/files/items?tab=approved&cursor=${legacy}`)).status, 200);
  assert.deepEqual([calls[2][5], calls[2][12], calls[2][6]], [FILE_ROW.cursor_value, 0, "40"], "un cursor de cinco elementos es de archivo");

  for (const invalid of [encodeCursor(["approved", "date", "desc", "x", 2, "40"]), encodeCursor(["pending", "date", "desc", "x", 0, "40"])]) {
    assert.equal((await server.send("GET", `/api/admin/files/items?tab=approved&cursor=${invalid}`)).status, 400);
  }
  assert.equal(calls.length, 3, "un cursor inválido no consulta PostgreSQL");
});

test("Pendientes y Rechazados no incluyen cotizaciones; solo el administrador accede", async (context) => {
  const { calls, server } = await start(context, []);
  for (const tab of ["pending", "rejected"]) assert.equal((await server.send("GET", `/api/admin/files/items?tab=${tab}`)).status, 200);
  assert.deepEqual(calls.map((params) => params[11]), [false, false]);
  for (const role of ["architect", "client"]) {
    server.setUser({ id: 9, role: { code: role } });
    assert.equal((await server.send("GET", "/api/admin/files/items?tab=approved")).status, 403, role);
  }
  server.setUser(null);
  assert.equal((await server.send("GET", "/api/admin/files/items?tab=approved")).status, 401);
  assert.equal(calls.length, 2);
});
