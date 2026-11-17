import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FOLDER_PENDING_DECISIONS,
  PROJECT_SYSTEM_FOLDERS,
  evaluateFolderContent,
  evaluateFolderOperation,
  findSystemFolderNameCollisions,
  getSystemFolder,
  resolveFolderClassification,
  systemFolderCreationOrder,
  validateFolderName,
  validateSystemFolderCatalog,
} from "../src/domain/projectFolderCatalog.js";

// Árbol de Figma 3727:618978 («Gestión de archivos»), en orden visual, como nombre por profundidad.
const FIGMA_TREE = [
  [0, "Portada del proyecto"],
  [0, "Renders e imágenes"],
  [1, "Modelos 3D"],
  [2, "Propuesta inicial"],
  [2, "Propuesta final"],
  [1, "Imágenes"],
  [2, "Propuesta inicial"],
  [3, "Antes"],
  [2, "Ejecución"],
  [2, "Resultado final"],
  [1, "Videos"],
  [2, "Propuesta inicial"],
  [2, "Ejecución"],
  [2, "Resultado final"],
  [0, "Documentos"],
  [1, "Propuesta inicial"],
  [0, "Archivos del cliente"],
];

test("el catálogo reproduce exactamente el árbol, los nombres y el orden de Figma", () => {
  assert.deepEqual(
    PROJECT_SYSTEM_FOLDERS.map((folder) => [folder.key.split(".").length - 1, folder.name]),
    FIGMA_TREE,
  );
});

test("el catálogo oficial es coherente: claves únicas y estables, padres previos y nombres únicos entre hermanas", () => {
  assert.deepEqual(validateSystemFolderCatalog(), []);
  const keys = PROJECT_SYSTEM_FOLDERS.map((folder) => folder.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const folder of PROJECT_SYSTEM_FOLDERS) {
    if (folder.parentKey) assert.ok(getSystemFolder(folder.parentKey), folder.key);
  }
  // Las claves no dependen del nombre visible: cuatro carpetas se llaman «Propuesta inicial».
  assert.equal(PROJECT_SYSTEM_FOLDERS.filter((folder) => folder.name === "Propuesta inicial").length, 4);
});

test("la validación detecta claves duplicadas, padres ausentes, claves no derivadas, ciclos y nombres repetidos", () => {
  const errors = validateSystemFolderCatalog([
    { key: "a", name: "A", parentKey: null, content: null },
    { key: "a", name: "Otra", parentKey: null, content: null },
    { key: "b.c", name: "C", parentKey: "b", content: null },
    { key: "a.x.y", name: "Y", parentKey: "a", content: null },
    { key: "a.d", name: "  ", parentKey: "a", content: null },
    { key: "a.e", name: "Duplicada", parentKey: "a", content: null },
    { key: "a.f", name: "duplicada", parentKey: "a", content: null },
    { key: "Mal-Formada", name: "M", parentKey: null, content: null },
    { key: "z.k", name: "K", parentKey: null, content: null },
    { key: "p", name: "P", parentKey: null, content: { allowsSubfolders: false } },
    { key: "p.q", name: "Q", parentKey: "p", content: null },
  ]);
  for (const expected of [
    "clave duplicada: a",
    "padre ausente o posterior: b.c → b",
    "la clave no deriva de su padre: a.x.y",
    "nombre inválido en a.d: empty",
    "nombre repetido entre hermanas: a.f y a.e",
    "clave inválida: Mal-Formada",
    "carpeta raíz con clave compuesta: z.k",
    "el padre no admite subcarpetas: p.q",
  ]) {
    assert.ok(errors.includes(expected), `Falta: ${expected}\n${errors.join("\n")}`);
  }
});

test("el orden de creación coloca cada carpeta después de su madre", () => {
  const order = systemFolderCreationOrder().map((folder) => folder.key);
  assert.equal(order.length, PROJECT_SYSTEM_FOLDERS.length);
  for (const folder of PROJECT_SYSTEM_FOLDERS) {
    if (folder.parentKey) assert.ok(order.indexOf(folder.parentKey) < order.indexOf(folder.key), folder.key);
  }
});

