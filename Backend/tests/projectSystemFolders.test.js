import assert from "node:assert/strict";
import { test } from "node:test";

import { PROJECT_SYSTEM_FOLDERS } from "../src/domain/projectFolderCatalog.js";
import { ensureProjectSystemFolders, findSystemTreeProblems } from "../src/repositories/projectSystemFolderRepository.js";

/**
 * Cliente simulado con un estado mínimo de carpetas, que imita el árbitro único por clave.
 *
 * @param {object} [options] - Estado inicial.
 * @param {boolean} [options.projectExists] - Si el proyecto existe.
 * @param {Array<object>} [options.folders] - Carpetas ya presentes.
 * @returns {{ query: Function, statements: Array<{ text: string, params: unknown[] }>, folders: Array<object> }} Cliente.
 */
function createClient({ folders = [], projectExists = true } = {}) {
  const client = {
    folders: [...folders],
    statements: [],
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      client.statements.push({ params, text });
      if (text.startsWith("select id from public.projects")) return { rowCount: projectExists ? 1 : 0, rows: projectExists ? [{ id: params[0] }] : [] };
      if (text.startsWith("insert into public.project_folders")) {
        const [, , keys, names, parentKeys] = params;
        let inserted = 0;
        keys.forEach((key, index) => {
          const parentReady = parentKeys[index] === null || client.folders.some((folder) => folder.system_key === parentKeys[index]);
          if (client.folders.some((folder) => folder.system_key === key) || !parentReady) return;
          client.folders.push({ id: 1000 + client.folders.length, name: names[index], parent_key: parentKeys[index], system_key: key });
          inserted += 1;
        });
        return { rowCount: inserted, rows: [] };
      }
      if (text.startsWith("select folder.system_key")) {
        const rows = client.folders.filter((folder) => folder.system_key).map(({ parent_key: parentKey, system_key: systemKey }) => ({ parent_key: parentKey, system_key: systemKey }));
        return { rowCount: rows.length, rows };
      }
      if (text.startsWith("select id, parent_id, system_key, name")) {
        // Carpetas vigentes con su madre por id (las predeterminadas se enlazan por la clave de su madre).
        const rows = client.folders.map((folder) => ({
          id: folder.id, name: folder.name, system_key: folder.system_key ?? null,
          parent_id: folder.parent_id ?? client.folders.find((candidate) => candidate.system_key && candidate.system_key === folder.parent_key)?.id ?? null,
        }));
        return { rowCount: rows.length, rows };
      }
      throw new Error(`Sentencia no simulada: ${text}`);
    },
  };
  return client;
}

test("crea las 22 carpetas con nombres del catálogo, madres antes que hijas y una sentencia por nivel", async () => {
  const client = createClient();
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 }), { blocked: [], conflicts: [], created: 22, total: 22 });

  assert.match(client.statements[0].text, /for update$/, "Primero bloquea el proyecto");
  const inserts = client.statements.filter((statement) => statement.text.startsWith("insert into public.project_folders"));
  assert.equal(inserts.length, 4, "Un INSERT por nivel de profundidad");
  assert.match(inserts[0].text, /on conflict \(project_id, system_key\) where system_key is not null and deleted_at is null do nothing$/);
  for (const insert of inserts) assert.deepEqual(insert.params.slice(0, 2), [50, 2]);
  assert.deepEqual(inserts[0].params[2], ["cover", "renders", "documents", "client_files"]);
  assert.deepEqual(inserts[1].params[2], [
    "renders.models", "renders.images", "renders.videos",
    "documents.quotes", "documents.initial_proposal", "documents.records", "documents.plans", "documents.warranties", "documents.additional",
  ]);
  const panoramas = client.folders.find((folder) => folder.system_key === "renders.models");
  assert.deepEqual([panoramas.name, panoramas.parent_key], ["Panorámicas", "renders"]);
  const warranties = client.folders.find((folder) => folder.system_key === "documents.warranties");
  assert.deepEqual({ ...warranties, id: undefined }, { id: undefined, name: "Garantías", parent_key: "documents", system_key: "documents.warranties" });
  const quotes = client.folders.find((folder) => folder.system_key === "documents.quotes");
  assert.deepEqual([quotes.name, quotes.parent_key], ["Cotizaciones", "documents"]);

  assert.deepEqual(
    client.folders.map((folder) => [folder.system_key, folder.name]).sort(),
    PROJECT_SYSTEM_FOLDERS.map((folder) => [folder.key, folder.name]).sort(),
  );
});

test("es idempotente: una repetición no crea carpetas nuevas", async () => {
  const client = createClient();
  await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 });
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 3, projectId: 50 }), { blocked: [], conflicts: [], created: 0, total: 22 });
  assert.equal(client.folders.length, 22);
});

