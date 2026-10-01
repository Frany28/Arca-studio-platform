import { readFile } from "node:fs/promises";

// Las comprobaciones de integración inspeccionan los módulos responsables del flujo,
// aunque su implementación ya no esté concentrada en la página de entrada.
export async function readSources(...urls) {
  return (await Promise.all(urls.map((url) => readFile(url, "utf8")))).join("\n");
}
