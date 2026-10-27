/**
 * Badge de la columna «Estado» de las tablas del módulo (Servicios y Unidades de medida): solo
 * depende de `isActive` de la API, para que ambas tablas presenten el mismo texto y tema.
 *
 * @param {{isActive?: boolean}} record - Fila de la API.
 * @returns {{label: "Activo"|"Inactivo", theme: "Success"|"Disabled"}} Texto y tema.
 */
export function getActiveStatusBadge(record) {
  return record?.isActive
    ? { label: "Activo", theme: "Success" }
    : { label: "Inactivo", theme: "Disabled" };
}
