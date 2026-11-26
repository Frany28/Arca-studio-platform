import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";

// Carpetas y subidas en cualquier ubicación del proyecto (D7 y D14 resueltas) con PostgreSQL simulado:
// raíz, predeterminadas, «Cotizaciones», personalizadas anidadas, nombres repetidos, profundidad
// máxima, portada (regla de Figma que se conserva) y permisos. El SQL real se cubre en
// fileManager.integration.test.js (PostgreSQL desechable).
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
const { pool } = await import("../src/config/db.js");
const { default: fileRoutes } = await import("../src/routes/fileManager.js");
const { withProjectFileReviewState } = await import("../src/config/projectFileReview.js");
const { fileManagerUploadSchema } = await import("../src/validation/fileManagerSchemas.js");
const { evaluateManagedUpload, resolveManagedFileCategory } = await import("../src/domain/fileManagerUpload.js");
const { resolveDocumentLocation, resolveUploadOrigin } = await import("../src/domain/documentClassification.js");

const ADMIN = { id: 2, permissionCodes: [], role: { code: "admin" } };
// Carpetas del proyecto 1: predeterminadas del catálogo y una cadena personalizada de 12 niveles.
const SYSTEM = [
  [100, null, "Portada del proyecto", "cover"], [101, null, "Renders e imágenes", "renders"], [102, 101, "Imágenes", "renders.images"],
  [103, 101, "Videos", "renders.videos"], [104, 101, "Panorámicas", "renders.models"], [110, null, "Documentos", "documents"],
  [111, 110, "Cotizaciones", "documents.quotes"], [120, null, "Archivos del cliente", "client_files"],
];

/**
 * Base simulada de carpetas con el índice único de hermanas y la auditoría.
 *
 * @returns {{ respond: Function, state: object }} Respondedor y estado.
 */
function createDatabase() {
  const state = {
    audits: [],
    folders: [
      ...SYSTEM.map(([id, parentId, name, systemKey]) => ({ deleted: false, id, name, parentId, systemKey })),
      ...Array.from({ length: 12 }, (_, index) => ({ deleted: false, id: 200 + index, name: `Nivel ${index + 1}`, parentId: index === 0 ? null : 199 + index, systemKey: null })),
    ],
    nextId: 500,
  };
  /**
   * Responde las sentencias de la creación de carpetas.
   *
   * @param {string} sql - Sentencia.
   * @param {unknown[]} params - Parámetros.
   * @returns {{ rows: object[], rowCount: number }} Resultado.
   */
  function respond(sql, params = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    const result = (rows) => ({ rowCount: rows.length, rows });
    if (/^(begin|commit|rollback)$/.test(text)) return result([]);
    // Los proyectos 1 y 2 existen; las carpetas simuladas pertenecen solo al 1.
    if (text.startsWith("select id, status, client_id from public.projects")) {
      return result([1, 2].includes(Number(params[0])) ? [{ client_id: "4", id: String(params[0]), status: "in_process" }] : []);
    }
    if (text.startsWith("select id, parent_id, system_key from public.project_folders")) {
      const folder = state.folders.find((candidate) => candidate.id === Number(params[0]) && Number(params[1]) === 1 && !candidate.deleted);
      return result(folder ? [{ id: String(folder.id), parent_id: folder.parentId === null ? null : String(folder.parentId), system_key: folder.systemKey }] : []);
    }
    if (text.startsWith("with recursive chain as ( select id, parent_id, 1 as depth")) {
      let depth = 0;
      for (let current = state.folders.find((folder) => folder.id === Number(params[0])); current; current = state.folders.find((folder) => folder.id === current.parentId)) depth += 1;
      return result([{ depth }]);
    }
    if (text.startsWith("insert into public.project_folders")) {
      const [projectId, parentId, name] = params;
      if (state.folders.some((folder) => !folder.deleted && folder.parentId === parentId && folder.name.trim().toLowerCase() === name.trim().toLowerCase())) {
        throw Object.assign(new Error("duplicate"), { code: "23505", constraint: "uq_project_folders_sibling_name" });
      }
      const folder = { deleted: false, id: state.nextId++, name, parentId, projectId, systemKey: null };
      state.folders.push(folder);
      return result([{ id: String(folder.id), name, parent_id: parentId === null ? null : String(parentId) }]);
    }
    if (text.startsWith("insert into public.audit_logs")) {
      state.audits.push({ action: params[1], entityId: params[3], newValues: JSON.parse(params[5]) });
      return result([{ id: "1" }]);
    }
    if (text.startsWith("select folder.id, folder.parent_id, folder.name, folder.system_key")) {
      return result(state.folders.filter((folder) => !folder.deleted).map((folder) => ({ file_count: "0", id: String(folder.id), name: folder.name, parent_id: folder.parentId === null ? null : String(folder.parentId), system_key: folder.systemKey })));
    }
    throw new Error(`Sentencia no simulada: ${text.slice(0, 100)}`);
  }
  return { respond, state };
}

