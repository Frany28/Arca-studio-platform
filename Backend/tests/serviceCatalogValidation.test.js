import assert from "node:assert/strict";
import test from "node:test";

import {
  isUnitCompatibleWithKind,
  listChangedServiceFields,
  mergeServiceChanges,
} from "../src/domain/serviceCatalog.js";
import { AppError, ConflictError, ValidationError } from "../src/errors/appError.js";
import { translateServiceCatalogError } from "../src/services/serviceCatalogErrors.js";
import { encodeCursor } from "../src/utils/pagination.js";
import {
  serviceCreateSchema,
  serviceDetailSchema,
  serviceListSchema,
  serviceStatusSchema,
  serviceUpdateSchema,
} from "../src/validation/serviceCatalogSchemas.js";

const VALID_CREATE = { code: "anteproyecto-m2", kind: "individual", measurementUnitId: 1, name: " Anteproyecto ", referenceRate: "12" };
const CURRENT = {
  description: null,
  isActive: true,
  kind: "individual",
  measurementUnit: { code: "square_meter", id: 1 },
  name: "Anteproyecto",
  referenceRate: "12.00",
  sortOrder: 1,
};

/**
 * Devuelve las rutas de campo con error de un resultado de Zod.
 *
 * @param {object} result - Resultado de safeParse.
 * @returns {Array<string>} Rutas con error.
 */
function errorPaths(result) {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

test("alta: normaliza código, nombre y tarifa, y aplica valores por defecto", () => {
  const result = serviceCreateSchema.safeParse({ body: VALID_CREATE });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body, {
    changeNote: null, code: "ANTEPROYECTO-M2", isActive: true, kind: "individual",
    measurementUnitId: 1, name: "Anteproyecto", referenceRate: "12.00", sortOrder: 0,
  });
  const turnkey = serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, kind: "turnkey", referenceRate: 900.5, description: "  " } });
  assert.equal(turnkey.data.body.referenceRate, "900.50");
  assert.equal(turnkey.data.body.description, null);
});

test("alta: rechaza campos obligatorios, longitudes, formato de código y campos no editables", () => {
  for (const field of ["code", "kind", "measurementUnitId", "name", "referenceRate"]) {
    const body = { ...VALID_CREATE };
    delete body[field];
    assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body })), [`body.${field}`], field);
  }
  for (const code of ["CON ESPACIO", "-INICIO", "FIN-", "Ñ", "A".repeat(31), "DOBLE--GUION"]) {
    assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, code } })), ["body.code"], code);
  }
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, name: "x".repeat(151) } })), ["body.name"]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, description: "x".repeat(2001) } })), ["body.description"]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, kind: "bundle" } })), ["body.kind"]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, sortOrder: -1 } })), ["body.sortOrder"]);
  // La moneda es siempre USD: un campo `currency` se rechaza en lugar de ignorarse.
  assert.equal(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, currency: "EUR" } }).success, false);
});

test("tarifa: precisión de NUMERIC(14,2), no negativa y sin números inseguros", () => {
  const rate = (referenceRate) => serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, referenceRate } });
  assert.equal(rate("0").data.body.referenceRate, "0.00");
  assert.equal(rate("999999999999.99").data.body.referenceRate, "999999999999.99");
  assert.equal(rate("12.500").data.body.referenceRate, "12.50");
  for (const [value, message] of [
    ["12.345", "Admite como máximo 2 decimales."],
    ["-1", "No puede ser negativo."],
    ["1000000000000", "Admite como máximo 12 dígitos enteros."],
    ["doce", "Debe ser un número decimal válido."],
    [0.1 + 0.2, "Envía el valor como texto decimal para conservar la precisión."],
    [null, "Es obligatorio."],
  ]) {
    const result = rate(value);
    assert.deepEqual(errorPaths(result), ["body.referenceRate"], String(value));
    assert.equal(result.error.issues[0].message, message);
  }
});

test("edición: exige expectedVersion y algún campo, y no permite cambiar código ni moneda", () => {
  const update = (body) => serviceUpdateSchema.safeParse({ params: { serviceId: "4" }, body });
  const valid = update({ expectedVersion: 2, referenceRate: "15.5", changeNote: " Ajuste 2026 " });
  assert.equal(valid.success, true);
  assert.deepEqual(valid.data, { params: { serviceId: 4 }, body: { changeNote: "Ajuste 2026", expectedVersion: 2, referenceRate: "15.50" } });
  assert.deepEqual(errorPaths(update({ referenceRate: "15" })), ["body.expectedVersion"]);
  assert.deepEqual(errorPaths(update({ expectedVersion: 0, name: "Otro" })), ["body.expectedVersion"]);
  assert.deepEqual(errorPaths(update({ expectedVersion: 1 })), ["body.request"]);
  assert.deepEqual(errorPaths(update({ expectedVersion: 1, changeNote: "Solo nota" })), ["body.request"]);
  assert.equal(update({ expectedVersion: 1, code: "OTRO" }).success, false);
  assert.equal(update({ expectedVersion: 1, currency: "EUR" }).success, false);
  assert.equal(update({ expectedVersion: 1, description: null }).data.body.description, null);
  assert.deepEqual(errorPaths(serviceUpdateSchema.safeParse({ params: { serviceId: "0" }, body: { expectedVersion: 1, name: "x" } })), ["params.serviceId"]);
});

