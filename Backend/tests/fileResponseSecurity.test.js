import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import express from "express";
import helmet from "helmet";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.CORS_ORIGINS = "https://arca-frontend.test";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const { streamProjectFile, streamProjectRequestFile } = await import("../src/controllers/fileController.js");
const { getFileResponseSecurity } = await import("../src/utils/fileResponseSecurity.js");
const { getAllowedOrigins } = await import("../src/config/cors.js");

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Los orígenes incrustadores son los mismos que CORS permite (en desarrollo incluye localhost:5173).
const FRAME_ORIGINS = getAllowedOrigins().join(" ");
const STRICT = `default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self' ${FRAME_ORIGINS}`;
const STRICT_SANDBOX = `${STRICT}; sandbox`;

test("política por tipo: imágenes y Office con sandbox, video sin sandbox, PDF y resto como descarga", () => {
  const frameAncestors = getAllowedOrigins();
  for (const type of ["image/png", "image/jpeg", "image/webp", "IMAGE/PNG; charset=binary", DOCX, XLSX]) {
    assert.deepEqual(getFileResponseSecurity({ contentType: type, frameAncestors }), {
      contentSecurityPolicy: STRICT_SANDBOX, contentType: type.split(";")[0].toLowerCase(), disposition: "inline",
    }, type);
  }
  assert.deepEqual(getFileResponseSecurity({ contentType: "video/mp4", frameAncestors }), { contentSecurityPolicy: STRICT, contentType: "video/mp4", disposition: "inline" });
  assert.deepEqual(getFileResponseSecurity({ contentType: "Application/PDF", frameAncestors }), {
    contentSecurityPolicy: STRICT_SANDBOX, contentType: "application/pdf", disposition: "attachment",
  });
  for (const type of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/javascript", "model/gltf-binary", "", null]) {
    assert.deepEqual(getFileResponseSecurity({ contentType: type, frameAncestors }), {
      contentSecurityPolicy: STRICT_SANDBOX, contentType: "application/octet-stream", disposition: "attachment",
    }, String(type));
  }
  assert.match(getFileResponseSecurity({ contentType: "image/png" }).contentSecurityPolicy, /frame-ancestors 'self'; sandbox$/);
});

/**
 * Sustituye la búsqueda del archivo y el almacenamiento por respuestas controladas.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @param {{ fileType: string, storageType?: string|null, found?: boolean, body?: Buffer }} options - Archivo simulado.
 * @returns {void}
 */
function mockFile(context, { body = Buffer.from("contenido"), fileType, found = true, storageType = fileType }) {
  context.mock.method(pool, "query", async () => ({
    rows: found
      ? [{ direct_access: true, file_extension: "x", file_name: "key", file_size: body.length, file_type: fileType, id: "5", original_name: "plano final.bin", title: "plano", version_id: "9" }]
      : [],
  }));
  context.mock.method(objectStorage, "get", async (_key, { range } = {}) => {
    if (range) {
      return { Body: Readable.from([body.subarray(0, 4)]), ContentLength: 4, ContentRange: `bytes 0-3/${body.length}`, ContentType: storageType };
    }
    return { Body: Readable.from([body]), ContentLength: body.length, ContentType: storageType };
  });
}

/**
 * Inicia la aplicación mínima con Helmet, como en `src/app.js`, y los controladores reales.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<Function>} Cliente `get(path, headers)`.
 */
