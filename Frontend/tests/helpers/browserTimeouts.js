/**
 * Política compartida de timeouts para las pruebas de navegador (Playwright como librería
 * sobre node:test; el proyecto no usa playwright.config porque no emplea su runner).
 *
 * Separa dos esperas de naturaleza distinta:
 * - Interacción: lo que la prueba verifica (clics, foco, renders tras un cambio de props).
 *   Un límite corto detecta componentes lentos o bloqueados.
 * - Navegación: `page.goto` y equivalentes. La primera carga de cada archivo compila en frío
 *   el grafo de módulos en su propio servidor Vite; con la suite completa en paralelo esa
 *   compilación compite por CPU y tarda varias veces más que aislada. No forma parte de lo
 *   que se prueba, así que no debe heredar el límite de interacción.
 */

/** Límite para interacciones en las pruebas que exigen respuesta rápida de la interfaz. */
export const INTERACTION_TIMEOUT_MS = 5000;

/**
 * Límite de navegación de 30 s para dar margen a las primeras cargas en frío de Vite
 * cuando los archivos de la suite compiten por CPU. No amplía las esperas de interacción.
 */
export const NAVIGATION_TIMEOUT_MS = 30000;

/**
 * Aplica la política a una página: interacciones con límite corto y navegación con margen
 * para la compilación inicial de Vite. Playwright prioriza el timeout de navegación sobre
 * el general en `goto`, `reload`, `waitForURL` y `waitForNavigation`.
 *
 * @param {import("playwright").Page} page Página recién creada.
 * @param {Object} [options] Ajustes de la prueba.
 * @param {number} [options.interactionTimeout=INTERACTION_TIMEOUT_MS] Límite de interacción.
 * @returns {import("playwright").Page} La misma página, para encadenar.
 */
export function applyBrowserTimeouts(page, { interactionTimeout = INTERACTION_TIMEOUT_MS } = {}) {
  page.setDefaultTimeout(interactionTimeout);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  return page;
}
