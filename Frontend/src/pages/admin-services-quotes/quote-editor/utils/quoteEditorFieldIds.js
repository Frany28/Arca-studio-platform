// Ids del editor de cotizaciones que relacionan secciones distintas del formulario.

/** Cuerpo de la tabla del selector de servicios (filas con sus casillas). */
export const QUOTE_SERVICE_PICKER_ROWS_ID = "quote-service-picker-rows";

/** Buscador del selector de servicios. */
export const QUOTE_SERVICE_SEARCH_ID = "quote-service-search";

/**
 * Controles que resuelven «Añade al menos un servicio», en orden de preferencia: la primera casilla
 * seleccionable del selector y, si no hay filas (sin coincidencias, catálogo vacío o en carga), el
 * buscador. Valor de `data-invalid-field-control` (invalidFieldNavigation.js).
 */
export const QUOTE_SERVICE_PICKER_CONTROL_IDS = `${QUOTE_SERVICE_PICKER_ROWS_ID} ${QUOTE_SERVICE_SEARCH_ID}`;

/** Mensaje de error de la lista de servicios incluidos. */
export const QUOTE_ITEMS_ERROR_ID = "quote-items-error";
