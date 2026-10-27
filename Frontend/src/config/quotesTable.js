// Geometría compartida por la tabla de cotizaciones y su skeleton (Figma 5771:488506).
// Orden: selección (48), N° (154), Cliente, Proyecto, Fecha y Total (flexibles, 182,5 px en el
// frame de 1104 px) y Acciones (172). `null` marca las columnas que reparten el ancho restante.
export const QUOTES_TABLE_COLUMN_WIDTHS = Object.freeze([48, 154, null, null, null, null, 172]);

// Como en el tabulador: el frame mide 1104 px con el borde por dentro y en CSS el borde de 1 px del
// contenedor resta 2 px al área de desplazamiento, así que el mínimo es 1102 px.
const FIGMA_TABLE_FRAME_WIDTH = 1104;
const TABLE_BORDER_WIDTH = 1;
export const QUOTES_TABLE_MIN_WIDTH = FIGMA_TABLE_FRAME_WIDTH - 2 * TABLE_BORDER_WIDTH;

// Diez cotizaciones por página, como Figma y el tabulador; el contrato admite 1–100.
export const QUOTES_PAGE_SIZE = 10;

/**
 * Plantilla de columnas CSS Grid equivalente al `colgroup` de la tabla, para el skeleton.
 *
 * @returns {string} Valor de `grid-template-columns` (las columnas flexibles usan `minmax(0,1fr)`).
 */
export function getQuotesTableGridTemplate() {
  return QUOTES_TABLE_COLUMN_WIDTHS.map((width) => (width ? `${width}px` : "minmax(0,1fr)")).join(" ");
}
