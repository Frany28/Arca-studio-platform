import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { uploadRawFile } from "../src/api/client.js";
import { NETWORK_USER_ERROR_MESSAGE } from "../src/utils/userFacingError.js";

const OriginalXMLHttpRequest = globalThis.XMLHttpRequest;
let lastRequest = null;

/**
 * XMLHttpRequest mínimo: registra cabeceras y cuerpo y permite terminar la petición con un estado,
 * un cuerpo o un fallo de red, como lo haría el navegador.
 */
class FakeXMLHttpRequest {
  constructor() {
    this.headers = {};
    this.upload = {};
    lastRequest = this;
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.body = body;
  }

  abort() {
    this.onabort?.();
  }

  respond(status, responseText = "") {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }

  failNetwork() {
    this.onerror?.();
  }
}

afterEach(() => {
  globalThis.XMLHttpRequest = OriginalXMLHttpRequest;
  lastRequest = null;
});

const file = { name: "Plano principal.pdf", size: 2048, type: "application/pdf" };

test("uploadRawFile envía el binario con Content-Type, X-File-Name y cookies", async () => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  const progress = [];
  const pending = uploadRawFile({ file, onUploadProgress: (event) => progress.push(event.progress), path: "/project-requests/7/files" });
  assert.equal(lastRequest.method, "POST");
  assert.equal(lastRequest.url, "/api/project-requests/7/files");
  assert.equal(lastRequest.withCredentials, true);
  assert.equal(lastRequest.headers["Content-Type"], "application/pdf");
  assert.equal(lastRequest.headers["X-File-Name"], "Plano%20principal.pdf");
  assert.equal(lastRequest.body, file);
  // El progreso nunca alcanza 100 antes de la respuesta del servidor.
  lastRequest.upload.onprogress({ lengthComputable: true, loaded: 2048, total: 2048 });
  assert.deepEqual(progress, [99]);
  lastRequest.respond(201, JSON.stringify({ file: { id: 3 } }));
  assert.deepEqual(await pending, { file: { id: 3 } });
  assert.deepEqual(progress, [99, 100]);
});

test("uploadRawFile conserva el mensaje y el código JSON del backend", async () => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  const pending = uploadRawFile({ file, path: "/project-requests/7/files" });
  lastRequest.respond(409, JSON.stringify({ code: "DUPLICATE_PROJECT_REQUEST_FILE", message: "Ese archivo ya existe en esta solicitud." }));
  await assert.rejects(pending, { code: "DUPLICATE_PROJECT_REQUEST_FILE", message: "Ese archivo ya existe en esta solicitud.", status: 409 });
});

test("uploadRawFile explica un 413 sin JSON (límite de la plataforma) en lugar de un error genérico", async () => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  const pending = uploadRawFile({ file, path: "/project-requests/7/files" });
  lastRequest.respond(413, "Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE");
  await assert.rejects(pending, (error) => {
    assert.equal(error.status, 413);
    assert.equal(error.code, "FILE_TOO_LARGE");
    assert.match(error.message, /supera el tamaño/);
    return true;
  });
});

test("uploadRawFile identifica un fallo de red", async () => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  const pending = uploadRawFile({ file, path: "/project-requests/7/files" });
  lastRequest.failNetwork();
  await assert.rejects(pending, { code: "NETWORK_ERROR", message: NETWORK_USER_ERROR_MESSAGE });
});