/**
 * Levanta el router del administrador con la revisión activada.
 *
 * @param {import("node:test").TestContext} context - Contexto de la prueba.
 * @param {object|null} [user] - Sesión.
 * @returns {Promise<object>} Servidor y base.
 */
async function start(context, user = ADMIN) {
  const database = createDatabase();
  const server = await startAdminRouterServer(context, {
    pool,
    respond: database.respond,
    routes: [["/api", (_req, _res, next) => withProjectFileReviewState(true, next)], ["/api/admin/files", fileRoutes]],
  });
  server.setUser(user);
  return { database, server };
}

const create = (server, parentId, name) => server.send("POST", "/api/admin/files/projects/1/folders", { name, parentId });

test("crea carpetas en la raíz, en predeterminadas (también Cotizaciones, Imágenes, Videos, Panorámicas y Archivos del cliente) y anidadas, con auditoría", async (context) => {
  const { database, server } = await start(context);
  const cases = [[null, "Contratos firmados"], [110, "Correspondencia"], [111, "Borradores comerciales"], [102, "Detalles"], [103, "Recorridos"], [104, "Exteriores"], [120, "Referencias"]];
  for (const [parentId, name] of cases) {
    const response = await create(server, parentId, name);
    assert.equal(response.status, 201, `${parentId}: ${JSON.stringify(response.body)}`);
    assert.deepEqual([response.body.folder.name, response.body.folder.parentId], [name, parentId]);
  }
  const nested = database.state.folders.find((folder) => folder.name === "Borradores comerciales");
  assert.equal((await create(server, nested.id, "Versión cliente")).status, 201, "subcarpeta de una personalizada dentro de Cotizaciones");
  assert.equal(database.state.audits.length, cases.length + 1);
  assert.ok(database.state.audits.every((audit) => audit.action === "project_folder.created"));
  assert.deepEqual(database.state.audits[0].newValues, { name: "Contratos firmados", parentId: null, projectId: 1 });
  assert.equal(database.state.folders.filter((folder) => folder.systemKey).length, SYSTEM.length, "las predeterminadas conservan sus claves");
});

test("conserva las reglas: nombre repetido entre hermanas (400), portada sin subcarpetas y profundidad máxima (409)", async (context) => {
  const { server } = await start(context);
  assert.equal((await create(server, null, "Contratos")).status, 201);
  const duplicated = await create(server, null, " contratos ");
  assert.equal(duplicated.status, 400);
  assert.match(JSON.stringify(duplicated.body.fields), /Ya existe una carpeta con ese nombre/);
  assert.equal((await create(server, 110, "Contratos")).status, 201, "el mismo nombre en otra ubicación sí");
  const cover = await create(server, 100, "Variantes");
  assert.deepEqual([cover.status, cover.body.code], [409, "PROJECT_FOLDER_SUBFOLDERS_NOT_ALLOWED"]);
  assert.equal((await create(server, 210, "Nivel 12 bis")).status, 201, "dentro del nivel 11 (queda en el 12)");
  const tooDeep = await create(server, 211, "Nivel 13");
  assert.deepEqual([tooDeep.status, tooDeep.body.code], [409, "PROJECT_FOLDER_TOO_DEEP"]);
  assert.equal((await create(server, 999, "Huérfana")).status, 404);
});

