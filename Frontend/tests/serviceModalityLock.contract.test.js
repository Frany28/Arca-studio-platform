import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_MODALITY_LOCKED_MESSAGE,
  getServiceFormErrorFeedback,
} from "../src/pages/admin-services-quotes/service-catalog/utils/serviceCatalogErrors.js";

// Contrato del formulario para la regla «un servicio usado en una cotización guardada no cambia de
// modalidad» (SERVICE_MODALITY_IN_USE, Backend/ARCHITECTURE.md). Activa desde que existen
// cotizaciones: el detalle del servicio expone `kindLocked` y el backend responde 409. El
// comportamiento visual (campo bloqueado con el motivo) se comprueba en
// tests/browser/adminServiceForm.test.js.

test("409 SERVICE_MODALITY_IN_USE: el motivo se muestra en la modalidad y el formulario no se recarga", () => {
  const feedback = getServiceFormErrorFeedback({
    code: "SERVICE_MODALITY_IN_USE",
    message: "La modalidad no se puede modificar porque este servicio ya está incluido en una cotización.",
    status: 409,
  }, "No se pudo guardar el servicio.");
  assert.deepEqual(feedback.fieldErrors, { kind: SERVICE_MODALITY_LOCKED_MESSAGE });
  assert.equal(feedback.shouldReload, false, "El borrador se conserva: no es un conflicto de versión");
  assert.equal(feedback.notFound, false);
});

test("el motivo del bloqueo coincide con el mensaje del backend", () => {
  assert.equal(SERVICE_MODALITY_LOCKED_MESSAGE, "La modalidad no se puede modificar porque este servicio ya está incluido en una cotización.");
  // Sin mensaje del servidor (p. ej. respuesta truncada) se usa el mismo texto.
  assert.deepEqual(getServiceFormErrorFeedback({ code: "SERVICE_MODALITY_IN_USE", status: 409 }, "x").fieldErrors, { kind: SERVICE_MODALITY_LOCKED_MESSAGE });
});

test("un conflicto de versión sigue recargando el listado y no se confunde con la modalidad", () => {
  const feedback = getServiceFormErrorFeedback({ code: "SERVICE_VERSION_CONFLICT", status: 409 }, "x");
  assert.equal(feedback.shouldReload, true);
  assert.deepEqual(feedback.fieldErrors, {});
});
