import assert from "node:assert/strict";
import test from "node:test";

import { describeServiceStatusSuccess } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceStatusFeedback.js";

for (const isActive of [true, false]) {
  const state = isActive ? "activado" : "desactivado";
  test(`resultado ${state}: nombre de la API separado de la consecuencia, sin código público`, () => {
    const service = Object.freeze({ name: "Arquitectura " + "extendida ".repeat(30), code: "CODIGO".repeat(80) });
    const result = describeServiceStatusSuccess({ isActive, service });
    assert.deepEqual(result, {
      tone: "success",
      title: `Servicio ${state} correctamente`,
      content: service.name,
      message: `${isActive ? "Vuelve a estar disponible" : "Ya no está disponible"} para nuevas cotizaciones`,
    });
    assert.equal(JSON.stringify(result).includes(service.code), false);
  });

  test(`resultado ${state}: cantidad real en plural sin nombres de ejemplo`, () => {
    assert.deepEqual(describeServiceStatusSuccess({ isActive, count: 7 }), {
      tone: "success",
      title: `Servicios ${state}s correctamente`,
      message: `Se ${isActive ? "activaron" : "desactivaron"} 7 servicios`,
    });
  });
}
