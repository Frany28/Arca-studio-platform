import assert from "node:assert/strict";
import test from "node:test";
import { getRequestClientFailure, normalizeRequestClientUserId } from "../src/pages/admin-dashboard/utils/adminRequestClient.js";
import { buildAdminRequestDetails } from "../src/pages/admin-dashboard/utils/adminRequestDetails.js";
import { NETWORK_USER_ERROR_MESSAGE } from "../src/utils/userFacingError.js";

test("valida el usuario solicitante sin convertir ausencias ni valores ajenos a IDs", () => {
  for (const value of [null, undefined, "", " ", "null", "undefined", "NaN", NaN, Infinity, 0, -1, 1.5, true, {}, [], "1e2", "2.5", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeRequestClientUserId(value), null, String(value));
  }
  assert.equal(normalizeRequestClientUserId(11), 11);
  assert.equal(normalizeRequestClientUserId("11"), 11);
});

test("requestedBy identifica al usuario y nunca hereda clientId ni el ID de solicitud", () => {
  const summary = { id: 9, clientId: 2, userId: 88, customerId: 99, requesterId: 100 };
  assert.equal(buildAdminRequestDetails({ summary, queueRequest: { clientId: 2, requestedBy: 11 } }).clientUserId, 11);
  assert.equal(buildAdminRequestDetails({ summary, queueRequest: { clientId: 2 } }).clientUserId, null);
});

test("404 es ausencia neutral, conserva diagnóstico y no permite reintentar", () => {
  assert.deepEqual(getRequestClientFailure({ status: 404, code: "USER_NOT_FOUND", message: "El usuario seleccionado no existe." }), {
    error: "Información del cliente no disponible", status: 404, code: "USER_NOT_FOUND", unavailable: true, canRetry: false,
  });
});

test("403 y 401 conservan el mensaje de acceso sin reintentar", () => {
  for (const status of [401, 403]) {
    const result = getRequestClientFailure({ status, code: "ACCESS_DENIED", message: "No tienes permiso para acceder a este recurso." });
    assert.equal(result.error, "No tienes permiso para acceder a este recurso.");
    assert.equal(result.status, status);
    assert.equal(result.canRetry, false);
    assert.equal(result.unavailable, false);
  }
});

test("500 y red permiten reintentar, conservando status y code", () => {
  const server = getRequestClientFailure({ status: 500, code: "42703", message: "Ocurrió un error inesperado." });
  assert.equal(server.error, "No fue posible cargar los datos del cliente.");
  assert.equal(server.canRetry, true);
  assert.equal(server.code, "42703");
  const network = getRequestClientFailure({ code: "NETWORK_ERROR" });
  assert.equal(network.error, NETWORK_USER_ERROR_MESSAGE);
  assert.equal(network.canRetry, true);
  assert.equal(network.status, null);
});
