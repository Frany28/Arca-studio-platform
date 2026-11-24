// Geometría compartida por la tabla del administrador de archivos y su skeleton (Figma 3727:683873,
// aprobados con árbol, y 4273:683806 / 3727:683877, pendientes y rechazados con columna Proyecto).
// `null` marca Nombre, que absorbe el ancho libre y se trunca con su nombre completo en `title`.
//
// Como en Figma, la tabla de aprobados es más ancha que su área junto al árbol: desplaza dentro de su
// propio contenedor (HorizontalScrollViewport). Figma no tiene columna de selección operativa: no hay
// acciones masivas disponibles, así que se omite y no se reserva su ancho.
const BASE_COLUMNS = Object.freeze([
  { id: "name", width: null },
  { id: "version", width: 88 },
  { id: "project", width: 176 },
  { id: "type", width: 96 },
  { id: "size", width: 112 },
  { id: "date", width: 152 },
  { id: "uploadedBy", width: 168 },
  { id: "actions", width: 176 },
]);

// «Pendientes por aprobación» (Figma 3727:683264): cada fila solo ofrece «Revisar» (la descarga y el
// historial están en el visor), así que Acciones es estrecha y la tabla, con Proyecto, cabe en el área
// de contenido a 1440 px (1032 px con el menú lateral abierto) sin ocultar «Revisar». Nombre conserva
// los 160 px de Figma como mínimo y absorbe el resto.
const REVIEW_COLUMNS = Object.freeze([
  { id: "name", width: null },
  { id: "version", width: 72 },
  { id: "project", width: 160 },
  { id: "type", width: 96 },
  { id: "size", width: 104 },
  { id: "date", width: 136 },
  { id: "uploadedBy", width: 168 },
  { id: "actions", width: 128 },
]);

// Ancho mínimo de Nombre antes de desplazar la tabla en horizontal.
export const ADMIN_FILES_NAME_MIN_WIDTH = 200;
const REVIEW_NAME_MIN_WIDTH = 160;

/**
 * Columnas de la tabla según la pestaña: «Proyecto» solo cuando la tabla no está acotada por el
 * árbol (pendientes y rechazados, como en Figma); `review` usa la geometría de Pendientes.
 *
 * @param {{ showProject: boolean, review?: boolean }} options - Presentación.
 * @returns {ReadonlyArray<{id: string, width: number|null}>} Columnas en orden.
 */
export function getAdminFilesColumns({ review = false, showProject }) {
  if (review) return REVIEW_COLUMNS;
  return BASE_COLUMNS.filter((column) => showProject || column.id !== "project");
}

/**
 * Ancho mínimo de la tabla con sus columnas.
 *
 * @param {{ showProject: boolean, review?: boolean }} options - Presentación.
 * @returns {number} Píxeles.
 */
export function getAdminFilesTableMinWidth(options) {
  const nameMinWidth = options.review ? REVIEW_NAME_MIN_WIDTH : ADMIN_FILES_NAME_MIN_WIDTH;
  return getAdminFilesColumns(options).reduce((total, column) => total + (column.width ?? nameMinWidth), 0);
}

/**
 * Plantilla de columnas CSS Grid equivalente al `colgroup`, para el skeleton.
 *
 * @param {{ showProject: boolean, review?: boolean }} options - Presentación.
 * @returns {string} Valor de `grid-template-columns`.
 */
export function getAdminFilesGridTemplate(options) {
  return getAdminFilesColumns(options).map((column) => (column.width ? `${column.width}px` : "minmax(0,1fr)")).join(" ");
}
