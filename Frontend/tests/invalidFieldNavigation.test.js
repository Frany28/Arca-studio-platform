import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compareVisualOrder,
  computeScrollDelta,
  findFirstInvalidField,
  focusFirstInvalidField,
  isInvalidFieldNavigationFocus,
  resolveScrollBehavior,
} from "../src/utils/invalidFieldNavigation.js";

const box = (top, height, left = 0, width = 100) => ({ bottom: top + height, left, right: left + width, top });

test("orden visual: filas de arriba abajo y, en la misma fila, según la dirección del texto", () => {
  assert.ok(compareVisualOrder(box(0, 40), box(100, 40)) < 0, "La fila superior va primero");
  // Rejilla de dos columnas con etiquetas de distinta altura: misma fila aunque la caja derecha empiece antes.
  assert.ok(compareVisualOrder(box(10, 60, 0), box(0, 60, 300)) < 0, "En la misma fila, la izquierda primero");
  assert.ok(compareVisualOrder(box(10, 60, 0), box(0, 60, 300), true) > 0, "En RTL, la derecha primero");
  assert.ok(compareVisualOrder(box(0, 40), box(30, 40)) < 0, "Un solape pequeño no comparte fila");
});

test("desplazamiento: nada si ya se ve, centra si cabe y alinea el inicio si no cabe", () => {
  const view = { maxScroll: 3000, scrollPosition: 1000, viewEnd: 800, viewStart: 0 };
  assert.equal(computeScrollDelta({ ...view, end: 300, start: 200 }), 0, "Visible: sin desplazamiento");
  assert.equal(computeScrollDelta({ ...view, end: -300, start: -400 }), -750, "Fuera por arriba: se centra");
  assert.equal(computeScrollDelta({ ...view, end: 1300, start: 1200 }), 850, "Fuera por abajo: se centra");
  assert.equal(computeScrollDelta({ ...view, end: 2000, start: 900 }), 900, "Más alto que el área: alinea el inicio");
  assert.equal(computeScrollDelta({ ...view, end: -1900, start: -2000 }), -1000, "No pasa del inicio del scroll");
  assert.equal(computeScrollDelta({ ...view, end: 2600, start: 2500 }), 2000, "No pasa del final del scroll");
  assert.equal(computeScrollDelta({ ...view, end: 950, start: 850, viewStart: 100, viewEnd: 800 }) > 0, true, "Respeta el scroll-padding del área");
});

test("movimiento reducido: inmediato con reduce y suave en otro caso", () => {
  const view = (matches) => ({ matchMedia: (query) => ({ matches: matches && query === "(prefers-reduced-motion: reduce)" }) });
  assert.equal(resolveScrollBehavior(view(true)), "auto");
  assert.equal(resolveScrollBehavior(view(false)), "smooth");
  assert.equal(resolveScrollBehavior({}), "smooth", "Sin matchMedia no falla");
});

test("sin contenedor o sin campos inválidos no navega", () => {
  assert.equal(findFirstInvalidField(null), null);
  assert.equal(focusFirstInvalidField(undefined), null);
  assert.equal(focusFirstInvalidField({ querySelectorAll: () => [] }), null);
  assert.equal(isInvalidFieldNavigationFocus(null), false);
});

test("los formularios integrados navegan solo tras intentar enviar, no al escribir", async () => {
  const consumers = [
    "../src/pages/admin-services-quotes/quote-editor/components/QuoteEditorForm.jsx",
    "../src/pages/admin-services-quotes/service-catalog/components/ServiceFormDialog.jsx",
    "../src/pages/admin-services-quotes/measurement-units/components/MeasurementUnitFormModal.jsx",
    "../src/pages/admin-users/CreateAdminUserModal.jsx",
    "../src/pages/ProjectRequestPage.jsx",
    "../src/components/project-requests/ProjectRequestWorkflowModal.jsx",
    "../src/pages/auth/CreateAccount.jsx",
  ];
  for (const path of consumers) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /useInvalidFieldFocus\(\{ getContainer:/, `${path} usa el hook compartido`);
    assert.doesNotMatch(source, /onChange=\{[^}]*focusInvalidField/, `${path} no navega en onChange`);
    assert.doesNotMatch(source, /scrollIntoView\(\{ behavior: "smooth"/, `${path} no duplica la navegación`);
  }
});
