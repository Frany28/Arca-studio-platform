import assert from "node:assert/strict";
import test from "node:test";

import {
  isProjectRequestFileRemovable,
  toProjectRequestFileCards,
} from "../src/pages/project-request/utils/projectRequestFilePresentation.js";
import { getProjectRequestFileErrors } from "../src/utils/projectRequestValidation.js";

const MB = 1024 * 1024;
const persisted = (remoteId, name, size = MB, type = "application/pdf") => ({
  file: { name, size, type }, id: `persisted-${remoteId}`, persisted: true, remoteId, status: "uploaded",
});
const local = (id, name, size = MB, type = "image/png") => ({ file: { name, size, type }, id, status: "pending" });

test("los adjuntos guardados cuentan para cantidad, tamaño total y nombres repetidos", () => {
  const saved = Array.from({ length: 9 }, (_, index) => persisted(index + 1, `plano-${index + 1}.pdf`));
  assert.deepEqual(getProjectRequestFileErrors([...saved, local("n1", "nuevo.png")]), []);
  assert.deepEqual(
    getProjectRequestFileErrors([...saved, local("n1", "nuevo.png"), local("n2", "otro.png")]),
    ["Puedes adjuntar un máximo de 10 archivos."],
  );
  assert.deepEqual(
    getProjectRequestFileErrors([persisted(1, "Plano.pdf", 180 * MB), local("n1", "vista.png", 30 * MB)]),
    ["Los archivos no pueden superar 200 MB en total."],
  );
  assert.deepEqual(
    getProjectRequestFileErrors([persisted(1, "Fachada.png", MB, "image/png"), local("n1", "fachada.png")]),
    ["fachada.png: está repetido."],
    "el backend reutilizaría el archivo con ese nombre en lugar de subirlo",
  );
});

test("un adjunto guardado no repite las comprobaciones de formato ni tamaño individual", () => {
  // MIME guardado distinto del esperado o tamaño desconocido: lo validó el backend al recibirlo.
  assert.deepEqual(getProjectRequestFileErrors([persisted(1, "render.jpg", 0, "image/pjpeg")]), []);
});

test("un adjunto guardado se conserva: solo se cancela la selección que aún no se envió (Fase 1.2, B1)", () => {
  const saved = persisted(7, "Plano.pdf");
  assert.equal(isProjectRequestFileRemovable(saved), false);
  assert.equal(isProjectRequestFileRemovable({ ...saved, persisted: false }), false, "también uno subido en esta sesión");
  // Lo que todavía no se guardó se puede quitar; quitar uno en curso cancela la transferencia.
  for (const status of ["pending", "uploading", "error"]) {
    assert.equal(isProjectRequestFileRemovable({ remoteId: null, status }), true, status);
  }

  const removed = [];
  const [card, pending] = toProjectRequestFileCards([saved, local("n1", "nuevo.png")], (id) => removed.push(id));
  assert.equal(card.status, "completed");
  assert.equal(card.name, "Plano.pdf");
  assert.equal(card.onRemove, undefined, "la tarjeta guardada no ofrece «Eliminar archivo»");
  assert.equal(card.removeWhenCompleted, undefined);
  pending.onRemove();
  assert.deepEqual(removed, ["n1"]);
});
