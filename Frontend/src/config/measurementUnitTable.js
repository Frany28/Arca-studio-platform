// Geometría compartida por la tabla de unidades de medida y su skeleton (Figma 5771:487550, sin
// selección de filas). Orden: N°, Unidad, Estado y Acciones. `null` marca Unidad, que ocupa el
// ancho restante (su etiqueta se trunca).
//
// N° (154) y Acciones (128) conservan su ancho; Estado usa el mismo que en el tabulador de
// servicios (116), suficiente para su cabecera con icono y para «Activo» / «Inactivo».
export const MEASUREMENT_UNIT_COLUMN_WIDTHS = Object.freeze([154, null, 116, 128]);

// Ancho mínimo que se reserva a Unidad antes de desplazar la tabla en horizontal.
const MIN_UNIT_COLUMN_WIDTH = 230;
export const MEASUREMENT_UNIT_TABLE_MIN_WIDTH = MEASUREMENT_UNIT_COLUMN_WIDTHS
  .reduce((total, width) => total + (width ?? MIN_UNIT_COLUMN_WIDTH), 0);

/**
 * Plantilla de columnas CSS Grid equivalente al `colgroup` de la tabla, para el skeleton.
 *
 * @returns {string} Valor de `grid-template-columns` (la columna flexible usa `minmax(0,1fr)`).
 */
export function getMeasurementUnitGridTemplate() {
  return MEASUREMENT_UNIT_COLUMN_WIDTHS.map((width) => (width ? `${width}px` : "minmax(0,1fr)")).join(" ");
}
