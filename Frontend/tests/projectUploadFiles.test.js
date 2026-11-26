import assert from "node:assert/strict";
import test from "node:test";

import { formatProjectUploadSize, getProjectUploadFileError, PROJECT_UPLOAD_ACCEPT } from "../src/pages/projects/utils/projectUploadFiles.js";

const pdf = { name: "Plano.PDF", type: "application/pdf", size: 1024 };

test("la cola del proyecto admite JPEG, PNG, PDF y MP4 dentro del límite", () => {
  assert.equal(PROJECT_UPLOAD_ACCEPT, ".jpeg,.jpg,.png,.pdf,.mp4");
  assert.equal(getProjectUploadFileError(pdf, []), "");
  assert.equal(getProjectUploadFileError({ name: "Video.mp4", type: "video/mp4", size: 50 * 1024 * 1024 }, []), "");
  assert.match(getProjectUploadFileError({ ...pdf, type: "text/plain" }, []), /JPEG, PNG, PDF y MP4/);
  assert.match(getProjectUploadFileError({ ...pdf, name: ".pdf" }, []), /JPEG, PNG, PDF y MP4/);
  assert.match(getProjectUploadFileError({ ...pdf, size: 50 * 1024 * 1024 + 1 }, []), /50 MB/);
  assert.match(getProjectUploadFileError({ ...pdf, size: 0 }, []), /vacío/);
  assert.match(getProjectUploadFileError({ ...pdf, name: `${"a".repeat(151)}.pdf` }, []), /150 caracteres/);
});

test("la cola detecta duplicados normalizados y admite el nombre al quitar la selección", () => {
  const candidate = { ...pdf, name: " plano.pdf " };
  assert.match(getProjectUploadFileError(candidate, [{ file: pdf }]), /ya está seleccionado/);
  assert.equal(getProjectUploadFileError(candidate, []), "");
});

test("la tarjeta formatea progreso y tamaño con la notación compacta de Figma", () => {
  assert.equal(formatProjectUploadSize(0), "0KB");
  assert.equal(formatProjectUploadSize(17), "1KB");
  assert.equal(formatProjectUploadSize(200 * 1024), "200KB");
  assert.equal(formatProjectUploadSize(1024 * 1024), "1.0MB");
});
