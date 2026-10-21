import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getBrowserTestCacheDir } from "./helpers/browserViteCache.js";

const FRONTEND_DIR = fileURLToPath(new URL("../", import.meta.url));
const BROWSER_TESTS_DIR = join(FRONTEND_DIR, "tests", "browser");

test("cada archivo de navegador recibe una caché de Vite propia dentro de node_modules", () => {
  const units = getBrowserTestCacheDir(pathToFileURL(join(BROWSER_TESTS_DIR, "adminServicesQuotesUnits.test.js")).href);
  const gallery = getBrowserTestCacheDir(pathToFileURL(join(BROWSER_TESTS_DIR, "galleryImagesModal.test.js")).href);

  assert.equal(units, join(FRONTEND_DIR, "node_modules", ".vite-browser", "adminServicesQuotesUnits"));
  assert.notEqual(units, gallery);
  assert.ok(!units.endsWith(`${sep}.vite`), "No reutiliza la caché compartida node_modules/.vite");
});

test("ningún servidor de pruebas de navegador usa la caché compartida por defecto", async () => {
  const files = (await readdir(BROWSER_TESTS_DIR)).filter((file) => file.endsWith(".test.js"));
  const withoutCache = [];
  for (const file of files) {
    const source = await readFile(join(BROWSER_TESTS_DIR, file), "utf8");
    if (source.includes("createServer(") && !source.includes("cacheDir:")) withoutCache.push(file);
  }
  assert.deepEqual(withoutCache, []);
});
