import { SERVICES_QUOTES_PATH } from "../../../utils/sideNavigationItems.js";

// Pestañas del módulo en el orden de Figma (5790:339391). `slug` forma la subruta bajo
// /servicios-cotizaciones; la entrada del Side Navigation sigue activa en todas ellas.
export const SERVICES_QUOTES_TABS = Object.freeze([
  { id: "quotes", slug: "cotizaciones", label: "Cotizaciones" },
  { id: "services", slug: "tabulador", label: "Tabulador de servicios" },
  { id: "units", slug: "unidades", label: "Unidades" },
]);

// Unidades es la única pestaña funcional y la que muestra activa el diseño aprobado; la raíz
// del módulo y las subrutas desconocidas redirigen a ella.
export const SERVICES_QUOTES_DEFAULT_TAB_SLUG = "unidades";

/**
 * Construye la ruta absoluta de una pestaña del módulo.
 *
 * @param {string} slug - Subruta de la pestaña.
 * @returns {string} Ruta navegable, por ejemplo `/servicios-cotizaciones/unidades`.
 */
export function getServicesQuotesTabPath(slug) {
  return `${SERVICES_QUOTES_PATH}/${slug}`;
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