async function startApp(context) {
  const app = express();
  app.use(helmet());
  app.use((req, _res, next) => { req.user = { id: 1, role: { code: "admin" } }; next(); });
  app.get("/projects/:projectId/files/:fileId/content", streamProjectFile);
  app.get("/project-requests/:projectRequestId/files/:fileId/content", streamProjectRequestFile);
  app.use((error, _req, res, _next) => res.status(500).json({ code: error.code || "ERROR" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return (path, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
}

const PROJECT_CASES = [
  { label: "imagen PNG", fileType: "image/png", csp: STRICT_SANDBOX, type: "image/png", disposition: "inline" },
  { label: "panorama 360 (JPEG)", fileType: "image/jpeg", csp: STRICT_SANDBOX, type: "image/jpeg", disposition: "inline" },
  { label: "video MP4", fileType: "video/mp4", csp: STRICT, type: "video/mp4", disposition: "inline" },
  { label: "documento Word", fileType: DOCX, csp: STRICT_SANDBOX, type: DOCX, disposition: "inline" },
  { label: "hoja Excel", fileType: XLSX, csp: STRICT_SANDBOX, type: XLSX, disposition: "inline" },
  { label: "PDF (solo visor integrado: descarga con sandbox)", fileType: "application/pdf", csp: STRICT_SANDBOX, type: "application/pdf", disposition: "attachment" },
  { label: "modelo 3D GLB heredado", fileType: "model/gltf-binary", csp: STRICT_SANDBOX, type: "application/octet-stream", disposition: "attachment" },
  { label: "HTML en los metadatos del almacenamiento", fileType: "image/png", storageType: "text/html", csp: STRICT_SANDBOX, type: "application/octet-stream", disposition: "attachment" },
  { label: "SVG con scripts posibles", fileType: "image/svg+xml", csp: STRICT_SANDBOX, type: "application/octet-stream", disposition: "attachment" },
];

for (const { label, fileType, storageType, csp, type, disposition } of PROJECT_CASES) {
  test(`archivo de proyecto: ${label}`, async (context) => {
    mockFile(context, { fileType, storageType });
    const get = await startApp(context);
    const response = await get("/projects/15/files/5/content");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-security-policy"), csp);
    assert.equal(response.headers.get("content-type"), type);
    assert.equal(response.headers.get("content-disposition"), `${disposition}; filename="plano%20final.bin"`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.equal(response.headers.get("x-frame-options"), null, "frame-ancestors sustituye a X-Frame-Options");
    assert.equal(await response.text(), "contenido");
  });
}

test("archivo de proyecto: el video conserva Range (206) con la política estricta", async (context) => {
  mockFile(context, { fileType: "video/mp4" });
  const get = await startApp(context);
  const response = await get("/projects/15/files/5/content", { Range: "bytes=0-3" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/9");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-security-policy"), STRICT);
});

test("archivo de proyecto: sin acceso responde 404 sin consultar el almacenamiento", async (context) => {
  mockFile(context, { fileType: "image/png", found: false });
  const get = await startApp(context);
  const response = await get("/projects/15/files/5/content");
  assert.equal(response.status, 404);
  assert.equal(objectStorage.get.mock.callCount(), 0);
});

test("archivo de proyecto: un PDF sin acceso sigue respondiendo 404; attachment y CSP no sustituyen la autorización", async (context) => {
  mockFile(context, { fileType: "application/pdf", found: false });
  const get = await startApp(context);
  const response = await get("/projects/15/files/5/content");
  assert.equal(response.status, 404);
  assert.equal(objectStorage.get.mock.callCount(), 0);
});

test("adjunto de solicitud: imagen con política estricta solo incrustable por 'self'", async (context) => {
  mockFile(context, { fileType: "image/png" });
  const get = await startApp(context);
  const response = await get("/project-requests/3/files/5/content");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox");
  assert.equal(response.headers.get("content-disposition"), 'inline; filename="plano%20final.bin"');
});

test("adjunto de solicitud: PDF solo visible en la aplicación, como descarga con CSP estricta y sandbox", async (context) => {
  mockFile(context, { fileType: "application/pdf" });
  const get = await startApp(context);
  const response = await get("/project-requests/3/files/5/content");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="plano%20final.bin"');
  assert.equal(await response.text(), "contenido");
});

test("adjunto de solicitud: un PDF sin acceso responde 404 sin consultar el almacenamiento", async (context) => {
  mockFile(context, { fileType: "application/pdf", found: false });
  const get = await startApp(context);
  const response = await get("/project-requests/3/files/5/content");
  assert.equal(response.status, 404);
  assert.equal(objectStorage.get.mock.callCount(), 0);
});

test("adjunto de solicitud: un tipo no permitido se entrega como descarga inerte", async (context) => {
  mockFile(context, { fileType: "application/pdf", storageType: "text/html" });
  const get = await startApp(context);
  const response = await get("/project-requests/3/files/5/content");
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.match(response.headers.get("content-security-policy"), /sandbox$/);
});
