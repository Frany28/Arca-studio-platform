import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FOLDER_PENDING_DECISIONS,
  PROJECT_SYSTEM_FOLDERS,
  WARRANTY_DOCUMENTS_FOLDER_KEY,
  evaluateFolderContent,
  evaluateFolderOperation,
  findSystemFolderNameCollisions,
  getSystemFolder,
  orderFolderTree,
  resolveFolderClassification,
  resolveFolderDisplayName,
  systemFolderCreationOrder,
  validateFolderName,
  validateSystemFolderCatalog,
} from "../src/domain/projectFolderCatalog.js";

// Árbol de Figma 3727:618978 y 3727:682730 («Gestión de archivos»), en orden visual, como nombre por
// profundidad, con «Panorámicas» (clave renders.models) y «Documentos › Garantías» confirmados.
const FIGMA_TREE = [
  [0, "Portada del proyecto"],
  [0, "Renders e imágenes"],
  [1, "Panorámicas"],
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
  [1, "Garantías"],
  [0, "Archivos del cliente"],
];

test("el catálogo reproduce exactamente el árbol, los nombres y el orden confirmados", () => {
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
  // Toda carpeta con clave funcional está protegida, aunque su clave saliera del catálogo (como en la API).
  for (const operation of ["rename", "delete", "move"]) {
    assert.deepEqual(evaluateFolderOperation({ folder: { systemKey: "legacy.retired" }, operation }), { outcome: "forbidden", reason: "SYSTEM_FOLDER_PROTECTED" });
  }
});

test("crear carpetas personalizadas: dentro de cualquier otra salvo la portada; la raíz depende de D7", () => {
  assert.deepEqual(evaluateFolderOperation({ operation: "create_child", parent: { systemKey: null } }), { outcome: "allowed", reason: "INSIDE_CUSTOM_FOLDER" });
  assert.deepEqual(evaluateFolderOperation({ operation: "create_child", parent: null }), { decision: "D7", outcome: "pending_decision", reason: "ROOT_CUSTOM_FOLDER_UNDECIDED" });
  for (const folder of PROJECT_SYSTEM_FOLDERS.filter((candidate) => candidate.key !== "cover")) {
    assert.deepEqual(evaluateFolderOperation({ operation: "create_child", parent: { systemKey: folder.key } }), { outcome: "allowed", reason: "INSIDE_SYSTEM_FOLDER" }, folder.key);
  }
  assert.equal(evaluateFolderOperation({ operation: "create_child", parent: { systemKey: "cover" } }).outcome, "forbidden");
  assert.equal(evaluateFolderOperation({ operation: "create_child", parent: { systemKey: "legacy.retired" } }).outcome, "allowed");
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
    pendingDecisions: ["D14"],
    section: "videos",
    stage: "execution",
    systemKey: "renders.videos.execution",
  });
  // Una carpeta personalizada llamada «Videos» en la raíz no hereda nada.
  assert.deepEqual(resolveFolderClassification([{ systemKey: null }]), { pendingDecisions: [], section: null, stage: null, systemKey: null });
  const before = resolveFolderClassification([{ systemKey: "renders.images.initial_proposal.before" }]);
  assert.equal(before.stage, null);
  assert.ok(before.pendingDecisions.includes("D2"));
  // «Panorámicas» conserva la clave y la sección de «Modelos 3D»; D6 ya está resuelta.
  const panoramas = resolveFolderClassification([{ systemKey: "renders.models" }, { systemKey: "renders.models.final_proposal" }]);
  assert.deepEqual(panoramas, { pendingDecisions: ["D14"], section: "models_3d", stage: "final_proposal", systemKey: "renders.models.final_proposal" });
  // Una subcarpeta personalizada de «Garantías» sigue clasificada como garantías.
  const warranty = resolveFolderClassification([{ systemKey: "documents" }, { systemKey: "documents.warranties" }, { systemKey: null }]);
  assert.equal(warranty.section, "warranties");
  assert.equal(warranty.systemKey, "documents.warranties");
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

