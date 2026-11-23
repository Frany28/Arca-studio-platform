import assert from "node:assert/strict";
import { test } from "node:test";

import { PROJECT_SYSTEM_FOLDERS } from "../src/domain/projectFolderCatalog.js";
import { sha256 } from "../src/services/projectFileCompatibilityService.js";
import {
  applyFolderSyncPlan,
  buildFolderSyncPlan,
  readFolderSyncPlan,
  serializeFolderSyncPlan,
  verifyFolderSync,
} from "../src/services/projectFolderSyncService.js";

// Sincronización de carpetas y clasificación documental con una base simulada con estado: reconoce
// solo las sentencias del flujo (lecturas del plan, bloqueo, inserción por nivel, asignación de
// carpeta y auditoría) e imita transacciones con una copia del estado. El SQL real se cubre en
// projectFolderSync.integration.test.js (PostgreSQL desechable).

const NEW_KEYS = ["documents.quotes", "documents.records", "documents.plans", "documents.additional"];

/**
 * Árbol predeterminado anterior a las categorías documentales para un proyecto.
 *
 * @param {number} projectId - Proyecto.
 * @param {number} base - Primer id.
 * @returns {Array<object>} Carpetas.
 */
function previousTree(projectId, base) {
  const definitions = PROJECT_SYSTEM_FOLDERS.filter((folder) => !NEW_KEYS.includes(folder.key));
  const ids = new Map(definitions.map((folder, index) => [folder.key, base + index]));
  return definitions.map((folder) => ({
    deleted: false, id: ids.get(folder.key), name: folder.name, parentId: folder.parentKey ? ids.get(folder.parentKey) : null, projectId, systemKey: folder.key,
  }));
}

/**
 * Base simulada: proyectos 1 (completo salvo las nuevas, con archivos) y 2 (con una «Cotizaciones» personalizada).
 *
 * @param {{ failProject?: number }} [options] - Proyecto cuya asignación falla.
 * @returns {object} Cliente con estado.
 */
function createDatabase({ failProject = null } = {}) {
  let state = {
    audits: [],
    files: [
      { category: "image", folderId: null, id: 11, projectId: 1, requestId: 70, title: "Fachada cliente.jpg" },
      { category: "image", folderId: null, id: 12, projectId: 1, requestId: null, title: "Render.png" },
      { category: "video", folderId: null, id: 13, projectId: 1, requestId: null, title: "Recorrido.mp4" },
      { category: "panorama", folderId: null, id: 14, projectId: 1, requestId: null, title: "Sala 360.jpg" },
      { category: "document", folderId: null, id: 15, projectId: 1, requestId: null, title: "Documento.pdf" },
      { category: "document", folderId: 103, id: 16, projectId: 1, requestId: null, title: "Plano.pdf" },
      { category: "document", folderId: null, id: 21, projectId: 2, requestId: 71, title: "Escritura.pdf" },
    ],
    folders: [...previousTree(1, 100), ...previousTree(2, 200)],
    nextId: 1000,
    projects: [{ id: 1, name: "Quinta" }, { id: 2, name: "Apartamento" }],
    quotes: [{ projectId: 1 }, { projectId: 1 }, { projectId: 2 }],
  };
  const documentsOf2 = state.folders.find((folder) => folder.projectId === 2 && folder.systemKey === "documents").id;
  state.folders.push({ deleted: false, id: 299, name: "Cotizaciones", parentId: documentsOf2, projectId: 2, systemKey: null });
  let snapshot = null;
  const statements = [];
  const client = {
    get state() {
      return state;
    },
    statements,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      statements.push(text);
      const result = (rows) => ({ rowCount: rows.length, rows });
      if (text === "begin") {
        snapshot = structuredClone(state);
        return result([]);
      }
      if (text === "commit") {
        snapshot = null;
        return result([]);
      }
      if (text === "rollback") {
        state = snapshot ?? state;
        snapshot = null;
        return result([]);
      }
      if (text.startsWith("select 1 from public.users u")) return result(params[0] === 9 ? [{}] : []);
      if (text.startsWith("select id, name, status::text as status from public.projects")) return result(state.projects.map((project) => ({ ...project, status: "in_process" })));
      if (text.startsWith("select folder.id, folder.project_id, folder.parent_id, folder.system_key, folder.name")) {
        return result(state.folders.filter((folder) => !folder.deleted).map((folder) => ({ id: String(folder.id), name: folder.name, parent_id: folder.parentId === null ? null : String(folder.parentId), project_id: String(folder.projectId), system_key: folder.systemKey })));
      }
      if (text.startsWith("select file.id, file.project_id, file.title")) {
        return result(state.files.filter((file) => file.folderId === null).map((file) => ({ file_category: file.category, id: String(file.id), origin_project_request_id: file.requestId, project_id: String(file.projectId), title: file.title })));
      }
      if (text.startsWith("select quote_version.project_id, count(*)::int as quotes")) {
        const counts = new Map();
        for (const quote of state.quotes) counts.set(quote.projectId, (counts.get(quote.projectId) || 0) + 1);
        return result([...counts].map(([projectId, quotes]) => ({ project_id: String(projectId), quotes })));
      }
      if (text.startsWith("select id from public.projects where id = $1 and deleted_at is null for update")) return result(state.projects.some((project) => project.id === params[0]) ? [{ id: params[0] }] : []);
      if (text.startsWith("select id, parent_id, system_key, name from public.project_folders")) {
        return result(state.folders.filter((folder) => folder.projectId === params[0] && !folder.deleted).map((folder) => ({ id: folder.id, name: folder.name, parent_id: folder.parentId, system_key: folder.systemKey })));
      }
      if (text.startsWith("insert into public.project_folders")) {
        const [projectId, , keys, names, parentKeys] = params;
        let inserted = 0;
        keys.forEach((key, index) => {
          const folders = state.folders.filter((folder) => folder.projectId === projectId && !folder.deleted);
          const parent = parentKeys[index] ? folders.find((folder) => folder.systemKey === parentKeys[index]) : null;
          if ((parentKeys[index] && !parent) || folders.some((folder) => folder.systemKey === key)) return;
          // Índice único de hermanas: un nombre repetido en la misma madre haría fallar la sentencia.
          if (folders.some((folder) => folder.parentId === (parent?.id ?? null) && folder.name.trim().toLowerCase() === names[index].trim().toLowerCase())) {
            throw Object.assign(new Error("duplicate key value violates unique constraint \"uq_project_folders_sibling_name\""), { code: "23505" });
          }
          state.folders.push({ deleted: false, id: state.nextId++, name: names[index], parentId: parent?.id ?? null, projectId, systemKey: key });
          inserted += 1;
        });
        return { rowCount: inserted, rows: [] };
      }
      if (text.startsWith("select folder.system_key, parent.system_key as parent_key")) {
        const folders = state.folders.filter((folder) => folder.projectId === params[0] && !folder.deleted);
        return result(folders.filter((folder) => folder.systemKey).map((folder) => ({ parent_key: folders.find((candidate) => candidate.id === folder.parentId)?.systemKey ?? null, system_key: folder.systemKey })));
      }
      if (text.startsWith("update public.files file set folder_id = target.id")) {
        const [fileIds, projectId, systemKey] = params;
        if (projectId === failProject) throw Object.assign(new Error("fallo simulado"), { code: "SIMULATED" });
        const target = state.folders.find((folder) => folder.projectId === projectId && folder.systemKey === systemKey && !folder.deleted);
        const moved = target ? state.files.filter((file) => fileIds.includes(file.id) && file.projectId === projectId && file.folderId === null && file.requestId !== null) : [];
        for (const file of moved) file.folderId = target.id;
        return result(moved.map((file) => ({ id: String(file.id) })));
      }
      if (text.startsWith("insert into public.audit_logs")) {
        state.audits.push({ action: params[1], entityId: params[2], newValues: JSON.parse(params[4]), userId: params[0] });
        return result([]);
      }
      throw new Error(`Sentencia no simulada: ${text.slice(0, 120)}`);
    },
  };
  return client;
}

