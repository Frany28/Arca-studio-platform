import assert from "node:assert/strict";
import test from "node:test";

import { getProjectImageSource, getProjectRequestImageSource } from "../src/utils/projectImage.js";

test("la miniatura de una solicitud usa su adjunto y, aprobada, la imagen del proyecto", () => {
  assert.match(
    getProjectRequestImageSource({ id: 7, imageFileId: 21, status: "pending_review" }),
    /\/api\/project-requests\/7\/files\/21\/content$/,
  );
  // Convertida: los adjuntos ya son del proyecto y su portada puede ser una imagen nueva.
  assert.match(
    getProjectRequestImageSource({ convertedProjectId: 40, id: 7, imageFileId: 22, imageFileVersionId: 5, status: "converted" }),
    /\/api\/projects\/40\/files\/22\/content\?versionId=5$/,
  );
  assert.equal(getProjectRequestImageSource({ id: 7, imageFileId: null, status: "rejected" }), null, "sin imagen: placeholder");
  assert.equal(getProjectRequestImageSource(null), null);
});

test("project covers are reconstructed from protected identifiers", () => {
  assert.match(
    getProjectImageSource({
      id: 12,
      imageFileId: 34,
      imageFileVersionId: 56,
    }),
    /\/api\/projects\/12\/files\/34\/content\?versionId=56$/,
  );
});

test("local presentation images remain valid fallbacks", () => {
  assert.equal(
    getProjectImageSource({ image: "/assets/example.png" }),
    "/assets/example.png",
  );
  assert.equal(getProjectImageSource({ id: 12 }), null);
});
