import assert from "node:assert/strict";
import test from "node:test";

import { isPdfAttachment, toAttachmentViewerDocument } from "../src/utils/projectRequestAttachments.js";

test("solo los adjuntos con MIME PDF se abren en el visor integrado", () => {
  for (const fileType of ["application/pdf", "Application/PDF", "application/pdf; charset=binary"]) {
    assert.equal(isPdfAttachment({ fileType }), true, fileType);
  }
  for (const fileType of ["image/png", "image/jpeg", "video/mp4", "pdf", "", null, undefined]) {
    assert.equal(isPdfAttachment({ fileType }), false, String(fileType));
  }
  assert.equal(isPdfAttachment(null), false);
});

test("el adjunto se adapta al documento que espera ProjectDocumentViewerModal", () => {
  const document = toAttachmentViewerDocument({ fileType: "application/pdf", id: 31, name: "Memoria descriptiva.pdf" }, 7);
  assert.equal(document.fileType, "pdf", "el visor reconoce el tipo y el icono por extensión");
  assert.equal(document.mimeType, "application/pdf");
  assert.equal(document.id, 31);
  assert.equal(document.name, "Memoria descriptiva.pdf");
  assert.match(document.fileUrl, /\/project-requests\/7\/files\/31\/content$/);
  assert.equal(toAttachmentViewerDocument({ fileType: "application/pdf", id: 2 }, 7).name, "Archivo");
});
