/**
 * PROTOTIPO — Indicadores del drawer "Detalles de Solicitud" sin fuente real en el backend.
 *
 * La API todavía no calcula "Viabilidad financiera" ni "Información completada" por
 * solicitud (solo existe el score de compatibilidad). Estos valores fijos únicamente
 * permiten representar el diseño de Figma y se muestran rotulados como dato de ejemplo.
 *
 * Para integrarlos: exponer ambos porcentajes en `GET /project-requests/review-queue`
 * (o en un detalle de solicitud) y reemplazar `getPrototypeRequestIndicators` por la
 * lectura de esos campos en `buildAdminRequestDetails`. No se debe combinar con datos reales.
 */
export const PROTOTYPE_INDICATOR_HINT = "Dato de ejemplo · pendiente de integración";

const PROTOTYPE_REQUEST_INDICATORS = Object.freeze([
  Object.freeze({ id: "financialViability", title: "Viabilidad financiera", value: 95, fillClassName: "bg-[var(--color-success-200)]" }),
  Object.freeze({ id: "informationCompleted", title: "Información completada", value: 100, fillClassName: "bg-[var(--color-success-200)]" }),
]);

// Variante de referencia Figma 3727:677617; no representa métricas calculadas.
const LOW_PROTOTYPE_REQUEST_INDICATORS = Object.freeze([
  Object.freeze({ id: "financialViability", title: "Viabilidad financiera", value: 22, fillClassName: "bg-[var(--color-danger-200)]" }),
  Object.freeze({ id: "informationCompleted", title: "Información completada", value: 61, fillClassName: "bg-[var(--color-warning-200)]" }),
]);

/**
 * Devuelve los indicadores de ejemplo, marcados con `isPrototype` para que la vista
 * los rotule y las pruebas puedan comprobar que no se mezclan con datos reales.
 *
 * @param {string} [level] - Nivel ya clasificado por la API; solo elige la variante del prototipo.
 * @returns {Array<{id: string, title: string, value: number, isPrototype: true}>} Indicadores de ejemplo.
 */
export function getPrototypeRequestIndicators(level) {
  const indicators = level === "low" || level === "poorly_defined"
    ? LOW_PROTOTYPE_REQUEST_INDICATORS : PROTOTYPE_REQUEST_INDICATORS;
  return indicators.map((indicator) => ({ ...indicator, isPrototype: true }));
}