test("el catálogo es inmutable", () => {
  assert.ok(Object.isFrozen(PROJECT_SYSTEM_FOLDERS));
  assert.ok(Object.isFrozen(getSystemFolder("cover").content.acceptedExtensions));
  assert.throws(() => {
    PROJECT_SYSTEM_FOLDERS[0].name = "Otra";
  }, TypeError);
});

test("la portada admite una sola imagen JPG o PNG y solo se reemplaza (Figma)", () => {
  const cover = { systemKey: "cover" };
  assert.deepEqual(evaluateFolderContent(cover, { currentFileCount: 0, extension: "PNG" }), { outcome: "allowed", reason: "CONTENT_ACCEPTED" });
  assert.deepEqual(evaluateFolderContent(cover, { currentFileCount: 0, extension: ".jpeg" }), { outcome: "allowed", reason: "CONTENT_ACCEPTED" });
  assert.deepEqual(evaluateFolderContent(cover, { currentFileCount: 0, extension: "webp" }), { outcome: "forbidden", reason: "FILE_TYPE_NOT_ACCEPTED" });
  assert.deepEqual(evaluateFolderContent(cover, { currentFileCount: 1, extension: "jpg" }), { outcome: "forbidden", reason: "FOLDER_FULL_REPLACE_EXISTING" });
  assert.deepEqual(evaluateFolderOperation({ operation: "create_child", parent: cover }), { outcome: "forbidden", reason: "FOLDER_DOES_NOT_ALLOW_SUBFOLDERS" });
});

test("el contenido de las demás carpetas queda pendiente de D14, sin valores supuestos", () => {
  for (const folder of PROJECT_SYSTEM_FOLDERS.filter((candidate) => candidate.key !== "cover")) {
    assert.equal(folder.content, null, folder.key);
    assert.ok(folder.pendingDecisions.includes("D14"), folder.key);
    assert.deepEqual(evaluateFolderContent({ systemKey: folder.key }, { currentFileCount: 0, extension: "pdf" }), {
      decision: "D14",
      outcome: "pending_decision",
      reason: "FOLDER_CONTENT_UNDECIDED",
    });
  }
  assert.equal(evaluateFolderContent({ systemKey: null }, { currentFileCount: 0, extension: "pdf" }).outcome, "pending_decision");
});

test("las carpetas predeterminadas no se renombran, eliminan ni mueven", () => {
  for (const folder of PROJECT_SYSTEM_FOLDERS) {
    for (const operation of ["rename", "delete", "move"]) {
      assert.deepEqual(evaluateFolderOperation({ folder: { systemKey: folder.key }, operation }), { outcome: "forbidden", reason: "SYSTEM_FOLDER_PROTECTED" }, `${operation} ${folder.key}`);
    }
  }
});

test("las carpetas personalizadas se renombran y solo se eliminan vacías; moverlas depende de D13", () => {
  const custom = { systemKey: null };
  assert.deepEqual(evaluateFolderOperation({ folder: custom, operation: "rename" }), { outcome: "allowed", reason: "CUSTOM_FOLDER" });
  assert.deepEqual(evaluateFolderOperation({ folder: { ...custom, hasChildren: false, hasFiles: false }, operation: "delete" }), { outcome: "allowed", reason: "EMPTY_CUSTOM_FOLDER" });
  assert.deepEqual(evaluateFolderOperation({ folder: { ...custom, hasFiles: true }, operation: "delete" }), { outcome: "forbidden", reason: "FOLDER_NOT_EMPTY" });
  assert.deepEqual(evaluateFolderOperation({ folder: { ...custom, hasChildren: true }, operation: "delete" }), { outcome: "forbidden", reason: "FOLDER_NOT_EMPTY" });
  assert.deepEqual(evaluateFolderOperation({ folder: custom, operation: "move", parent: null }), { decision: "D13", outcome: "pending_decision", reason: "CUSTOM_FOLDER_MOVE_UNDECIDED" });
  // Una clave que no existe en el catálogo no convierte la carpeta en protegida.
  assert.equal(evaluateFolderOperation({ folder: { systemKey: "inventada" }, operation: "rename" }).outcome, "allowed");
});

