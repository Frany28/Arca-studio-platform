import { basename } from "node:path";
import { fileURLToPath } from "node:url";

// Raíz de las cachés de dependencias optimizadas de los servidores Vite de las pruebas.
const BROWSER_CACHE_ROOT = new URL("../../node_modules/.vite-browser/", import.meta.url);

/**
 * Devuelve la caché de dependencias optimizadas (`cacheDir`) propia de un archivo de pruebas de
 * navegador. Con la suite en paralelo cada archivo levanta su propio servidor Vite; si todos
 * comparten `node_modules/.vite`, sus optimizadores renombran `deps` y `deps_temp_*` a la vez
 * (ENOENT/EPERM en Windows) y fuerzan «optimized dependencies changed. reloading», de modo que
 * las páginas pierden sus imports dinámicos a mitad de la prueba. Una caché por archivo los aísla.
 *
 * @param {string} testFileUrl `import.meta.url` del archivo de pruebas.
 * @returns {string} Ruta absoluta de la caché, estable entre ejecuciones del mismo archivo.
 */
export function getBrowserTestCacheDir(testFileUrl) {
  const name = basename(fileURLToPath(testFileUrl)).replace(/\.test\.js$/, "");
  return fileURLToPath(new URL(name, BROWSER_CACHE_ROOT));
}
