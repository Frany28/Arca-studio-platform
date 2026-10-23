import assert from "node:assert/strict";
import test from "node:test";

import { describeServiceStatusConfirmation } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceStatusConfirmation.js";

for (const isActive of [true, false]) {
  const action = isActive ? "Activar" : "Desactivar";
  test(`confirmación ${action}: singular desde menú o selección de un servicio`, () => {
    for (const change of [{ isActive, service: { id: 1 } }, { isActive, services: [{ id: 1 }] }]) {
      assert.deepEqual(describeServiceStatusConfirmation(change), {
        title: `¿${action} servicio?`,
        description: `Este servicio ${isActive ? "volverá a estar disponible" : "dejará de estar disponible"} para nuevas cotizaciones`,
        actionLabel: action,
        actionTheme: isActive ? "Success" : "Danger",
      });
    }
  });

  test(`confirmación ${action}: plural con la cantidad completa, sin modificar servicios`, () => {
    const services = Object.freeze(Array.from({ length: 10 }, (_, id) => Object.freeze({ id, isActive: !isActive, currentVersion: 3 })));
    assert.deepEqual(describeServiceStatusConfirmation({ isActive, services }), {
      title: `¿${action} servicios?`,
      description: `Los 10 servicios seleccionados ${isActive ? "volverán a estar disponibles" : "dejarán de estar disponibles"} para nuevas cotizaciones`,
      actionLabel: action,
      actionTheme: isActive ? "Success" : "Danger",
    });
    assert.ok(services.every((service) => service.isActive === !isActive && service.currentVersion === 3));
  });
}
