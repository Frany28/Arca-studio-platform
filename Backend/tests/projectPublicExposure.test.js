import assert from "node:assert/strict";
import test from "node:test";

import { getShowcaseFileName, toGeneralLocation, toPublicProjectView } from "../src/domain/projectPublicView.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";

const { pool } = await import("../src/config/db.js");
const {
  findAssignedArchitectProfilePhotoForUser,
  findDirectProjectStateForUser,
  findProjectDetailForUser,
  listProjectsForUser,
} = await import("../src/repositories/projectRepository.js");
const { canAccessProjectComments } = await import("../src/repositories/projectCommentRepository.js");
const { findProjectFileForDownload, findProjectForFileUpload } = await import("../src/repositories/fileRepository.js");

const OWNER_CLIENT_ID = 7;
const owner = { clientId: OWNER_CLIENT_ID, id: 70, role: { code: "client" } };
const foreignClient = { clientId: 8, id: 80, role: { code: "client" } };
const assignedArchitect = { id: 90, role: { code: "architect" } };
const unassignedArchitect = { id: 91, role: { code: "architect" } };
const admin = { id: 1, role: { code: "admin" } };

// Contrato aprobado de P-1: lo único que recibe quien no tiene acceso directo.
const PUBLIC_PROJECT_KEYS = [
  "areaUnit", "assignedArchitect", "assignedArchitects", "assignees", "city", "constructionArea", "country", "createdAt",
  "description", "generalArea", "hasImage", "id", "imageFileId", "imageFileVersionId", "isPublic", "location", "name",
  "progress", "projectType", "publicSlug", "startDate", "state", "status", "updatedAt",
];
const PUBLIC_DETAIL_KEYS = [...PUBLIC_PROJECT_KEYS, "files", "filesNextCursor", "recentDocuments", "requirements", "technicalSpecifications"].sort();
const PRIVATE_KEYS = ["budget", "client", "createdBy", "endDate", "hasPlans", "locationCoordinates", "locationFormattedAddress", "providerPlaceId"];

/**
 * Fila de proyecto público finalizado de otro cliente, con todos los campos sensibles poblados.
 *
 * @param {object} [overrides] - Valores que sustituyen a los predeterminados.
 * @returns {object} Fila equivalente a la consulta de proyectos.
 */
function projectRow(overrides = {}) {
  return {
    area_unit: "m2", architect_first_name: "Ana", architect_has_profile_photo: true, architect_last_name: "Arq",
    assigned_architect_id: "90", assigned_employees: [{ id: 90, name: "Ana Arq", roleCode: "architect", roleName: "Arquitecto" }],
    budget: "125000.50", city: "Ciudad", client_id: String(OWNER_CLIENT_ID), client_name: "Cliente Privado S.A.",
    construction_area: "120", country: "País", created_at: "2026-01-01T00:00:00Z", created_by: "1", description: "Descripción",
    end_date: "2026-06-01", formatted_address: "Calle Exacta 123, Ciudad", general_area: "200", has_plans: true, id: "15",
    image_file_id: "301", image_file_version_id: "401", is_public: true, location: "Calle Exacta 123", location_latitude: "10.1234567",
    location_longitude: "-66.7654321", name: "Casa Vitrina", progress: "100", project_type: "residential",
    provider_place_id: "geo-place-id", public_slug: "casa-vitrina", start_date: "2026-01-02", state: "Estado", status: "finished",
    updated_at: "2026-06-02T00:00:00Z",
    ...overrides,
  };
}

/**
 * Fila de archivo del proyecto con el tipo indicado.
 *
 * @param {number} id - Identificador del archivo.
 * @param {string} fileType - Tipo MIME.
 * @returns {object} Fila equivalente a la consulta de archivos.
 */
