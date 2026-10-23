import assert from "node:assert/strict";
import test from "node:test";

import { describeMeasurementUnitError } from "../src/pages/admin-services-quotes/measurement-units/utils/measurementUnitErrors.js";
import {
  describeMeasurementUnitStatusConfirmation,
  describeMeasurementUnitSuccess,
} from "../src/pages/admin-services-quotes/measurement-units/utils/measurementUnitFeedback.js";
import { formatMeasurementUnitIdentity } from "../src/pages/admin-services-quotes/measurement-units/utils/measurementUnitPresentation.js";

const UNIT = Object.freeze({ publicCode: "UNID-007", label: "m² de construcción" });

test("confirmación: variantes de Servicios con textos de Unidades y su identidad, sin afirmar eliminación", () => {
  assert.deepEqual(describeMeasurementUnitStatusConfirmation({ denomination: UNIT, isActive: false }), {
    activating: false,
    actionLabel: "Desactivar",
    title: "¿Desactivar unidad de medida?",
    description: "Esta unidad dejará de estar disponible para nuevas asignaciones. Podrás activarla nuevamente",
    detail: "UNID-007 · m² de construcción",
  });
  const activation = describeMeasurementUnitStatusConfirmation({ denomination: UNIT, isActive: true });
  assert.deepEqual([activation.activating, activation.actionLabel, activation.title, activation.description],
    [true, "Activar", "¿Activar unidad de medida?", "Esta unidad volverá a estar disponible para nuevas asignaciones"]);
  assert.doesNotMatch(JSON.stringify(activation), /elimina/i);
});

test("identidad: solo datos de la API, sin códigos inventados", () => {
  assert.equal(formatMeasurementUnitIdentity(UNIT), "UNID-007 · m² de construcción");
  assert.equal(formatMeasurementUnitIdentity({ label: "m² de obra" }), "m² de obra");
  assert.equal(formatMeasurementUnitIdentity(null), "");
});

test("avisos de éxito: título, identidad devuelta por la API y consecuencia de cada operación", () => {
  const cases = {
    create: ["Unidad creada correctamente", "Ya está disponible para asignarla a servicios"],
    update: ["Unidad actualizada correctamente", ""],
    unchanged: ["Sin cambios", ""],
    activate: ["Unidad activada correctamente", "Vuelve a estar disponible para nuevas asignaciones"],
    deactivate: ["Unidad desactivada correctamente", "Ya no está disponible para nuevas asignaciones"],
  };
  for (const [operation, [title, message]] of Object.entries(cases)) {
    assert.deepEqual(describeMeasurementUnitSuccess(operation, UNIT), { tone: "success", title, message, content: "UNID-007 · m² de construcción" });
  }
});

test("avisos de error: cada código real con su motivo; solo la unicidad es un duplicado", () => {
  const inUse = { status: 409, code: "MEASUREMENT_UNIT_IN_USE", message: "La denominación está asignada a 2 servicio(s) activo(s). Crea otra denominación y reasigna esos servicios." };
  assert.deepEqual(
    [describeMeasurementUnitError(inUse, "deactivate").title, describeMeasurementUnitError(inUse, "deactivate").message],
    ["No se pudo desactivar la unidad", "Está siendo utilizada por servicios activos"],
  );
  // Al editar el texto se conserva la alternativa real que ofrece el backend.
  assert.equal(describeMeasurementUnitError(inUse, "update").message, inUse.message);

  const duplicate = describeMeasurementUnitError({ status: 409, code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", message: "Ya existe." }, "create");
  assert.deepEqual([duplicate.title, duplicate.message, duplicate.fieldErrors],
    ["Esta unidad ya existe", "Ya hay una denominación equivalente para la unidad base seleccionada", { denomination: "Ya hay una denominación equivalente para la unidad base seleccionada" }]);

  for (const code of ["MEASUREMENT_UNIT_CONCURRENT_UPDATE", "MEASUREMENT_UNIT_CONFLICT", "MEASUREMENT_UNIT_REFERENCE_CONFLICT"]) {
    const conflict = describeMeasurementUnitError({ status: 409, code, message: "Conflicto." }, "update");
    assert.deepEqual([conflict.title, conflict.message], ["No se pudo actualizar la unidad", "La información cambió. Actualiza el listado e inténtalo nuevamente"], code);
  }
  // La base en uso no es un duplicado: conserva su motivo junto a la abreviatura.
  const baseInUse = describeMeasurementUnitError({ status: 409, code: "MEASUREMENT_UNIT_BASE_IN_USE", message: "La unidad base no se puede cambiar." }, "update");
  assert.deepEqual([baseInUse.title, baseInUse.baseUnitLocked, baseInUse.fieldErrors], ["No se pudo actualizar la unidad", true, { measurementUnitId: "La unidad base no se puede cambiar." }]);

  const network = describeMeasurementUnitError({ code: "NETWORK_ERROR", message: "No pudimos conectarnos con el servidor." }, "activate");
  assert.deepEqual([network.title, network.message], ["No se pudo completar la operación", "Comprueba tu conexión e inténtalo nuevamente"]);

  const validation = describeMeasurementUnitError({ status: 400, code: "VALIDATION_ERROR", message: "Datos inválidos.", fields: { measurementUnitId: "La unidad de medida está inactiva." } }, "activate");
  assert.deepEqual([validation.title, validation.message], ["No se pudo activar la unidad", "La unidad de medida está inactiva."]);
  // En el formulario el detalle queda junto al campo y el mensaje general no lo repite.
  assert.equal(describeMeasurementUnitError({ status: 400, code: "VALIDATION_ERROR", fields: { "body.denomination": "Escribe el nombre." } }, "create").message, "Revisa los datos marcados.");

  assert.equal(describeMeasurementUnitError({ status: 404, code: "MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND" }, "update").shouldReload, true);
  assert.match(describeMeasurementUnitError({ status: 429, code: "RATE_LIMITED" }, "deactivate").message, /demasiados cambios/);
  // Un error sin texto útil no repite el título en la descripción ni expone detalles técnicos.
  const unexpected = describeMeasurementUnitError({ status: 500, message: "Internal Server Error" }, "create");
  assert.equal(unexpected.title, "No se pudo crear la unidad");
  assert.notEqual(unexpected.message, unexpected.title);
  assert.doesNotMatch(unexpected.message, /Internal/);
});