/**
 * Plan serializado con su huella, como lo guarda el comando.
 *
 * @param {object} client - Base simulada.
 * @returns {Promise<{ plan: object, planSha256: string }>} Plan revisado.
 */
async function reviewedPlan(client) {
  const text = serializeFolderSyncPlan(await buildFolderSyncPlan(client, { now: new Date("2026-11-23T10:00:00Z"), target: "arca@test" }));
  const planSha256 = sha256(text);
  return { plan: readFolderSyncPlan(text, planSha256), planSha256 };
}

test("plan (simulación): carpetas que faltan, conflicto con una personalizada, archivos ubicables y pendientes, sin escribir", async () => {
  const client = createDatabase();
  const before = structuredClone(client.state);
  const { plan } = await reviewedPlan(client);
  assert.deepEqual(client.state, before, "el plan no modifica nada");
  assert.ok(client.statements.every((text) => text.startsWith("select")), "solo lecturas");

  const [quinta, apartamento] = plan.projects;
  assert.deepEqual(quinta.createFolders, NEW_KEYS);
  assert.deepEqual(quinta.classify.map((file) => [file.fileId, file.folderKey]), [[11, "client_files"]]);
  assert.deepEqual(quinta.pending.map((file) => [file.fileId, file.reason, file.suggestedKey]), [
    [12, "IMAGE_STAGE_UNKNOWN", "renders.images"],
    [13, "VIDEO_STAGE_UNKNOWN", "renders.videos"],
    [14, "PANORAMA_STAGE_UNKNOWN", "renders.models"],
    [15, "DOCUMENT_TYPE_UNKNOWN", "documents"],
  ]);
  assert.deepEqual(quinta.quotes, { count: 2, folderKey: "documents.quotes" });
  assert.deepEqual(apartamento.conflicts, [{ existingSystemKey: null, folderId: 299, folderName: "Cotizaciones", systemKey: "documents.quotes" }]);
  assert.deepEqual(apartamento.createFolders, ["documents.records", "documents.plans", "documents.additional"]);
  assert.deepEqual(apartamento.quotes, { count: 1, folderKey: "documents" }, "con conflicto, las cotizaciones siguen en «Documentos»");
  assert.deepEqual(plan.summary, {
    classifyByCategory: { document: 1, image: 1 },
    classifyByFolder: { client_files: 2 },
    conflicts: 1,
    filesToClassify: 2,
    foldersToCreate: 7,
    pendingByCategory: { document: 1, image: 1, panorama: 1, video: 1 },
    pendingByReason: { DOCUMENT_TYPE_UNKNOWN: 1, IMAGE_STAGE_UNKNOWN: 1, PANORAMA_STAGE_UNKNOWN: 1, VIDEO_STAGE_UNKNOWN: 1 },
    pendingFiles: 4,
    projects: 2,
    projectsToUpdate: 2,
    quotesByFolder: { documents: 1, "documents.quotes": 2 },
  });
});

