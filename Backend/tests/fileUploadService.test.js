import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Readable } from "node:stream";
import { prepareProjectRequestUpload, prepareUpload, runUpload, uploadPolicies } from "../src/services/fileUploadService.js";

function request(overrides = {}) {
  return { destroyed: false, headers: { "content-length": "100", "content-type": "application/pdf", "x-file-name": "documento.pdf" }, ...overrides };
}

test("upload service validates once and passes the original stream", async () => {
  const req = request();
  const result = await runUpload({ req, policy: uploadPolicies.document, operation: async (upload) => upload });
  assert.equal(result.body, req);
  assert.equal(result.size, 100);
  assert.equal(result.originalName, "documento.pdf");
});

test("upload service rejects invalid types and aborted streams", async () => {
  assert.throws(() => prepareUpload(request({ headers: { "content-length": "100", "content-type": "application/x-msdownload", "x-file-name": "bad.exe" } }), uploadPolicies.document), { code: "UNSUPPORTED_FILE_TYPE" });
  await assert.rejects(() => runUpload({ req: request({ destroyed: true }), policy: uploadPolicies.document, operation: async () => null }), { code: "UPLOAD_ABORTED" });
});

test("document uploads accept modern Word and Excel formats", () => {
  const docx = prepareUpload(
    request({
      headers: {
        "content-length": "100",
        "content-type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-file-name": "memoria.docx",
      },
    }),
    uploadPolicies.document,
  );
  const xlsx = prepareUpload(
    request({
      headers: {
        "content-length": "100",
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-file-name": "presupuesto.xlsx",
      },
    }),
    uploadPolicies.document,
  );

  assert.equal(docx.originalName, "memoria.docx");
  assert.equal(xlsx.originalName, "presupuesto.xlsx");
});

test("document uploads reject legacy Office and mismatched extensions", () => {
  assert.throws(
    () =>
      prepareUpload(
        request({
          headers: {
            "content-length": "100",
            "content-type": "application/msword",
            "x-file-name": "memoria.doc",
          },
        }),
        uploadPolicies.document,
      ),
    { code: "UNSUPPORTED_FILE_TYPE" },
  );
  assert.throws(
    () =>
      prepareUpload(
        request({
          headers: {
            "content-length": "100",
            "content-type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "x-file-name": "memoria.xlsx",
          },
        }),
        uploadPolicies.document,
      ),
    { code: "UNSUPPORTED_FILE_TYPE" },
  );
});

test("operation errors remain the primary upload error", async () => {
  const failure = new Error("database failed");
  await assert.rejects(() => runUpload({ req: request(), policy: uploadPolicies.document, operation: async () => { throw failure; } }), failure);
});

function streamingRequest(content, contentType, fileName) {
  const req = Readable.from([content]);
  req.headers = {
    "content-length": String(content.length),
    "content-type": contentType,
    "x-file-name": fileName,
  };
  return req;
}

test("project request uploads verify the real file signature", async () => {
  const validPng = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const upload = prepareProjectRequestUpload(
    streamingRequest(validPng, "image/png", "referencia.png"),
  );
  const chunks = [];
  for await (const chunk of upload.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), validPng);

  const invalid = prepareProjectRequestUpload(
    streamingRequest(Buffer.from("not a png"), "image/png", "falso.png"),
  );
  await assert.rejects(async () => {
    for await (const _chunk of invalid.body) {
      // Consume the stream so signature failures surface.
    }
  }, { code: "INVALID_FILE_SIGNATURE" });
});

/**
 * Registra las excepciones no capturadas mientras dura la prueba: una firma inválida que llega
 * antes de que alguien lea el flujo no debe terminar el proceso.
 *
 * @param {import("node:test").TestContext} context - Contexto que retira el oyente.
 * @returns {Array<Error>} Excepciones registradas.
 */
function captureUncaught(context) {
  const uncaught = [];
  const listener = (error) => uncaught.push(error);
  process.prependListener("uncaughtException", listener);
  context.after(() => process.removeListener("uncaughtException", listener));
  return uncaught;
}

test("project request signature: a failure before anyone reads the body is not an uncaught exception", async (context) => {
  const uncaught = captureUncaught(context);
  // El servicio consulta PostgreSQL antes de leer el cuerpo: el contenido ya llegó al validador.
  const upload = prepareProjectRequestUpload(streamingRequest(Buffer.alloc(2048, 1), "application/pdf", "falso.pdf"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(uncaught.map((error) => error.code), []);

  // La comprobación previa a la transferencia informa el motivo y el flujo sigue fallando al leerlo.
  await assert.rejects(upload.ready, { code: "INVALID_FILE_SIGNATURE", status: 415 });
  await assert.rejects(async () => {
    for await (const _chunk of upload.body) {
      // Consume the stream so the stored error surfaces.
    }
  }, { code: "INVALID_FILE_SIGNATURE" });
});

test("project request signature: ready resolves for valid content without consuming it", async () => {
  const validPdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4096, 0x20)]);
  const upload = prepareProjectRequestUpload(streamingRequest(validPdf, "application/pdf", "plano.pdf"));
  await upload.ready;
  const chunks = [];
  for await (const chunk of upload.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), validPdf);

  const small = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const smallUpload = prepareProjectRequestUpload(streamingRequest(small, "image/png", "icono.png"));
  await smallUpload.ready;
  const smallChunks = [];
  for await (const chunk of smallUpload.body) smallChunks.push(chunk);
  assert.deepEqual(Buffer.concat(smallChunks), small);
});

test("project request signature: a source error after validation never becomes uncaught", async (context) => {
  const uncaught = captureUncaught(context);
  const source = new PassThrough();
  source.headers = { "content-length": "4096", "content-type": "application/pdf", "x-file-name": "plano.pdf" };
  const upload = prepareProjectRequestUpload(source);
  source.write(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 0x20)]));
  await upload.ready;
  // El cliente cancela la subida mientras el almacenamiento transfiere sin escuchar errores.
  source.destroy(Object.assign(new Error("aborted"), { code: "ECONNRESET" }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(uncaught.map((error) => error.code), []);
  assert.equal(upload.body.errored?.code, "ECONNRESET");
});

test("uploads without signature validation expose an already resolved ready", async () => {
  const upload = prepareUpload(streamingRequest(Buffer.from("%PDF-1.7"), "application/pdf", "doc.pdf"), uploadPolicies.document);
  await upload.ready;
});
