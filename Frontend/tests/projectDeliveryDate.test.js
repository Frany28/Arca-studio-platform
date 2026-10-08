import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_DATE_FALLBACK,
  formatProjectDeliveryDate,
} from "../src/utils/projectDeliveryDate.js";
import { formatEnvironmentDate } from "../src/utils/environmentDate.js";
import { getAdminDashboardPresentation } from "../src/pages/admin-dashboard/utils/adminDashboardMobilePresentation.js";

test("la fecha de entrega conserva el día de @db.Date en cualquier zona horaria", () => {
  // Medianoche UTC: en UTC-4 un formateo local mostraba el 23 de marzo.
  assert.equal(formatProjectDeliveryDate("2026-03-24T00:00:00.000Z"), "24 Mar 2026");
  assert.equal(formatProjectDeliveryDate("2026-03-24"), "24 Mar 2026");
});

test("la fecha de entrega usa el texto de respaldo si falta o no es válida", () => {
  assert.equal(formatProjectDeliveryDate(null), DELIVERY_DATE_FALLBACK);
  assert.equal(formatProjectDeliveryDate(""), DELIVERY_DATE_FALLBACK);
  assert.equal(formatProjectDeliveryDate("no-es-fecha"), DELIVERY_DATE_FALLBACK);
});

test("la fecha del navbar capitaliza día y mes como en Figma", () => {
  assert.equal(formatEnvironmentDate(new Date(2026, 2, 23)), "Lunes, 23 de Marzo");
  assert.equal(formatEnvironmentDate(new Date(2026, 9, 8)), "Jueves, 8 de Octubre");
});

test("la escala móvil del dashboard solo cambia tamaños por debajo de 768 px", () => {
  assert.deepEqual(getAdminDashboardPresentation(false), {
    iconButtonSize: "S",
    textButtonSize: "S",
    textButtonClassName: undefined,
    tagSize: "S",
    tagClassName: undefined,
  });
  const mobile = getAdminDashboardPresentation(true);
  assert.equal(mobile.iconButtonSize, "M");
  assert.equal(mobile.tagSize, "L");
  assert.equal(getAdminDashboardPresentation(true), mobile, "La presentación es estable entre renders");
});
