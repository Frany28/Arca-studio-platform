import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Las variantes oscuras del logo son archivos estáticos (src/assets/logos/dark). Deben seguir siendo
// exactamente la transformación que MainLogo aplicaba en tiempo de ejecución: la variante clara con
// `#2A2929` sustituido por `#FFFFFF`. Si cambia un SVG claro, hay que regenerar su variante oscura.
const LOGO_FILES = [
  "LOGO=20px (1).svg",
  "LOGO=24px (1).svg",
  "LOGO=32px (1).svg",
  "LOGO=48px (1).svg",
  "LOGO 64px.svg",
  "LOGO 200px.svg",
];
const LOGOS_DIR = new URL("../src/assets/logos/", import.meta.url);

test("logo: cada variante oscura es su variante clara con el texto en #FFFFFF y nada más", async () => {
  for (const fileName of LOGO_FILES) {
    const [light, dark] = await Promise.all([
      readFile(new URL(fileName, LOGOS_DIR), "utf8"),
      readFile(new URL(`dark/${fileName}`, LOGOS_DIR), "utf8"),
    ]);
    assert.ok(light.includes("#2A2929"), `${fileName}: la variante clara conserva el color del texto`);
    assert.equal(dark, light.replaceAll("#2A2929", "#FFFFFF"), `${fileName}: variante oscura desactualizada`);
  }
});

test("logo: MainLogo referencia las seis variantes por URL y no incrusta SVG en el JavaScript", async () => {
  const source = await readFile(new URL("MainLogo.jsx", LOGOS_DIR), "utf8");
  assert.doesNotMatch(source, /^import[^;]*\?raw/m, "Sin SVG incrustado como texto");
  for (const fileName of LOGO_FILES) {
    assert.ok(source.includes(`from "./${fileName}"`), `Variante clara ${fileName}`);
    assert.ok(source.includes(`from "./dark/${fileName}"`), `Variante oscura ${fileName}`);
  }
});
