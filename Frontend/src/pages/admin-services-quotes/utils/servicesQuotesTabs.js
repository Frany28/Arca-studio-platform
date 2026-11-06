import { SERVICES_QUOTES_PATH } from "../../../utils/sideNavigationItems.js";

// Pestañas del módulo en el orden de Figma (5790:339391). `slug` forma la subruta bajo
// /servicios-cotizaciones; la entrada del Side Navigation sigue activa en todas ellas.
export const SERVICES_QUOTES_TABS = Object.freeze([
  { id: "quotes", slug: "cotizaciones", label: "Cotizaciones" },
  { id: "services", slug: "tabulador", label: "Tabulador de servicios" },
  { id: "units", slug: "unidades", label: "Unidades" },
]);

// Cotizaciones, primera pestaña del módulo, es su punto de entrada: la raíz (incluido el
// destino del Side Navigation) y las subrutas desconocidas redirigen a ella.
export const SERVICES_QUOTES_DEFAULT_TAB_SLUG = "cotizaciones";

/**
 * Construye la ruta absoluta de una pestaña del módulo.
 *
 * @param {string} slug - Subruta de la pestaña.
 * @returns {string} Ruta navegable, por ejemplo `/servicios-cotizaciones/unidades`.
 */
export function getServicesQuotesTabPath(slug) {
  return `${SERVICES_QUOTES_PATH}/${slug}`;
}

// Subrutas del formulario de cotización (Figma 5771:452483) bajo la pestaña Cotizaciones.
const QUOTES_TAB_SLUG = SERVICES_QUOTES_TABS.find((tab) => tab.id === "quotes").slug;
export const QUOTE_CREATE_SEGMENT = "nueva";
export const QUOTE_EDIT_SEGMENT = "editar";

/**
 * Ruta absoluta del listado de cotizaciones (pestaña Cotizaciones).
 *
 * @returns {string} `/servicios-cotizaciones/cotizaciones`.
 */
export function getQuotesListPath() {
  return getServicesQuotesTabPath(QUOTES_TAB_SLUG);
}

/**
 * Ruta absoluta del formulario «Nueva cotización».
 *
 * @returns {string} `/servicios-cotizaciones/cotizaciones/nueva`.
 */
export function getQuoteCreatePath() {
  return `${getServicesQuotesTabPath(QUOTES_TAB_SLUG)}/${QUOTE_CREATE_SEGMENT}`;
}

// Parámetro de «Nueva cotización» que inicia el borrador con un proyecto existente y su cliente
// (por ejemplo, el creado al aprobar una solicitud). Solo identifica el proyecto: nombre y
// cliente se leen del backend, y un enlace sin el parámetro abre el formulario vacío.
export const QUOTE_PROJECT_PARAM = "proyecto";

/**
 * Ruta absoluta de «Nueva cotización» precargada con un proyecto existente.
 *
 * @param {number|string} projectId - Proyecto de la cotización.
 * @returns {string} `/servicios-cotizaciones/cotizaciones/nueva?proyecto=40`.
 */
export function getQuoteCreatePathForProject(projectId) {
  return `${getQuoteCreatePath()}?${new URLSearchParams({ [QUOTE_PROJECT_PARAM]: String(projectId) })}`;
}

/**
 * Lee el proyecto que precarga «Nueva cotización». Solo admite un ID entero positivo; cualquier
 * otro valor se ignora y el formulario empieza vacío.
 *
 * @param {URLSearchParams} searchParams - Consulta de la URL.
 * @returns {string|null} ID normalizado o null.
 */
export function parseQuoteProjectParam(searchParams) {
  const value = searchParams?.get(QUOTE_PROJECT_PARAM)?.trim() ?? "";
  return /^[1-9]\d{0,15}$/.test(value) ? value : null;
}

/**
 * Ruta absoluta de la edición de una cotización.
 *
 * @param {number|string} quoteId - Cotización.
 * @returns {string} `/servicios-cotizaciones/cotizaciones/12/editar`.
 */
export function getQuoteEditorPath(quoteId) {
  return `${getServicesQuotesTabPath(QUOTES_TAB_SLUG)}/${encodeURIComponent(quoteId)}/${QUOTE_EDIT_SEGMENT}`;
}

/**
 * Resuelve la pestaña activa a partir de la URL actual, de modo que el estado activo depende
 * solo de la ruta (enlaces directos, recargas y Atrás/Adelante del navegador).
 *
 * @param {string} pathname - Ruta actual de react-router (sin basename).
 * @returns {number} Índice de la pestaña en SERVICES_QUOTES_TABS, o -1 si no coincide ninguna.
 */
export function getServicesQuotesTabIndex(pathname) {
  const prefix = `${SERVICES_QUOTES_PATH}/`;
  if (!String(pathname || "").startsWith(prefix)) return -1;
  const [slug] = pathname.slice(prefix.length).split("/");
  return SERVICES_QUOTES_TABS.findIndex((tab) => tab.slug === slug);
}
