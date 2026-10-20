import assert from "node:assert/strict";
import test from "node:test";

import { formatUnitLabel, normalizeUnitText } from "../src/domain/measurementUnitLabel.js";
import { listChangedServiceFields, mergeServiceChanges } from "../src/domain/serviceCatalog.js";
import { AppError, ConflictError, ValidationError } from "../src/errors/appError.js";
import { translateMeasurementUnitError } from "../src/services/measurementUnitErrors.js";
import { translateServiceCatalogError } from "../src/services/serviceCatalogErrors.js";
import { encodeCursor } from "../src/utils/pagination.js";
import {
  denominationCreateSchema,
  denominationListSchema,
  denominationStatusSchema,
  denominationUpdateSchema,
  measurementUnitListSchema,
} from "../src/validation/measurementUnitSchemas.js";
import { serviceCreateSchema, serviceListSchema, serviceUpdateSchema } from "../src/validation/serviceCatalogSchemas.js";

/**
 * Devuelve las rutas de campo con error de un resultado de Zod.
 *
 * @param {object} result - Resultado de safeParse.
 * @returns {Array<string>} Rutas con error.
 */
function errorPaths(result) {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

test("formatUnitLabel compone abreviatura y denominación de forma consistente", () => {
  assert.equal(formatUnitLabel("m²", "de construcción"), "m² de construcción");
  assert.equal(formatUnitLabel("m²", "de recorrido comercial"), "m² de recorrido comercial");
  assert.equal(formatUnitLabel("m.l.", "de canalización"), "m.l. de canalización");
  assert.equal(formatUnitLabel("pt.", "eléctrico"), "pt. eléctrico");
  assert.equal(formatUnitLabel("hrs", "de supervisión"), "hrs de supervisión");
  // Sin denominación, solo la abreviatura; sin espacios duplicados ni sobrantes.
  assert.equal(formatUnitLabel("glb."), "glb.");
  assert.equal(formatUnitLabel("glb.", null), "glb.");
  assert.equal(formatUnitLabel("glb.", "   "), "glb.");
  assert.equal(formatUnitLabel(" m² ", "  de   construcción \n"), "m² de construcción");
  assert.throws(() => formatUnitLabel("", "de construcción"), TypeError);
  assert.throws(() => formatUnitLabel(null), TypeError);
});

test("normalizeUnitText aplica NFC, recorta y colapsa espacios", () => {
  // "é" descompuesta (e + acento combinante) se compone en NFC.
  assert.equal(normalizeUnitText("eléctrico"), "eléctrico");
  assert.equal(normalizeUnitText("\tde   obra  "), "de obra");
  assert.equal(normalizeUnitText(undefined), "");
});

test("denominaciones: alta normaliza el texto y exige una unidad base", () => {
  const result = denominationCreateSchema.safeParse({ body: { denomination: "  de   construcción ", measurementUnitId: "1" } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body, { denomination: "de construcción", measurementUnitId: 1 });
  assert.deepEqual(errorPaths(denominationCreateSchema.safeParse({ body: { denomination: "x" } })), ["body.measurementUnitId"]);
  for (const denomination of ["", "   ", "x".repeat(81), "de\u0007obra", undefined, 12]) {
    assert.deepEqual(errorPaths(denominationCreateSchema.safeParse({ body: { denomination, measurementUnitId: 1 } })), ["body.denomination"], String(denomination));
  }
  assert.equal(denominationCreateSchema.safeParse({ body: { denomination: "x".repeat(80), measurementUnitId: 1 } }).success, true);
  assert.equal(denominationCreateSchema.safeParse({ body: { denomination: "x", measurementUnitId: 1, isActive: false } }).success, false);
  // El código público lo genera PostgreSQL: ningún cliente puede enviarlo ni modificarlo.
  for (const publicCode of ["UNID-001", "UNID-999999", null]) {
    assert.equal(denominationCreateSchema.safeParse({ body: { denomination: "x", measurementUnitId: 1, publicCode } }).success, false);
    assert.equal(denominationUpdateSchema.safeParse({ params: { denominationId: "1" }, body: { denomination: "x", publicCode } }).success, false);
    assert.equal(denominationStatusSchema.safeParse({ params: { denominationId: "1" }, body: { isActive: true, publicCode } }).success, false);
  }
  assert.equal(denominationListSchema.safeParse({ query: { search: "UNID-001" } }).data.query.search, "UNID-001");
});

test("denominaciones: la edición no permite cambiar la unidad base; estado exige booleano", () => {
  const params = { denominationId: "7" };
  assert.deepEqual(denominationUpdateSchema.safeParse({ params, body: { denomination: "de obra" } }).data, { params: { denominationId: 7 }, body: { denomination: "de obra" } });
  assert.equal(denominationUpdateSchema.safeParse({ params, body: { denomination: "de obra", measurementUnitId: 2 } }).success, false);
  assert.deepEqual(errorPaths(denominationUpdateSchema.safeParse({ params, body: {} })), ["body.denomination"]);
  assert.equal(denominationStatusSchema.safeParse({ params, body: { isActive: false } }).success, true);
  assert.deepEqual(errorPaths(denominationStatusSchema.safeParse({ params, body: { isActive: "false" } })), ["body.isActive"]);
  assert.deepEqual(errorPaths(denominationStatusSchema.safeParse({ params: { denominationId: "0" }, body: { isActive: true } })), ["params.denominationId"]);
});

test("listados: unidades base con inactivas explícitas; denominaciones con filtros y cursor", () => {
  assert.equal(measurementUnitListSchema.safeParse({ query: {} }).data.query.includeInactive, false);
  assert.equal(measurementUnitListSchema.safeParse({ query: { includeInactive: "true" } }).data.query.includeInactive, true);
  assert.equal(measurementUnitListSchema.safeParse({ query: { includeInactive: "1" } }).success, false);

  const valid = denominationListSchema.safeParse({ query: {
    cursor: encodeCursor([1, "de obra", "9"]), limit: "20", measurementUnitId: "1", search: " obra ", status: "active",
  } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.query.search, "obra");
  for (const query of [{ cursor: encodeCursor([1, "9"]) }, { cursor: encodeCursor(["1", "x", "9"]) }, { cursor: encodeCursor([1, 5, "9"]) },
    { limit: "101" }, { status: "deleted" }, { measurementUnitId: "-1" }]) {
    assert.equal(denominationListSchema.safeParse({ query }).success, false, JSON.stringify(query));
  }
});

test("servicios: unitDenominationId es opcional, admite null y cuenta como campo editable", () => {
  const base = { code: "ANTEPROYECTO", kind: "individual", measurementUnitId: 1, name: "Anteproyecto", referenceRate: "12" };
  assert.equal(serviceCreateSchema.safeParse({ body: base }).data.body.unitDenominationId, undefined);
  assert.equal(serviceCreateSchema.safeParse({ body: { ...base, unitDenominationId: 7 } }).data.body.unitDenominationId, 7);
  assert.equal(serviceCreateSchema.safeParse({ body: { ...base, unitDenominationId: null } }).data.body.unitDenominationId, null);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...base, unitDenominationId: "7" } })), ["body.unitDenominationId"]);
  const update = serviceUpdateSchema.safeParse({ params: { serviceId: "1" }, body: { expectedVersion: 1, unitDenominationId: null } });
  assert.equal(update.success, true);
  assert.equal(serviceListSchema.safeParse({ query: { unitDenominationId: "7" } }).data.query.unitDenominationId, 7);

  const current = { description: null, isActive: true, kind: "turnkey", measurementUnit: { id: 1 }, name: "Llave", referenceRate: "900.00", sortOrder: 1, unitDenomination: { id: 7 } };
  assert.deepEqual(listChangedServiceFields(current, mergeServiceChanges(current, {})), []);
  assert.deepEqual(listChangedServiceFields(current, mergeServiceChanges(current, { unitDenominationId: 7 })), []);
  assert.deepEqual(listChangedServiceFields(current, mergeServiceChanges(current, { unitDenominationId: 8 })), ["unitDenominationId"]);
  assert.deepEqual(listChangedServiceFields(current, mergeServiceChanges(current, { unitDenominationId: null })), ["unitDenominationId"]);
});