test("completa un árbol parcial sin tocar las carpetas que ya existen", async () => {
  const client = createClient({ folders: [{ name: "Portada del proyecto", parent_key: null, system_key: "cover" }] });
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 }), { blocked: [], conflicts: [], created: 21, total: 22 });
});

test("un proyecto creado con un catálogo anterior solo recibe las carpetas nuevas y conserva las suyas", async () => {
  // Árbol de 17 carpetas (antes de «Garantías» y de las categorías documentales) con el nombre guardado
  // anterior («Modelos 3D»): la clave no cambia.
  const added = ["documents.warranties", "documents.quotes", "documents.records", "documents.plans", "documents.additional"];
  const previous = PROJECT_SYSTEM_FOLDERS
    .filter((folder) => !added.includes(folder.key))
    .map((folder) => ({ name: folder.key === "renders.models" ? "Modelos 3D" : folder.name, parent_key: folder.parentKey, system_key: folder.key }));
  const client = createClient({ folders: previous });
  const before = client.folders.length;
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 }), { blocked: [], conflicts: [], created: 5, total: 22 });
  assert.equal(client.folders.find((folder) => folder.system_key === "renders.models").name, "Modelos 3D", "no renombra filas existentes");
  assert.deepEqual(client.folders.slice(before).map((folder) => folder.system_key).sort(), ["documents.additional", "documents.plans", "documents.quotes", "documents.records", "documents.warranties"]);
});

test("un proyecto inexistente o eliminado responde PROJECT_NOT_FOUND sin insertar", async () => {
  const client = createClient({ projectExists: false });
  await assert.rejects(ensureProjectSystemFolders(client, { createdBy: 2, projectId: 99 }), { code: "PROJECT_NOT_FOUND" });
  assert.equal(client.statements.length, 1);
});

test("un árbol que no coincide con el catálogo aborta para que la transacción se revierta", async () => {
  // Una carpeta predeterminada con otra madre: la inserción no la cambia y la verificación lo detecta.
  const client = createClient({ folders: [{ name: "Imágenes", parent_key: "documents", system_key: "renders.images" }] });
  await assert.rejects(ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 }), (error) => {
    assert.equal(error.code, "PROJECT_SYSTEM_FOLDERS_INCONSISTENT");
    assert.match(error.message, /madre incorrecta en renders\.images/);
    return true;
  });
});

test("la verificación informa claves ausentes e ignora claves retiradas del catálogo", () => {
  const complete = PROJECT_SYSTEM_FOLDERS.map((folder) => ({ parent_key: folder.parentKey, system_key: folder.key }));
  assert.deepEqual(findSystemTreeProblems(complete), []);
  assert.deepEqual(findSystemTreeProblems([...complete, { parent_key: null, system_key: "retirada" }]), []);
  assert.deepEqual(findSystemTreeProblems(complete.filter((row) => row.system_key !== "client_files")), ["falta client_files"]);
});

test("sincronización de un proyecto existente: omite la carpeta en conflicto, crea el resto y no toca la personalizada", async () => {
  const previous = PROJECT_SYSTEM_FOLDERS
    .filter((folder) => !["documents.quotes", "documents.records", "documents.plans", "documents.additional"].includes(folder.key))
    .map((folder, index) => ({ id: index + 1, name: folder.name, parent_key: folder.parentKey, system_key: folder.key }));
  const documentsId = previous.find((folder) => folder.system_key === "documents").id;
  const custom = { id: 500, name: "Cotizaciones", parent_id: documentsId, parent_key: null, system_key: null };
  const client = createClient({ folders: [...previous, custom] });

  const result = await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50, skipNameConflicts: true });
  assert.deepEqual(result.conflicts, [{ existingSystemKey: null, folderId: 500, folderName: "Cotizaciones", systemKey: "documents.quotes" }]);
  assert.deepEqual([result.created, result.blocked], [3, []]);
  assert.equal(client.folders.filter((folder) => folder.system_key === "documents.quotes").length, 0, "no crea un duplicado");
  assert.deepEqual(client.folders.find((folder) => folder.id === 500), custom, "la personalizada conserva nombre, madre y significado");
  const inserted = client.statements.filter((statement) => statement.text.startsWith("insert into public.project_folders")).flatMap((statement) => statement.params[2]);
  assert.equal(inserted.includes("documents.quotes"), false);

  // Repetirlo no crea nada más y sigue informando el conflicto.
  const again = await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50, skipNameConflicts: true });
  assert.deepEqual([again.created, again.conflicts.length], [0, 1]);
});

test("findSystemTreeProblems ignora solo las claves omitidas a propósito", () => {
  const rows = PROJECT_SYSTEM_FOLDERS.filter((folder) => folder.key !== "documents.quotes").map((folder) => ({ parent_key: folder.parentKey, system_key: folder.key }));
  assert.deepEqual(findSystemTreeProblems(rows), ["falta documents.quotes"]);
  assert.deepEqual(findSystemTreeProblems(rows, new Set(["documents.quotes"])), []);
});