test("estado, detalle y listado validan identificadores, filtros y cursor", () => {
  assert.equal(serviceStatusSchema.safeParse({ params: { serviceId: "3" }, body: { expectedVersion: 1, isActive: false } }).success, true);
  assert.deepEqual(errorPaths(serviceStatusSchema.safeParse({ params: { serviceId: "3" }, body: { expectedVersion: 1 } })), ["body.isActive"]);
  assert.equal(serviceDetailSchema.safeParse({ params: { serviceId: "abc" } }).success, false);

  const list = serviceListSchema.safeParse({ query: {
    cursor: encodeCursor([3, "17"]), kind: "turnkey", limit: "50", measurementUnitId: "2", search: "  m2 ", status: "inactive",
  } });
  assert.equal(list.success, true);
  assert.deepEqual({ ...list.data.query, cursor: undefined }, { cursor: undefined, kind: "turnkey", limit: 50, measurementUnitId: 2, search: "m2", status: "inactive" });
  assert.equal(serviceListSchema.safeParse({ query: { search: "   " } }).data.query.search, undefined);
  for (const query of [{ limit: "101" }, { status: "deleted" }, { kind: "bundle" }, { cursor: "x" },
    { cursor: encodeCursor(["2026-01-01", "1"]) }, { cursor: encodeCursor([-1, "1"]) }, { measurementUnitId: "0" }]) {
    assert.equal(serviceListSchema.safeParse({ query }).success, false, JSON.stringify(query));
  }
});

test("dominio: llave en mano solo admite unidades de superficie por código estable", () => {
  assert.equal(isUnitCompatibleWithKind("individual", { code: "point" }), true);
  assert.equal(isUnitCompatibleWithKind("turnkey", { code: "square_meter" }), true);
  // El nombre o el símbolo visibles no bastan.
  assert.equal(isUnitCompatibleWithKind("turnkey", { code: "metro_cuadrado", name: "Metro cuadrado", symbol: "m²" }), false);
  assert.equal(isUnitCompatibleWithKind("turnkey", null), false);
});

test("dominio: detecta solo cambios efectivos en los campos versionados", () => {
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, {})), []);
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { name: "Anteproyecto", referenceRate: "12.00" })), []);
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { referenceRate: "15.50", isActive: false })), ["referenceRate", "isActive"]);
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { description: "Nueva" })), ["description"]);
  assert.deepEqual(listChangedServiceFields({ ...CURRENT, description: "Algo" }, mergeServiceChanges({ ...CURRENT, description: "Algo" }, { description: null })), ["description"]);
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { measurementUnitId: 2, kind: "turnkey" })), ["kind", "measurementUnitId"]);
});

test("errores de PostgreSQL se traducen sin exponer detalles internos", () => {
  const pgError = (code, constraint) => Object.assign(new Error(`detalle interno ${code}`), { code, constraint });
  const cases = [
    [pgError("23505", "uq_services_code"), ConflictError, "SERVICE_CODE_ALREADY_EXISTS", 409],
    [pgError("23505", "uq_service_versions_current"), ConflictError, "SERVICE_VERSION_CONFLICT", 409],
    [pgError("23505", "uq_service_versions_service_version"), ConflictError, "SERVICE_VERSION_CONFLICT", 409],
    [pgError("23503", "fk_services_measurement_unit"), ValidationError, "VALIDATION_ERROR", 400],
    [pgError("23503", "fk_services_updated_by"), ConflictError, "SERVICE_REFERENCE_CONFLICT", 409],
    [pgError("23001"), ConflictError, "SERVICE_REFERENCE_CONFLICT", 409],
    [pgError("23514"), ValidationError, "VALIDATION_ERROR", 400],
    [pgError("55000"), ConflictError, "SERVICE_HISTORY_IMMUTABLE", 409],
    [pgError("40P01"), ConflictError, "SERVICE_CONCURRENT_UPDATE", 409],
  ];
  for (const [error, type, code, status] of cases) {
    const translated = translateServiceCatalogError(error);
    assert.ok(translated instanceof type, code);
    assert.equal(translated.code, code);
    assert.equal(translated.status, status);
    assert.doesNotMatch(translated.publicMessage, /detalle interno/);
  }
  const appError = new AppError({ code: "X", message: "x", status: 418 });
  assert.equal(translateServiceCatalogError(appError), appError);
  const unknown = new Error("desconocido");
  assert.equal(translateServiceCatalogError(unknown), unknown);
});