test("errores de PostgreSQL de unidades y servicios se traducen sin detalles internos", () => {
  const pgError = (code, constraint) => Object.assign(new Error(`detalle interno ${code}`), { code, constraint });
  const cases = [
    [translateMeasurementUnitError, pgError("23505", "uq_measurement_unit_denominations_key"), ConflictError, "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS"],
    [translateMeasurementUnitError, pgError("23503", "fk_measurement_unit_denominations_unit"), ValidationError, "VALIDATION_ERROR"],
    [translateMeasurementUnitError, pgError("23503", "fk_measurement_unit_denominations_updated_by"), ConflictError, "MEASUREMENT_UNIT_REFERENCE_CONFLICT"],
    [translateMeasurementUnitError, pgError("23001"), ConflictError, "MEASUREMENT_UNIT_REFERENCE_CONFLICT"],
    [translateMeasurementUnitError, pgError("55000"), ConflictError, "MEASUREMENT_UNIT_BASE_IMMUTABLE"],
    [translateMeasurementUnitError, pgError("428C9"), ConflictError, "MEASUREMENT_UNIT_PUBLIC_CODE_IMMUTABLE"],
    [translateMeasurementUnitError, pgError("23505", "uq_measurement_unit_denominations_public_code"), ConflictError, "MEASUREMENT_UNIT_CONFLICT"],
    [translateMeasurementUnitError, pgError("23514"), ValidationError, "VALIDATION_ERROR"],
    [translateMeasurementUnitError, pgError("40001"), ConflictError, "MEASUREMENT_UNIT_CONCURRENT_UPDATE"],
    [translateServiceCatalogError, pgError("23503", "fk_services_unit_denomination"), ValidationError, "VALIDATION_ERROR"],
    [translateServiceCatalogError, pgError("23503", "fk_service_versions_unit_denomination"), ValidationError, "VALIDATION_ERROR"],
  ];
  for (const [translate, error, type, code] of cases) {
    const translated = translate(error);
    assert.ok(translated instanceof type, code);
    assert.equal(translated.code, code);
    assert.doesNotMatch(translated.publicMessage, /detalle interno/);
  }
  assert.ok("unitDenominationId" in translateServiceCatalogError(pgError("23503", "fk_services_unit_denomination")).fields);
  const appError = new AppError({ code: "X", message: "x", status: 418 });
  assert.equal(translateMeasurementUnitError(appError), appError);
});
