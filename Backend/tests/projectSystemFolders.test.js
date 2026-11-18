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
          client.folders.push({ name: names[index], parent_key: parentKeys[index], system_key: key });
          inserted += 1;
        });
        return { rowCount: inserted, rows: [] };
      }
      if (text.startsWith("select folder.system_key")) return { rowCount: client.folders.length, rows: client.folders };
      throw new Error(`Sentencia no simulada: ${text}`);
    },
  };
  return client;
}

test("crea las 18 carpetas con nombres del catálogo, madres antes que hijas y una sentencia por nivel", async () => {
  const client = createClient();
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 }), { created: 18, total: 18 });

  assert.match(client.statements[0].text, /for update$/, "Primero bloquea el proyecto");
  const inserts = client.statements.filter((statement) => statement.text.startsWith("insert into public.project_folders"));
  assert.equal(inserts.length, 4, "Un INSERT por nivel de profundidad");
  assert.match(inserts[0].text, /on conflict \(project_id, system_key\) where system_key is not null and deleted_at is null do nothing$/);
  for (const insert of inserts) assert.deepEqual(insert.params.slice(0, 2), [50, 2]);
  assert.deepEqual(inserts[0].params[2], ["cover", "renders", "documents", "client_files"]);
  assert.deepEqual(inserts[1].params[2], ["renders.models", "renders.images", "renders.videos", "documents.initial_proposal", "documents.warranties"]);
  const panoramas = client.folders.find((folder) => folder.system_key === "renders.models");
  assert.deepEqual(panoramas, { name: "Panorámicas", parent_key: "renders", system_key: "renders.models" });
  const warranties = client.folders.find((folder) => folder.system_key === "documents.warranties");
  assert.deepEqual(warranties, { name: "Garantías", parent_key: "documents", system_key: "documents.warranties" });

  assert.deepEqual(
    client.folders.map((folder) => [folder.system_key, folder.name]).sort(),
    PROJECT_SYSTEM_FOLDERS.map((folder) => [folder.key, folder.name]).sort(),
  );
});

test("es idempotente: una repetición no crea carpetas nuevas", async () => {
  const client = createClient();
  await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 });
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 3, projectId: 50 }), { created: 0, total: 18 });
  assert.equal(client.folders.length, 18);
});

test("completa un árbol parcial sin tocar las carpetas que ya existen", async () => {
  const client = createClient({ folders: [{ name: "Portada del proyecto", parent_key: null, system_key: "cover" }] });
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 }), { created: 17, total: 18 });
});

test("un proyecto creado con el catálogo anterior solo recibe «Garantías» y conserva sus carpetas", async () => {
  // Árbol de 17 carpetas con el nombre guardado anterior («Modelos 3D»): la clave no cambia.
  const previous = PROJECT_SYSTEM_FOLDERS
    .filter((folder) => folder.key !== "documents.warranties")
    .map((folder) => ({ name: folder.key === "renders.models" ? "Modelos 3D" : folder.name, parent_key: folder.parentKey, system_key: folder.key }));
  const client = createClient({ folders: previous });
  assert.deepEqual(await ensureProjectSystemFolders(client, { createdBy: 2, projectId: 50 }), { created: 1, total: 18 });
  assert.equal(client.folders.find((folder) => folder.system_key === "renders.models").name, "Modelos 3D", "no renombra filas existentes");
  assert.deepEqual(client.folders.at(-1), { name: "Garantías", parent_key: "documents", system_key: "documents.warranties" });
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
