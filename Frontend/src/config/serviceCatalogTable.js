// Geometría compartida por el tabulador de servicios y su skeleton (Figma 5790:332040).
// Orden: selección, N°, Servicio, Modalidad, Unidad, Tarifa, Estado y Acciones. `null` marca
// Servicio, que ocupa el ancho restante (su nombre se trunca con `title`).
//
// Respecto a Figma: Modalidad (140) y Unidad (190) se conservan; N° (100), Tarifa y Estado (82)
// se ensanchan para que quepan `SERV-1000`, tarifas de hasta cuatro cifras enteras y los iconos
// de cabecera, y Acciones conserva 128 px mientras «Ver» siga omitido.
export const SERVICE_CATALOG_COLUMN_WIDTHS = Object.freeze([48, 120, null, 140, 190, 116, 116, 128]);

// Figma dibuja el borde de 1 px del frame (1104 px) por dentro, sobre las celdas; en CSS el borde
// del contenedor resta 2 px al área de desplazamiento. Por eso el mínimo es 1104 − 2 = 1102 px:
// con 1104 px el escritorio mostraba un desplazamiento horizontal residual de 2 px.
const FIGMA_TABLE_FRAME_WIDTH = 1104;
const TABLE_BORDER_WIDTH = 1;
export const SERVICE_CATALOG_TABLE_MIN_WIDTH = FIGMA_TABLE_FRAME_WIDTH - 2 * TABLE_BORDER_WIDTH;

/**
 * Plantilla de columnas CSS Grid equivalente al `colgroup` de la tabla, para el skeleton.
 *
 * @returns {string} Valor de `grid-template-columns` (la columna flexible usa `minmax(0,1fr)`).
 */
export function getServiceCatalogGridTemplate() {
  return SERVICE_CATALOG_COLUMN_WIDTHS.map((width) => (width ? `${width}px` : "minmax(0,1fr)")).join(" ");
}
