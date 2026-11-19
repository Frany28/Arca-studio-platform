import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FILE_CONTEXTS,
  FILE_OWNER_ENTITIES,
  describeVisibleLocation,
  findAmbiguousLabels,
  getFileContext,
  resolveFilesRowContext,
} from "../src/domain/fileContexts.js";
import { FILE_PENDING_DECISIONS } from "../src/domain/projectFileDecisions.js";
import { uploadPolicies } from "../src/services/fileUploadService.js";

const BACKEND = new URL("../", import.meta.url);

test("el catálogo cubre los cinco contextos existentes con códigos estables", () => {
  assert.deepEqual(Object.keys(FILE_CONTEXTS).sort(), [
    "profile_photo",
    "project_file",
    "project_request_attachment",
    "quote_pdf",
    "support_attachment",
  ]);
  for (const [code, context] of Object.entries(FILE_CONTEXTS)) {
    assert.equal(context.code, code);
    assert.ok(context.label);
    assert.ok(Object.isFrozen(context));
  }
  assert.throws(() => getFileContext("signature"), { code: "UNKNOWN_FILE_CONTEXT" });
  assert.throws(() => getFileContext("toString"), { code: "UNKNOWN_FILE_CONTEXT" });
});

test("cada contexto nombra su ubicación con entidades legibles conocidas, empezando por su propietario visible", () => {
  for (const context of Object.values(FILE_CONTEXTS)) {
    assert.ok(context.ownerChain.length > 0, context.code);
    for (const entity of context.ownerChain) assert.ok(FILE_OWNER_ENTITIES[entity], `${context.code}: ${entity}`);
    assert.ok(context.ownerChain.includes(context.ownerEntity), context.code);
  }
  // Los archivos de proyecto se muestran por cliente › proyecto › carpetas.
  assert.deepEqual(FILE_CONTEXTS.project_file.ownerChain, ["client", "project", "project_folder"]);
});

test("las políticas de subida del catálogo existen y coinciden con las que usan los controladores", async () => {
  for (const context of Object.values(FILE_CONTEXTS)) {
    if (context.uploadPolicy === null) {
      assert.equal(context.generated, true, context.code);
      continue;
    }
    assert.ok(uploadPolicies[context.uploadPolicy], `${context.code}: ${context.uploadPolicy}`);
  }
  const sources = {
    profile_photo: "src/controllers/authController.js",
    project_file: "src/controllers/fileController.js",
    support_attachment: "src/controllers/supportController.js",
  };
  for (const [code, file] of Object.entries(sources)) {
    const content = await readFile(new URL(file, BACKEND), "utf8");
    assert.ok(content.includes(`uploadPolicies.${FILE_CONTEXTS[code].uploadPolicy}`), `${code} en ${file}`);
  }
  const uploadService = await readFile(new URL("src/services/fileUploadService.js", BACKEND), "utf8");
  assert.ok(uploadService.includes("uploadPolicies.projectRequest"));
});

test("los prefijos de clave del catálogo coinciden con los constructores de claves actuales", async () => {
  const sources = await Promise.all([
    readFile(new URL("src/repositories/fileRepository.js", BACKEND), "utf8"),
    readFile(new URL("src/repositories/supportRepository.js", BACKEND), "utf8"),
    readFile(new URL("src/config/storage.js", BACKEND), "utf8"),
    readFile(new URL("src/domain/quotePdfDocument.js", BACKEND), "utf8"),
  ]).then((files) => files.join("\n"));
  for (const code of ["project_file", "project_request_attachment", "support_attachment"]) {
    assert.match(sources, new RegExp(`belongsTo:\\s*"${FILE_CONTEXTS[code].storageKeyPrefix}"`), code);
  }
  assert.match(sources, new RegExp(`"${FILE_CONTEXTS.profile_photo.storageKeyPrefix}",\\s*String\\(userId\\),\\s*"profile-photo"`));
  assert.match(sources, new RegExp(`objectKey:\\s*\`${FILE_CONTEXTS.quote_pdf.storageKeyPrefix}/`));
  assert.equal(FILE_CONTEXTS.quote_pdf.bucketRole, "quotes");
});

