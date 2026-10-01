import assert from "node:assert/strict";
import test from "node:test";
import * as legacy from "../src/api/http.js";
import * as current from "../src/api/index.js";
import { apiRequest, collectCursorPages } from "../src/api/client.js";

test("the HTTP facade preserves every public export and domain instance", () => {
  assert.deepEqual(Object.keys(legacy).sort(), Object.keys(current).sort());
  for (const key of Object.keys(legacy)) assert.equal(legacy[key], current[key]);
  for (const domain of ["auth", "admin", "projects", "projectRequests", "environmentComments", "support"]) {
    assert.equal(legacy.api[domain], legacy[`${domain}Api`]);
  }
});

test("the common client preserves credentials, headers, success and empty responses", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("empty") ? { status: 204 } : {
      status: 200, ok: true, headers: { get: () => "application/json" }, json: async () => ({ id: 4 }),
    };
  };
  try {
    assert.deepEqual(await apiRequest("/example", { headers: { "X-Test": "yes" } }), { id: 4 });
    assert.equal(calls[0].url, "/api/example");
    assert.equal(calls[0].options.credentials, "include");
    assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json", "X-Test": "yes" });
    assert.equal(await apiRequest("/empty"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the common client retains backend errors, network classification and abort identity", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      status: 422, ok: false, headers: { get: () => "application/json" },
      json: async () => ({ code: "VALIDATION_ERROR", message: "Datos inválidos", fields: { name: "Requerido" } }),
    });
    await assert.rejects(apiRequest("/example"), { status: 422, code: "VALIDATION_ERROR", message: "Datos inválidos", fields: { name: "Requerido" } });
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    globalThis.fetch = async () => { throw abort; };
    await assert.rejects(apiRequest("/example"), (error) => error === abort);
    const networkFailure = new TypeError("Failed to fetch");
    globalThis.fetch = async () => { throw networkFailure; };
    await assert.rejects(apiRequest("/example"), (error) => error.code === "NETWORK_ERROR" && error.cause === networkFailure);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cursor collection keeps page order and deduplicates numeric and string identifiers", async () => {
  const calls = [];
  const result = await collectCursorPages(async (page) => {
    calls.push(page);
    return page.cursor
      ? { projects: [{ id: "1", name: "Repeated" }, { id: 2 }], nextCursor: null }
      : { projects: [{ id: 1, name: "First" }], nextCursor: "next" };
  }, "projects", 25);
  assert.deepEqual(calls, [{ cursor: null, limit: 25 }, { cursor: "next", limit: 25 }]);
  assert.deepEqual(result, { projects: [{ id: 1, name: "First" }, { id: 2 }], nextCursor: null });
});
