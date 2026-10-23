import { filterBaseOptionsForKind } from "./serviceFormValues.js";

/**
 * Construye el mismo catálogo seleccionable para Crear y Editar: bases activas permitidas
 * que tienen denominaciones activas registradas. La referencia histórica se muestra aparte;
 * nunca se incorpora al catálogo como si fuera una nueva asignación válida.
 *
 * @param {Array<Object>} baseOptions - Opciones de bases activas obtenidas de la API.
 * @param {Array<Object>} denominations - Denominaciones registradas.
 * @param {string} kind - Modalidad actual del borrador.
 * @returns {{prefixOptions: Array<Object>, denominations: Array<Object>}} Opciones de nuevas asignaciones.
 */
export function getServiceUnitCatalog(baseOptions, denominations, kind) {
  const bases = filterBaseOptionsForKind(baseOptions, kind).filter((base) => base.isActive !== false);
  const baseIds = new Set(bases.map((base) => base.id));
  const selectable = (denominations || []).filter((item) => item.isActive !== false
    && item.measurementUnit?.isActive !== false && baseIds.has(item.measurementUnit?.id));
  const registeredBaseIds = new Set(selectable.map((item) => item.measurementUnit.id));
  return { prefixOptions: bases.filter((base) => registeredBaseIds.has(base.id)), denominations: selectable };
}

/**
 * Reconoce la combinación guardada por sus identificadores, incluida una base sin denominación.
 * Permite conservar referencias históricas sin exigir que vuelvan a estar disponibles en el catálogo.
 *
 * @param {Object} draft - Borrador actual.
 * @param {Object|null} service - Servicio original leído por GET.
 * @returns {boolean} La base y denominación conservan sus identificadores originales.
 */
export function preservesServiceUnit(draft, service) {
  return Boolean(service && draft.measurementUnitId === service.measurementUnit.id
    && (draft.unitDenomination?.id ?? null) === (service.unitDenomination?.id ?? null));
}
