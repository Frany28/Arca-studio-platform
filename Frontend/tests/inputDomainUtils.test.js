import assert from "node:assert/strict";
import test from "node:test";

import { formatPhoneNumber, getPhoneDigits, normalizeDialCode } from "../src/components/ui/Input/phone/phoneUtils.js";
import { createTagFromText, normalizeTagItem, normalizeTagSearchText } from "../src/components/ui/Input/tags/tagUtils.js";

test("teléfono normaliza prefijos vacíos y separadores sin inventar dígitos", () => {
  assert.equal(getPhoneDigits(null), "");
  assert.equal(getPhoneDigits("+58 (412) 123-4567"), "584121234567");
  assert.equal(normalizeDialCode("++ 58"), "+58");
  assert.equal(normalizeDialCode("abc"), "+");
});

test("máscara telefónica conserva números parciales, fallback y truncamiento", () => {
  assert.equal(formatPhoneNumber(""), "");
  assert.equal(formatPhoneNumber("12"), "(12");
  assert.equal(formatPhoneNumber("1234567890123"), "(123) 4567-8901");
  assert.equal(formatPhoneNumber("4121234567", { mask: "(###) ###-####" }), "(412) 123-4567");
  assert.equal(formatPhoneNumber("612345678", { mask: "### ### ###" }), "612 345 678");
});

test("tags comparan búsqueda sin acentos y sin espacios exteriores", () => {
  assert.equal(normalizeTagSearchText("  ÁNA Pérez  "), "ana perez");
  assert.equal(normalizeTagSearchText(null), "");
  assert.equal(normalizeTagSearchText("Ana  Pérez"), "ana  perez", "No compacta espacios interiores");
});

test("tags libres conservan etiqueta, índice e identidad original", () => {
  assert.equal(createTagFromText("  "), null);
  assert.deepEqual(createTagFromText("  Nuevo equipo  ", 2), {
    id: "tag-custom-nuevo-equipo-2", label: "Nuevo equipo", avatar: true, closeIcon: true, avatarText: "N",
  });
});

test("normalización de tags conserva las sobrescrituras explícitas", () => {
  assert.deepEqual(normalizeTagItem({ label: "Ana", avatar: false }, "fallback"), { id: "fallback", avatar: false, closeIcon: true, label: "Ana" });
  assert.equal(normalizeTagItem({ id: undefined, label: "Ana" }, "fallback").id, undefined);
});
