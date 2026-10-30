import assert from "node:assert/strict";
import test from "node:test";

import { calculateQuotePreview } from "../src/pages/admin-services-quotes/quote-editor/utils/quoteAmounts.js";
import {
  EMPTY_QUOTE_DRAFT,
  addServicesToLines,
  createLineFromService,
  draftFromQuote,
  isQuoteDraftDirty,
  normalizeServerFields,
  toEditableDecimal,
  toQuotePayload,
  validateQuoteDraft,
} from "../src/pages/admin-services-quotes/quote-editor/utils/quoteDraft.js";
import { describeQuoteSubmitError } from "../src/pages/admin-services-quotes/quote-editor/hooks/useQuoteSubmit.js";

const SERVICE = {
  code: "SERV-001",
  description: "Planos y memoria",
  id: 1,
  measurementUnit: { allowsDecimals: true },
  name: "Anteproyecto arquitectónico",
  referenceRate: "14.00",
  unitLabel: "m² de construcción",
};
const POINT_SERVICE = { ...SERVICE, code: "SERV-002", id: 2, measurementUnit: { allowsDecimals: false }, name: "Puntos eléctricos", referenceRate: "45.50" };

test("decimales editables sin ceros sobrantes y conceptos con la tarifa de referencia", () => {
  assert.equal(toEditableDecimal("200.000"), "200");
  assert.equal(toEditableDecimal("12.50"), "12.5");
  assert.equal(toEditableDecimal("100"), "100");
  assert.equal(toEditableDecimal("abc"), "abc");
  assert.deepEqual(createLineFromService(POINT_SERVICE), {
    key: "service-2", quantity: "1", referenceRate: "45.50", serviceCode: "SERV-002", serviceDescription: "Planos y memoria",
    serviceId: 2, serviceName: "Puntos eléctricos", unitAllowsDecimals: false, unitLabel: "m² de construcción", unitRate: "45.5",
  });
});

/// Cada forma de cobro es un servicio independiente con una sola unidad (importes ficticios).
const MODELING_BY_PROJECT = { ...SERVICE, code: "SERV-002", id: 4, measurementUnit: { allowsDecimals: false }, name: "Modelado 3D & Renders — Por proyecto", referenceRate: "320.00", unitLabel: "proy." };
const MODELING_BY_SPACE = { ...MODELING_BY_PROJECT, code: "SERV-020", id: 20, name: "Modelado 3D & Renders — Por espacio", unitLabel: "esp." };
const TOUR_BY_MINUTE = { ...SERVICE, code: "SERV-014", id: 14, measurementUnit: { allowsDecimals: false }, name: "Recorrido Virtual / VR — Por minuto", referenceRate: "275.00", unitLabel: "min" };
const TOUR_BY_PROJECT = { ...TOUR_BY_MINUTE, code: "SERV-021", id: 21, name: "Recorrido Virtual / VR — Por proyecto", unitLabel: "proy." };

test("una unidad por servicio: cada variante es un concepto propio con su unidad y tarifa editable", () => {
  const lines = addServicesToLines([], [MODELING_BY_PROJECT, MODELING_BY_SPACE, TOUR_BY_MINUTE, TOUR_BY_PROJECT]);
  assert.deepEqual(lines.map((line) => [line.serviceId, line.unitLabel, line.referenceRate, line.unitRate]), [
    [4, "proy.", "320.00", "320"], [20, "esp.", "320.00", "320"], [14, "min", "275.00", "275"], [21, "proy.", "275.00", "275"],
  ]);
  // La tarifa aplicada se modifica en la cotización; la de referencia sigue siendo la del tabulador.
  const edited = lines.map((line) => ({ ...line, quantity: line.serviceId === 14 ? "3" : "1", unitRate: line.serviceId === 21 ? "250" : line.unitRate }));
  const preview = calculateQuotePreview(edited);
  assert.deepEqual(preview.lines.map((line) => line.subtotal), ["320.00", "320.00", "825.00", "250.00"]);
  const draft = { client: { id: 3 }, lines: edited, notes: "", project: { id: 9 } };
  assert.deepEqual(validateQuoteDraft(draft, preview), {});
  // El cuerpo no elige unidad: cada servicio tiene la suya.
  assert.deepEqual(toQuotePayload(draft).items.at(-1), { quantity: "1", serviceId: 21, unitRate: "250" });
});