test("orden de lectura: preorden del árbol, predeterminadas según el catálogo y personalizadas por nombre e id", () => {
  // Ids asignados en orden inverso al catálogo para que el id no explique el resultado.
  const system = PROJECT_SYSTEM_FOLDERS.map((folder, index) => ({ id: 100 - index, key: folder.key, name: folder.name, parentKey: folder.parentKey }));
  const idByKey = new Map(system.map((folder) => [folder.key, folder.id]));
  const rows = [
    { id: 300, name: "zeta", parentId: null, systemKey: null },
    { id: 301, name: "Alfa", parentId: null, systemKey: null },
    { id: 302, name: "alfa", parentId: null, systemKey: null },
    { id: 303, name: "Interior", parentId: idByKey.get("renders.images"), systemKey: null },
    { id: 304, name: "Detalle", parentId: 303, systemKey: null },
    { id: 305, name: "Retirada", parentId: null, systemKey: "legacy.retired" },
    ...system.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentKey ? idByKey.get(folder.parentKey) : null, systemKey: folder.key })),
  ].reverse();

  const ordered = orderFolderTree(rows);
  const labels = ordered.map((folder) => folder.systemKey ?? `custom:${folder.id}`);
  assert.deepEqual(labels, [
    "cover",
    "renders",
    "renders.models",
    "renders.models.initial_proposal",
    "renders.models.final_proposal",
    "renders.images",
    "renders.images.initial_proposal",
    "renders.images.initial_proposal.before",
    "renders.images.execution",
    "renders.images.final_result",
    "custom:303",
    "custom:304",
    "renders.videos",
    "renders.videos.initial_proposal",
    "renders.videos.execution",
    "renders.videos.final_result",
    "documents",
    "documents.initial_proposal",
    "documents.warranties",
    "client_files",
    "legacy.retired",
    "custom:301",
    "custom:302",
    "custom:300",
  ]);
  // Mismo resultado con otros órdenes de entrada (invertido y rotado).
  for (const permutation of [[...rows].reverse(), [...rows.slice(7), ...rows.slice(0, 7)]]) {
    assert.deepEqual(orderFolderTree(permutation).map((folder) => folder.id), ordered.map((folder) => folder.id));
  }
});

test("orden de lectura: madres ausentes y ciclos no ocultan carpetas", () => {
  const ordered = orderFolderTree([
    { id: 1, name: "B", parentId: 99, systemKey: null },
    { id: 2, name: "A", parentId: null, systemKey: null },
    { id: 3, name: "Ciclo 1", parentId: 4, systemKey: null },
    { id: 4, name: "Ciclo 2", parentId: 3, systemKey: null },
  ]);
  assert.deepEqual(ordered.map((folder) => folder.id), [2, 1, 3, 4]);
});

test("«Panorámicas» conserva la clave renders.models y sus subcarpetas, con su jerarquía", () => {
  assert.equal(getSystemFolder("renders.models").name, "Panorámicas");
  assert.equal(getSystemFolder("renders.models").parentKey, "renders");
  assert.deepEqual(
    PROJECT_SYSTEM_FOLDERS.filter((folder) => folder.parentKey === "renders.models").map((folder) => [folder.key, folder.name]),
    [["renders.models.initial_proposal", "Propuesta inicial"], ["renders.models.final_proposal", "Propuesta final"]],
  );
  assert.equal(PROJECT_SYSTEM_FOLDERS.some((folder) => folder.name === "Modelos 3D"), false);
});

test("«Documentos › Garantías» usa la clave documents.warranties dentro de Documentos", () => {
  assert.equal(WARRANTY_DOCUMENTS_FOLDER_KEY, "documents.warranties");
  assert.deepEqual(getSystemFolder("documents.warranties"), {
    content: null,
    key: "documents.warranties",
    name: "Garantías",
    parentKey: "documents",
    pendingDecisions: ["D14"],
    section: "warranties",
    stage: null,
  });
  assert.deepEqual(
    PROJECT_SYSTEM_FOLDERS.filter((folder) => folder.parentKey === "documents").map((folder) => folder.key),
    ["documents.initial_proposal", "documents.warranties"],
  );
  // Admite subcarpetas personalizadas y está protegida como cualquier predeterminada.
  assert.equal(evaluateFolderOperation({ operation: "create_child", parent: { systemKey: "documents.warranties" } }).outcome, "allowed");
  assert.equal(evaluateFolderOperation({ folder: { systemKey: "documents.warranties" }, operation: "delete" }).reason, "SYSTEM_FOLDER_PROTECTED");
});

test("el nombre visible de una carpeta predeterminada sale del catálogo; el de una personalizada, de su fila", () => {
  assert.equal(resolveFolderDisplayName({ name: "Modelos 3D", systemKey: "renders.models" }), "Panorámicas");
  assert.equal(resolveFolderDisplayName({ name: "Planos", systemKey: null }), "Planos");
  assert.equal(resolveFolderDisplayName({ name: "Retirada", systemKey: "legacy.retired" }), "Retirada");
});

test("las decisiones de carpetas resueltas salen del registro y las pendientes están documentadas", () => {
  for (const resolved of ["D1", "D6"]) assert.equal(Object.hasOwn(FOLDER_PENDING_DECISIONS, resolved), false, resolved);
  for (const decision of ["D2", "D7", "D13", "D14"]) assert.ok(FOLDER_PENDING_DECISIONS[decision], decision);
  const referenced = new Set(PROJECT_SYSTEM_FOLDERS.flatMap((folder) => folder.pendingDecisions));
  for (const decision of referenced) assert.ok(FOLDER_PENDING_DECISIONS[decision], `Decisión sin documentar: ${decision}`);
  // D13 ya no afecta a cada carpeta: solo describe mover carpetas personalizadas.
  assert.equal(PROJECT_SYSTEM_FOLDERS.some((folder) => folder.pendingDecisions.includes("D13")), false);
});