function fileRow(id, fileType) {
  return {
    created_at: "2026-05-01T00:00:00Z", current_version: 1, current_version_id: id + 100, description: "Fachada de la casa de Pérez",
    file_category: fileType.startsWith("image/") ? "image" : "document", file_created_at: `2026-05-${String(30 - id).padStart(2, "0")}T00:00:00Z`,
    file_extension: fileType.split("/")[1], file_name: `key-${id}`, file_size: 10, file_type: fileType, id: String(id),
    title: `casa-perez-calle-exacta-${id}`, uploader_first_name: "Cliente", uploader_id: "70", uploader_last_name: "Pérez", uploader_profile_photo_url: null,
  };
}

/**
 * Sustituye `pool.query` y emula las consultas del repositorio, registrando SQL y parámetros.
 * El filtro de archivos reproduce la condición SQL `$5 or image/video` aplicada antes del LIMIT.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {{ files?: Array<object>, projects?: Array<object> }} [data] - Filas a devolver.
 * @returns {Array<{ sql: string, params: Array<unknown> }>} Consultas ejecutadas.
 */
function mockDatabase(context, { files = [], projects = [projectRow()] } = {}) {
  const calls = [];
  context.mock.method(pool, "query", async (sql, params) => {
    calls.push({ params, sql });
    if (sql.includes("c.name as client_name")) return { rows: projects };
    if (sql.includes("from public.project_requirements")) return { rows: [{ description: "Requisito privado", id: "1", sort_order: 1 }] };
    if (sql.includes("from public.project_technical_specifications")) return { rows: [{ default_open: true, description: "Especificación", id: "2", items: [], sort_order: 1, title: "Estructura" }] };
    if (sql.includes("limit $4")) {
      const visible = files.filter((file) => params[4] || /^(image|video)\//.test(file.file_type));
      return { rows: visible.slice(0, params[3]) };
    }
    if (sql.includes("limit 3")) return { rows: files.filter((file) => !/^(image|video)\//.test(file.file_type)).slice(0, 3) };
    return { rows: [] };
  });
  return calls;
}

// --- Proyección pública -------------------------------------------------------------------------

for (const [label, viewer] of [["cliente de otra cuenta", foreignClient], ["arquitecto no asignado", unassignedArchitect]]) {
  test(`P-1: ${label} recibe solo la información pública autorizada del detalle`, async (context) => {
    const calls = mockDatabase(context, { files: [fileRow(1, "application/pdf"), fileRow(2, "image/png")] });
    const detail = await findProjectDetailForUser(15, viewer, { fileLimit: 25 });

    assert.deepEqual(Object.keys(detail).sort(), PUBLIC_DETAIL_KEYS);
    for (const key of PRIVATE_KEYS) assert.equal(key in detail, false, key);
    assert.equal(detail.location, "Ciudad, Estado, País");
    assert.deepEqual([detail.requirements, detail.technicalSpecifications, detail.recentDocuments], [[], [], []]);
    assert.deepEqual(detail.files, [{
      available: true, createdAt: "2026-05-01T00:00:00Z", currentVersion: 1, currentVersionId: 102, description: null,
      extension: "png", fileCategory: "image", fileType: "image/png", id: 2, size: 10, title: "Imagen 2", uploadedBy: null,
    }]);
    assert.doesNotMatch(JSON.stringify(detail), /Cliente Privado|Calle Exacta|125000|geo-place-id|10\.1234567|Pérez|casa-perez|Requisito privado/);
    // Requisitos, especificaciones y documentos recientes no se consultan para terceros.
    assert.equal(calls.some(({ sql }) => /project_requirements|project_technical_specifications|limit 3/.test(sql)), false);
  });
}

for (const [label, viewer] of [["cliente propietario", owner], ["arquitecto asignado", assignedArchitect], ["administrador", admin]]) {
  test(`P-1: ${label} conserva la respuesta completa`, async (context) => {
    mockDatabase(context, { files: [fileRow(1, "application/pdf"), fileRow(2, "image/png")] });
    const detail = await findProjectDetailForUser(15, viewer, { fileLimit: 25 });
    assert.equal(detail.budget, 125000.5);
    assert.deepEqual(detail.client, { id: OWNER_CLIENT_ID, name: "Cliente Privado S.A." });
    assert.deepEqual(detail.locationCoordinates, { latitude: 10.1234567, longitude: -66.7654321 });
    assert.equal(detail.location, "Calle Exacta 123");
    assert.equal(detail.locationFormattedAddress, "Calle Exacta 123, Ciudad");
    assert.equal(detail.providerPlaceId, "geo-place-id");
    assert.deepEqual([detail.createdBy, detail.endDate, detail.hasPlans], [1, "2026-06-01", true]);
    assert.equal(detail.requirements.length, 1);
    assert.equal(detail.technicalSpecifications.length, 1);
    assert.equal(detail.recentDocuments.length, 1);
    assert.deepEqual(detail.files.map((file) => file.fileType), ["application/pdf", "image/png"]);
    assert.equal(detail.files[1].title, "casa-perez-calle-exacta-2");
    assert.equal(detail.files[1].uploadedBy.name, "Cliente Pérez");
  });
}

test("P-1: el listado proyecta por fila y separa propios de públicos ajenos", async (context) => {
  mockDatabase(context, {
    projects: [projectRow(), projectRow({ client_id: String(foreignClient.clientId), id: "16", is_public: false, name: "Propio" })],
  });
  const { items } = await listProjectsForUser(foreignClient, { limit: 25 });
  const [foreign, own] = items;
  assert.deepEqual(Object.keys(foreign).sort(), [...PUBLIC_PROJECT_KEYS].sort());
  assert.equal(foreign.location, "Ciudad, Estado, País");
  assert.equal(own.budget, 125000.5);
  assert.deepEqual(own.client, { id: foreignClient.clientId, name: "Cliente Privado S.A." });

  // Campos de la galería y la búsqueda (nombre, tipo, responsables, año, orden e imagen).
  for (const key of ["name", "projectType", "assignedArchitect", "assignees", "startDate", "createdAt", "updatedAt", "imageFileId", "imageFileVersionId", "hasImage", "isPublic", "publicSlug"]) {
    assert.ok(key in foreign, key);
  }
  assert.equal(foreign.assignedArchitect.name, "Ana Arq");
});

test("P-1: ubicación general sin dirección exacta, con los datos geográficos disponibles", () => {
  assert.equal(toGeneralLocation({ city: "Ciudad", country: "País", state: "Estado" }), "Ciudad, Estado, País");
  assert.equal(toGeneralLocation({ city: null, country: "País", state: "Estado" }), "Estado, País");
  assert.equal(toGeneralLocation({ city: "  ", country: "País" }), "País");
  assert.equal(toGeneralLocation({ location: "Calle Exacta 123" }), null);
  const view = toPublicProjectView({ city: null, country: null, id: 1, location: "Calle Exacta 123", state: null });
  assert.equal(view.location, null);
});

test("P-1: un campo nuevo de Project queda privado hasta incluirlo en la lista pública", () => {
  const view = toPublicProjectView({ id: 1, internalNotes: "nota privada", name: "Proyecto" });
  assert.equal("internalNotes" in view, false);
});

// --- Paginación de archivos para terceros -------------------------------------------------------

test("P-1: imágenes y videos se filtran antes del LIMIT y el cursor no pierde páginas", async (context) => {
  const files = [fileRow(1, "application/pdf"), fileRow(2, "image/png"), fileRow(3, "image/png"), fileRow(4, "video/mp4")];
  const calls = mockDatabase(context, { files });
  const detail = await findProjectDetailForUser(15, foreignClient, { fileLimit: 2 });
  assert.deepEqual(detail.files.map((file) => file.id), [2, 3]);
  assert.notEqual(detail.filesNextCursor, null, "queda un video después de esta página");

  const fileQuery = calls.find(({ sql }) => sql.includes("limit $4"));
  assert.match(fileQuery.sql, /and \(\$5::boolean or file\.file_type like 'image\/%' or file\.file_type like 'video\/%'\)\s+order by file\.created_at desc, file\.id desc\s+limit \$4/);
  assert.equal(fileQuery.params[4], false);

  const owners = mockDatabase(context, { files });
  await findProjectDetailForUser(15, owner, { fileLimit: 2 });
  assert.equal(owners.find(({ sql }) => sql.includes("limit $4")).params[4], true);
});

// --- Restricciones vigentes que se conservan ----------------------------------------------------

test("descargas: terceros solo obtienen imágenes o videos de proyectos públicos y con nombre genérico", async (context) => {
  const calls = [];
  let directAccess = false;
  context.mock.method(pool, "query", async (sql, params) => {
    calls.push({ params, sql });
    return { rows: [{ direct_access: directAccess, file_extension: "png", file_name: "key", file_size: 4, file_type: "image/png", id: "5", original_name: "casa-perez-calle-exacta.png", title: "casa-perez-calle-exacta", version_id: "9" }] };
  });

  const foreignDownload = await findProjectFileForDownload({ fileId: 5, projectId: 15, user: foreignClient });
  assert.deepEqual([foreignDownload.originalName, foreignDownload.title, foreignDownload.directAccess], ["imagen-5.png", "imagen-5.png", false]);
  assert.match(calls[0].sql, /\(\(project\.client_id = \$3\) or \(\s*project\.is_public = true and \(\s*file\.file_type like 'image\/%' or\s*file\.file_type like 'video\/%'\s*\)\s*\)\)/);
  assert.match(calls[0].sql, /\(\(project\.client_id = \$3\)\) as direct_access/);
  assert.deepEqual(calls[0].params, [15, 5, foreignClient.clientId]);

  await findProjectFileForDownload({ fileId: 5, projectId: 15, user: unassignedArchitect });
  assert.match(calls[1].sql, /project\.is_public = true and/);
  assert.deepEqual(calls[1].params, [15, 5, unassignedArchitect.id]);

  await findProjectFileForDownload({ fileId: 5, projectId: 15, user: { clientId: null, id: 1, role: { code: "client" } } });
  assert.match(calls[2].sql, /and \(false\)/, "un cliente sin clientId no accede a ningún archivo");

  directAccess = true;
  const ownerDownload = await findProjectFileForDownload({ fileId: 5, projectId: 15, user: owner });
  assert.deepEqual([ownerDownload.originalName, ownerDownload.directAccess], ["casa-perez-calle-exacta.png", true]);
});

test("nombre de descarga genérico con extensión saneada", () => {
  assert.equal(getShowcaseFileName({ extension: "PNG", fileType: "image/png", id: 5 }), "imagen-5.png");
  assert.equal(getShowcaseFileName({ extension: "mp4", fileType: "video/mp4", id: 7 }), "video-7.mp4");
  assert.equal(getShowcaseFileName({ extension: "../x\"y", fileType: "image/jpeg", id: 8 }), "imagen-8.xy");
  assert.equal(getShowcaseFileName({ extension: null, fileType: null, id: 9 }), "archivo-9");
});

test("comentarios, eventos y operaciones directas nunca se amplían por is_public", async (context) => {
  const calls = mockDatabase(context, { projects: [] });
  assert.equal(await canAccessProjectComments(15, foreignClient), false);
  await findDirectProjectStateForUser(15, foreignClient);
  await findAssignedArchitectProfilePhotoForUser(15, foreignClient);
  for (const { sql } of calls) assert.doesNotMatch(sql, /is_public = true/);
  assert.deepEqual(calls[0].params, [foreignClient.clientId, 15]);
});

test("subir o borrar archivos requiere acceso directo aunque el proyecto sea público", async (context) => {
  context.mock.method(pool, "query", async () => ({
    rows: [{ assigned_architect_id: "90", client_id: String(OWNER_CLIENT_ID), id: "15", is_assignee: false, is_public: true, status: "finished" }],
  }));
  assert.equal(await findProjectForFileUpload(15, foreignClient), null);
  assert.equal(await findProjectForFileUpload(15, unassignedArchitect), null);
  assert.ok(await findProjectForFileUpload(15, owner));
  assert.ok(await findProjectForFileUpload(15, assignedArchitect));
});
