import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/*
 * Recursos estáticos del PDF de cotizaciones: la tipografía Inter del sistema de diseño
 * (@fontsource/inter, licencia OFL-1.1; se usa WOFF porque fontkit no embebe sus WOFF2) y los
 * trazados del logo descargados del formato de Figma (assets/quote-pdf). Se leen una sola vez
 * por proceso y se reutilizan en cada documento; vercel.json los incluye en la función.
 */

const require = createRequire(import.meta.url);
const ASSETS_DIRECTORY = new URL("../../assets/quote-pdf/", import.meta.url);

const FONT_FILES = Object.freeze({
  bold: "inter-latin-700-normal.woff",
  medium: "inter-latin-500-normal.woff",
  regular: "inter-latin-400-normal.woff",
});

const VECTOR_FILES = Object.freeze({
  footerMark: "footer-mark.svg",
  logoBox: "logo-box.svg",
  logoRif: "logo-rif.svg",
  logoWordmark: "logo-wordmark.svg",
  logoYear: "logo-year.svg",
});

let assetsPromise = null;

/**
 * Lee el valor de un atributo dentro de una etiqueta SVG. Los SVG de Figma usan comillas dobles
 * y no anidan comillas, de modo que basta una búsqueda acotada al atributo.
 *
 * @param {string} tag - Texto de la etiqueta.
 * @param {string} name - Nombre del atributo.
 * @returns {string|null} Valor del atributo o null si no existe.
 */
function readAttribute(tag, name) {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/**
 * Extrae del SVG exportado por Figma su caja de vista y los trazados con su relleno, que es todo
 * lo que contienen estos recursos (sin transformaciones ni degradados). Un trazado sin relleno
 * visible se descarta.
 *
 * @param {string} svg - Contenido del archivo SVG.
 * @returns {{ width: number, height: number, paths: Array<{ d: string, fill: string, fillRule: string }> }} Vector.
 * @throws {Error} Si el archivo no declara viewBox o no contiene trazados.
 */
export function parseSvgVector(svg) {
  const viewBox = readAttribute(/<svg\b[^>]*>/.exec(svg)?.[0] ?? "", "viewBox")?.split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)]
    .map(([tag]) => ({ d: readAttribute(tag, "d"), fill: readAttribute(tag, "fill"), fillRule: readAttribute(tag, "fill-rule") }))
    .filter((path) => path.d && path.fill && path.fill !== "none")
    .map((path) => ({ d: path.d, fill: path.fill, fillRule: path.fillRule === "evenodd" ? "even-odd" : "non-zero" }));
  if (!viewBox || viewBox.length !== 4 || paths.length === 0) throw new Error("quote_pdf: recurso SVG sin viewBox o sin trazados.");
  return { height: viewBox[3], paths, width: viewBox[2] };
}

/**
 * Lee del disco las fuentes y los vectores del documento. Las fuentes se resuelven desde el
 * paquete instalado y los vectores desde assets/quote-pdf del backend.
 *
 * @returns {Promise<{ fonts: Record<string, Buffer>, vectors: Record<string, object> }>} Recursos leídos.
 */
async function readQuotePdfAssets() {
  const fontEntries = await Promise.all(Object.entries(FONT_FILES).map(async ([name, file]) => (
    [name, await readFile(require.resolve(`@fontsource/inter/files/${file}`))]
  )));
  const vectorEntries = await Promise.all(Object.entries(VECTOR_FILES).map(async ([name, file]) => (
    [name, parseSvgVector(await readFile(new URL(file, ASSETS_DIRECTORY), "utf8"))]
  )));
  return { fonts: Object.fromEntries(fontEntries), vectors: Object.fromEntries(vectorEntries) };
}

/**
 * Devuelve los recursos del PDF compartiendo una única lectura entre peticiones concurrentes.
 * Si la lectura falla se descarta la promesa, para que una petición posterior pueda reintentar.
 *
 * @returns {Promise<{ fonts: Record<string, Buffer>, vectors: Record<string, object> }>} Recursos.
 */
export function loadQuotePdfAssets() {
  if (!assetsPromise) {
    assetsPromise = readQuotePdfAssets().catch((error) => {
      assetsPromise = null;
      throw error;
    });
  }
  return assetsPromise;
}