test("un archivo de la tabla files pertenece a un proyecto o a una solicitud, nunca a ambos", () => {
  assert.equal(resolveFilesRowContext({ project_id: "4", project_request_id: null }), "project_file");
  assert.equal(resolveFilesRowContext({ project_id: null, project_request_id: 9 }), "project_request_attachment");
  assert.throws(() => resolveFilesRowContext({ project_id: 1, project_request_id: 2 }), { code: "INVALID_FILE_OWNER" });
  assert.throws(() => resolveFilesRowContext({ project_id: null, project_request_id: null }), { code: "INVALID_FILE_OWNER" });
  // Al aprobar, el adjunto pasa al proyecto sin mover su objeto.
  assert.deepEqual(FILE_CONTEXTS.project_request_attachment.transfersTo, {
    context: "project_file",
    keepsStorageKey: true,
    originColumn: "files.origin_project_request_id",
  });
});

test("la ubicación visible usa nombres y conserva los ids internos sin mostrarlos como etiqueta", () => {
  const location = describeVisibleLocation("project_file", {
    client: { id: 7, name: "Ana Pérez" },
    project: { id: 31, name: "Casa Los Robles" },
    project_folder: [{ id: 501, name: "Documentos" }, { id: 502, name: "Propuesta inicial" }],
  });
  assert.deepEqual(location.missingLabels, []);
  assert.deepEqual(location.segments.map((segment) => segment.label), ["Ana Pérez", "Casa Los Robles", "Documentos", "Propuesta inicial"]);
  assert.deepEqual(location.segments.map((segment) => segment.id), ["7", "31", "501", "502"]);

  const profile = describeVisibleLocation("profile_photo", { user: { firstName: "Luis", id: 3, lastName: " Mora " } });
  assert.deepEqual(profile.segments, [{ entity: "user", id: "3", label: "Luis Mora" }]);

  const root = describeVisibleLocation("project_file", { client: { id: 7, name: "Ana Pérez" }, project: { id: 31, name: "Casa Los Robles" } });
  assert.equal(root.segments.length, 2);
});

test("sin nombre, la ubicación informa la etiqueta ausente en lugar de mostrar un número", () => {
  const location = describeVisibleLocation("project_request_attachment", {
    client: { id: 7, name: "Ana Pérez" },
    project_request: { id: 88, name: null },
  });
  assert.deepEqual(location.segments.map((segment) => segment.label), ["Ana Pérez"]);
  assert.deepEqual(location.missingLabels, [{ entity: "project_request", id: "88" }]);
  for (const segment of location.segments) assert.notEqual(segment.label, segment.id);

  const missingEntity = describeVisibleLocation("quote_pdf", { quote: { id: 57, name: "COT-057" } });
  assert.deepEqual(missingEntity.missingLabels, [{ entity: "client", id: null }]);
});

test("los nombres repetidos se detectan sin decidir todavía cómo distinguirlos (D12)", () => {
  assert.deepEqual(findAmbiguousLabels([
    { id: 1, label: "Ana Pérez" },
    { id: 2, label: " ana  pérez" },
    { id: 3, label: "Luis Mora" },
    { id: 4, label: "" },
  ]), [{ ids: ["1", "2"], key: "ana pérez" }]);
});

test("cada contexto declara las decisiones abiertas que le afectan", () => {
  assert.ok(FILE_CONTEXTS.project_file.pendingDecisions.includes("DA1"));
  for (const resolved of ["D3", "D4", "DA2", "DA3", "DA5"]) assert.equal(FILE_CONTEXTS.project_file.pendingDecisions.includes(resolved), false, resolved);
  assert.ok(FILE_CONTEXTS.support_attachment.pendingDecisions.includes("A2"));
  assert.ok(FILE_CONTEXTS.quote_pdf.pendingDecisions.includes("A6"));
  for (const context of Object.values(FILE_CONTEXTS)) {
    for (const decision of context.pendingDecisions) assert.match(decision, /^(D\d{1,2}|DA\d{1,2}|A\d{1,2})$/, context.code);
  }
  // Las decisiones de archivos de proyecto existen en el registro del dominio (sin identificadores sueltos).
  for (const decision of FILE_CONTEXTS.project_file.pendingDecisions.filter((code) => code.startsWith("D"))) {
    assert.ok(FILE_PENDING_DECISIONS[decision], decision);
  }
  assert.equal(FILE_CONTEXTS.project_file.pendingDecisions.includes("D5"), false, "D5 quedó superada");
});