test("crear carpetas personalizadas: dentro de otra personalizada sí; raíz y predeterminadas pendientes de D7 y D13", () => {
  assert.deepEqual(evaluateFolderOperation({ operation: "create_child", parent: { systemKey: null } }), { outcome: "allowed", reason: "INSIDE_CUSTOM_FOLDER" });
  assert.deepEqual(evaluateFolderOperation({ operation: "create_child", parent: null }), { decision: "D7", outcome: "pending_decision", reason: "ROOT_CUSTOM_FOLDER_UNDECIDED" });
  assert.deepEqual(evaluateFolderOperation({ operation: "create_child", parent: { systemKey: "renders.images.execution" } }), {
    decision: "D13",
    outcome: "pending_decision",
    reason: "CUSTOM_FOLDER_IN_SYSTEM_FOLDER_UNDECIDED",
  });
  assert.throws(() => evaluateFolderOperation({ operation: "copy" }), { code: "UNKNOWN_FOLDER_OPERATION" });
});

test("los nombres se validan como en la API y sin repetir una hermana, incluida una predeterminada", () => {
  const siblings = [{ id: 1, name: "Documentos" }, { id: 2, name: "Planos" }];
  assert.equal(validateFolderName("  ", siblings), "empty");
  assert.equal(validateFolderName("x".repeat(121), siblings), "too_long");
  assert.equal(validateFolderName("x".repeat(120), siblings), null);
  assert.equal(validateFolderName(" documentos ", siblings), "duplicate_sibling");
  assert.equal(validateFolderName("PLANOS", siblings, { ignoreId: 2 }), null);
  assert.equal(validateFolderName("Fachada", siblings), null);
});

test("la clasificación se hereda de la carpeta predeterminada más cercana, no del nombre", () => {
  assert.deepEqual(resolveFolderClassification([{ systemKey: "renders" }, { systemKey: "renders.videos" }, { systemKey: "renders.videos.execution" }, { systemKey: null }]), {
    pendingDecisions: ["D13", "D14"],
    section: "videos",
    stage: "execution",
    systemKey: "renders.videos.execution",
  });
  // Una carpeta personalizada llamada «Videos» en la raíz no hereda nada.
  assert.deepEqual(resolveFolderClassification([{ systemKey: null }]), { pendingDecisions: [], section: null, stage: null, systemKey: null });
  const before = resolveFolderClassification([{ systemKey: "renders.images.initial_proposal.before" }]);
  assert.equal(before.stage, null);
  assert.ok(before.pendingDecisions.includes("D2"));
  const models = resolveFolderClassification([{ systemKey: "renders.models.final_proposal" }]);
  assert.equal(models.section, "models_3d");
  assert.ok(models.pendingDecisions.includes("D6"));
});

test("las colisiones de nombre con carpetas predeterminadas se informan sin adoptarlas", () => {
  const collisions = findSystemFolderNameCollisions([
    { id: 10, name: "documentos", parentIsRoot: true, parentSystemKey: null },
    { id: 11, name: "Ejecución", parentIsRoot: false, parentSystemKey: "renders.images" },
    { id: 12, name: "Ejecución", parentIsRoot: true, parentSystemKey: null },
    { id: 13, name: "Planos", parentIsRoot: true, parentSystemKey: null },
    { id: 14, name: "Documentos", parentIsRoot: false, parentSystemKey: null },
  ]);
  assert.deepEqual(collisions, [
    { folderId: "10", systemKey: "documents" },
    { folderId: "11", systemKey: "renders.images.execution" },
  ]);
});

test("el catálogo no incluye carpetas que dependen de decisiones abiertas y las documenta", () => {
  assert.equal(PROJECT_SYSTEM_FOLDERS.some((folder) => /garant/i.test(folder.name) || folder.key.includes("warrant")), false);
  for (const decision of ["D1", "D2", "D6", "D7", "D13", "D14"]) assert.ok(FOLDER_PENDING_DECISIONS[decision], decision);
  const referenced = new Set(PROJECT_SYSTEM_FOLDERS.flatMap((folder) => folder.pendingDecisions));
  for (const decision of referenced) assert.ok(FOLDER_PENDING_DECISIONS[decision], `Decisión sin documentar: ${decision}`);
});