test("aplicar: crea solo las carpetas que faltan, ubica los adjuntos, conserva la personalizada y es idempotente", async () => {
  const client = createDatabase();
  const { plan, planSha256 } = await reviewedPlan(client);
  const run = await applyFolderSyncPlan(client, { operatorUserId: 9, plan, planSha256, target: "arca@test" });
  assert.deepEqual(run.summary, { classifiedFiles: 2, createdFolders: 7, errors: 0, projects: 2 });

  const { state } = client;
  const clientFiles = (projectId) => state.folders.find((folder) => folder.projectId === projectId && folder.systemKey === "client_files").id;
  assert.equal(state.files.find((file) => file.id === 11).folderId, clientFiles(1));
  assert.equal(state.files.find((file) => file.id === 21).folderId, clientFiles(2));
  assert.deepEqual(state.files.filter((file) => [12, 13, 14, 15].includes(file.id)).map((file) => file.folderId), [null, null, null, null], "los pendientes no se mueven");
  assert.equal(state.files.find((file) => file.id === 16).folderId, 103, "un archivo ya ubicado no cambia");
  assert.equal(state.files.length, 7, "ningún archivo se elimina ni duplica");
  assert.deepEqual(state.folders.find((folder) => folder.id === 299), { deleted: false, id: 299, name: "Cotizaciones", parentId: state.folders.find((folder) => folder.projectId === 2 && folder.systemKey === "documents").id, projectId: 2, systemKey: null });
  assert.equal(state.folders.filter((folder) => folder.projectId === 2 && folder.systemKey === "documents.quotes").length, 0);
  assert.equal(state.folders.filter((folder) => folder.deleted).length, 0, "no se retira ninguna carpeta");
  assert.deepEqual(state.audits.map((audit) => [audit.action, audit.entityId, audit.userId, audit.newValues.createdFolders]), [
    ["project_folders.synchronized", 1, 9, 4],
    ["project_folders.synchronized", 2, 9, 3],
  ]);
  assert.equal(state.audits[0].newValues.planSha256, planSha256);

  // Repetir el mismo plan no cambia nada; la verificación no deja nada aplicable (solo el conflicto).
  const again = await applyFolderSyncPlan(client, { operatorUserId: 9, plan, planSha256, target: "arca@test" });
  assert.deepEqual(again.summary, { classifiedFiles: 0, createdFolders: 0, errors: 0, projects: 2 });
  assert.equal(state.audits.length, 2, "una repetición sin cambios no audita");
  const verification = await verifyFolderSync(client, { target: "arca@test" });
  assert.equal(verification.ok, true);
  assert.deepEqual([verification.summary.conflicts, verification.summary.pendingFiles], [1, 4]);
});

test("aplicar: un proyecto con error se revierte entero y no afecta a los demás", async () => {
  const client = createDatabase({ failProject: 1 });
  const { plan, planSha256 } = await reviewedPlan(client);
  const run = await applyFolderSyncPlan(client, { operatorUserId: 9, plan, planSha256, target: "arca@test" });
  assert.deepEqual(run.results.map((result) => [result.projectId, result.outcome]), [[1, "error"], [2, "applied"]]);
  assert.equal(client.state.folders.filter((folder) => folder.projectId === 1 && NEW_KEYS.includes(folder.systemKey)).length, 0, "sin carpetas a medias");
  assert.equal(client.state.files.find((file) => file.id === 21).folderId !== null, true);
});

test("aplicar exige el plan revisado, su destino y un administrador activo", async () => {
  const client = createDatabase();
  const text = serializeFolderSyncPlan(await buildFolderSyncPlan(client, { target: "arca@test" }));
  assert.throws(() => readFolderSyncPlan(text, "0".repeat(64)), /huella/);
  assert.throws(() => readFolderSyncPlan(JSON.stringify({ projects: [], version: 99 }), sha256(JSON.stringify({ projects: [], version: 99 }))), /versión/);
  const plan = readFolderSyncPlan(text, sha256(text));
  await assert.rejects(applyFolderSyncPlan(client, { operatorUserId: 9, plan, planSha256: sha256(text), target: "otra@base" }), /es de arca@test/);
  await assert.rejects(applyFolderSyncPlan(client, { operatorUserId: 5, plan, planSha256: sha256(text), target: "arca@test" }), /administrador activo/);
  assert.equal(client.state.audits.length, 0);
});
