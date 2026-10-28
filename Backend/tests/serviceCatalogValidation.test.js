import assert from "node:assert/strict";
import test from "node:test";

import {
  formatGeneratedServiceCode,
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

const VALID_CREATE = { measurementUnitId: 1, name: " Anteproyecto ", referenceRate: "12" };
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

test("alta: normaliza nombre y tarifa y aplica valores por defecto (modalidad individual si se omite)", () => {
  const result = serviceCreateSchema.safeParse({ body: VALID_CREATE });
  assert.equal(result.success, true);
  // Sin código (lo genera el servicio) y, por compatibilidad con clientes previos, `individual`.
  assert.deepEqual(result.data.body, {
    changeNote: null, isActive: true, kind: "individual", measurementUnitId: 1, name: "Anteproyecto", referenceRate: "12.00", sortOrder: 0,
  });
  const described = serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, referenceRate: 900.5, description: "  " } });
  assert.equal(described.data.body.referenceRate, "900.50");
  assert.equal(described.data.body.description, null);
});

test("alta: el cliente no puede fijar el código", () => {
  for (const value of ["SERV-001", "MANUAL"]) {
    const result = serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, code: value } });
    assert.deepEqual(errorPaths(result), ["body.code"], value);
    assert.equal(result.error.issues[0].message, "El código del servicio lo genera el sistema.");
  }
  // Aunque la modalidad sea válida, el código sigue rechazándose.
  const withKind = serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, code: "X", kind: "turnkey" } });
  assert.deepEqual(errorPaths(withKind), ["body.code"]);
});

test("alta: la modalidad admite solo individual y turnkey", () => {
  for (const kind of ["individual", "turnkey"]) {
    const result = serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, kind } });
    assert.equal(result.data.body.kind, kind);
  }
  // La modalidad no restringe la unidad: el esquema acepta llave en mano con cualquier base.
  assert.equal(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, kind: "turnkey", measurementUnitId: 6 } }).success, true);
  for (const kind of ["", "Turnkey", "llave en mano", "bundle", null, 1, ["turnkey"]]) {
    const result = serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, kind } });
    assert.deepEqual(errorPaths(result), ["body.kind"], JSON.stringify(kind));
    assert.equal(result.error.issues[0].message, "Elige una modalidad de contratación válida: individual o llave en mano.");
  }
});

test("dominio: el código generado es SERV- y el id con al menos tres dígitos", () => {
  assert.equal(formatGeneratedServiceCode(1), "SERV-001");
  assert.equal(formatGeneratedServiceCode(42), "SERV-042");
  assert.equal(formatGeneratedServiceCode(1000), "SERV-1000");
  assert.match(formatGeneratedServiceCode(123456), /^[A-Z0-9]+([_-][A-Z0-9]+)*$/, "Cumple chk_services_code");
  for (const invalid of [0, -1, 1.5, Number.NaN, "7"]) {
    assert.throws(() => formatGeneratedServiceCode(invalid), TypeError, String(invalid));
  }
});

test("alta: rechaza campos obligatorios, longitudes y campos no editables", () => {
  for (const field of ["measurementUnitId", "name", "referenceRate"]) {
    const body = { ...VALID_CREATE };
    delete body[field];
    assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body })), [`body.${field}`], field);
  }
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, name: "x".repeat(151) } })), ["body.name"]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...VALID_CREATE, description: "x".repeat(2001) } })), ["body.description"]);
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

test("dominio: detecta solo cambios efectivos en los campos versionados", () => {
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, {})), []);
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { name: "Anteproyecto", referenceRate: "12.00" })), []);
  // Con una sola unidad, su tarifa es la del servicio: cambiarla cambia también `unitOptions`.
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { referenceRate: "15.50", isActive: false })), ["unitOptions", "referenceRate", "isActive"]);
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { description: "Nueva" })), ["description"]);
  assert.deepEqual(listChangedServiceFields({ ...CURRENT, description: "Algo" }, mergeServiceChanges({ ...CURRENT, description: "Algo" }, { description: null })), ["description"]);
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { measurementUnitId: 2, kind: "turnkey" })), ["kind", "measurementUnitId", "unitOptions"]);
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
