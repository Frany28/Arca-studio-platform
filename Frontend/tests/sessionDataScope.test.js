import assert from "node:assert/strict";
import test from "node:test";

import { getSessionDataScopeKey } from "../src/auth/sessionDataScope.js";

const CLIENT = { id: 5, email: "diego@example.test", role: "client", clientId: 50, firstName: "Diego", profilePhotoUrl: "/a?v=1" };

test("sin usuario no hay ámbito de datos", () => {
  assert.equal(getSessionDataScopeKey(null), null);
  assert.equal(getSessionDataScopeKey(undefined), null);
});

test("la misma sesión publicada como otro objeto conserva la clave", () => {
  assert.equal(getSessionDataScopeKey({ ...CLIENT }), getSessionDataScopeKey(CLIENT));
});

test("los campos de presentación no cambian la clave", () => {
  assert.equal(
    getSessionDataScopeKey({ ...CLIENT, firstName: "Diego A.", profilePhotoUrl: "/a?v=2", updatedAt: "2026-11-09" }),
    getSessionDataScopeKey(CLIENT),
  );
});

test("otra cuenta, otro rol u otro cliente vinculado cambian la clave", () => {
  const base = getSessionDataScopeKey(CLIENT);
  assert.notEqual(getSessionDataScopeKey({ ...CLIENT, id: 6 }), base);
  assert.notEqual(getSessionDataScopeKey({ ...CLIENT, role: "architect" }), base);
  assert.notEqual(getSessionDataScopeKey({ ...CLIENT, clientId: 51 }), base);
});

test("usa el correo sin id y el código de roleDetails sin rol plano", () => {
  assert.equal(getSessionDataScopeKey({ email: "x@example.test", roleDetails: { code: "client" } }), "x@example.test:client:");
});
