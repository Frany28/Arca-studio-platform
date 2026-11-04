import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getFileUploadCardIds } from "../src/components/ui/FileUploadSection/fileUploadSectionConfig.js";
import { splitProjectRequestFileErrors } from "../src/pages/project-request/utils/projectRequestFilePresentation.js";
import { getProjectRequestFileErrors, getProjectRequestFileIssues } from "../src/utils/projectRequestValidation.js";

const png = (name, size = 100) => ({ name, size, type: "image/png" });
const item = (id, file) => ({ file, id, progress: 0, status: "pending" });

test("los problemas de adjuntos conservan reglas, textos y orden, y señalan el archivo afectado", () => {
  const files = [
    item("a", png("vista.png")),
    item("b", { name: "notas.txt", size: 10, type: "text/plain" }),
    item("c", png("vista.png")),
    item("d", png("vacio.png", 0)),
  ];
  assert.deepEqual(getProjectRequestFileIssues(files), [
    { index: 1, message: "notas.txt: formato no permitido." },
    { index: 2, message: "vista.png: está repetido." },
    { index: 3, message: "vacio.png: está vacío." },
  ]);
  assert.deepEqual(getProjectRequestFileErrors(files), ["notas.txt: formato no permitido.", "vista.png: está repetido.", "vacio.png: está vacío."]);
});

test("cantidad y tamaño total son errores de la sección (sin archivo)", () => {
  const many = Array.from({ length: 11 }, (_, index) => png(`vista-${index}.png`));
  assert.deepEqual(getProjectRequestFileIssues(many), [{ index: null, message: "Puedes adjuntar un máximo de 10 archivos." }]);
  const heavy = Array.from({ length: 5 }, (_, index) => png(`plano-${index}.png`, 45 * 1024 * 1024));
  assert.deepEqual(getProjectRequestFileIssues(heavy), [{ index: null, message: "Los archivos no pueden superar 200 MB en total." }]);
});

test("getProjectRequestFileErrors sigue sin duplicar mensajes repetidos", () => {
  const files = [{ name: "a.txt", size: 1, type: "text/plain" }, { name: "a.txt", size: 1, type: "text/plain" }];
  assert.deepEqual(getProjectRequestFileErrors(files), ["a.txt: formato no permitido.", "a.txt: está repetido."]);
});

test("reparto de errores: por archivo (id estable) y de sección, solo con los mensajes activos", () => {
  const files = [item("f-1", png("vista.png")), item("f-2", { name: "notas.txt", size: 10, type: "text/plain" })];
  const active = getProjectRequestFileErrors(files);
  const split = splitProjectRequestFileErrors(files, active);
  assert.deepEqual([...split.byFileId], [["f-2", "notas.txt: formato no permitido."]]);
  assert.deepEqual(split.general, []);

  // Una selección rechazada (borrador en curso) no procede de ningún archivo: es de la sección.
  const rejected = "Ya existe un borrador en proceso. Reintenta el envío antes de cambiar los archivos.";
  const onlyRejected = splitProjectRequestFileErrors(files, [rejected]);
  assert.equal(onlyRejected.byFileId.size, 0, "Un mensaje inactivo no se muestra en la tarjeta");
  assert.deepEqual(onlyRejected.general, [rejected]);

  // Quitar o reordenar archivos no mueve el motivo a otra tarjeta: va por id, no por posición.
  const reordered = [files[1], files[0]];
  assert.deepEqual([...splitProjectRequestFileErrors(reordered, active).byFileId.keys()], ["f-2"]);
});

test("ids de tarjeta estables por id de archivo y válidos como id del DOM", () => {
  assert.deepEqual(getFileUploadCardIds("attachments", "project-request-file-3"), {
    card: "attachments-file-project-request-file-3",
    message: "attachments-file-project-request-file-3-message",
    remove: "attachments-file-project-request-file-3-remove",
  });
  assert.equal(getFileUploadCardIds("p", "a b:c").card, "p-file-a_b_c");
  assert.deepEqual(getFileUploadCardIds("p", 7), getFileUploadCardIds("p", "7"));
});

test("FileUploadSection: las nuevas props son opcionales y el resto de consumidores no las necesita", async () => {
  const source = await readFile(new URL("../src/components/ui/FileUploadSection/FileUploadSection.jsx", import.meta.url), "utf8");
  assert.match(source, /idPrefix,\s*\n\s*dropzoneSupportingContent = null,/);
  assert.match(source, /if \(!validationMessage\) return card;/, "Sin motivo, la tarjeta es la de siempre");
  assert.match(source, /tooltip="Eliminar archivo"/, "El tooltip visible no cambia");
  for (const consumer of [
    "../src/pages/projects/panels/ProjectUploadFilesPanel.jsx",
    "../src/pages/settings/panels/SupportPanel.jsx",
    "../src/pages/settings/components/AvatarUploadModal.jsx",
    "../src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx",
  ]) {
    const consumerSource = await readFile(new URL(consumer, import.meta.url), "utf8");
    assert.doesNotMatch(consumerSource, /validationMessage|dropzoneSupportingContent/, `${consumer} conserva su uso`);
  }
});
