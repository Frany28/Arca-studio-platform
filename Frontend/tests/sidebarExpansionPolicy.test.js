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
