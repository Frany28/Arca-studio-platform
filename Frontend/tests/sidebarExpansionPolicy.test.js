import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const SOURCE_ROOT = new URL("../src/", import.meta.url);

/**
 * Lista recursivamente los módulos JS/JSX de `src` como URLs.
 *
 * @param {URL} directory Carpeta a recorrer.
 * @returns {Promise<URL[]>} Archivos de código encontrados.
 */
async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return listSourceFiles(entryUrl);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [entryUrl] : [];
  }));
  return nested.flat();
}

test("la expansión del riel lateral proviene solo de useResponsiveSidebarExpansion", async () => {
  const files = await listSourceFiles(SOURCE_ROOT);
  const offenders = [];
  let consumers = 0;

  for (const fileUrl of files) {
    const source = await readFile(fileUrl, "utf8");
    const relativePath = fileUrl.pathname.slice(SOURCE_ROOT.pathname.length);
    const declaration = source.match(/const \[isSidebarExpanded, setIsSidebarExpanded\] =\s*([^\n;]+)/);

    if (declaration) {
      consumers += 1;
      if (!declaration[1].startsWith("useResponsiveSidebarExpansion()")) {
        offenders.push(`${relativePath}: ${declaration[1].trim()}`);
      }
    }
    // Ningún módulo, salvo el hook, sincroniza la expansión con su propio breakpoint.
    if (relativePath !== "hooks/useResponsiveSidebarExpansion.js"
      && /setIsSidebarExpanded\(!?\s*event\.matches\)/.test(source)) {
      offenders.push(`${relativePath}: listener de matchMedia propio`);
    }
  }

  assert.deepEqual(offenders, [], "Cada vista debe usar la política compartida del riel");
  assert.ok(consumers >= 9, "Las vistas autenticadas siguen declarando su expansión mediante el hook");
});

test("los anchos del riel provienen solo de los tokens --app-side-navigation-*", async () => {
  const [globalStyles, sideNavigation] = await Promise.all([
    readFile(new URL("styles/global.css", SOURCE_ROOT), "utf8"),
    readFile(new URL("components/ui/SideNavigation/SideNavigation.jsx", SOURCE_ROOT), "utf8"),
  ]);

  // Tablet: 76 px contraído y 234 px expandido; web (≥1280 px): 312 px expandido.
  assert.match(globalStyles, /--app-side-navigation-collapsed-width: 76px;/);
  assert.match(globalStyles, /--app-side-navigation-expanded-width: 234px;/);
  assert.match(globalStyles, /@media \(min-width: 1280px\) \{\s*:root \{\s*--app-side-navigation-expanded-width: 312px;/);
  assert.match(sideNavigation, /expanded: "w-\[var\(--app-side-navigation-expanded-width\)\]/);
  assert.match(sideNavigation, /"w-\[var\(--app-side-navigation-collapsed-width\)\]/);

  const offenders = [];
  for (const fileUrl of await listSourceFiles(new URL("pages/", SOURCE_ROOT))) {
    const source = await readFile(fileUrl, "utf8");
    const relativePath = fileUrl.pathname.slice(SOURCE_ROOT.pathname.length);
    for (const usage of source.match(/<ResponsiveSideNavigation[\s\S]*?\/>/g) || []) {
      if (/className=[^\n]*(?:\bw-\[|\bpx-\[|!w-|!px-)/.test(usage)) offenders.push(`${relativePath}: className del riel`);
    }
    if (/\[&>aside\]:!?w-|_SIDEBAR_WIDTH\b/.test(source)) offenders.push(`${relativePath}: ancho del riel redefinido`);
  }
  assert.deepEqual(offenders, [], "Ninguna página redefine anchos ni padding del riel");
});