test("agregar servicios: cada servicio una sola vez y en el orden elegido", () => {
  const lines = addServicesToLines([], [SERVICE, POINT_SERVICE]);
  assert.deepEqual(lines.map((line) => line.serviceId), [1, 2]);
  assert.deepEqual(addServicesToLines(lines, [POINT_SERVICE, { ...SERVICE, id: 3 }]).map((line) => line.serviceId), [1, 2, 3]);
});

test("payload: ids, observaciones vacías como null y decimales normalizados", () => {
  const draft = {
    client: { id: 3, name: "Leonel" },
    lines: [{ ...createLineFromService(SERVICE), quantity: " 200,5 ", unitRate: "14" }],
    notes: "   ",
    project: { id: 9, name: "Apto. 910" },
  };
  assert.deepEqual(toQuotePayload(draft), { clientId: 3, items: [{ quantity: "200.5", serviceId: 1, unitRate: "14" }], notes: null, projectId: 9 });
  assert.equal(toQuotePayload({ ...draft, notes: " Visita " }).notes, "Visita");
});

test("validación local con las reglas del backend y errores del servidor sin prefijo", () => {
  const empty = validateQuoteDraft(EMPTY_QUOTE_DRAFT, calculateQuotePreview([]));
  assert.deepEqual(Object.keys(empty).sort(), ["clientId", "items", "projectId"]);
  assert.equal(empty.projectId, "Selecciona primero el cliente.");

  const lines = [{ ...createLineFromService(POINT_SERVICE), quantity: "2.5" }, { ...createLineFromService(SERVICE), quantity: "1", unitRate: "1.001" }];
  const draft = { client: { id: 3 }, lines, notes: "x".repeat(2001), project: { id: 9 } };
  assert.deepEqual(validateQuoteDraft(draft, calculateQuotePreview(lines)), {
    "items.0.quantity": "La unidad de este servicio solo admite cantidades enteras.",
    "items.1.unitRate": "Admite como máximo 2 decimales.",
    notes: "Admite como máximo 2000 caracteres.",
  });

  assert.deepEqual(normalizeServerFields({ "body.items.0.quantity": "A", clientId: "B" }), { clientId: "B", "items.0.quantity": "A" });
  assert.deepEqual(describeQuoteSubmitError({ fields: { "body.notes": "Larga" }, message: "Datos inválidos", status: 400 }), {
    conflict: false, fieldErrors: { notes: "Larga" }, formError: "", notFound: false,
  });
  assert.equal(describeQuoteSubmitError({ code: "QUOTE_VERSION_CONFLICT", message: "Otro administrador…", status: 409 }).conflict, true);
  assert.equal(describeQuoteSubmitError({ code: "NETWORK_ERROR", message: "Sin conexión" }).formError, "Sin conexión");
});

test("edición: borrador desde la cotización guardada y detección de cambios sin guardar", () => {
  const quote = {
    client: { id: 3, name: "Leonel Pérez" },
    items: [{
      quantity: "200.000", referenceRate: "14.00", subtotal: "2800.00", unitRate: "14.00",
      service: { code: "SERV-001", description: null, id: 1, isActive: false, kind: "individual", name: "Anteproyecto", versionId: 10 },
      unit: { allowsDecimals: true, label: "m² de construcción" },
    }],
    notes: null,
    project: { id: 9, name: "Apto. 910" },
  };
  const draft = draftFromQuote(quote);
  assert.equal(draft.lines[0].quantity, "200");
  assert.equal(draft.lines[0].serviceIsActive, false);
  assert.equal(draft.notes, "");
  assert.equal(isQuoteDraftDirty(draft, { ...draft }), false);
  assert.equal(isQuoteDraftDirty(draft, { ...draft, lines: [{ ...draft.lines[0], quantity: "200.0" }] }), false, "200 y 200.0 son el mismo valor");
  assert.equal(isQuoteDraftDirty(draft, { ...draft, notes: "Nota" }), true);
});
