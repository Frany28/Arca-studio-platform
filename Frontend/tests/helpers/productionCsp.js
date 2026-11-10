import { readFileSync } from "node:fs";

const NETLIFY_TOML = new URL("../../../netlify.toml", import.meta.url);
const PUBLIC_HEADERS = new URL("../../public/_headers", import.meta.url);

/**
 * Lee la Content-Security-Policy que Netlify aplica a la SPA desde `netlify.toml`.
 * Es la política de producción que las pruebas deben respetar.
 *
 * @returns {string} Política tal como se publica.
 */
export function readNetlifyCsp() {
  const match = readFileSync(NETLIFY_TOML, "utf8").match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("netlify.toml no define Content-Security-Policy");
  return match[1];
}

/**
 * Lee la Content-Security-Policy duplicada en `public/_headers`, que se publica con `dist`.
 * Debe coincidir con la de `netlify.toml` para que ambos caminos de despliegue sean iguales.
 *
 * @returns {string} Política tal como se publica.
 */
export function readPublicHeadersCsp() {
  const match = readFileSync(PUBLIC_HEADERS, "utf8").match(/Content-Security-Policy:\s*(.+)/);
  if (!match) throw new Error("public/_headers no define Content-Security-Policy");
  return match[1].trim();
}

/**
 * Adapta la política de producción al servidor de desarrollo de Vite sin relajar la evaluación
 * dinámica: solo añade 'unsafe-inline' para el preámbulo de React Refresh y retira el upgrade a https.
 *
 * @returns {string} Política aplicable al documento de la prueba.
 */
export function buildDevServerCsp() {
  return readNetlifyCsp()
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive && directive !== "upgrade-insecure-requests")
    .map((directive) => (directive.startsWith("script-src ") ? `${directive} 'unsafe-inline'` : directive))
    .join("; ");
}

/**
 * Sirve los HTML de fixtures con la CSP de producción adaptada y registra cada violación
 * (`securitypolicyviolation`) en `violations` para que la prueba la haga fallar.
 *
 * @param {import("playwright").Page} page - Página recién creada.
 * @param {Array<string>} violations - Lista donde se acumulan las violaciones detectadas.
 * @returns {Promise<void>} Finaliza cuando la intercepción queda registrada.
 */
export async function enforceProductionCsp(page, violations) {
  const policy = buildDevServerCsp();
  await page.exposeFunction("__reportCspViolation", (detail) => violations.push(detail));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      // El cliente de Vite abre su WebSocket aunque no haya HMR; no existe en producción.
      if (event.violatedDirective === "connect-src" && event.blockedURI.startsWith("ws:")) return;
      window.__reportCspViolation(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.route((url) => url.pathname.startsWith("/tests/browser/fixtures/") && url.pathname.endsWith(".html"), async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
}
