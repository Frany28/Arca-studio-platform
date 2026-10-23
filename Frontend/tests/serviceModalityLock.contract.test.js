import test from "node:test";

// Contrato del formulario para la regla «un servicio usado en una cotización guardada no cambia de
// modalidad» (SERVICE_MODALITY_IN_USE, Backend/ARCHITECTURE.md). Pendiente: aún no existen
// cotizaciones persistidas ni un dato real de uso, así que el formulario no muestra ningún bloqueo.
// Estos casos se convertirán en pruebas de navegador (tests/browser/adminServiceForm.test.js)
// cuando el detalle del servicio exponga el uso y el backend devuelva el 409.
const PENDING = "Pendiente: sin cotizaciones persistidas no hay un dato real que respalde el bloqueo.";

for (const scenario of [
  "edición de un servicio usado en cotizaciones: «Modalidad de Contratación» muestra el valor actual, deshabilitada y con el motivo",
  "409 SERVICE_MODALITY_IN_USE al guardar: el error se muestra en la modalidad y el borrador se conserva",
  "servicio sin cotizaciones: la modalidad sigue editable",
]) {
  test(`pendiente: ${scenario}`, { todo: PENDING }, () => {});
}
