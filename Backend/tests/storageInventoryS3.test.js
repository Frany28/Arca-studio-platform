import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createReadOnlyStorageInspector } from "../src/services/objectStorage.js";
import { runStorageInventory } from "../src/services/storageInventoryService.js";

/*
 * Interpretación de respuestas reales del SDK de S3 (E0) frente a un servidor HTTP local que imita
 * la API S3 con estilo de ruta, como Supabase. Comprueba que un acceso denegado o un error del
 * proveedor nunca se clasifiquen como objeto ausente y que el inspector solo emita GET de listado y
 * HEAD. No contacta ningún servicio remoto.
 */

const BUCKET = "general-files";
const DENIED_BUCKET = "denied-files";
const requests = [];
let server;
let endpoint;

/**
 * Respuesta XML de error con el formato de S3.
 *
 * @param {import("node:http").ServerResponse} response - Respuesta HTTP.
 * @param {number} status - Código HTTP.
 * @param {string} code - Código de error S3.
 * @returns {void}
 */
function sendError(response, status, code) {
  response.writeHead(status, { "content-type": "application/xml" });
  response.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code} for secret/path/nombre-persona.pdf</Message></Error>`);
}

/**
 * Página de ListObjectsV2 con dos objetos por página.
 *
 * @param {import("node:http").ServerResponse} response - Respuesta HTTP.
 * @param {string|null} token - Token de continuación recibido.
 * @returns {void}
 */
function sendListPage(response, token) {
  const pages = {
    "": { keys: ["a/present.pdf", "a/second.pdf"], next: "page-2" },
    "page-2": { keys: ["a/third.pdf"], next: null },
  };
  const page = pages[token || ""];
  const contents = page.keys.map((key) => `<Contents><Key>${key}</Key><LastModified>2026-11-01T00:00:00.000Z</LastModified><Size>5</Size></Contents>`).join("");
  response.writeHead(200, { "content-type": "application/xml" });
  response.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${BUCKET}</Name><KeyCount>${page.keys.length}</KeyCount><MaxKeys>2</MaxKeys><IsTruncated>${page.next ? "true" : "false"}</IsTruncated>${page.next ? `<NextContinuationToken>${page.next}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`);
}

before(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push({ method: request.method, path: url.pathname, query: url.search });
    const [, , , , bucket, ...rest] = url.pathname.split("/");
    const key = rest.join("/");
    if (request.method === "GET" && !key && url.searchParams.get("list-type") === "2") {
      if (bucket === DENIED_BUCKET) return sendError(response, 403, "AccessDenied");
      return sendListPage(response, url.searchParams.get("continuation-token"));
    }
    if (request.method === "HEAD") {
      const statusByKey = { "a/bad-request": 400, "a/forbidden": 403, "a/missing": 404, "a/server-error": 500 };
      const status = statusByKey[key];
      if (status) {
        response.writeHead(status);
        return response.end();
      }
      response.writeHead(200, { "content-length": "5", "content-type": "application/pdf" });
      return response.end();
    }
    return sendError(response, 405, "MethodNotAllowed");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/storage/v1/s3`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Crea el inspector real (SDK de S3) contra el servidor local.
 *
 * @returns {ReturnType<typeof createReadOnlyStorageInspector>} Inspector.
 */
function inspector() {
  return createReadOnlyStorageInspector({ accessKeyId: "clave-ficticia", endpoint, region: "us-east-1", secretAccessKey: "secreto-ficticio" });
}

test("HEAD real: 404 es ausencia confirmada; 403, 400 y 500 son inaccesibles", async () => {
  const storage = inspector();
  try {
    assert.deepEqual(await storage.headObject({ bucket: BUCKET, key: "a/present.pdf" }), { size: 5, status: "present" });
    assert.deepEqual(await storage.headObject({ bucket: BUCKET, key: "a/missing" }), { status: "missing" });
    for (const [key, httpStatus] of [["a/forbidden", 403], ["a/bad-request", 400], ["a/server-error", 500]]) {
      const result = await storage.headObject({ bucket: BUCKET, key });
      assert.equal(result.status, "inaccessible", key);
      assert.equal(result.httpStatus, httpStatus, key);
    }
  } finally {
    storage.close();
  }
});

test("el listado real recorre el token de continuación y un 403 deja el bucket incompleto", async () => {
  const storage = inspector();
  try {
    const first = await storage.listPage({ bucket: BUCKET, maxKeys: 2 });
    assert.deepEqual(first.objects.map((object) => object.key), ["a/present.pdf", "a/second.pdf"]);
    assert.equal(first.isTruncated, true);
    assert.equal(first.nextToken, "page-2");

    const report = await runStorageInventory({
      config: { buckets: { general: DENIED_BUCKET, quotes: BUCKET }, supabaseUrl: null },
      limits: { listPageSize: 2 },
      openDatabase: async () => ({
        async end() {},
        async query() {
          return { rows: [] };
        },
      }),
      run: { runId: "s3", target: {} },
      storage,
    });
    const listings = Object.fromEntries(report.completeness.listings.map((listing) => [listing.bucket, listing]));
    assert.equal(listings[BUCKET].status, "complete");
    assert.equal(listings[BUCKET].pages, 2);
    assert.equal(listings[BUCKET].objects, 3);
    assert.equal(listings[DENIED_BUCKET].status, "incomplete");
    assert.equal(listings[DENIED_BUCKET].errorCode, "AccessDenied");
    // El mensaje del proveedor, que incluye una ruta, nunca llega al informe.
    assert.ok(!JSON.stringify(report).includes("nombre-persona"));
  } finally {
    storage.close();
  }
});

test("el inspector solo emite GET de listado y HEAD contra el proveedor", () => {
  assert.ok(requests.length > 0);
  for (const request of requests) {
    assert.ok(
      request.method === "HEAD" || (request.method === "GET" && request.query.includes("list-type=2")),
      `${request.method} ${request.path}${request.query}`,
    );
  }
});