test("una carpeta madre de otro proyecto responde 404 sin crear ni auditar nada", async (context) => {
  const { database, server } = await start(context);
  const before = database.state.folders.length;
  for (const parentId of [111, 200]) {
    const response = await server.send("POST", "/api/admin/files/projects/2/folders", { name: "Intrusa", parentId });
    assert.deepEqual([response.status, response.body.code], [404, "PROJECT_FOLDER_NOT_FOUND"], String(parentId));
  }
  assert.equal(database.state.folders.length, before);
  assert.equal(database.state.audits.length, 0);
});

test("crear carpetas sigue siendo exclusivo del administrador", async (context) => {
  for (const role of ["architect", "client"]) {
    const { database, server } = await start(context, { clientId: 4, id: 9, permissionCodes: ["projects.read", "projects.files.upload"], role: { code: role } });
    assert.equal((await create(server, null, "Intento")).status, 403, role);
    assert.equal(database.state.audits.length, 0);
  }
  const anonymous = await start(context, null);
  assert.equal((await create(anonymous.server, null, "Intento")).status, 401);
});

test("subida del administrador en cualquier ubicación: se acepta y conserva la carpeta elegida, sin reubicar por extensión", () => {
  // Destinos: raíz (sin carpeta), personalizada, predeterminadas y «Cotizaciones»; formatos cruzados.
  const cases = [
    [null, "pdf", "application/pdf", "document"],
    [null, "png", "image/png", "image"],
    ["documents", "png", "image/png", "image"],
    ["documents.quotes", "pdf", "application/pdf", "document"],
    ["renders.images", "pdf", "application/pdf", "document"],
    ["renders.videos", "png", "image/png", "image"],
    ["renders.models", "png", "image/png", "panorama"],
    ["client_files", "mp4", "video/mp4", "video"],
  ];
  for (const [systemKey, extension, fileType, category] of cases) {
    assert.equal(evaluateManagedUpload({ fileCount: 3, systemKey }, extension).allowed, true, `${systemKey}: ${extension}`);
    assert.equal(resolveManagedFileCategory(systemKey, fileType), category, `${systemKey}: ${fileType}`);
  }
  // Una carpeta personalizada sin ancestro predeterminado tampoco tiene reglas propias.
  assert.equal(evaluateManagedUpload({ fileCount: 0, systemKey: null }, "dwg").allowed, true);
  // Sin carpeta elegida, el equipo sube a la raíz (queda sin carpeta); solo el cliente va a «Archivos del cliente».
  assert.equal(resolveDocumentLocation({ origin: resolveUploadOrigin({ folderId: null, uploaderRole: "admin" }) }).folderKey, null);
  assert.equal(resolveUploadOrigin({ folderId: 111, uploaderRole: "admin" }), "folder_upload", "la carpeta elegida es la clasificación");
  // La portada conserva su regla de Figma.
  assert.equal(evaluateManagedUpload({ fileCount: 0, systemKey: "cover" }, "pdf").allowed, false);
});

test("subida del administrador: `folderId` es opcional (raíz del proyecto) y, si llega, debe ser un id válido", () => {
  const parse = (query) => fileManagerUploadSchema.safeParse({ params: { projectId: "1" }, query });
  assert.equal(parse({}).success, true, "raíz");
  assert.equal(parse({}).data.query.folderId, undefined);
  assert.equal(parse({ folderId: "111" }).data.query.folderId, 111, "Cotizaciones u otra carpeta");
  assert.equal(parse({ folderId: "abc" }).success, false);
  assert.equal(parse({ folderId: "0" }).success, false);
});
