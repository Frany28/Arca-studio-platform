import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project request page keeps flow logic while form presentation is extracted", async () => {
  const [page, formView] = await Promise.all([
    readFile(new URL("../src/pages/ProjectRequestPage.jsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/pages/project-request/components/ProjectRequestFormView.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(page, /<ProjectRequestFormView/);
  assert.match(page, /getProjectRequestFileErrors\(files\)/);
  assert.match(page, /validateForSubmit\(nextFileErrors\)/);
  assert.match(page, /openValidation\(\)/);
  assert.match(page, /submitValidation\(code, \{ files, updateFileItem \}\)/);
  assert.match(page, /resetFormState\(\)/);
  assert.match(page, /clearLocationSuggestions\(\)/);
  assert.match(page, /resetFiles\(\)/);
  assert.match(page, /resetSubmission\(\)/);

  for (const sectionTitle of [
    "Detalles del proyecto",
    "Documentación legal del inmueble",
    "Viabilidad financiera",
    "Compatibilidad",
    "Referencias",
  ]) {
    assert.match(formView, new RegExp(`title="${sectionTitle}"`));
  }

  assert.match(formView, /onDrop=\{\(event\) =>/);
  assert.match(formView, /handleFilesChange\(event\.dataTransfer\.files\)/);
  assert.match(formView, /ProjectLocationSuggestions/);
  assert.match(formView, /onClick=\{requestReset\}/);
  assert.match(formView, /htmlType="submit"/);
});
