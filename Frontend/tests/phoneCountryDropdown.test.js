import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("phone country options reuse the attached four-row dropdown pattern", async () => {
  const source = await readFile(
    new URL("../src/components/ui/Input/phone/PhoneCountrySelector.jsx", import.meta.url),
    "utf8",
  );

  const hook = await readFile(
    new URL("../src/components/ui/Input/phone/usePhoneInput.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /left-\[-1px\] top-full/);
  assert.match(source, /max-h-\[152px\]/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /\[scrollbar-width:none\]/);
  assert.match(source, /border-t-0/);
  assert.match(source, /rounded-b-\[12px\]/);
  assert.match(source, /h-\[35px\] shrink-0/);
  assert.match(source, /left-\[-1px\][^"\n]*w-\[calc\(100%\+1px\)\]/);
  assert.match(source, /after:left-\[-1px\][^"\n]*after:h-px/);
  assert.match(source, /grid-cols-\[20px_40px_minmax\(0,1fr\)\]/);
  assert.match(source, /gap-\[2px\][^"\n]*px-\[8px\]/);
  assert.match(source, /\{option\.abbreviation\}/);
  assert.match(source, /aria-haspopup="listbox"/);
  assert.match(source, /aria-label="Buscar código de país por prefijo; el signo más es fijo"/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /onClick=\{handleToggleMenu\}/);
  assert.match(hook, /setIsPhoneMenuOpen\(\(current\) => !current\)/);
  assert.match(source, /value=\{getPhoneDigits\(normalizedPhonePrefix\)\}/);
  assert.match(source, /aria-hidden="true">\+<\/span>/);
  assert.match(source, /inputMode="numeric"/);
  assert.match(hook, /setPhonePrefixValue\(nextPrefix\)/);
  assert.match(hook, /optionDigits\.startsWith\(prefixDigits\)/);
  assert.match(hook, /event\.key !== "Enter" \|\| !isPhoneMenuOpen/);
  assert.match(hook, /const firstVisibleOption = filteredPhoneOptions\[0\]/);
  assert.match(hook, /event\.preventDefault\(\);\s*handlePhoneOptionSelection\(firstVisibleOption\)/);
  assert.match(source, /onClick=\{\(\) => handlePhoneOptionSelection\(option\)\}/);
  assert.doesNotMatch(source, /aria-label="Código de país"/);
  assert.doesNotMatch(source, /text="Mostrar países"/);
  assert.match(source, /<ScrollBar/);
  assert.match(source, /aria-label="Desplazar países"/);
  assert.match(hook, /event\.key === "Escape"/);
  assert.doesNotMatch(source, /top-\[calc\(100%_-_1px\)\]/);
});

test("phone country options expose compact labels for the narrow selector", async () => {
  const source = await readFile(
    new URL("../src/components/ui/Input/phoneCountryOptions.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /US: "USA"/);
  assert.match(source, /VE: "VE"/);
  assert.match(source, /NO: "NOR"/);
  assert.match(source, /\?\? normalizedCode/);
});
