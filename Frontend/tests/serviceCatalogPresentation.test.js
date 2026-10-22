import assert from "node:assert/strict";
import test from "node:test";

import { getServiceStatusErrorFeedback } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceCatalogErrors.js";
import {
  buildUnitFilterItems,
  formatReferenceRate,
  getServiceDescription,
  getServiceStatusBadge,
} from "../src/pages/admin-services-quotes/service-catalog/utils/serviceCatalogPresentation.js";

const M2 = { id: 1, symbol: "m²" };
const ML = { id: 6, symbol: "m.l." };

test("tarifa: texto decimal sin convertir a Number, céntimos solo si no son cero y miles agrupados", () => {
  assert.equal(formatReferenceRate("12.00"), "$12");
  assert.equal(formatReferenceRate("12.5"), "$12.50");
  assert.equal(formatReferenceRate("0.05"), "$0.05");
  assert.equal(formatReferenceRate("1250.50"), "$1,250.50");
  // 12 enteros (máximo del contrato) sin pérdida de precisión ni redondeo.
  assert.equal(formatReferenceRate("999999999999.99"), "$999,999,999,999.99");
  assert.equal(formatReferenceRate("12.00", "EUR"), "EUR 12");
  // Un formato inesperado se muestra tal cual en lugar de inventar una cifra.
  assert.equal(formatReferenceRate("12,00"), "$12,00");
  assert.equal(formatReferenceRate(null), "—");
});

test("descripción y estado: sin texto real no hay tooltip; el estado solo depende de isActive", () => {
  assert.equal(getServiceDescription({ description: "  Texto  " }), "Texto");
  assert.equal(getServiceDescription({ description: "   " }), "");
  assert.equal(getServiceDescription({ description: null }), "");
  assert.deepEqual(getServiceStatusBadge({ isActive: true }), { label: "Activo", theme: "Success" });
  assert.deepEqual(getServiceStatusBadge({ isActive: false }), { label: "Inactivo", theme: "Disabled" });
});

test("filtro por unidad: solo unidades usadas, base excluyente con sus denominaciones y sin duplicados", () => {
  const items = buildUnitFilterItems([
    { measurementUnit: M2, unitDenomination: { id: 11, denomination: "a intervenir" }, unitLabel: "m² a intervenir" },
    { measurementUnit: M2, unitDenomination: { id: 10, denomination: "de construcción" }, unitLabel: "m² de construcción" },
    { measurementUnit: M2, unitDenomination: { id: 11, denomination: "a intervenir" }, unitLabel: "m² a intervenir" },
    { measurementUnit: ML, unitDenomination: null, unitLabel: "m.l." },
  ]);
  assert.deepEqual(items.map((item) => [item.label, item.filter]), [
    ["m.l.", { name: "measurementUnitId", value: 6 }],
    ["m² · todas", { name: "measurementUnitId", value: 1 }],
    ["m² a intervenir", { name: "unitDenominationId", value: 11 }],
    ["m² de construcción", { name: "unitDenominationId", value: 10 }],
  ]);
  assert.deepEqual(buildUnitFilterItems([]), []);
});

test("errores de estado: mensajes comprensibles y recarga ante versión desactualizada o inexistente", () => {
  assert.deepEqual(getServiceStatusErrorFeedback({ code: "SERVICE_VERSION_CONFLICT", status: 409 }, "x").shouldReload, true);
  assert.equal(getServiceStatusErrorFeedback({ status: 404 }, "x").shouldReload, true);
  assert.match(getServiceStatusErrorFeedback({ code: "VALIDATION_ERROR", status: 400, fields: { "body.measurementUnitId": "inactiva" } }, "x").message, /unidad base está inactiva/);
  assert.match(getServiceStatusErrorFeedback({ code: "VALIDATION_ERROR", status: 400, fields: { unitDenominationId: "inactiva" } }, "x").message, /unidad de medida está inactiva/);
  assert.equal(getServiceStatusErrorFeedback({ status: 403 }, "x").message, "No tienes permisos para gestionar el tabulador de servicios.");
  assert.equal(getServiceStatusErrorFeedback({ status: 429 }, "x").shouldReload, false);
});
