import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Gestión de archivos (Figma 3727:682730) sobre un backend simulado con la forma del contrato B7:
// árbol, pestañas, búsqueda, tipos, orden, cursor, carpetas y descarga. Datos ficticios en
// memoria; nunca usa Supabase ni datos de Figma.

let browser;
let server;
let origin;

const SCREENSHOT_DIR = process.env.ARCA_U1_SCREENSHOT_DIR || "";

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url),
    configFile: false,
    envDir: false,
    plugins: [react(), tailwindcss()],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Carpetas predeterminadas de un proyecto (ids desde `base`), en preorden y con nombre visible.
 *
 * @param {number} base - Primer id.
 * @returns {Array<Object>} Carpetas.
 */
function defaultFolders(base) {
  return [
    { fileCount: 0, id: base, name: "Portada del proyecto", parentId: null, systemKey: "cover" },
    { fileCount: 0, id: base + 1, name: "Renders e imágenes", parentId: null, systemKey: "renders" },
    { fileCount: 0, id: base + 2, name: "Panorámicas", parentId: base + 1, systemKey: "renders.models" },
    { fileCount: 0, id: base + 3, name: "Documentos", parentId: null, systemKey: "documents" },
    { fileCount: 0, id: base + 4, name: "Garantías", parentId: base + 3, systemKey: "documents.warranties" },
  ];
}

/**
 * Versión de archivo con la forma de FileManagerItem.
 *
 * @param {number} id - Identificador de versión y archivo.
 * @param {Object} values - Campos variables.
 * @returns {Object} Elemento.
 */
function item(id, { day, extension = "pdf", fileCategory, fileId = id, folder, isCurrent = true, name, project, reason = null, size, status = "approved", versionNumber = 1 }) {
  return {
    changeNote: null,
    contentType: extension === "pdf" ? "application/pdf" : "image/png",
    createdAt: `2026-03-${String(day).padStart(2, "0")}T14:00:00.000Z`,
    extension,
    fileCategory: fileCategory || (extension === "pdf" ? "document" : "image"),
    fileId,
    folder,
    isCurrent,
    name,
    project: { id: project.id, name: project.name, status: "in_progress" },
    restoredFromVersionId: null,
    review: { reason, reviewedAt: status === "pending" ? null : "2026-03-25T10:00:00.000Z", reviewerName: status === "pending" ? null : "Ana Admin", status },
    size,
    uploadedBy: { id: 2, name: "Arq. Armando" },
    versionId: id * 10,
    versionNumber,
  };
}

/**
 * Versión del historial (FileVersion) a partir de un elemento del simulador.
 *
 * @param {Object} entry - Elemento.
 * @returns {Object} Versión.
 */
function toFileVersion(entry) {
  return {
    changeNote: entry.changeNote, contentType: entry.contentType, createdAt: entry.createdAt, extension: entry.extension,
    id: entry.versionId, isCurrent: entry.isCurrent, originalName: entry.name, restoredFromVersionId: entry.restoredFromVersionId,
    review: entry.review, size: entry.size, uploadedBy: entry.uploadedBy, versionNumber: entry.versionNumber,
  };
}

// Sección funcional de las carpetas predeterminadas del simulador (catálogo del backend).
const SECTION_BY_KEY = Object.freeze({ cover: "cover", documents: "documents", "documents.warranties": "warranties", renders: "renders", "renders.models": "models_3d" });

// PDF mínimo válido de una página para PDF.js (contenido ficticio).
const SAMPLE_PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<<>>>>endobj
4 0 obj<</Length 0>>stream

endstream endobj
xref
0 5
0000000000 65535 f 
trailer<</Size 5/Root 1 0 R>>
startxref
0
%%EOF`);
// PNG de 1 × 1 píxel.
const SAMPLE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/**
 * PNG válido de un color con las dimensiones pedidas (proporciones reales para el visor adaptativo).
 *
 * @param {number} width - Ancho en píxeles.
 * @param {number} height - Alto en píxeles.
 * @returns {Buffer} Imagen PNG.
 */
function pngOf(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x9a)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Backend simulado del administrador de archivos con estado en memoria.
 *
 * @param {{ enabled?: boolean, failures?: Object, quotes?: boolean }} [options] - Activación, fallos inyectados y
 *   PDF de cotizaciones de «Casa Cotizada» (solo con `quotes`, para no alterar los demás recuentos).
 * @returns {Object} Estado y manejador.
 */
function createBackend({ enabled = true, failures = {}, media = [], quotes = false } = {}) {
  const quinta = { client: { name: "Cliente Uno" }, fileCount: 13, folders: defaultFolders(100), id: 1, name: "Quinta Bella Vista", status: "in_progress" };
  const apto = { client: { name: "Cliente Dos" }, fileCount: 1, folders: defaultFolders(200), id: 2, name: "Apartamento JC", status: "in_progress" };
  quinta.folders.push({ fileCount: 0, id: 150, name: "Planos de obra", parentId: 103, systemKey: null });
  const documents = { id: 103, name: "Documentos", section: "documents" };
  const warranties = { id: 104, name: "Garantías", section: "warranties" };
  const items = [
    ...Array.from({ length: 12 }, (_, index) => item(index + 1, { day: index + 1, folder: documents, name: `Acta de inicio ${String(index + 1).padStart(2, "0")}.pdf`, project: quinta, size: (index + 1) * 1024 * 1024 })),
    // Garantía: doce versiones aprobadas; la V12 es la vigente (historial con «Mostrar más versiones»).
    ...Array.from({ length: 12 }, (_, index) => item(300 + index, { day: 9 + index, fileId: 30, folder: warranties, isCurrent: index === 11, name: "Garantía impermeabilización.pdf", project: quinta, size: 512 * 1024, versionNumber: index + 1 })),
    item(40, { day: 21, extension: "png", folder: { id: 201, name: "Renders e imágenes", section: "renders" }, name: "Fachada.png", project: apto, size: 2048 * 1024 }),
    // Propuesta: V1 aprobada vigente y V2 pendiente de revisión.
    item(49, { day: 1, fileId: 50, folder: documents, name: "Propuesta pendiente.pdf", project: quinta, size: 4000 }),
    item(50, { day: 22, fileId: 50, folder: documents, isCurrent: false, name: "Propuesta pendiente.pdf", project: quinta, size: 4096, status: "pending", versionNumber: 2 }),
    item(60, { day: 23, folder: documents, isCurrent: false, name: "Contrato rechazado.pdf", project: quinta, reason: "Falta la firma del cliente.", size: 8192, status: "rejected" }),
  ];
  const warrantyList = [
    { code: "G-01", documents: [], endDate: "2028-01-01", id: 5, model: "Techo", product: "Impermeabilización", startDate: "2026-01-01" },
    { code: "G-02", documents: [{ fileId: 30 }], endDate: "2027-06-01", id: 6, model: "Aluminio", product: "Ventanas", startDate: "2026-02-01" },
  ];
  const state = { items, projects: [quinta, apto], quoteDocuments: new Map(), requests: [], warranties: warrantyList };
  // Medios con contenido propio (visor adaptativo): imágenes y vídeos de proporciones reales.
  for (const [index, medium] of media.entries()) {
    const entry = item(900 + index, {
      day: 24, extension: medium.extension, fileCategory: medium.fileCategory, fileId: medium.fileId ?? 900 + index,
      folder: { id: 201, name: "Renders e imágenes", section: "renders" }, isCurrent: medium.isCurrent ?? true, name: medium.name, project: apto,
      size: medium.bytes.length, versionNumber: medium.versionNumber ?? 1,
    });
    entry.contentType = medium.contentType;
    entry.bytes = medium.bytes;
    state.items.push(entry);
  }
  if (quotes) {
    // Proyecto con dos cotizaciones: COT-012 (v1 y v2 disponibles) y COT-013 (v1 con fallo de almacenamiento).
    const cotizada = { client: { name: "Cliente Tres" }, fileCount: 0, folders: defaultFolders(500), id: 3, name: "Casa Cotizada", status: "in_progress" };
    state.projects.push(cotizada);
    // Catálogo ampliado: «Documentos › Cotizaciones» (gestionada por Cotizaciones) y las demás categorías.
    cotizada.folders.push(
      { fileCount: 2, id: 510, name: "Cotizaciones", parentId: 503, systemKey: "documents.quotes" },
      { fileCount: 0, id: 511, name: "Actas", parentId: 503, systemKey: "documents.records" },
      { fileCount: 0, id: 512, name: "Planos", parentId: 503, systemKey: "documents.plans" },
    );
    const folder = { id: 510, name: "Cotizaciones", section: "quotes" };
    const quoteVersion = (quoteId, versionNumber, day, status) => ({
      createdAt: `2026-04-${String(day).padStart(2, "0")}T14:00:00.000Z`, createdBy: { id: 1, name: "Ana Admin" }, quoteId, versionNumber,
      pdf: { errorCode: status === "error" ? "QUOTE_PDF_STORAGE_ERROR" : null, fileName: `COT-0${quoteId}-v${versionNumber}.pdf`, size: status === "available" ? 40960 : null, status },
    });
    state.quoteVersion = quoteVersion;
    state.quoteDocuments.set(12, [quoteVersion(12, 2, 3, "available"), quoteVersion(12, 1, 1, "available")]);
    state.quoteDocuments.set(13, [quoteVersion(13, 1, 2, "error")]);
    state.quoteItem = (quoteId) => {
      const current = state.quoteDocuments.get(quoteId)[0];
      return {
        contentType: "application/pdf", createdAt: current.createdAt, extension: "pdf", fileCategory: null, fileId: null, folder, isCurrent: true,
        name: current.pdf.fileName, project: { id: cotizada.id, name: cotizada.name, status: "in_progress" },
        quote: { code: `COT-0${quoteId}`, id: quoteId, pdf: { errorCode: current.pdf.errorCode, status: current.pdf.status } },
        restoredFromVersionId: null, review: null, size: current.pdf.size, source: "quote", uploadedBy: current.createdBy,
        versionId: 9000 + quoteId, versionNumber: current.versionNumber,
      };
    };
  }
  const json = (route, status, body) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });

  /**
   * Ids de una carpeta y sus subcarpetas.
   *
   * @param {Object} project - Proyecto.
   * @param {number} folderId - Carpeta.
   * @returns {Set<number>} Ids.
   */
  function subtree(project, folderId) {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of project.folders) {
        if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  /**
   * Registra una subida como v1 pendiente en la carpeta, con la categoría y la sección del backend.
   *
   * @param {Object} project - Proyecto.
   * @param {Object} folder - Carpeta.
   * @param {string} name - Nombre legible.
   * @param {Object} request - Petición de Playwright.
   * @returns {Object} `file` de la respuesta.
   */
  function recordUpload(project, folder, name, request) {
    const extension = name.split(".").pop().toLowerCase();
    let section = null;
    for (let current = folder; current && !section; current = project.folders.find((candidate) => candidate.id === current.parentId)) {
      section = SECTION_BY_KEY[current.systemKey] || null;
    }
    const id = 800 + state.items.length;
    const entry = item(id, { day: 28, extension, fileCategory: extension === "png" && section === "models_3d" ? "panorama" : undefined, folder: folder ? { id: folder.id, name: folder.name, section } : null, isCurrent: false, name, project, size: request.postDataBuffer()?.length || 10, status: "pending" });
    entry.contentType = extension === "pdf" ? "application/pdf" : "image/png";
    state.items.push(entry);
    if (folder) folder.fileCount += 1;
    return { id: entry.fileId, reviewStatus: "pending", title: name, versionId: entry.versionId };
  }

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname: path } = url;
    const method = request.method();
    const isJson = String(request.headers()["content-type"] || "").includes("application/json");
    const body = isJson && request.postData() ? JSON.parse(request.postData()) : null;
    const params = Object.fromEntries(url.searchParams);
    state.requests.push({ body, method, path, search: params });
    const operation = `${method} ${path.replace(/\/\d+(?=\/|$)/g, "/:id")}`;
    if (failures[operation]) return json(route, failures[operation].status, failures[operation].body);

    if (path === "/api/auth/me") return json(route, 200, { user: { email: "ana@example.test", firstName: "Ana", id: 1, lastName: "Admin", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { nextCursor: null, projects: [] });
    if (path === "/api/admin/dashboard-metrics") return json(route, 200, { metrics: { files: { latestUploadAt: "2026-06-19T13:34:00", total: 500, totalBytes: 2.33 * 1024 ** 3 } } });
    if (path.startsWith("/api/admin/files") && !enabled) return json(route, 404, { code: "API_ROUTE_NOT_FOUND", message: "Ruta no encontrada" });

    if (path === "/api/admin/files/metrics") {
      return json(route, 200, { metrics: { lastUploadAt: "2026-03-23T14:00:00.000Z", objectCount: 16, scope: { folderId: null, projectId: null }, totalFiles: 16, usedBytes: 2.33 * 1024 ** 3, } });
    }
    if (path === "/api/admin/files/tree") {
      const search = (params.search || "").toLowerCase();
      return json(route, 200, { nextCursor: null, projects: state.projects.filter((project) => `${project.name} ${project.client.name}`.toLowerCase().includes(search)) });
    }
    if (path === "/api/admin/files/folders") {
      const search = (params.search || "").toLowerCase();
      const folders = state.projects.flatMap((project) => project.folders
        .filter((folder) => folder.name.toLowerCase().includes(search))
        .map((folder) => {
          const chain = [];
          for (let current = folder; current; current = project.folders.find((candidate) => candidate.id === current.parentId)) chain.unshift({ id: current.id, name: current.name });
          return { ...folder, client: project.client, path: chain, project: { id: project.id, name: project.name } };
        }));
      return json(route, 200, { folders, nextCursor: null });
    }
    if (path === "/api/admin/files/items") {
      const tab = params.tab || "approved";
      const sort = params.sort || "date";
      const order = params.order || "desc";
      let rows = state.items.filter((candidate) => candidate.review.status === tab && (tab !== "approved" || candidate.isCurrent));
      if (tab === "approved" && state.quoteItem) rows = [...rows, ...[...state.quoteDocuments.keys()].map((quoteId) => state.quoteItem(quoteId))];
      if (params.projectId) rows = rows.filter((candidate) => candidate.project.id === Number(params.projectId));
      if (params.folderId) {
        const project = state.projects.find((candidate) => candidate.id === Number(params.projectId));
        const ids = subtree(project, Number(params.folderId));
        rows = rows.filter((candidate) => candidate.folder && ids.has(candidate.folder.id));
      }
      if (params.search) rows = rows.filter((candidate) => candidate.name.toLowerCase().includes(params.search.toLowerCase()));
      if (params.extensions) rows = rows.filter((candidate) => params.extensions.split(",").includes(candidate.extension));
      const key = { date: (row) => row.createdAt, name: (row) => row.name, size: (row) => row.size }[sort];
      rows.sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0) * (order === "asc" ? 1 : -1));
      let offset = 0;
      if (params.cursor) {
        const cursor = JSON.parse(Buffer.from(params.cursor, "base64url").toString());
        if (cursor.tab !== tab || cursor.sort !== sort || cursor.order !== order) return json(route, 400, { code: "VALIDATION_ERROR", fields: { "query.cursor": ["Cursor inválido"] }, message: "Cursor inválido" });
        offset = cursor.offset;
      }
      const limit = Number(params.limit || 10);
      const page = rows.slice(offset, offset + limit);
      const nextCursor = offset + limit < rows.length ? Buffer.from(JSON.stringify({ offset: offset + limit, order, sort, tab })).toString("base64url") : null;
      return json(route, 200, { items: page, nextCursor });
    }
    const folderMatch = /^\/api\/admin\/files\/projects\/(\d+)\/folders(?:\/(\d+))?$/.exec(path);
    if (folderMatch) {
      const project = state.projects.find((candidate) => candidate.id === Number(folderMatch[1]));
      const folderId = folderMatch[2] ? Number(folderMatch[2]) : null;
      if (method === "POST") {
        const siblings = project.folders.filter((folder) => folder.parentId === body.parentId);
        if (siblings.some((folder) => folder.name.toLowerCase() === body.name.trim().toLowerCase())) {
          return json(route, 400, { code: "VALIDATION_ERROR", fields: { "body.name": ["Ya existe una carpeta con ese nombre en esta ubicación."] }, message: "Datos inválidos" });
        }
        const folder = { fileCount: 0, id: 300 + project.folders.length, name: body.name.trim(), parentId: body.parentId, systemKey: null };
        const parentIndex = project.folders.findIndex((candidate) => candidate.id === body.parentId);
        project.folders.splice(parentIndex + 1, 0, folder);
        return json(route, 201, { folder, folders: project.folders });
      }
      const folder = project.folders.find((candidate) => candidate.id === folderId);
      if (folder.systemKey) return json(route, 409, { code: "PROJECT_FOLDER_PROTECTED", message: "Protegida" });
      if (method === "PATCH") {
        folder.name = body.name;
        return json(route, 200, { folder: null, folders: project.folders });
      }
      if (method === "DELETE") {
        const hasContent = project.folders.some((candidate) => candidate.parentId === folder.id) || state.items.some((candidate) => candidate.folder?.id === folder.id);
        if (hasContent) return json(route, 409, { code: "PROJECT_FOLDER_NOT_EMPTY", message: "No vacía" });
        project.folders = project.folders.filter((candidate) => candidate.id !== folder.id);
        return json(route, 200, { folder: null, folders: project.folders });
      }
    }
    const contentMatch = /^\/api\/projects\/(\d+)\/files\/(\d+)\/content$/.exec(path);
    if (contentMatch) {
      const entry = state.items.find((candidate) => candidate.versionId === Number(params.versionId));
      const png = entry?.extension === "png";
      if (entry?.bytes) return route.fulfill({ body: entry.bytes, contentType: entry.contentType, status: 200 });
      return route.fulfill({
        body: png ? SAMPLE_PNG : SAMPLE_PDF,
        contentType: png ? "image/png" : "application/pdf",
        headers: { "Content-Disposition": `attachment; filename="acta-v${params.versionId}.${png ? "png" : "pdf"}"` },
        status: 200,
      });
    }
    const versionsMatch = /^\/api\/projects\/(\d+)\/files\/(\d+)\/versions$/.exec(path);
    if (versionsMatch && method === "GET") {
      const fileId = Number(versionsMatch[2]);
      const all = state.items.filter((candidate) => candidate.fileId === fileId).sort((left, right) => right.versionNumber - left.versionNumber);
      const offset = params.cursor ? Number(params.cursor) : 0;
      const limit = Number(params.limit || 20);
      const current = all.find((candidate) => candidate.isCurrent);
      return json(route, 200, {
        currentVersionId: current?.versionId ?? null,
        nextCursor: offset + limit < all.length ? String(offset + limit) : null,
        versions: all.slice(offset, offset + limit).map(toFileVersion),
      });
    }
    const reviewMatch = /^\/api\/projects\/(\d+)\/files\/(\d+)\/versions\/(\d+)\/(approve|reject|restore)$/.exec(path);
    if (reviewMatch && method === "POST") {
      const [, , fileIdText, versionIdText, action] = reviewMatch;
      const fileId = Number(fileIdText);
      const target = state.items.find((candidate) => candidate.versionId === Number(versionIdText));
      const siblings = state.items.filter((candidate) => candidate.fileId === fileId);
      if (action === "restore") {
        if (!body?.changeNote?.trim()) return json(route, 400, { code: "VALIDATION_ERROR", fields: { "body.changeNote": ["Escribe el motivo del cambio."] }, message: "Datos inválidos" });
        if (siblings.some((candidate) => candidate.review.status === "pending")) return json(route, 409, { code: "FILE_VERSION_PENDING_REVIEW", message: "Pendiente" });
        const versionNumber = Math.max(...siblings.map((candidate) => candidate.versionNumber)) + 1;
        const created = {
          ...target, changeNote: body.changeNote.trim(), createdAt: "2026-03-30T10:00:00.000Z", isCurrent: false, restoredFromVersionId: target.versionId,
          review: { reason: null, reviewedAt: null, reviewerName: null, status: "pending" }, uploadedBy: { id: 1, name: "Ana Admin" }, versionId: 9000 + versionNumber, versionNumber,
        };
        state.items.push(created);
        return json(route, 201, { version: toFileVersion(created) });
      }
      if (target.review.status !== "pending") return json(route, 409, { code: "FILE_VERSION_NOT_PENDING", message: "No pendiente" });
      if (action === "approve") {
        for (const sibling of siblings) sibling.isCurrent = false;
        target.isCurrent = true;
        target.review = { reason: null, reviewedAt: "2026-03-31T10:00:00.000Z", reviewerName: "Ana Admin", status: "approved" };
      } else {
        if (!body?.reason?.trim()) return json(route, 400, { code: "VALIDATION_ERROR", fields: { "body.reason": ["Escribe el motivo del rechazo."] }, message: "Datos inválidos" });
        target.review = { reason: body.reason.trim(), reviewedAt: "2026-03-31T10:00:00.000Z", reviewerName: "Ana Admin", status: "rejected" };
      }
      const current = siblings.find((candidate) => candidate.isCurrent);
      return json(route, 200, { currentVersionId: current?.versionId ?? null, sharedWithClient: false, version: toFileVersion(target) });
    }
    if (/^\/api\/projects\/\d+\/warranties$/.test(path)) return json(route, 200, { warranties: state.warranties });
    const warrantyMatch = /^\/api\/admin\/files\/projects\/(\d+)\/warranties\/(\d+)\/documents\/(\d+)$/.exec(path);
    if (warrantyMatch) {
      const warranty = state.warranties.find((candidate) => candidate.id === Number(warrantyMatch[2]));
      const fileId = Number(warrantyMatch[3]);
      const linked = warranty.documents.some((document) => document.fileId === fileId);
      if (method === "PUT" && !linked) warranty.documents.push({ fileId });
      if (method === "DELETE") {
        if (!linked) return json(route, 404, { code: "WARRANTY_DOCUMENT_LINK_NOT_FOUND", message: "Sin vínculo" });
        warranty.documents = warranty.documents.filter((document) => document.fileId !== fileId);
      }
      const linkedWarrantyIds = state.warranties.filter((candidate) => candidate.documents.some((document) => document.fileId === fileId)).map((candidate) => candidate.id);
      return json(route, 200, { changed: method === "DELETE" || !linked, fileId, linkedWarrantyIds, warrantyId: warranty.id });
    }
    const uploadMatch = /^\/api\/admin\/files\/projects\/(\d+)\/files$/.exec(path);
    if (uploadMatch && method === "POST") {
      const project = state.projects.find((candidate) => candidate.id === Number(uploadMatch[1]));
      const folder = project.folders.find((candidate) => candidate.id === Number(params.folderId));
      const name = decodeURIComponent(request.headers()["x-file-name"] || "");
      if (state.uploadHook) {
        const handled = await state.uploadHook({ folder, name, project, record: () => recordUpload(project, folder, name, request), route });
        if (handled) return handled;
      }
      if (params.folderId && !folder) return json(route, 404, { code: "PROJECT_FOLDER_NOT_FOUND", message: "Carpeta no encontrada." });
      // Unicidad del nombre por carpeta (la raíz incluida), como el backend.
      if (state.items.some((candidate) => candidate.project.id === project.id && (candidate.folder?.id ?? null) === (folder?.id ?? null) && candidate.name.toLowerCase() === name.toLowerCase())) {
        return json(route, 409, { code: "DUPLICATE_PROJECT_FILE", message: "Ya existe un archivo con ese nombre en esta carpeta." });
      }
      if (folder?.systemKey === "cover" && folder.fileCount >= 1) return json(route, 409, { code: "PROJECT_FOLDER_FULL", message: "La portada admite una sola imagen: reemplaza la existente." });
      return json(route, 201, { file: recordUpload(project, folder, name, request) });
    }
    const replaceMatch = /^\/api\/projects\/(\d+)\/files\/(\d+)\/versions$/.exec(path);
    if (replaceMatch && method === "POST") {
      const fileId = Number(replaceMatch[2]);
      const note = decodeURIComponent(request.headers()["x-change-note"] || "").trim();
      if (!note) return json(route, 400, { code: "VALIDATION_ERROR", fields: { "headers.x-change-note": ["Escribe el motivo del cambio."] }, message: "Datos inválidos" });
      const siblings = state.items.filter((candidate) => candidate.fileId === fileId);
      if (siblings.some((candidate) => candidate.review.status === "pending")) return json(route, 409, { code: "FILE_VERSION_PENDING_REVIEW", message: "Pendiente" });
      const latest = siblings.reduce((top, candidate) => (candidate.versionNumber > top.versionNumber ? candidate : top));
      const versionNumber = latest.versionNumber + 1;
      // La versión nueva toma el formato del archivo subido (una imagen sigue siendo imagen).
      const uploadedName = decodeURIComponent(request.headers()["x-file-name"] || latest.name);
      const uploadedExtension = uploadedName.split(".").pop().toLowerCase();
      const created = {
        ...latest, changeNote: note, contentType: uploadedExtension === "png" ? "image/png" : "application/pdf", createdAt: "2026-04-01T10:00:00.000Z", extension: uploadedExtension, isCurrent: false, name: uploadedName,
        review: { reason: null, reviewedAt: null, reviewerName: null, status: "pending" }, size: request.postDataBuffer()?.length || 10, uploadedBy: { id: 1, name: "Ana Admin" }, versionId: 7000 + versionNumber, versionNumber,
      };
      state.items.push(created);
      return json(route, 201, { version: toFileVersion(created) });
    }
    // Restauración comercial: crea la versión vigente siguiente con su PDF (sin revisión posterior).
    const restoreMatch = /^\/api\/admin\/quotes\/(\d+)\/versions\/(\d+)\/restore$/.exec(path);
    if (restoreMatch && method === "POST" && state.quoteDocuments.has(Number(restoreMatch[1]))) {
      const quoteId = Number(restoreMatch[1]);
      const versions = state.quoteDocuments.get(quoteId);
      if (body.expectedVersion !== versions[0].versionNumber) {
        return json(route, 409, { code: "QUOTE_VERSION_CONFLICT", message: "Otro administrador modificó esta cotización." });
      }
      const versionNumber = versions[0].versionNumber + 1;
      const created = { ...state.quoteVersion(quoteId, versionNumber, 5, "available"), restoredFrom: { reason: body.reason, versionNumber: Number(restoreMatch[2]) } };
      versions.unshift(created);
      return json(route, 201, {
        message: "Versión restaurada.", replayed: false,
        quote: { code: `COT-0${quoteId}`, currentVersion: versionNumber, id: quoteId, pdf: created.pdf, version: { createdAt: created.createdAt, createdBy: created.createdBy, restoredFrom: created.restoredFrom } },
      });
    }
    const quoteMatch = /^\/api\/admin\/quotes\/(\d+)\/pdf(\/versions|\/retry)?$/.exec(path);
    if (quoteMatch && state.quoteDocuments.has(Number(quoteMatch[1]))) {
      const quoteId = Number(quoteMatch[1]);
      const versions = state.quoteDocuments.get(quoteId);
      const target = versions.find((candidate) => candidate.versionNumber === Number(params.version)) ?? versions[0];
      if (quoteMatch[2] === "/versions") {
        return json(route, 200, {
          nextCursor: null, quote: { code: `COT-0${quoteId}`, id: quoteId },
          versions: versions.map((version, index) => ({ ...version, isCurrent: index === 0, project: { id: 3, name: "Casa Cotizada" }, versionId: quoteId * 100 + version.versionNumber })),
        });
      }
      if (quoteMatch[2] === "/retry" && method === "POST") {
        target.pdf = { ...target.pdf, errorCode: null, size: 40960, status: "available" };
        return json(route, 200, { message: "PDF disponible.", pdf: target.pdf });
      }
      if (target.pdf.status !== "available") return json(route, 409, { code: "QUOTE_PDF_ERROR", message: "El PDF no está disponible. Reintenta su recuperación." });
      return route.fulfill({ body: SAMPLE_PDF, contentType: "application/pdf", headers: { "Content-Disposition": `attachment; filename="${target.pdf.fileName}"` }, status: 200 });
    }
    state.requests.push({ method, path, unexpected: true });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Ruta no simulada" });
  };
  return state;
}

/**
 * Abre la página con sesión de administrador; vigila errores y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context - Prueba.
 * @param {Object} backend - Backend simulado.
 * @param {Object} [options] - Tema y viewport.
 * @returns {Promise<import("playwright").Page>} Página.
 */
async function openFiles(context, backend, { theme = "light", viewport = { height: 1100, width: 1440 } } = {}) {
  const browserContext = await browser.newContext({ acceptDownloads: true, timezoneId: "America/Caracas", viewport });
  const page = applyBrowserTimeouts(await browserContext.newPage());
  await page.addInitScript((value) => localStorage.setItem("arca-theme", value), theme);
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(`${error.message} | ${error.stack || ""}`));
  // Errores de consola: se ignoran solo los avisos del navegador por respuestas HTTP de error que la
  // prueba simula a propósito (409, 503...); cualquier otro se registra con su origen y falla la prueba.
  page.on("console", (message) => {
    if (message.type() !== "error" || /^Failed to load resource: the server responded with a status of \d{3}/.test(message.text())) return;
    consoleErrors.push(`${message.text()} @ ${message.location()?.url || ""}:${message.location()?.lineNumber ?? ""}`);
  });
  await page.route((url) => url.pathname.startsWith("/api/"), backend.handle);
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, [], "errores de página");
    assert.deepEqual(consoleErrors, [], "errores de consola");
    assert.deepEqual(backend.requests.filter((request) => request.unexpected), []);
  });
  await page.goto(`${origin}/archivos`);
  await page.getByRole("heading", { level: 1, name: "Gestión de archivos" }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return page;
}

/**
 * Espera a que se cumpla una condición sobre el backend simulado.
 *
 * @param {() => boolean} condition - Condición.
 * @param {number} [timeout=5000] - Milisegundos máximos.
 * @returns {Promise<void>}
 */
async function waitUntil(condition, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("La condición no se cumplió a tiempo");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const itemRequests = (backend) => backend.requests.filter((request) => request.path === "/api/admin/files/items");
const rowNames = (page) => page.locator("[data-admin-files-table] tbody th[scope='row'] > span:first-child").allInnerTexts();

test("métricas, pestañas, orden, búsqueda, tipos y paginación por cursor con datos de la API", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const metrics = page.getByLabel("Métricas de archivos");
  await metrics.getByText("16").waitFor();
  assert.match(await metrics.innerText(), /2,33 GB/);

  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
  assert.equal((await rowNames(page)).length, 10);
  assert.deepEqual(itemRequests(backend).at(-1).search, { limit: "10", order: "desc", sort: "date", tab: "approved" });
  const firstRow = await page.locator("[data-admin-files-table] tbody tr").first().locator("th, td").allInnerTexts();
  assert.deepEqual(firstRow.slice(0, 5), ["Fachada.png", "v1", ".PNG", "2 MB", "21 mar 2026"]);
  assert.equal(firstRow[5], "Arq. Armando");
  assert.equal(await page.getByRole("columnheader", { name: "Proyecto" }).count(), 0, "Aprobados no muestra Proyecto");

  await page.getByRole("button", { name: "Siguiente pág." }).click();
  await page.getByRole("rowheader", { name: /Acta de inicio 01/ }).waitFor();
  assert.equal((await rowNames(page)).length, 5);
  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();

  await page.getByRole("button", { name: "Ordenar por Nombre" }).click();
  await page.waitForFunction(() => document.querySelector("[data-admin-files-table] tbody th")?.textContent.startsWith("Acta de inicio 01"));
  assert.equal(await page.getByRole("columnheader", { name: /Nombre/ }).getAttribute("aria-sort"), "ascending");
  assert.equal(itemRequests(backend).at(-1).search.cursor, undefined, "Cambiar el orden vuelve a la primera página");

  await page.getByLabel("Buscar archivos por nombre").fill("garant");
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 1);
  assert.equal(itemRequests(backend).at(-1).search.search, "garant");
  assert.equal(await page.locator("[data-admin-files-toolbar]").getByRole("button", { name: /Filtrar archivos por tipo|Quitar filtros/ }).count(), 0, "La barra no tiene filtros, como en Figma");
  await page.getByLabel("Buscar archivos por nombre").fill("");
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 10);

  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByRole("rowheader", { name: /Propuesta pendiente/ }).waitFor();
  await page.getByRole("columnheader", { name: "Proyecto" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Proyectos" }).count(), 0, "El árbol solo está en Aprobados");

  await page.getByRole("tab", { name: "Rechazados" }).click();
  await page.getByRole("rowheader", { name: /Contrato rechazado/ }).waitFor();
  assert.equal(await page.getByText(/Motivo: Falta la firma/).count(), 0, "el motivo está en el historial del visor");
  assert.equal(itemRequests(backend).at(-1).search.tab, "rejected");
  assert.equal(await page.getByRole("button", { name: /Eliminar/ }).count(), 0, "Los archivos guardados no se eliminan");
});

/**
 * Añade versiones rechazadas de dos proyectos y dos formatos al backend de prueba.
 * @param {Object} backend - Estado del simulador.
 */
function seedRejectedPage(backend) {
  for (let index = 0; index < 10; index += 1) {
    const extension = index === 0 ? "png" : "pdf";
    backend.items.push(item(1000 + index, {
      day: index + 1,
      extension,
      name: `Documento devuelto ${index + 1}.${extension}`,
      project: backend.projects[index % 2],
      isCurrent: false,
      size: (index + 1) * 1024 * 1024,
      status: "rejected",
    }));
  }
}

test("Rechazados · geometría Figma, búsqueda, tipos, orden y paginación entre proyectos", async (context) => {
  const backend = createBackend();
  seedRejectedPage(backend);
  const page = await openFiles(context, backend, { viewport: { width: 1920, height: 1280 } });
  await page.getByRole("tab", { name: "Rechazados" }).click();
  const row = page.getByRole("row", { name: /Contrato rechazado\.pdf/ });
  await row.waitFor();
  const table = page.locator("[data-admin-files-table]");
  assert.deepEqual(await table.getByRole("columnheader").allInnerTexts(), ["Nombre", "Versión", "Proyecto", "Tipo", "Peso", "Fecha", "Subido por", "Acciones"]);
  assert.deepEqual((await row.getByRole("cell").allInnerTexts()).slice(0, 6), ["v1", "Quinta Bella Vista", ".PDF", "8 KB", "23 mar 2026", "Arq. Armando"]);
  assert.equal(await row.getByRole("button").count(), 1);
  assert.equal(await page.getByRole("complementary", { name: "Proyectos" }).count(), 0);
  const dimensions = await table.evaluate((frame) => ({
    width: frame.getBoundingClientRect().width,
    columns: [...frame.querySelectorAll("th[scope=col]")].map((cell) => cell.getBoundingClientRect().width),
    header: frame.querySelector("thead tr").getBoundingClientRect().height,
    row: frame.querySelector("tbody tr").getBoundingClientRect().height,
  }));
  assert.equal(dimensions.width, 1104);
  assert.equal(dimensions.columns[0], 160);
  assert.ok(dimensions.columns.slice(1).every((value) => Math.abs(value - (1104 - 160) / 7) < 1));
  assert.deepEqual([Math.round(dimensions.header), Math.round(dimensions.row)], [49, 68]);
  const search = page.getByLabel("Buscar archivos por nombre");
  const searchBox = await page.locator("[data-admin-files-toolbar] [data-input-shell]").boundingBox();
  assert.deepEqual([searchBox.width, searchBox.height], [320, 40]);
  if (SCREENSHOT_DIR) {
    await page.evaluate(() => document.fonts.ready);
    await page.locator("[data-admin-files-toolbar]").locator("xpath=..").screenshot({ path: `${SCREENSHOT_DIR}/reference-desktop.png`, animations: "disabled" });
  }

  await page.getByRole("button", { name: "Siguiente pág." }).click();
  await page.getByRole("rowheader", { name: "Documento devuelto 1.png" }).waitFor();
  assert.ok(itemRequests(backend).at(-1).search.cursor);
  await page.getByRole("button", { name: "Ordenar por Peso" }).click();
  await waitUntil(() => itemRequests(backend).at(-1).search.sort === "size");
  await page.getByRole("rowheader", { name: "Documento devuelto 10.pdf" }).waitFor();
  assert.equal(itemRequests(backend).at(-1).search.cursor, undefined);
  assert.equal(await page.getByRole("columnheader", { name: /Peso/ }).getAttribute("aria-sort"), "descending");

  const filter = page.getByRole("button", { name: /^Filtrar archivos por tipo/ });
  await filter.press("Enter");
  const docx = page.getByRole("menuitemcheckbox", { name: ".DOCX" });
  await docx.and(page.locator(":focus")).waitFor();
  await docx.press("Space");
  await waitUntil(() => itemRequests(backend).at(-1).search.extensions === "docx");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  const png = page.getByRole("menuitemcheckbox", { name: ".PNG" });
  await png.click();
  await page.getByRole("rowheader", { name: "Documento devuelto 1.png" }).waitFor();
  assert.equal(itemRequests(backend).at(-1).search.extensions, "docx,png");
  await png.press("Escape");
  await filter.and(page.locator(":focus")).waitFor();
  await search.fill("Contrato");
  await waitUntil(() => itemRequests(backend).at(-1).search.search === "Contrato");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await row.waitFor();
  assert.equal(itemRequests(backend).at(-1).search.extensions, undefined);

  await page.getByRole("tab", { name: "Aprobados" }).click();
  await page.getByRole("complementary", { name: "Proyectos" }).waitFor();
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByRole("button", { name: "Revisar Propuesta pendiente.pdf, versión 2" }).waitFor();
  assert.equal(itemRequests(backend).at(-1).search.extensions, undefined);
});

test("Rechazados · Ver conserva motivo, historial y descarga de la versión", async (context) => {
  const backend = createBackend();
  const record = backend.items.find((entry) => entry.fileId === 60);
  record.review.reason = "Falta la firma del cliente. La última página tampoco incluye el nombre de la persona responsable y requiere una nueva copia legible.";
  const page = await openFiles(context, backend);
  await page.getByRole("tab", { name: "Rechazados" }).click();
  const open = page.getByRole("button", { name: "Ver Contrato rechazado.pdf, versión 1" });
  await open.click();
  const viewer = page.locator("[data-admin-file-viewer]");
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  const reason = history.getByText(`Motivo del rechazo: ${record.review.reason}`, { exact: true });
  await reason.waitFor();
  assert.ok(await reason.evaluate((node) => node.clientHeight > 20), "el motivo se puede leer en varias líneas");
  assert.equal(await viewer.getByRole("button", { name: /^(Revisar|Aprobar|Rechazar)$/ }).count(), 0);
  await history.getByRole("button", { name: "Opciones de la versión 1" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Descargar", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "acta-v600.pdf");
  assert.ok(backend.requests.some((request) => request.path === "/api/projects/1/files/60/content" && request.search.versionId === "600"));
  await page.keyboard.press("Escape");
  await open.and(page.locator(":focus")).waitFor();
});

for (const theme of ["light", "dark"]) {
  for (const width of [360, 375, 390, 768, 1024, 1440, 1920]) {
    test(`Rechazados · responsive ${width} px (${theme})`, async (context) => {
      const backend = createBackend();
      const page = await openFiles(context, backend, { theme, viewport: { width, height: 1050 } });
      await page.getByRole("tab", { name: "Rechazados" }).click();
      const eye = page.getByRole("button", { name: "Ver Contrato rechazado.pdf, versión 1" });
      await eye.waitFor();
      const viewport = page.locator("[data-admin-files-table] [data-horizontal-scroll-viewport]");
      const layout = await viewport.evaluate((node) => ({
        scrollable: node.scrollWidth > node.clientWidth,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        dark: document.documentElement.classList.contains("dark"),
      }));
      assert.equal(layout.dark, theme === "dark");
      assert.ok(layout.overflow <= 0);
      assert.equal(layout.scrollable, width < 1440);
      const eyeBox = await eye.boundingBox();
      assert.ok(eyeBox.x >= 0 && eyeBox.x + eyeBox.width <= width);
      assert.equal(await page.getByLabel("Buscar archivos por nombre").isEditable(), true);
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/rejected-${theme}-${width}.png`, animations: "disabled" });
      const filter = page.getByRole("button", { name: /^Filtrar archivos por tipo/ });
      if (layout.scrollable) {
        const scrollbar = page.getByRole("scrollbar", { name: "Desplazar tabla de archivos horizontalmente" });
        const bar = await scrollbar.boundingBox();
        await scrollbar.click({ position: { x: bar.width - 2, y: bar.height / 2 } });
        assert.ok(await viewport.evaluate((node) => node.scrollLeft > 0));
        // Posiciona el encabezado en la zona visible a la izquierda de la acción fija.
        await filter.evaluate((button) => {
          const scroll = button.closest("[data-horizontal-scroll-viewport]");
          scroll.scrollLeft += button.getBoundingClientRect().left - scroll.getBoundingClientRect().left;
        });
      }
      await filter.click();
      const choice = page.getByRole("menuitemcheckbox", { name: ".PDF" });
      await choice.scrollIntoViewIfNeeded();
      await choice.click();
      await waitUntil(() => itemRequests(backend).at(-1).search.extensions === "pdf");
      await choice.press("Escape");
      await eye.click({ trial: true });
    });
  }
}

test("el árbol acota la tabla, busca carpetas y gestiona carpetas personalizadas", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).waitFor();
  const create = tree.getByRole("button", { name: /^Nueva carpeta/ });
  assert.equal(await create.isDisabled(), true, "Sin carpeta seleccionada no se crea");

  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 10);
  assert.equal(itemRequests(backend).at(-1).search.projectId, "1");
  assert.equal(await create.getAttribute("aria-label"), "Nueva carpeta en Quinta Bella Vista", "La raíz admite carpetas (D7 resuelta)");
  assert.equal(await create.isDisabled(), false);

  await tree.getByRole("button", { exact: true, name: "Portada del proyecto" }).click();
  assert.match(await create.getAttribute("aria-label"), /no admite subcarpetas/);
  assert.equal(await tree.getByRole("button", { name: "Opciones de la carpeta Portada del proyecto" }).count(), 0, "Predeterminadas protegidas");

  await tree.getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
  await tree.getByRole("button", { exact: true, name: "Garantías" }).click();
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
  await tree.getByRole("button", { exact: true, name: "Garantías" }).evaluate(async (button) => {
    await Promise.all(button.closest("[data-tree-row]").getAnimations().map((animation) => animation.finished));
  });
  const branch = await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).evaluate((button) => {
    const row = button.closest("[data-tree-row]");
    return { background: getComputedStyle(row).backgroundColor, current: button.getAttribute("aria-current"), height: row.getBoundingClientRect().height };
  });
  const selectedFolder = await tree.getByRole("button", { exact: true, name: "Garantías" }).evaluate((button) => {
    const row = button.closest("[data-tree-row]");
    return { background: getComputedStyle(row).backgroundColor, current: button.getAttribute("aria-current"), height: row.getBoundingClientRect().height };
  });
  assert.equal(branch.background, selectedFolder.background, "El proyecto conserva su contexto visual al seleccionar una carpeta, como en Figma");
  assert.notEqual(branch.background, "rgba(0, 0, 0, 0)");
  assert.equal(branch.current, null, "Solo la carpeta seleccionada es la ubicación actual");
  assert.equal(selectedFolder.current, "true");
  assert.equal(selectedFolder.height, 36, "La superficie de la fila respeta la geometría de Figma");
  const arrow = tree.getByRole("button", { name: "Ocultar carpetas de Documentos" });
  await arrow.hover();
  const arrowHover = await arrow.evaluate(async (button) => {
    const row = button.closest("[data-tree-row]");
    await Promise.all(row.getAnimations().map((animation) => animation.finished));
    const box = button.getBoundingClientRect();
    return { arrow: getComputedStyle(button).backgroundColor, row: getComputedStyle(row).backgroundColor, size: [box.width, box.height] };
  });
  assert.equal(arrowHover.arrow, "rgba(0, 0, 0, 0)", "La flecha no pinta un fondo propio al pasar el cursor");
  assert.equal(arrowHover.row, branch.background, "El hover lo muestra la fila completa");
  assert.deepEqual(arrowHover.size, [36, 36], "La flecha conserva su geometría");
  assert.deepEqual({ folderId: itemRequests(backend).at(-1).search.folderId, includeSubfolders: itemRequests(backend).at(-1).search.includeSubfolders }, { folderId: "104", includeSubfolders: "true" });

  await create.click();
  const dialog = page.getByRole("dialog", { name: "Nueva carpeta" });
  await dialog.getByText("Destino: Quinta Bella Vista/Documentos/Garantías", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("Escribe el nombre de la carpeta.").waitFor();
  await dialog.getByLabel("Nombre de la carpeta").fill("Certificados");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.waitFor({ state: "detached" });
  await tree.getByRole("button", { exact: true, name: "Certificados" }).waitFor();
  await page.getByText("Carpeta creada").waitFor();
  assert.deepEqual(backend.requests.find((request) => request.method === "POST").body, { name: "Certificados", parentId: 104 });

  await tree.getByRole("button", { exact: true, name: "Garantías" }).click();
  await create.click();
  await page.getByLabel("Nombre de la carpeta").fill("certificados");
  await page.getByRole("button", { name: "Crear" }).click();
  await page.getByText("Ya existe una carpeta con ese nombre en esta ubicación.").waitFor();
  await page.getByRole("button", { name: "Cancelar" }).click();

  await tree.getByRole("button", { name: "Opciones de la carpeta Certificados" }).click();
  await page.getByRole("menuitem", { name: "Renombrar" }).click();
  await page.getByLabel("Nombre de la carpeta").fill("Certificados de obra");
  await page.getByRole("button", { name: "Guardar" }).click();
  await tree.getByRole("button", { exact: true, name: "Certificados de obra" }).waitFor();

  await tree.getByRole("button", { name: "Opciones de la carpeta Certificados de obra" }).click();
  await page.getByRole("menuitem", { name: "Retirar carpeta" }).click();
  const confirm = page.locator("[data-admin-file-folder-removal]");
  await confirm.getByText("Los archivos guardados y sus versiones nunca se eliminan.").waitFor();
  await confirm.getByRole("button", { name: "Retirar carpeta" }).click();
  await page.getByText("Carpeta retirada").waitFor();
  await tree.getByRole("button", { exact: true, name: "Certificados de obra" }).waitFor({ state: "detached" });

  await tree.getByRole("button", { name: "Opciones de la carpeta Planos de obra" }).waitFor();
  await page.getByLabel("Buscar carpetas y proyectos").fill("garan");
  const results = page.getByRole("region", { name: "Carpetas encontradas" });
  await results.getByText("Apartamento JC › Documentos › Garantías").waitFor();
  await results.getByText("Apartamento JC › Documentos › Garantías").click();
  await waitUntil(() => itemRequests(backend).at(-1).search.folderId === "204");
  assert.equal(itemRequests(backend).at(-1).search.projectId, "2");
  await page.getByText("No hay coincidencias").waitFor();
});

test("las carpetas con contenido no se retiran y el error se comunica", async (context) => {
  const backend = createBackend();
  backend.projects[0].folders.push({ fileCount: 0, id: 151, name: "Sub", parentId: 150, systemKey: null });
  const page = await openFiles(context, backend);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { name: "Mostrar carpetas de Quinta Bella Vista" }).click();
  await tree.getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
  await tree.getByRole("button", { name: "Opciones de la carpeta Planos de obra" }).click();
  await page.getByRole("menuitem", { name: "Retirar carpeta" }).click();
  await page.locator("[data-admin-file-folder-removal]").getByRole("button", { name: "Retirar carpeta" }).click();
  await page.getByText(/Solo se pueden retirar carpetas vacías/).waitFor();
  await tree.getByRole("button", { exact: true, name: "Planos de obra" }).waitFor();
});

test("descarga la versión con el nombre del servidor", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar Garantía impermeabilización.pdf, versión 12" }).click();
  assert.equal((await download).suggestedFilename(), "acta-v3110.pdf");
  const request = backend.requests.find((candidate) => candidate.path === "/api/projects/1/files/30/content");
  assert.equal(request.search.versionId, "3110");
});

test("cotizaciones: su PDF aparece en «Documentos › Cotizaciones» del proyecto; se ve, descarga y recorre su historial sin reemplazarlo", async (context) => {
  const backend = createBackend({ quotes: true });
  const page = await openFiles(context, backend);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { name: "Mostrar carpetas de Casa Cotizada" }).click();
  await tree.getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
  for (const name of ["Cotizaciones", "Actas", "Planos"]) await tree.getByRole("button", { exact: true, name }).waitFor();
  await tree.getByRole("button", { exact: true, name: "Cotizaciones" }).click();
  await page.getByRole("rowheader", { name: /COT-012-v2\.pdf/ }).waitFor();
  assert.deepEqual((await rowNames(page)).sort(), ["COT-012-v2.pdf", "COT-013-v1.pdf"]);
  assert.deepEqual({ folderId: itemRequests(backend).at(-1).search.folderId, projectId: itemRequests(backend).at(-1).search.projectId }, { folderId: "510", projectId: "3" });
  // D14 resuelta: «Cotizaciones» admite subcarpetas y archivos manuales; sus PDF generados siguen gestionados.
  assert.equal(await page.getByRole("button", { name: "Nueva carpeta en Cotizaciones" }).isDisabled(), false);
  assert.equal(await page.getByRole("button", { exact: true, name: "Nuevo archivo" }).isDisabled(), false);
  // «Documentos» (con sus subcarpetas) las muestra una sola vez.
  await tree.getByRole("button", { exact: true, name: "Documentos" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 2);
  assert.deepEqual({ folderId: itemRequests(backend).at(-1).search.folderId, includeSubfolders: itemRequests(backend).at(-1).search.includeSubfolders }, { folderId: "503", includeSubfolders: "true" });
  await tree.getByRole("button", { exact: true, name: "Cotizaciones" }).click();
  await waitUntil(() => itemRequests(backend).at(-1).search.folderId === "510");

  // Un PDF no disponible se informa y no se descarga; uno disponible sí, desde la API de Cotizaciones.
  const failedRow = page.locator("tr", { has: page.getByRole("rowheader", { name: /COT-013-v1\.pdf/ }) });
  await failedRow.getByText("Error de almacenamiento del PDF").waitFor();
  assert.equal(await failedRow.locator("td").nth(2).innerText(), "—", "sin archivo no hay peso");
  assert.equal(await page.getByRole("button", { name: /^Descargar COT-013-v1\.pdf, versión 1\./ }).isDisabled(), true);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { exact: true, name: "Descargar COT-012-v2.pdf, versión 2" }).click();
  assert.equal((await download).suggestedFilename(), "COT-012-v2.pdf");
  assert.equal(backend.requests.find((request) => request.path === "/api/admin/quotes/12/pdf").search.version, "2");

  // Menú: historial, sin reemplazo ni garantías.
  await page.getByRole("button", { name: "Más opciones para COT-012-v2.pdf, versión 2" }).click();
  const menu = page.getByRole("menu", { name: "Acciones para COT-012-v2.pdf, versión 2" });
  assert.deepEqual((await menu.getByRole("menuitem").allInnerTexts()).map((text) => text.trim()), ["Historial de versiones"]);
  await page.keyboard.press("Escape");

  // Visor: PDF vigente, historial comercial (V2 actual y V1) y la versión anterior con su PDF original.
  await page.getByRole("button", { exact: true, name: "Ver COT-012-v2.pdf, versión 2" }).click();
  const viewer = page.locator("[data-admin-quote-viewer]");
  await viewer.locator("canvas").first().waitFor();
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  await history.locator("li").nth(1).waitFor();
  assert.deepEqual(await history.locator("li").evaluateAll((rows) => rows.map((row) => row.dataset.versionNumber)), ["2", "1"]);
  assert.equal(await viewer.getByRole("button", { name: /^Subir una versión nueva\./ }).isDisabled(), true, "el PDF no se reemplaza a mano");
  await viewer.getByRole("button", { name: "Opciones de la versión 1" }).click();
  const versionMenu = page.getByRole("menu", { name: "Acciones para la versión 1" });
  assert.deepEqual((await versionMenu.getByRole("menuitem").allInnerTexts()).map((text) => text.trim()), ["Ver", "Restaurar versión", "Descargar"]);
  await versionMenu.getByRole("menuitem", { exact: true, name: "Ver" }).click();
  await viewer.getByText(/V1 · Versión anterior/).waitFor();
  await waitUntil(() => backend.requests.some((request) => request.path === "/api/admin/quotes/12/pdf" && request.search.version === "1"));
  await viewer.getByRole("button", { name: "Editar cotización" }).waitFor();
  await viewer.getByRole("button", { exact: true, name: "Cerrar" }).click();
  await viewer.waitFor({ state: "detached" });

  // Un PDF con error se recupera una sola vez al abrirlo (sin versión nueva) y la tabla lo refleja.
  const loads = itemRequests(backend).length;
  await page.getByRole("button", { exact: true, name: "Ver COT-013-v1.pdf, versión 1" }).click();
  await viewer.locator("canvas").first().waitFor();
  assert.equal(backend.requests.filter((request) => request.method === "POST" && request.path === "/api/admin/quotes/13/pdf/retry").length, 1);
  await waitUntil(() => itemRequests(backend).length > loads);
  await viewer.getByRole("button", { exact: true, name: "Cerrar" }).click();
  await failedRow.getByText("Error de almacenamiento del PDF").waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { exact: true, name: "Descargar COT-013-v1.pdf, versión 1" }).isDisabled(), false);

  // Búsqueda y Pendientes (sin cotizaciones).
  await page.getByLabel("Buscar archivos por nombre").fill("COT-013");
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 1);
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByText("No hay coincidencias").waitFor();
  assert.equal(itemRequests(backend).at(-1).search.tab, "pending");
  assert.equal(await page.locator("[data-item-source='quote']").count(), 0, "las cotizaciones no pasan por revisión");
});

for (const { theme, viewport } of [{ theme: "light", viewport: { height: 1100, width: 1440 } }, { theme: "dark", viewport: { height: 844, width: 390 } }]) {
  test(`cotizaciones: «Restaurar versión» pide motivo, crea la versión vigente con su PDF y actualiza historial y tabla (${theme}, ${viewport.width}px)`, async (context) => {
    const backend = createBackend({ quotes: true });
    const page = await openFiles(context, backend, { theme, viewport });
    await page.getByRole("rowheader", { name: /COT-012-v2\.pdf/ }).first().waitFor();
    await page.getByRole("button", { exact: true, name: "Ver COT-012-v2.pdf, versión 2" }).click();
    const viewer = page.locator("[data-admin-quote-viewer]");
    const history = viewer.getByRole("list", { name: "Versiones del archivo" });
    await history.locator("li").nth(1).waitFor();

    // La vigente no se restaura; la histórica sí.
    await viewer.getByRole("button", { name: "Opciones de la versión 2" }).click();
    assert.equal(await page.getByRole("menu", { name: "Acciones para la versión 2" }).getByRole("menuitem", { name: "Restaurar versión" }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await viewer.getByRole("button", { name: "Opciones de la versión 1" }).click();
    await page.getByRole("menu", { name: "Acciones para la versión 1" }).getByRole("menuitem", { name: "Restaurar versión" }).click();

    // Diálogo: explica la versión creada y los datos restaurados; el motivo es obligatorio.
    const dialog = page.locator("[data-admin-file-reason='quoteRestore']");
    await dialog.waitFor();
    assert.match(await dialog.locator("[data-admin-file-reason-description]").innerText(), /Se creará la V3 con los datos comerciales de la V1/);
    await dialog.getByRole("button", { name: "Restaurar" }).click();
    await dialog.getByText("Escribe el motivo de la restauración.").waitFor();
    assert.equal(backend.requests.filter((request) => request.path.endsWith("/restore")).length, 0);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, "El diálogo cabe en el ancho de la pantalla");

    const loads = itemRequests(backend).length;
    await dialog.locator("textarea").fill("El cliente aprobó la primera propuesta");
    await dialog.getByRole("button", { name: "Restaurar" }).click();
    await dialog.waitFor({ state: "detached" });
    const restoreRequest = backend.requests.find((request) => request.path === "/api/admin/quotes/12/versions/1/restore");
    assert.equal(restoreRequest.method, "POST");

    // El visor sigue abierto, muestra V3 vigente y el historial conserva V2 y V1.
    await page.getByText("Versión restaurada", { exact: true }).waitFor();
    await viewer.waitFor();
    await waitUntil(() => itemRequests(backend).length > loads);
    await history.locator("li").nth(2).waitFor();
    assert.deepEqual(await history.locator("li").evaluateAll((rows) => rows.map((row) => row.dataset.versionNumber)), ["3", "2", "1"]);
    assert.equal(await history.locator("li[data-version-number='3']").getAttribute("aria-current"), "true");
    await history.getByText("Restaurada desde V1: El cliente aprobó la primera propuesta").waitFor();
    await waitUntil(() => backend.requests.some((request) => request.path === "/api/admin/quotes/12/pdf" && request.search.version === "3"));
    await viewer.getByRole("button", { exact: true, name: "Cerrar" }).click();
    await viewer.waitFor({ state: "detached" });
    await page.getByRole("rowheader", { name: /COT-012-v3\.pdf/ }).first().waitFor();
  });
}

test("estado de error con reintento y estado vacío por filtros", async (context) => {
  const backend = createBackend({ failures: { "GET /api/admin/files/items": { body: { code: "INTERNAL", message: "Error temporal del servidor." }, status: 500 } } });
  const page = await openFiles(context, backend);
  await page.getByText("No se pudieron cargar los archivos").waitFor();
  await page.getByText("Error temporal del servidor.").waitFor();
  const attempts = itemRequests(backend).length;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await waitUntil(() => itemRequests(backend).length > attempts);
});

test("estado vacío por filtros con «Quitar filtros»", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
  await page.getByLabel("Buscar archivos por nombre").fill("inexistente");
  await page.getByText("No hay coincidencias").waitFor();
  await page.locator("[data-admin-files-layout]").getByRole("button", { name: "Quitar filtros" }).last().click();
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
});

test("con la activación apagada solo muestra las métricas generales", async (context) => {
  const backend = createBackend({ enabled: false });
  const page = await openFiles(context, backend);
  await page.getByText("La gestión de archivos aún no está disponible").waitFor();
  assert.match(await page.getByLabel("Métricas de archivos").innerText(), /500/);
  assert.equal(await page.getByRole("tab").count(), 0);
  assert.equal(backend.requests.filter((request) => request.path === "/api/admin/files/items").length, 0);
});

const viewerDialog = (page) => page.locator("[data-admin-file-viewer]");
const viewerHeader = (viewer) => viewer.locator("[data-admin-file-modal] article");
const reviewRequests = (backend, action) => backend.requests.filter((request) => request.method === "POST" && request.path.endsWith(`/${action}`));
const metricsReads = (backend) => backend.requests.filter((request) => request.path === "/api/admin/files/metrics").length;
const reviewResult = (page, action) => page.locator(action ? `[data-admin-file-review-result="${action}"]` : "[data-admin-file-review-result]");
const reviewAlert = (page) => page.getByRole("alert", { name: "Gestión de archivos actualizada" });
const reviewErrorAlert = (page) => page.getByRole("alert", { name: "Error en la gestión de archivos" });

/**
 * Abre la pestaña de pendientes y el visor de «Propuesta pendiente.pdf» desde «Revisar».
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<import("playwright").Locator>} Visor.
 */
async function openPendingReview(page) {
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByRole("button", { name: "Revisar Propuesta pendiente.pdf, versión 2" }).click();
  const viewer = viewerDialog(page);
  await viewer.locator("canvas").first().waitFor();
  return viewer;
}

test("U2 · «Revisar» abre el PDF con historial; aprobar confirma lo que devuelve la API y no comparte", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("rowheader", { name: /Fachada/ }).waitFor();
  const viewer = await openPendingReview(page);
  await viewerHeader(viewer).getByText("V2 · Pendiente de revisión").waitFor();
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  assert.deepEqual(await history.locator("li").evaluateAll((rows) => rows.map((row) => row.dataset.versionNumber)), ["2", "1"]);
  assert.equal(backend.requests.find((request) => request.path === "/api/projects/1/files/50/content").search.versionId, "500");

  const metricsBefore = metricsReads(backend);
  let release;
  const responseGate = new Promise((resolve) => { release = resolve; });
  await page.route((url) => url.pathname.endsWith("/approve"), async (route) => {
    await responseGate;
    await route.fallback();
  });
  await viewer.getByRole("button", { name: "Aprobar" }).click();
  const result = reviewResult(page, "approve");
  try {
    const busy = viewer.getByRole("button", { name: "Aprobando..." });
    await busy.waitFor();
    assert.equal(await busy.isDisabled(), true);
    assert.equal(await result.count(), 0, "la aprobación todavía no ha sido confirmada");
    await busy.evaluate((button) => button.click());
  } finally {
    release();
  }
  await result.getByText("Archivo aprobado correctamente").waitFor();
  await result.getByText(/disponible en el proyecto según los permisos vigentes/).waitFor();
  assert.equal(await result.count(), 1);
  assert.equal(await page.getByRole("dialog", { name: "Archivo aprobado correctamente" }).count(), 1);
  assert.equal(await reviewAlert(page).count(), 0);
  assert.equal(reviewRequests(backend, "approve").length, 1);
  assert.equal(await viewerDialog(page).count(), 0, "el visor se cierra tras aprobar");
  await page.getByText("No hay archivos pendientes").waitFor();
  assert.ok(metricsReads(backend) > metricsBefore, "las métricas se vuelven a leer");
  const pendingTab = page.getByRole("tab", { name: "Pendientes por aprobación" });
  const accept = result.getByRole("button", { name: "Aceptar" });
  const close = result.getByRole("button", { name: "Cerrar resultado de revisión" });
  await accept.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Tab");
  await close.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Shift+Tab");
  await accept.and(page.locator(":focus")).waitFor();
  await accept.press("Enter");
  await result.waitFor({ state: "detached" });
  assert.equal(reviewRequests(backend, "approve").length, 1, "Aceptar solo cierra el resultado");
  await pendingTab.and(page.locator(":focus")).waitFor();
  await pendingTab.press("ArrowLeft");
  await page.getByRole("button", { name: "Ver Propuesta pendiente.pdf, versión 2" }).click();
  await viewer.getByRole("list", { name: "Versiones del archivo" }).getByText("Versión actual", { exact: true }).waitFor();
  assert.equal(await viewer.getByRole("button", { name: "Aprobar" }).count(), 0);
  // Compartir con el cliente es independiente: aprobar no llamó a las audiencias.
  assert.equal(backend.requests.filter((request) => request.path.includes("/audiences")).length, 0);
});

test("U2 · rechazar exige motivo, lo envía y conserva la versión rechazada", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const viewer = await openPendingReview(page);
  await viewer.getByRole("button", { name: "Rechazar" }).click();
  const reason = page.locator("[data-admin-file-reason='reject']");
  // Figma 3727:683879: 400 px, campo de 130 px, X y pie «Volver» / «Enviar».
  await page.waitForTimeout(400);
  const box = await reason.boundingBox();
  assert.equal(Math.round(box.width), 400);
  const geometry = await reason.evaluate((dialog) => {
    const form = dialog.querySelector("form");
    const textarea = dialog.querySelector("textarea");
    const field = textarea.parentElement.parentElement;
    const close = dialog.querySelector("button[aria-label='Cerrar motivo del rechazo']");
    const footer = dialog.querySelector("footer");
    const buttons = [...footer.querySelectorAll("button")];
    const dialogRect = dialog.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    const styles = getComputedStyle(dialog);
    const borderStyles = getComputedStyle(dialog, "::after");
    const formStyles = getComputedStyle(form);
    const footerStyles = getComputedStyle(footer);
    const footerDividerStyles = getComputedStyle(footer, "::before");
    return {
      borderColor: borderStyles.borderTopColor,
      borderRadius: styles.borderRadius,
      borderWidth: borderStyles.borderTopWidth,
      buttonWidths: buttons.map((button) => button.getBoundingClientRect().width),
      closeRight: dialogRect.right - closeRect.right,
      closeTop: closeRect.top - dialogRect.top,
      dialogHeight: dialogRect.height,
      fieldHeight: fieldRect.height,
      fieldRadius: getComputedStyle(field).borderRadius,
      footerGap: footerStyles.columnGap,
      footerTopBorder: footerDividerStyles.height,
      formPadding: [formStyles.paddingTop, formStyles.paddingRight, formStyles.paddingBottom, formStyles.paddingLeft],
    };
  });
  assert.equal(Math.round(geometry.dialogHeight), 260, "el diálogo conserva las dimensiones exteriores de Figma");
  assert.equal(Math.round(geometry.fieldHeight), 130, "el campo completo mide 130 px como Figma 3727:683879");
  assert.equal(geometry.borderWidth, "1px");
  assert.notEqual(geometry.borderColor, "rgba(0, 0, 0, 0)");
  assert.equal(geometry.borderRadius, "12px");
  assert.equal(geometry.fieldRadius, "8px");
  assert.deepEqual(geometry.formPadding, ["16px", "16px", "16px", "16px"]);
  assert.ok(Math.abs(geometry.closeTop) <= 1 && Math.abs(geometry.closeRight) <= 1, "la X ocupa la esquina superior derecha");
  assert.equal(geometry.footerTopBorder, "1px");
  assert.equal(geometry.footerGap, "16px");
  assert.ok(Math.abs(geometry.buttonWidths[0] - geometry.buttonWidths[1]) <= 1, "los botones se distribuyen por igual");
  const hint = await reason.getByText(/Máximo 500 caracteres/).boundingBox();
  assert.ok(hint.width <= 1 && hint.height <= 1, "sin línea de ayuda visible (solo para lectores de pantalla)");
  await reason.getByText("Motivo del rechazo", { exact: true }).waitFor();
  const reasonField = reason.getByRole("textbox", { name: /Motivo del rechazo/ });
  assert.equal(await reasonField.evaluate((field) => field === document.activeElement), true, "el foco inicial queda en el motivo");
  assert.equal(await reasonField.getAttribute("aria-required"), "true", "el motivo conserva su semántica de campo obligatorio");
  assert.equal(await reason.getByText("*", { exact: true }).count(), 0, "Figma no muestra un indicador adicional junto a la etiqueta");
  assert.equal(await reasonField.getAttribute("maxlength"), "500");
  await reasonField.fill("     ");
  await reason.getByRole("button", { name: "Enviar" }).click();
  const validationError = reason.getByText("Escribe el motivo del rechazo.");
  await validationError.waitFor();
  const [errorBox, footerBox] = await Promise.all([
    validationError.boundingBox(),
    reason.locator("footer").boundingBox(),
  ]);
  assert.ok(errorBox.y + errorBox.height <= footerBox.y, "el error aumenta el cuerpo sin superponer el pie");
  assert.equal(reviewRequests(backend, "reject").length, 0, "sin motivo no se envía");
  await reasonField.fill("  Falta la firma del cliente.  ");
  const metricsBefore = metricsReads(backend);
  await reason.getByRole("button", { name: "Enviar" }).click();
  const result = reviewResult(page, "reject");
  await result.getByText("Archivo rechazado correctamente").waitFor();
  await result.getByText("El motivo del rechazo quedó guardado en el historial de versiones.").waitFor();
  assert.equal(await result.count(), 1);
  assert.equal(await page.getByRole("dialog", { name: "Archivo rechazado correctamente" }).count(), 1);
  assert.equal(await reason.count(), 0);
  assert.equal(await reviewAlert(page).count(), 0);
  assert.equal(reviewRequests(backend, "reject").length, 1);
  assert.deepEqual(reviewRequests(backend, "reject")[0].body, { reason: "Falta la firma del cliente." });
  await waitUntil(() => metricsReads(backend) > metricsBefore);
  await result.getByRole("button", { name: "Cancelar" }).click();
  await result.waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).and(page.locator(":focus")).waitFor();
  assert.equal(reviewRequests(backend, "reject").length, 1, "Cancelar solo cierra el resultado");
  await page.getByRole("tab", { name: "Rechazados" }).click();
  await page.getByRole("rowheader", { name: "Propuesta pendiente.pdf" }).waitFor();
  await page.getByRole("button", { name: "Ver Propuesta pendiente.pdf, versión 2" }).click();
  await viewer.getByRole("list", { name: "Versiones del archivo" }).getByText("Motivo del rechazo: Falta la firma del cliente.").waitFor();
});

test("U2 · un 409 de versión ya revisada se informa sin cerrar el visor y recarga tabla e historial", async (context) => {
  const backend = createBackend({ failures: { "POST /api/projects/:id/files/:id/versions/:id/approve": { body: { code: "FILE_VERSION_NOT_PENDING", message: "No pendiente" }, status: 409 } } });
  const page = await openFiles(context, backend);
  const viewer = await openPendingReview(page);
  const versionReads = () => backend.requests.filter((request) => request.path === "/api/projects/1/files/50/versions").length;
  const itemReads = () => backend.requests.filter((request) => request.path === "/api/admin/files/items").length;
  const [versionsBefore, itemsBefore] = [versionReads(), itemReads()];
  await viewer.getByRole("button", { name: "Aprobar" }).click();
  const alert = reviewErrorAlert(page);
  await alert.getByText("No se pudo aprobar el archivo").waitFor();
  await alert.getByText("Esta versión ya fue revisada. Se actualizó la información.").waitFor();
  assert.equal(await alert.count(), 1);
  await waitUntil(() => versionReads() > versionsBefore && itemReads() > itemsBefore);
  assert.equal(await viewerDialog(page).count(), 1, "el visor sigue abierto con la versión mostrada");
  await viewerHeader(viewer).getByText("V2 · Pendiente de revisión").waitFor();
  assert.equal(await reviewAlert(page).count(), 0);
  assert.equal(await reviewResult(page).count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 1);
});

test("U2 · error al rechazar conserva el motivo y permite reintentar con una sola alerta", async (context) => {
  const operation = "POST /api/projects/:id/files/:id/versions/:id/reject";
  const failures = {
    [operation]: {
      body: { code: "VALIDATION_ERROR", fields: { "body.reason": ["Revisa el motivo del rechazo."] } },
      status: 400,
    },
  };
  const backend = createBackend({ failures });
  const page = await openFiles(context, backend);
  const viewer = await openPendingReview(page);
  await viewer.getByRole("button", { name: "Rechazar" }).click();
  const dialog = page.locator("[data-admin-file-reason='reject']");
  const field = dialog.getByRole("textbox", { name: "Motivo del rechazo" });
  const send = dialog.getByRole("button", { name: "Enviar" });
  await field.fill("Falta firmar el archivo.");
  await send.click();
  await dialog.getByRole("alert").getByText("Revisa el motivo del rechazo.").waitFor();
  assert.equal(await field.inputValue(), "Falta firmar el archivo.");
  assert.equal(await reviewErrorAlert(page).count(), 0, "la validación se indica junto al campo");
  assert.equal(await reviewResult(page).count(), 0);

  failures[operation] = { body: { code: "INTERNAL_ERROR", message: "Detalle interno del servidor" }, status: 500 };
  await field.fill("Falta la firma del cliente.");
  await send.click();
  const error = reviewErrorAlert(page);
  await error.getByText("No se pudo rechazar el archivo").waitFor();
  await error.getByText("Intenta rechazar la versión de nuevo.").waitFor();
  assert.equal(await error.count(), 1);
  assert.equal(await dialog.getByRole("alert").count(), 0, "el error general solo se anuncia una vez");
  assert.equal(await page.getByText("Detalle interno del servidor").count(), 0);
  assert.equal(await reviewAlert(page).count(), 0);
  assert.equal(await reviewResult(page).count(), 0);
  assert.equal(await field.inputValue(), "Falta la firma del cliente.");

  delete failures[operation];
  await send.click();
  await reviewResult(page, "reject").getByText("Archivo rechazado correctamente").waitFor();
  assert.deepEqual(reviewRequests(backend, "reject").map((request) => request.body), [
    { reason: "Falta firmar el archivo." },
    { reason: "Falta la firma del cliente." },
    { reason: "Falta la firma del cliente." },
  ]);
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await dialog.count(), 0);
  assert.equal(await reviewAlert(page).count(), 0);
  assert.equal(await reviewErrorAlert(page).count(), 0);
});

for (const theme of ["light", "dark"]) {
  for (const width of [360, 375, 390, 768, 1024, 1440, 1920]) {
    test(`U2/U3 · aprobación, rechazo y reemplazo centrados (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      // Dos archivos pendientes en la misma sesión para recorrer ambos resultados.
      backend.items.find((entry) => entry.name === "Contrato rechazado.pdf").review.status = "pending";
      const page = await openFiles(context, backend, { theme, viewport: { height: 900, width } });
      const viewer = await openPendingReview(page);
      await viewer.getByRole("button", { name: "Aprobar", exact: true }).click();
      const approved = reviewResult(page, "approve");
      await checkReviewModalGeometry(approved, { kind: "approve", theme, width });
      if (width === 375) {
        await page.setViewportSize({ height: 200, width });
        await assertScrollableModal(approved, "Aceptar", ":scope > div:first-of-type");
        await page.setViewportSize({ height: 900, width });
      }
      await approved.getByRole("button", { name: "Cerrar resultado de revisión" }).click();
      await approved.waitFor({ state: "detached" });
      const tab = page.getByRole("tab", { name: "Pendientes por aprobación" });
      await tab.and(page.locator(":focus")).waitFor();

      await page.getByRole("button", { name: "Revisar Contrato rechazado.pdf, versión 1" }).click();
      await viewer.getByRole("button", { name: "Rechazar" }).click();
      const reason = page.locator("[data-admin-file-reason='reject']");
      await reason.getByRole("textbox", { name: "Motivo del rechazo" }).fill("Falta la firma.");
      await reason.getByRole("button", { name: "Enviar" }).click();
      const rejected = reviewResult(page, "reject");
      await checkReviewModalGeometry(rejected, { kind: "reject", theme, width });
      await page.keyboard.press("Escape");
      await rejected.waitFor({ state: "detached" });
      await tab.and(page.locator(":focus")).waitFor();
      assert.equal(reviewRequests(backend, "approve").length, 1);
      assert.equal(reviewRequests(backend, "reject").length, 1);
      assert.equal(await reviewAlert(page).count(), 0);

      await page.getByRole("tab", { name: "Rechazados" }).click();
      await page.getByRole("button", { name: "Ver Contrato rechazado.pdf, versión 1" }).click();
      const add = viewer.getByRole("button", { name: "Subir una versión nueva", exact: true });
      await add.click();
      const replacement = uploadDialog(page, "replace");
      await checkReviewModalGeometry(replacement, { kind: "replace", theme, width });
      if (width === 375) {
        await page.setViewportSize({ height: 300, width });
        await replacement.locator("input[type='file']").setInputFiles(pdfFile("Contrato actualizado.pdf"));
        await replacement.getByText("Contrato actualizado", { exact: true }).waitFor();
        await assertScrollableModal(replacement, "Confirmar", "form");
        await replacement.getByRole("textbox", { name: /Motivo del cambio/ }).fill("Contrato con firma.");
        await page.setViewportSize({ height: 900, width });
      }
      await replacement.getByRole("button", { name: "Cancelar" }).click();
      await replacement.waitFor({ state: "detached" });
      await add.and(page.locator(":focus")).waitFor();
    });
  }
}

async function assertScrollableModal(dialog, actionLabel, bodySelector) {
  const body = dialog.locator(bodySelector);
  assert.equal(await body.evaluate((node) => node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === "auto"), true);
  const button = dialog.getByRole("button", { name: actionLabel });
  assert.equal(await button.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  }), true, "el pie conserva la acción principal visible");
}

async function checkReviewModalGeometry(dialog, { kind, theme, width }) {
  await dialog.waitFor();
  await dialog.page().evaluate(() => document.fonts.ready);
  const geometry = await dialog.evaluate(async (node) => {
    // El contenedor del modal anima escala y opacidad al abrir.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(node.parentElement.getAnimations().map((animation) => animation.finished));
    const box = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll("button")];
    const [left, right] = buttons.slice(-2);
    const closeBox = buttons[0].getBoundingClientRect();
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    const css = getComputedStyle(node);
    const title = node.querySelector("h2") ?? document.getElementById(node.getAttribute("aria-labelledby"));
    return {
      background: css.backgroundColor,
      border: getComputedStyle(node, "::after").borderTopWidth,
      buttonGap: rightBox.left - leftBox.right,
      buttonHeight: rightBox.height,
      buttonWidthDifference: Math.abs(leftBox.width - rightBox.width),
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2,
      closeRight: box.right - closeBox.right,
      closeTop: closeBox.top - box.top,
      divider: getComputedStyle(right.parentElement, "::before").height,
      dropzoneHeight: node.querySelector("[data-file-upload-dropzone]")?.getBoundingClientRect().height,
      fontSize: getComputedStyle(title).fontSize,
      height: box.height,
      inputHeight: node.querySelector("[data-input-shell]")?.getBoundingClientRect().height,
      labelHeight: node.querySelector("label")?.getBoundingClientRect().height,
      overflow: node.scrollWidth - node.clientWidth,
      radius: css.borderRadius,
      secondaryColor: getComputedStyle(left).color,
      supportingColor: getComputedStyle(node.querySelector("[data-file-upload-dropzone] p") ?? document.getElementById(node.getAttribute("aria-describedby"))).color,
      width: box.width,
    };
  });
  if (SCREENSHOT_DIR) await dialog.screenshot({ path: `${SCREENSHOT_DIR}/file-modal-${kind}-${theme}-${width}.png` });
  assert.ok(Math.abs(geometry.width - Math.min(400, width - 32)) < 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.centerX - width / 2) < 1 && Math.abs(geometry.centerY - 450) < 1, JSON.stringify(geometry));
  assert.ok(geometry.overflow <= 0);
  assert.equal(geometry.background, theme === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
  assert.equal(geometry.border, "1px");
  assert.equal(geometry.divider, "1px");
  assert.equal(geometry.radius, "12px");
  assert.equal(geometry.fontSize, "18px");
  if (theme === "dark") {
    assert.equal(geometry.secondaryColor, "rgb(142, 142, 142)");
    assert.equal(geometry.supportingColor, "rgb(142, 142, 142)");
  }
  assert.ok(geometry.closeTop <= 1 && geometry.closeRight <= 1);
  assert.ok(Math.abs(geometry.buttonGap - 16) < 1 && geometry.buttonWidthDifference < 1);
  assert.ok(Math.abs(geometry.buttonHeight - 41) < 1);
  if (width >= 768) {
    const referenceHeight = { approve: 238, reject: 221, replace: 370 }[kind];
    assert.ok(Math.abs(geometry.height - referenceHeight) <= 2, JSON.stringify(geometry));
    if (kind === "replace") {
      assert.equal(geometry.dropzoneHeight, 176);
      assert.equal(geometry.inputHeight, 35);
      assert.equal(geometry.labelHeight, 17);
    }
  }
}

test("U2 · historial paginado: ver, descargar y restaurar con motivo (la nueva versión queda pendiente)", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  const viewer = viewerDialog(page);
  await viewer.locator("canvas").first().waitFor();
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  await history.locator("li[data-version-number='3']").waitFor();
  assert.equal(await history.locator("li").count(), 10);
  await viewer.getByRole("button", { name: "Mostrar más versiones" }).click();
  await history.locator("li[data-version-number='1']").waitFor();
  assert.equal(await history.locator("li").count(), 12);
  assert.equal(await viewer.getByRole("button", { name: "Mostrar más versiones" }).count(), 0);
  await history.locator("li[data-version-number='12']").getByText("Versión actual", { exact: true }).waitFor();

  // Ver otra versión carga su contenido sin cerrar el visor.
  await viewer.getByRole("button", { name: "Opciones de la versión 3" }).click();
  await page.getByRole("menuitem", { exact: true, name: "Ver" }).click();
  await viewerHeader(viewer).getByText("V3 · Aprobada").waitFor();
  await waitUntil(() => backend.requests.some((request) => request.path === "/api/projects/1/files/30/content" && request.search.versionId === "3020"));

  // Descargar la versión mostrada reutiliza los bytes recibidos; otra versión la pide a la API.
  const download = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "Opciones de la versión 5" }).click();
  await page.getByRole("menuitem", { name: "Descargar" }).click();
  assert.equal((await download).suggestedFilename(), "acta-v3040.pdf");

  // Restaurar la V3 crea la V13 pendiente, conserva el historial y la muestra para revisarla.
  await viewer.getByRole("button", { name: "Opciones de la versión 3" }).click();
  await page.getByRole("menuitem", { name: "Restaurar versión" }).click();
  const reason = page.locator("[data-admin-file-reason='restore']");
  await reason.getByRole("button", { name: "Restaurar" }).click();
  await reason.getByText("Escribe el motivo de la restauración.").waitFor();
  await reason.getByRole("textbox", { name: /Motivo de la restauración/ }).fill("Se vuelve a la versión firmada.");
  await reason.getByRole("button", { name: "Restaurar" }).click();
  await page.getByText(/Se creó la V13 a partir de la V3, que se conserva en el historial\. La nueva versión queda pendiente de revisión\./).waitFor();
  assert.deepEqual(reviewRequests(backend, "restore")[0].body, { changeNote: "Se vuelve a la versión firmada." });
  await history.locator("li[data-version-number='13']").getByText("Pendiente de revisión").waitFor();
  await history.locator("li[data-version-number='13']").getByText("Motivo: Se vuelve a la versión firmada.").waitFor();
  await viewerHeader(viewer).getByText("V13 · Pendiente de revisión").waitFor();
  await viewer.getByRole("button", { name: "Aprobar" }).waitFor();
  assert.equal(await history.locator("li").count(), 13, "el historial conserva todas las versiones");

  // Con una pendiente, restaurar otra queda deshabilitado con su motivo.
  await viewer.getByRole("button", { name: "Opciones de la versión 2" }).click();
  assert.equal(await page.getByRole("menuitem", { name: /Restaurar versión\. El archivo ya tiene una versión pendiente/ }).isDisabled(), true);
  await page.keyboard.press("Escape");
});

test("U2 · garantías: vincular y desvincular un documento de «Documentos › Garantías» con la respuesta del backend", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Más opciones para Fachada.png, versión 1" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Garantías" }).count(), 0, "fuera de Garantías no se ofrece");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Más opciones para Garantía impermeabilización.pdf, versión 12" }).click();
  await page.getByRole("menuitem", { name: "Garantías" }).click();
  const dialog = page.locator("[data-admin-file-warranties]");
  const ventanas = dialog.getByRole("checkbox", { name: /Ventanas/ });
  await ventanas.waitFor();
  assert.equal(await ventanas.getAttribute("aria-checked"), "true", "vínculo leído del backend");
  await dialog.getByRole("checkbox", { name: "Vincular a Impermeabilización · Techo" }).click();
  await dialog.getByText("Documento vinculado a Impermeabilización · Techo.").waitFor();
  assert.ok(backend.requests.some((request) => request.method === "PUT" && request.path === "/api/admin/files/projects/1/warranties/5/documents/30"));
  await dialog.getByRole("checkbox", { name: "Desvincular de Ventanas · Aluminio" }).click();
  await dialog.getByText(/Documento desvinculado de Ventanas · Aluminio\. El vínculo se conserva en el historial\./).waitFor();
  assert.ok(backend.requests.some((request) => request.method === "DELETE" && request.path === "/api/admin/files/projects/1/warranties/6/documents/30"));
  assert.deepEqual(backend.warranties.map((warranty) => warranty.documents.map((document) => document.fileId)), [[30], []]);
  await dialog.getByRole("button", { name: "Listo" }).click();
});

test("U2 · las imágenes se abren en el visor con la versión indicada", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Fachada.png, versión 1" }).click();
  const image = viewerDialog(page).getByRole("img", { name: "Fachada.png" });
  await image.waitFor();
  assert.match(await image.getAttribute("src"), /\/api\/projects\/2\/files\/40\/content\?versionId=400$/);
  // Escenario de galería de Proyectos (Figma 3941:671103): 24 px de margen, imagen sin recortes y
  // el historial de 312 px pegado al borde derecho. El escenario toma la proporción de la imagen
  // (la de muestra es cuadrada) y se centra en el espacio libre, sin franjas.
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const stage = box("[data-admin-file-media]");
    const drawer = box("[data-admin-file-history-drawer]");
    return {
      drawer: { right: drawer.right, width: drawer.width },
      fit: getComputedStyle(document.querySelector("[data-admin-file-media] img[alt='Fachada.png']")).objectFit,
      layout: document.querySelector("[data-admin-file-viewer]").dataset.adminFileViewerLayout,
      stage: { bottom: stage.bottom, height: stage.height, left: stage.left, right: stage.right, top: stage.top, width: stage.width },
      viewport: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  assert.equal(layout.layout, "media");
  assert.equal(layout.fit, "contain", "la imagen conserva su proporción sin recortarse");
  assert.equal(Math.round(layout.stage.width), Math.round(layout.stage.height), "imagen cuadrada → escenario cuadrado");
  assert.deepEqual([layout.stage.top, layout.viewportHeight - layout.stage.bottom], [24, 24], "ocupa el alto libre con 24 px de margen");
  assert.ok(Math.abs((layout.stage.left - 24) - (layout.viewport - 312 - 24 - layout.stage.right)) <= 1, "centrado en el ancho libre");
  assert.deepEqual(layout.drawer, { right: layout.viewport, width: 312 });
  assert.equal(await viewerDialog(page).getByRole("button", { name: "Comentar video" }).count(), 0);
  await viewerDialog(page).getByRole("button", { name: "Cerrar visor" }).click();
  await viewerDialog(page).waitFor({ state: "detached" });
});

test("imágenes: reemplazar y cambiar de versión mantiene el drawer; la revisión pendiente se decide desde él", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Fachada.png, versión 1" }).click();
  const viewer = viewerDialog(page);
  const drawer = viewer.locator("[data-admin-file-history-drawer]");
  await viewer.getByRole("img", { name: "Fachada.png" }).waitFor();
  assert.equal(await drawer.locator("[data-admin-file-media-actions]").count(), 0, "la vigente aprobada no añade acciones al drawer");

  await drawer.getByRole("button", { name: "Subir una versión nueva" }).click();
  const dialog = uploadDialog(page, "replace");
  await dialog.locator("input[type='file']").setInputFiles([{ buffer: SAMPLE_PNG, mimeType: "image/png", name: "Fachada corregida.png" }]);
  await dialog.getByRole("textbox", { name: /Motivo del cambio/ }).fill("Render corregido.");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.waitFor({ state: "detached" });

  // La V2 pendiente se muestra en el escenario y el drawer ofrece su revisión.
  const actions = drawer.locator("[data-admin-file-media-actions]");
  await actions.getByText("Mostrando V2 · Pendiente de revisión").waitFor();
  await actions.getByRole("button", { name: "Rechazar" }).waitFor();
  await actions.getByRole("button", { name: "Aprobar" }).waitFor();
  await waitUntil(() => backend.requests.some((request) => request.path === "/api/projects/2/files/40/content" && request.search.versionId !== "400"));

  // «Ver» la V1 cambia la imagen sin cerrar el visor ni el historial.
  await drawer.getByRole("button", { name: "Opciones de la versión 1" }).click();
  await page.getByRole("menuitem", { exact: true, name: "Ver" }).click();
  await page.waitForFunction(() => /versionId=400$/.test(document.querySelector("[data-admin-file-media] img[alt='Fachada.png']")?.getAttribute("src") || ""));
  assert.equal(await drawer.locator("li[data-version-number='1']").getAttribute("aria-current"), "true");
  assert.equal(await drawer.locator("li").count(), 2, "el historial conserva las dos versiones");
  await actions.waitFor({ state: "detached" });
});

for (const theme of ["light", "dark"]) {
  test(`visor de consulta: modal 3727:682968 centrado y drawer 3934:182047 a la derecha (${theme}, 1440 px)`, async (context) => {
    const backend = createBackend();
    const page = await openFiles(context, backend, { theme, viewport: { height: 1024, width: 1440 } });
    await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
    const viewer = viewerDialog(page);
    await viewer.locator("canvas").first().waitFor();
    const drawer = viewer.locator("[data-admin-file-history-drawer]");
    await drawer.getByRole("heading", { name: "Historial de versiones" }).waitFor();
    const history = drawer.getByRole("list", { name: "Versiones del archivo" });
    await history.locator("li[data-version-number='12']").getByText("Versión actual", { exact: true }).waitFor();
    await history.locator("li[data-version-number='11']").getByText("V11", { exact: true }).waitFor();
    // Fecha (relativa hasta 30 días, «Hace 3 días»; después, exacta) y autor.
    await history.locator("li[data-version-number='12']").getByText(/^.+ \| Por Arq\. Armando$/).waitFor();
    await page.waitForTimeout(400);
    const layout = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const modal = box("[data-admin-file-modal]");
      const panel = box("[data-admin-file-history-drawer]");
      return { drawer: { height: panel.height, left: panel.left, right: panel.right, width: panel.width }, modal: { left: modal.left, right: modal.right, width: modal.width }, viewport: { height: innerHeight, width: innerWidth } };
    });
    assert.equal(layout.modal.width, 790, "el modal mide 790 px como en Figma");
    assert.equal(layout.drawer.width, 312, "el drawer mide 312 px");
    assert.equal(layout.drawer.right, layout.viewport.width, "el drawer queda pegado al borde derecho");
    assert.equal(layout.drawer.height, layout.viewport.height, "el drawer ocupa toda la altura");
    assert.ok(layout.modal.right <= layout.drawer.left, "el modal no queda bajo el drawer");
    assert.ok(Math.abs(layout.modal.left - (layout.viewport.width - 790) / 2) <= 8, "el modal queda centrado en la ventana");
    // La consulta no tiene X (Figma 3727:682968): se cierra con «Cerrar», Escape o el fondo.
    assert.equal(await viewer.getByRole("button", { name: "Cerrar visor" }).count(), 0);

    // Menú de versión de 160 px solo con texto: «Ver», «Restaurar versión» y «Descargar».
    await drawer.getByRole("button", { name: "Opciones de la versión 11" }).click();
    const menu = page.getByRole("menu", { name: "Acciones para la versión 11" });
    assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts(), ["Ver", "Restaurar versión", "Descargar"]);
    assert.equal(Math.round((await menu.boundingBox()).width), 160);
    assert.equal(await menu.locator("svg").count(), 0, "las opciones no llevan iconos");
    await page.keyboard.press("Escape");

    // «+» abre el mismo reemplazo que «Reemplazar» (anotación de Figma «para reemplazar versión»).
    await drawer.getByRole("button", { name: "Subir una versión nueva" }).click();
    const dialog = uploadDialog(page, "replace");
    await dialog.getByText("Archivo: Garantía impermeabilización.pdf").waitFor();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.waitFor({ state: "detached" });

    // Pulsar el fondo (fuera del modal y del drawer) cierra el visor.
    await page.mouse.click(40, 500);
    await viewer.waitFor({ state: "detached" });
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/viewer-drawer-${theme}.png` });
  });
}

test("visor en móvil: el modal arriba y el historial como hoja inferior, sin desbordar", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend, { viewport: { height: 812, width: 375 } });
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  const viewer = viewerDialog(page);
  await viewer.locator("canvas").first().waitFor();
  await viewer.locator("[data-admin-file-history-drawer] li").first().waitFor();
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => {
    const modal = document.querySelector("[data-admin-file-modal]").getBoundingClientRect();
    const drawer = document.querySelector("[data-admin-file-history-drawer]").getBoundingClientRect();
    return { drawerTop: drawer.top, drawerWidth: drawer.width, modalBottom: modal.bottom, modalWidth: modal.width, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.equal(layout.modalWidth, 343, "modal de 343 px con 16 px de margen (Figma 3953:297003)");
  assert.equal(layout.drawerWidth, 375, "la hoja ocupa todo el ancho");
  assert.ok(layout.drawerTop >= layout.modalBottom, "el historial va debajo del modal");
  assert.ok(layout.overflow <= 0, "la página no desborda");
  // El historial sigue accesible desplazando la composición.
  await viewer.getByRole("button", { name: "Mostrar más versiones" }).scrollIntoViewIfNeeded();
  await viewer.getByRole("button", { name: "Mostrar más versiones" }).click();
  await viewer.locator("li[data-version-number='1']").waitFor();
});

for (const theme of ["light", "dark"]) {
  for (const width of [360, 375, 390, 768, 1440, 1920]) {
    test(`U2 · visor responsive sin desbordar (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      const page = await openFiles(context, backend, { theme, viewport: { height: 1000, width } });
      const viewer = await openPendingReview(page);
      await viewer.getByRole("list", { name: "Versiones del archivo" }).locator("li").first().waitFor();
      await page.waitForTimeout(400);
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector("[data-admin-file-viewer]").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, right: dialog.right, width: window.innerWidth };
      });
      assert.ok(layout.overflow <= 0, `La página no desborda (${layout.overflow} px)`);
      assert.ok(layout.right <= layout.width, "El visor cabe en el viewport");
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/viewer-${theme}-${width}.png` });
      await viewer.getByRole("button", { name: "Rechazar" }).click();
      const reason = page.locator("[data-admin-file-reason='reject']");
      await reason.waitFor();
      await page.waitForTimeout(400);
      const reasonLayout = await reason.evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        const field = dialog.querySelector("textarea").parentElement.parentElement.getBoundingClientRect();
        return {
          fieldHeight: field.height,
          left: rect.left,
          overflow: document.documentElement.scrollWidth - innerWidth,
          right: rect.right,
          viewportWidth: innerWidth,
          width: rect.width,
        };
      });
      const expectedWidth = Math.min(400, width - 32);
      assert.equal(Math.round(reasonLayout.width), expectedWidth, "400 px en escritorio y 16 px de margen por lado en móvil");
      assert.equal(Math.round(reasonLayout.fieldHeight), 130, "el textarea conserva 130 px en todos los viewports");
      assert.ok(Math.abs(reasonLayout.left - (width - expectedWidth) / 2) <= 1, "el diálogo permanece centrado");
      assert.ok(reasonLayout.left >= 0 && reasonLayout.right <= reasonLayout.viewportWidth && reasonLayout.overflow <= 0, "sin recortes ni desbordamiento horizontal");
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/reject-${theme}-${width}.png` });
      if (SCREENSHOT_DIR) {
        await reason.locator("textarea").evaluate((field) => field.blur());
        await page.waitForTimeout(50);
        await reason.screenshot({ path: `${SCREENSHOT_DIR}/reason-dialog-${theme}-${width}.png` });
      }
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [375, 768, 1024, 1440]) {
    test(`diseño responsive sin desbordar la página (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      const page = await openFiles(context, backend, { theme, viewport: { height: 1100, width } });
      await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
      await page.getByRole("complementary", { name: "Proyectos" }).getByRole("button", { name: "Mostrar carpetas de Quinta Bella Vista" }).click();
      await page.getByRole("complementary", { name: "Proyectos" }).getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
      await page.waitForTimeout(400);
      const layout = await page.evaluate(() => {
        const grid = document.querySelector("[data-admin-files-layout]");
        const [tree, table] = grid.children;
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          sideBySide: Math.abs(tree.getBoundingClientRect().top - table.getBoundingClientRect().top) < 2,
          theme: document.documentElement.dataset.theme || document.documentElement.className,
        };
      });
      assert.ok(layout.overflow <= 0, `La página no desborda (${layout.overflow} px)`);
      assert.equal(layout.sideBySide, width >= 1024, "Dos columnas solo con espacio suficiente");
      if (SCREENSHOT_DIR) await page.screenshot({ fullPage: true, path: `${SCREENSHOT_DIR}/files-${theme}-${width}.png` });
    });
  }
}

const uploadDialog = (page, mode = "upload") => page.locator(`[data-admin-file-upload='${mode}']`);
const pdfFile = (name) => ({ buffer: SAMPLE_PDF, mimeType: "application/pdf", name });

/**
 * Selecciona «Quinta Bella Vista › <ruta>» en el árbol, desplegando cada nivel.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string[]} path - Carpetas desde la raíz del proyecto.
 * @returns {Promise<void>}
 */
async function selectQuintaFolder(page, path) {
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).click();
  for (const [index, name] of path.entries()) {
    if (index < path.length - 1) await tree.getByRole("button", { name: `Mostrar carpetas de ${name}` }).click();
    else await tree.getByRole("button", { exact: true, name }).click();
  }
}

test("U3 · «+ Nuevo» sube a la carpeta elegida, valida antes de transferir y avisa que queda pendiente", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const nuevo = page.getByRole("button", { name: /^Nuevo archivo/ });
  await nuevo.waitFor();
  assert.match(await nuevo.getAttribute("aria-label"), /Selecciona un proyecto o una carpeta/);
  assert.equal(await nuevo.isDisabled(), true);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).click();
  assert.equal(await nuevo.isDisabled(), false, "la raíz del proyecto admite archivos nuevos (D7 resuelta)");
  await tree.getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
  await tree.getByRole("button", { exact: true, name: "Garantías" }).click();
  await nuevo.click();

  const dialog = uploadDialog(page);
  await dialog.getByText("Destino: Quinta Bella Vista/Documentos/Garantías", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: /^Destino/ }).count(), 0, "el destino es la carpeta abierta, sin selector");
  await dialog.getByText("Formatos PDF, DOCX, XLSX, JPEG, PNG y MP4, hasta 50 MB.").waitFor();
  const input = dialog.locator("input[type='file']");
  await input.setInputFiles([{ buffer: Buffer.from("hola"), mimeType: "text/plain", name: "notas.txt" }]);
  await dialog.getByText("Formato no admitido. Usa PDF, DOCX, XLSX, JPEG, PNG o MP4.").waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Confirmar" }).isDisabled(), true, "un archivo inválido no se transfiere");
  await dialog.getByRole("button", { name: "Eliminar archivo notas.txt" }).click();
  await input.setInputFiles([pdfFile("Certificado techo.pdf")]);
  const metricsBefore = metricsReads(backend);
  const treeReads = () => backend.requests.filter((request) => request.path === "/api/admin/files/tree").length;
  const treeBefore = treeReads();
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("«Certificado techo.pdf» se subió a Quinta Bella Vista/Documentos/Garantías. Queda pendiente de revisión en «Pendientes por aprobación».").waitFor();
  const uploadRequest = backend.requests.find((request) => request.method === "POST" && request.path === "/api/admin/files/projects/1/files");
  assert.deepEqual(uploadRequest.search, { folderId: "104" });
  await waitUntil(() => metricsReads(backend) > metricsBefore && treeReads() > treeBefore);
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByRole("rowheader", { name: /Certificado techo\.pdf/ }).waitFor();
});

test("U3 · arrastrar y soltar, nombre repetido sin reintento, fallo temporal con reintento y 403 comprensible", async (context) => {
  const backend = createBackend();
  let attempts = 0;
  backend.uploadHook = async ({ name, route }) => {
    if (name !== "Inestable.pdf") return null;
    attempts += 1;
    if (attempts > 1) return null;
    await route.fulfill({ body: JSON.stringify({ code: "STORAGE_UNAVAILABLE", message: "Almacenamiento no disponible." }), contentType: "application/json", status: 503 });
    return true;
  };
  const page = await openFiles(context, backend);
  await selectQuintaFolder(page, ["Documentos", "Garantías"]);
  await page.getByRole("button", { name: "Nuevo archivo" }).click();
  const dialog = uploadDialog(page);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["%PDF-1.4"], "Garantía impermeabilización.pdf", { type: "application/pdf" }));
    transfer.items.add(new File(["%PDF-1.4"], "Inestable.pdf", { type: "application/pdf" }));
    return transfer;
  });
  await dialog.getByText("Arrastra y suelta").dispatchEvent("drop", { dataTransfer });
  await dialog.getByText("Garantía impermeabilización", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  // El conflicto nombra la carpeta destino y no reemplaza nada; la tarjeta se conserva con su error.
  await dialog.getByText(/Ya existe un archivo con ese nombre en «Quinta Bella Vista\/.*Garantías»\. No se reemplazó nada/).waitFor();
  await dialog.getByText("Almacenamiento no disponible.").waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Intenta de nuevo" }).count(), 1, "solo el fallo temporal se reintenta");
  await dialog.getByRole("button", { name: "Intenta de nuevo" }).click();
  await dialog.getByText("Subido · Pendiente de revisión").waitFor();
  assert.equal(attempts, 2);
  assert.equal(await dialog.count(), 1, "con un error definitivo el diálogo sigue abierto");
  await page.getByText(/«Inestable\.pdf» se subió/).waitFor();
  await dialog.getByRole("button", { exact: true, name: "Eliminar archivo Garantía impermeabilización.pdf" }).click();
  await dialog.getByRole("button", { name: "Listo" }).click();
  await dialog.waitFor({ state: "detached" });

  const forbidden = createBackend({ failures: { "POST /api/admin/files/projects/:id/files": { body: { code: "FORBIDDEN", message: "No tienes permisos para realizar esta acción." }, status: 403 } } });
  const second = await openFiles(context, forbidden);
  await selectQuintaFolder(second, ["Documentos", "Garantías"]);
  await second.getByRole("button", { name: "Nuevo archivo" }).click();
  await uploadDialog(second).locator("input[type='file']").setInputFiles([pdfFile("Permiso.pdf")]);
  await uploadDialog(second).getByRole("button", { name: "Confirmar" }).click();
  await uploadDialog(second).getByText("No tienes permisos para realizar esta acción.").waitFor();
  assert.equal(await uploadDialog(second).getByRole("button", { name: "Intenta de nuevo" }).count(), 0);
});

test("U3 · cancelar una carga en curso reconcilia con lo guardado: sin registro sale de la lista; registrada se conserva", async (context) => {
  const backend = createBackend();
  backend.uploadHook = async ({ name, record }) => {
    if (name === "Registrado.pdf") record();
    return new Promise(() => {});
  };
  const page = await openFiles(context, backend);
  await selectQuintaFolder(page, ["Documentos", "Garantías"]);
  await page.getByRole("button", { name: "Nuevo archivo" }).click();
  const dialog = uploadDialog(page);
  await dialog.locator("input[type='file']").setInputFiles([pdfFile("Cancelado.pdf")]);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.locator("form").getByText("Subiendo...").waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Cerrar nuevo archivo" }).isDisabled(), true, "no se cierra con una carga en curso");
  await dialog.getByRole("button", { name: "Eliminar archivo Cancelado.pdf" }).click();
  await dialog.getByText("Cancelado", { exact: true }).waitFor({ state: "detached" });
  assert.ok(backend.requests.some((request) => request.path === "/api/admin/files/items" && request.search.search === "Cancelado.pdf" && request.search.tab === "pending"), "consulta lo guardado");

  await dialog.locator("input[type='file']").setInputFiles([pdfFile("Registrado.pdf")]);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.locator("form").getByText("Subiendo...").waitFor();
  await dialog.getByRole("button", { name: "Eliminar archivo Registrado.pdf" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText(/«Registrado\.pdf» se subió a Quinta Bella Vista\/Documentos\/Garantías\. Queda pendiente de revisión/).waitFor();
  assert.equal(backend.items.filter((entry) => entry.name === "Registrado.pdf").length, 1, "la carga registrada se conserva una sola vez");
});

test("U3 · «Reemplazar» desde el visor exige motivo, crea la versión pendiente y la muestra; con una pendiente se deshabilita", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  const viewer = viewerDialog(page);
  await viewer.locator("canvas").first().waitFor();
  await viewer.getByRole("button", { exact: true, name: "Reemplazar" }).click();
  const dialog = uploadDialog(page, "replace");
  await dialog.getByText("Archivo: Garantía impermeabilización.pdf").waitFor();
  await dialog.locator("input[type='file']").setInputFiles([pdfFile("Garantía firmada.pdf")]);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.getByText("Escribe el motivo del cambio.").waitFor();
  await dialog.getByRole("textbox", { name: /Motivo del cambio/ }).fill("Se añade la firma del cliente.");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("Se creó la V13 de «Garantía impermeabilización.pdf». Queda pendiente de revisión: la versión vigente no cambia hasta aprobarla.").waitFor();
  assert.ok(backend.requests.some((candidate) => candidate.method === "POST" && candidate.path === "/api/projects/1/files/30/versions"), "usa la ruta de versiones (B4)");
  await viewerHeader(viewer).getByText("V13 · Pendiente de revisión").waitFor();
  await viewer.getByRole("button", { name: "Aprobar" }).waitFor();
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  await history.locator("li[data-version-number='13']").getByText("Motivo: Se añade la firma del cliente.").waitFor();
  await history.locator("li[data-version-number='12']").waitFor();

  await viewer.getByRole("button", { name: "Opciones de la versión 12" }).click();
  await page.getByRole("menuitem", { exact: true, name: "Ver" }).click();
  // La vigente aprobada se muestra con la cabecera de Figma (sin sufijo) y el drawer la marca.
  await history.locator("li[data-version-number='12'][aria-current='true']").waitFor();
  assert.equal(await viewerHeader(viewer).getByText(/V1[23] ·/).count(), 0);
  const replace = viewer.getByRole("button", { name: /^Reemplazar/ });
  assert.equal(await replace.isDisabled(), true);
  assert.match(await replace.getAttribute("aria-label"), /ya tiene una versión pendiente/);
});

test("«+» del historial abre «Reemplazar archivo» (Figma 3727:683111): valida, crea una sola versión con su motivo y actualiza el drawer", async (context) => {
  const backend = createBackend();
  backend.items = backend.items.filter((entry) => entry.fileId !== 30 || entry.versionNumber <= 3);
  backend.items.find((entry) => entry.fileId === 30 && entry.versionNumber === 3).isCurrent = true;
  const originalVersions = structuredClone(backend.items.filter((entry) => entry.fileId === 30));
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 3" }).click();
  const viewer = viewerDialog(page);
  await viewer.locator("canvas").first().waitFor();
  const drawer = viewer.locator("[data-admin-file-history-drawer]");
  const add = drawer.getByRole("button", { name: "Subir una versión nueva" });
  const versionPosts = () => backend.requests.filter((request) => request.method === "POST" && request.path === "/api/projects/1/files/30/versions").length;

  // El origen sigue siendo el archivo lógico aunque se esté viendo una versión histórica.
  await drawer.getByRole("button", { name: "Opciones de la versión 1" }).click();
  await page.getByRole("menuitem", { name: "Ver", exact: true }).click();
  await viewerHeader(viewer).getByText("V1 · Aprobada").waitFor();

  // Dos clics seguidos abren un solo modal, con el documento gestionado en su descripción.
  await add.click();
  await add.click({ force: true }).catch(() => {});
  const dialog = uploadDialog(page, "replace");
  await dialog.waitFor();
  assert.equal(await page.locator("[data-admin-file-upload]").count(), 1);
  await dialog.getByRole("heading", { name: "Reemplazar archivo" }).waitFor();
  assert.match(await dialog.evaluate((element) => document.getElementById(element.getAttribute("aria-describedby")).textContent), /Garantía impermeabilización\.pdf/);
  const note = dialog.getByRole("textbox", { name: /Motivo del cambio/ });
  assert.equal(await note.getAttribute("placeholder"), "Ej. “Falta firma del cliente, Datos actualizados, etc.”");
  assert.equal(await dialog.getByRole("button", { name: "Confirmar" }).isDisabled(), true, "sin archivo no se confirma");

  // Cancelar, la X y Escape cierran sin crear nada.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  await add.click();
  await dialog.getByRole("button", { name: "Cerrar reemplazo de archivo" }).click();
  await dialog.waitFor({ state: "detached" });
  await add.click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await viewerDialog(page).count(), 1, "Escape solo cierra el modal de reemplazo");
  assert.equal(versionPosts(), 0);

  // Formato no admitido y más de 50 MB se rechazan antes de transferir (el reemplazo admite un archivo).
  for (const [invalidFile, message] of [["txt", /Formato no admitido/], ["large", /supera el tamaño máximo de 50 MB/]]) {
    await add.click();
    const invalid = await page.evaluateHandle((kind) => {
      const transfer = new DataTransfer();
      transfer.items.add(kind === "txt"
        ? new File(["texto"], "Notas.txt", { type: "text/plain" })
        : new File([new Uint8Array(50 * 1024 * 1024 + 1)], "Enorme.pdf", { type: "application/pdf" }));
      return transfer;
    }, invalidFile);
    await dialog.getByText("Arrastra y suelta").dispatchEvent("drop", { dataTransfer: invalid });
    await dialog.getByText(message).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Confirmar" }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.waitFor({ state: "detached" });
  }

  // Arrastrar un PDF válido; un motivo de solo espacios no se envía y conserva el archivo elegido.
  await add.click();
  const valid = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["%PDF-1.4"], "Garantía firmada.pdf", { type: "application/pdf" }));
    return transfer;
  });
  await dialog.getByText("Arrastra y suelta").dispatchEvent("drop", { dataTransfer: valid });
  await dialog.getByText("Garantía firmada", { exact: true }).waitFor();
  await note.fill("   ");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.getByText("Escribe el motivo del cambio.").waitFor();
  assert.equal(await note.getAttribute("aria-invalid"), "true");
  assert.equal(versionPosts(), 0, "sin motivo no se transfiere");
  await dialog.getByText("Garantía firmada", { exact: true }).waitFor();

  // Confirmar (doble clic) crea una sola versión con su motivo y el drawer la muestra.
  await note.fill("Datos actualizados desde el historial.");
  const metricsBefore = metricsReads(backend);
  await dialog.getByRole("button", { name: "Confirmar" }).dblclick();
  await dialog.waitFor({ state: "detached" });
  assert.equal(versionPosts(), 1, "una sola subida");
  await page.getByText("Se creó la V4 de «Garantía impermeabilización.pdf». Queda pendiente de revisión: la versión vigente no cambia hasta aprobarla.").waitFor();
  const history = drawer.getByRole("list", { name: "Versiones del archivo" });
  const created = history.locator("li[data-version-number='4']");
  await created.getByText("V4 · Pendiente de revisión").waitFor();
  await created.getByText("Motivo: Datos actualizados desde el historial.").waitFor();
  await created.getByText(/Por Ana Admin/).waitFor();
  await viewerHeader(viewer).getByText("V4 · Pendiente de revisión").waitFor();
  await history.locator("li[data-version-number='3']").getByText("Versión actual", { exact: true }).waitFor();
  assert.deepEqual(await history.locator("li").evaluateAll((rows) => rows.map((row) => row.dataset.versionNumber)), ["4", "3", "2", "1"]);
  assert.deepEqual(backend.items.filter((entry) => entry.fileId === 30 && entry.versionNumber < 4), originalVersions);
  await waitUntil(() => metricsReads(backend) > metricsBefore);
  // Con una versión pendiente, el «+» queda deshabilitado con su motivo.
  assert.equal(await add.isDisabled(), true);
  assert.match(await add.getAttribute("aria-label"), /ya tiene una versión pendiente/);
});

test("reemplazo · historial no disponible, permisos y reintento por pérdida de conexión conservan archivo y motivo", async (context) => {
  const listing = "GET /api/projects/:id/files/:id/versions";
  const upload = "POST /api/projects/:id/files/:id/versions";
  const failures = { [listing]: { body: { code: "FILE_NOT_FOUND" }, status: 404 } };
  const backend = createBackend({ failures });
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  const viewer = viewerDialog(page);
  const unavailable = viewer.getByRole("button", { name: /Subir una versión nueva\. No se pudo verificar el historial/ });
  await unavailable.waitFor();
  assert.equal(await unavailable.isDisabled(), true);
  assert.equal(await uploadDialog(page, "replace").count(), 0);
  delete failures[listing];
  await viewer.getByRole("button", { name: "Reintentar", exact: true }).click();
  await viewer.getByRole("button", { name: "Subir una versión nueva", exact: true }).click();

  const dialog = uploadDialog(page, "replace");
  const input = dialog.locator("input[type='file']");
  const note = dialog.getByRole("textbox", { name: /Motivo del cambio/ });
  const submit = dialog.getByRole("button", { name: "Confirmar" });
  const filename = "Garantía revisada.pdf";
  const draft = "Se incorporó la firma.";
  assert.equal(await input.getAttribute("multiple"), null);
  await input.setInputFiles(pdfFile(filename));
  await note.fill(draft);
  failures[upload] = { body: { code: "FORBIDDEN", message: "No tienes permisos para realizar esta acción." }, status: 403 };
  await submit.click();
  await dialog.getByText("No tienes permisos para realizar esta acción.").waitFor();
  assert.equal(await note.inputValue(), draft);
  await dialog.getByText("Garantía revisada", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Intenta de nuevo" }).count(), 0);
  assert.equal(await reviewAlert(page).count(), 0);

  await input.setInputFiles(pdfFile(filename));
  failures[upload] = { body: { code: "NETWORK_ERROR" }, status: 503 };
  await submit.click();
  await dialog.getByText("Se perdió la conexión durante la carga.").waitFor();
  assert.equal(await note.inputValue(), draft);
  await dialog.getByText("Garantía revisada", { exact: true }).waitFor();
  assert.equal(await reviewAlert(page).count(), 0);
  delete failures[upload];
  // El reintento se registra, pero la respuesta se pierde. La consulta de historial lo reconcilia.
  await page.route((url) => url.pathname === "/api/projects/1/files/30/versions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return backend.handle({
      request: () => route.request(),
      fulfill: () => route.fulfill({ status: 503, json: { code: "NETWORK_ERROR" } }),
    });
  });
  await dialog.getByRole("button", { name: "Intenta de nuevo" }).dblclick();
  await dialog.waitFor({ state: "detached" });
  await reviewAlert(page).getByText(/Se creó la V13/).waitFor();
  assert.equal(backend.items.filter((entry) => entry.fileId === 30 && entry.review.status === "pending").length, 1);
  assert.equal(backend.requests.filter((request) => request.method === "POST" && request.path === "/api/projects/1/files/30/versions").length, 3);
});

test("U3 · «Reemplazar archivo» desde la tabla (no en Pendientes) y restaurar la vigente aprobada (B4)", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Más opciones para Fachada.png, versión 1" }).click();
  await page.getByRole("menuitem", { name: "Reemplazar archivo" }).click();
  const dialog = uploadDialog(page, "replace");
  await dialog.getByRole("textbox", { name: /Motivo del cambio/ }).fill("Render corregido.");
  await dialog.locator("input[type='file']").setInputFiles([{ buffer: SAMPLE_PNG, mimeType: "image/png", name: "Fachada v2.png" }]);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await page.getByText(/Se creó la V2 de «Fachada\.png»/).waitFor();
  assert.ok(backend.requests.some((candidate) => candidate.method === "POST" && candidate.path === "/api/projects/2/files/40/versions"));

  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  // Figma 3727:683264: la fila pendiente solo ofrece «Revisar» (no se reemplaza, descarga ni abre menú desde la tabla).
  await page.getByRole("button", { name: "Revisar Fachada v2.png, versión 2" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Más opciones para Fachada v2.png, versión 2" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Descargar Fachada v2.png, versión 2" }).count(), 0);

  await page.getByRole("tab", { name: "Aprobados" }).click();
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  const viewer = viewerDialog(page);
  await viewer.getByRole("button", { name: "Opciones de la versión 12" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Restaurar versión" }).isDisabled(), false, "la vigente aprobada se puede restaurar (PR2)");
  await page.keyboard.press("Escape");
});

test("U3 · Panorámicas: una imagen subida se revisa con el visor 360", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await selectQuintaFolder(page, ["Renders e imágenes", "Panorámicas"]);
  await page.getByRole("button", { name: "Nuevo archivo" }).click();
  const dialog = uploadDialog(page);
  await dialog.locator("input[type='file']").setInputFiles([{ buffer: SAMPLE_PNG, mimeType: "image/png", name: "Sala 360.png" }]);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByRole("button", { name: "Revisar Sala 360.png, versión 1" }).click();
  const stage = viewerDialog(page).getByRole("region", { name: "Visor panorámico 360" });
  await stage.waitFor();
  await viewerDialog(page).getByText("Cargando panorámica 360…").waitFor({ state: "detached", timeout: 15000 });
  assert.equal(await viewerDialog(page).getByText("No se pudo cargar la panorámica.").count(), 0);
  assert.equal(await stage.locator("canvas").count(), 1, "WebGL dibuja la esfera 360");
});

test("U3 · teclado: «+ Nuevo» se abre con Enter, el foco queda en el diálogo y Escape lo cierra", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await selectQuintaFolder(page, ["Documentos", "Garantías"]);
  await page.getByRole("button", { name: "Nuevo archivo" }).focus();
  await page.keyboard.press("Enter");
  const dialog = uploadDialog(page);
  await dialog.waitFor();
  await page.waitForFunction(() => document.querySelector("[data-admin-file-upload]")?.contains(document.activeElement));
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => Boolean(document.querySelector("[data-admin-file-upload]")?.contains(document.activeElement))), true, "el foco no sale del diálogo");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

for (const theme of ["light", "dark"]) {
  for (const width of [375, 1440]) {
    test(`U3 · diálogos de carga responsive sin desbordar (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      const page = await openFiles(context, backend, { theme, viewport: { height: 900, width } });
      await selectQuintaFolder(page, ["Documentos", "Garantías"]);
      await page.getByRole("button", { name: "Nuevo archivo" }).click();
      const dialog = uploadDialog(page);
      await dialog.locator("input[type='file']").setInputFiles([pdfFile("Uno.pdf"), { buffer: Buffer.from("x"), mimeType: "text/plain", name: "dos.txt" }]);
      await dialog.getByText("Formato no admitido. Usa PDF, DOCX, XLSX, JPEG, PNG o MP4.").waitFor();
      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => {
        const box = document.querySelector("[data-admin-file-upload]").getBoundingClientRect();
        return { left: box.left, overflow: document.documentElement.scrollWidth - window.innerWidth, right: box.right, width: window.innerWidth };
      });
      assert.ok(layout.overflow <= 0 && layout.left >= 0 && layout.right <= layout.width, JSON.stringify(layout));
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/upload-${theme}-${width}.png` });
      await dialog.getByRole("button", { exact: true, name: "Cerrar" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
      await viewerDialog(page).getByRole("button", { exact: true, name: "Reemplazar" }).click();
      await uploadDialog(page, "replace").waitFor();
      await page.waitForTimeout(350);
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/replace-${theme}-${width}.png` });
    });
  }
}


// ---------------------------------------------------------------------------------------------
// Visor multimedia adaptativo: el escenario toma la proporción natural de cada imagen o vídeo.

const RATIOS = [
  ["horizontal-16x9.png", 1600, 900],
  ["horizontal-4x3.png", 1200, 900],
  ["vertical-9x16.png", 900, 1600],
  ["vertical-3x4.png", 900, 1200],
  ["cuadrada-1x1.png", 1000, 1000],
  ["pequena.png", 120, 80],
  ["alta-resolucion.png", 6000, 4000],
];

/**
 * Mide el escenario multimedia, la imagen o el vídeo y el drawer del visor abierto.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Object>} Medidas.
 */
function measureMediaViewer(page) {
  return page.evaluate(() => {
    const stage = document.querySelector("[data-admin-file-media]");
    const media = stage.querySelector("img, video");
    const drawer = document.querySelector("[data-admin-file-history-drawer]");
    const box = stage.getBoundingClientRect();
    const drawerBox = drawer.getBoundingClientRect();
    const natural = media.tagName === "IMG" ? [media.naturalWidth, media.naturalHeight] : [media.videoWidth, media.videoHeight];
    return {
      drawer: { bottom: drawerBox.bottom, left: drawerBox.left, right: drawerBox.right, top: drawerBox.top, width: drawerBox.width },
      fitted: stage.dataset.mediaFitted === "true",
      media: { height: media.getBoundingClientRect().height, width: media.getBoundingClientRect().width },
      natural,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      stage: { bottom: box.bottom, height: box.height, left: box.left, right: box.right, top: box.top, width: box.width },
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });
}

/**
 * Comprueba la proporción del escenario, su ajuste al viewport y la independencia del drawer.
 *
 * @param {Object} measure - Medidas de measureMediaViewer.
 * @param {string} label - Contexto del fallo.
 * @returns {void}
 */
function assertFittedStage(measure, label) {
  const [naturalWidth, naturalHeight] = measure.natural;
  assert.ok(measure.fitted, `${label}: escenario ajustado`);
  assert.ok(Math.abs(measure.stage.width / measure.stage.height - naturalWidth / naturalHeight) < 0.02, `${label}: conserva la proporción ${naturalWidth}×${naturalHeight} (${measure.stage.width}×${measure.stage.height})`);
  assert.ok(Math.abs(measure.media.width - measure.stage.width) <= 1 && Math.abs(measure.media.height - measure.stage.height) <= 1, `${label}: sin franjas ni recortes`);
  assert.ok(measure.stage.left >= 0 && measure.stage.right <= measure.viewport.width + 0.5 && measure.stage.top >= 0, `${label}: dentro del viewport`);
  assert.equal(measure.overflow, false, `${label}: sin desplazamiento horizontal`);
  if (measure.viewport.width >= 921) {
    assert.equal(Math.round(measure.drawer.width), 312, `${label}: drawer de Figma`);
    assert.ok(measure.stage.right <= measure.drawer.left, `${label}: sin superponerse al drawer`);
    assert.ok(measure.stage.bottom <= measure.viewport.height + 0.5, `${label}: cabe en alto`);
  } else {
    assert.ok(measure.drawer.top >= measure.stage.bottom, `${label}: historial debajo, accesible`);
  }
}

/**
 * Abre el visor de un medio desde el ojo de su fila en Aprobados.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string} name - Nombre del archivo.
 * @returns {Promise<void>}
 */
async function openMedia(page, name) {
  await page.getByRole("button", { exact: true, name: `Ver ${name}, versión 1` }).click();
  await page.locator("[data-admin-file-media][data-media-fitted='true']").waitFor();
  await page.waitForTimeout(250);
}

test("visor adaptativo: cada imagen conserva su proporción natural sin franjas, dentro del viewport y con el drawer de 312 px", async (context) => {
  const backend = createBackend({ media: RATIOS.map(([name, width, height]) => ({ bytes: pngOf(width, height), contentType: "image/png", extension: "png", name })) });
  const page = await openFiles(context, backend);
  for (const [name, width, height] of RATIOS) {
    await openMedia(page, name);
    const measure = await measureMediaViewer(page);
    assert.deepEqual(measure.natural, [width, height]);
    assertFittedStage(measure, name);
    // Una imagen vertical no ocupa el ancho libre: estrecha el escenario en lugar de dejar franjas.
    if (height > width) assert.ok(measure.stage.width < measure.stage.height, `${name}: escenario vertical`);
    await viewerDialog(page).getByRole("button", { name: "Cerrar visor" }).click();
    await viewerDialog(page).waitFor({ state: "detached" });
  }
});

for (const theme of ["light", "dark"]) {
  for (const width of [1920, 1440, 1280, 1024, 768, 430, 390, 375, 360]) {
    test(`visor adaptativo responsive: horizontal y vertical (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend({ media: [
        { bytes: pngOf(1600, 900), contentType: "image/png", extension: "png", name: "horizontal-16x9.png" },
        { bytes: pngOf(900, 1600), contentType: "image/png", extension: "png", name: "vertical-9x16.png" },
      ] });
      const page = await openFiles(context, backend, { theme, viewport: { height: width >= 921 ? 900 : 844, width } });
      for (const name of ["horizontal-16x9.png", "vertical-9x16.png"]) {
        await page.getByRole("button", { exact: true, name: `Ver ${name}, versión 1` }).scrollIntoViewIfNeeded();
        await openMedia(page, name);
        assertFittedStage(await measureMediaViewer(page), `${name} ${theme} ${width}`);
        await viewerDialog(page).getByRole("button", { name: "Cerrar visor" }).click();
        await viewerDialog(page).waitFor({ state: "detached" });
      }
    });
  }
}

test("visor adaptativo: al cambiar de versión (horizontal → vertical) el escenario se ajusta y el drawer no cambia", async (context) => {
  const backend = createBackend({ media: [
    { bytes: pngOf(900, 1600), contentType: "image/png", extension: "png", fileId: 950, isCurrent: true, name: "render-versiones.png", versionNumber: 2 },
    { bytes: pngOf(1600, 900), contentType: "image/png", extension: "png", fileId: 950, isCurrent: false, name: "render-versiones.png", versionNumber: 1 },
  ] });
  const page = await openFiles(context, backend);
  await page.getByRole("button", { exact: true, name: "Ver render-versiones.png, versión 2" }).click();
  await page.locator("[data-admin-file-media][data-media-fitted='true']").waitFor();
  await page.waitForTimeout(250);
  const vertical = await measureMediaViewer(page);
  assertFittedStage(vertical, "V2 vertical");
  await viewerDialog(page).getByRole("button", { name: "Opciones de la versión 1" }).click();
  await page.getByRole("menuitem", { exact: true, name: "Ver" }).click();
  await page.waitForFunction(() => {
    const box = document.querySelector("[data-admin-file-media][data-media-fitted='true']")?.getBoundingClientRect();
    return box && box.width > box.height;
  });
  await page.waitForTimeout(250);
  const horizontal = await measureMediaViewer(page);
  assertFittedStage(horizontal, "V1 horizontal");
  assert.deepEqual(horizontal.drawer, vertical.drawer, "el drawer no cambia de tamaño ni posición");
});

test("visor adaptativo: vídeos horizontal y vertical con su proporción real y sus controles", async (context) => {
  // Vídeos WebM reales grabados en el navegador (canvas + MediaRecorder): 16:9 y 9:16.
  const recorder = await browser.newPage();
  const record = (width, height) => recorder.evaluate(async ([w, h]) => {
    const canvas = Object.assign(document.createElement("canvas"), { height: h, width: w });
    const context2d = canvas.getContext("2d");
    const stream = canvas.captureStream(15);
    const media = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    media.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => { media.onstop = resolve; });
    media.start();
    for (let frame = 0; frame < 12; frame += 1) {
      context2d.fillStyle = frame % 2 ? "#4a7" : "#47a";
      context2d.fillRect(0, 0, w, h);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    media.stop();
    await done;
    const buffer = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }, [width, height]);
  const horizontalVideo = Buffer.from(await record(640, 360), "base64");
  const verticalVideo = Buffer.from(await record(360, 640), "base64");
  await recorder.close();
  const backend = createBackend({ media: [
    { bytes: horizontalVideo, contentType: "video/webm", extension: "webm", fileCategory: "video", name: "recorrido-horizontal.webm" },
    { bytes: verticalVideo, contentType: "video/webm", extension: "webm", fileCategory: "video", name: "recorrido-vertical.webm" },
  ] });
  const page = await openFiles(context, backend);
  for (const [name, width, height] of [["recorrido-horizontal.webm", 640, 360], ["recorrido-vertical.webm", 360, 640]]) {
    await openMedia(page, name);
    const measure = await measureMediaViewer(page);
    assert.deepEqual(measure.natural, [width, height]);
    assertFittedStage(measure, name);
    await viewerDialog(page).getByRole("button", { name: /Reproducir/ }).first().waitFor();
    await viewerDialog(page).getByRole("button", { name: "Cerrar visor" }).click();
    await viewerDialog(page).waitFor({ state: "detached" });
  }
});

test("visor adaptativo: la panorámica conserva su visor 360 a todo el espacio y el PDF su visor de documentos", async (context) => {
  const backend = createBackend({ media: [{ bytes: pngOf(2000, 1000), contentType: "image/png", extension: "png", fileCategory: "panorama", name: "sala-360.png" }] });
  const page = await openFiles(context, backend);
  await page.getByRole("button", { exact: true, name: "Ver sala-360.png, versión 1" }).click();
  await viewerDialog(page).locator("canvas").first().waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("[data-admin-file-media]").getAttribute("data-media-fitted"), null, "la panorámica no se reduce a un <img>");
  await viewerDialog(page).getByRole("button", { name: "Cerrar visor" }).click();
  await viewerDialog(page).waitFor({ state: "detached" });

  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  await viewerDialog(page).locator("canvas").first().waitFor();
  assert.equal(await page.locator("[data-admin-file-media]").count(), 0, "el PDF usa el modal de documentos");
  assert.equal(await page.locator("[data-admin-file-document]").count(), 1);
});


test("restaurar: explica la versión que se creará, cancela sin cambios, evita envíos dobles y conserva el motivo ante un 409", async (context) => {
  const backend = createBackend({ failures: { "POST /api/projects/:id/files/:id/versions/:id/restore": { body: { code: "FILE_VERSION_OBJECT_MISSING", message: "Sin contenido" }, status: 409 } } });
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  const viewer = viewerDialog(page);
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  await history.locator("li[data-version-number='3']").waitFor();

  await viewer.getByRole("button", { name: "Opciones de la versión 3" }).click();
  await page.getByRole("menuitem", { name: "Restaurar versión" }).click();
  const reason = page.locator("[data-admin-file-reason='restore']");
  await reason.getByText("Se creará la V13 con el contenido de la V3. Las versiones anteriores se conservan y la nueva quedará pendiente de revisión; la versión vigente no cambia hasta aprobarla.").waitFor();
  await reason.getByText("Garantía impermeabilización.pdf · V3 · Máximo 255 caracteres.", { exact: true }).waitFor();
  await reason.getByRole("button", { name: "Volver" }).click();
  await reason.waitFor({ state: "detached" });
  assert.equal(reviewRequests(backend, "restore").length, 0, "cancelar no envía nada");

  // Retrasa la respuesta para observar la carga y un segundo clic.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route((url) => url.pathname.endsWith("/restore"), async (route) => {
    await gate;
    await route.fallback();
  });
  await viewer.getByRole("button", { name: "Opciones de la versión 3" }).click();
  await page.getByRole("menuitem", { name: "Restaurar versión" }).click();
  await reason.getByRole("textbox", { name: /Motivo de la restauración/ }).fill("Se vuelve a la versión firmada.");
  await reason.getByRole("button", { name: "Restaurar" }).click();
  const busy = reason.getByRole("button", { name: "Restaurando..." });
  await busy.waitFor();
  assert.equal(await busy.isDisabled(), true, "deshabilitado durante la operación");
  await busy.click({ force: true }).catch(() => {});
  release();
  await reason.getByRole("alert").getByText("El contenido de esa versión no está disponible en el almacenamiento: no se puede restaurar.").waitFor();
  assert.equal(await reason.getByRole("textbox", { name: /Motivo de la restauración/ }).inputValue(), "Se vuelve a la versión firmada.", "conserva el motivo");
  assert.equal(reviewRequests(backend, "restore").length, 1, "una sola petición");
  assert.equal(await history.locator("li").count(), 10, "no aparece ninguna versión nueva");
});

for (const [theme, width] of [["dark", 1440], ["light", 375], ["dark", 375]]) {
  test(`restaurar: el diálogo cabe y se lee (${theme}, ${width} px)`, async (context) => {
    const backend = createBackend();
    const page = await openFiles(context, backend, { theme, viewport: { height: 844, width } });
    await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
    const viewer = viewerDialog(page);
    await viewer.getByRole("list", { name: "Versiones del archivo" }).locator("li[data-version-number='3']").waitFor();
    await viewer.getByRole("button", { name: "Opciones de la versión 3" }).scrollIntoViewIfNeeded();
    await viewer.getByRole("button", { name: "Opciones de la versión 3" }).click();
    await page.getByRole("menuitem", { name: "Restaurar versión" }).click();
    const reason = page.locator("[data-admin-file-reason='restore']");
    await reason.locator("[data-admin-file-reason-description]").waitFor();
    await page.waitForTimeout(300);
    const box = await reason.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0 && box.y + box.height <= 844 + 0.5, "dentro del viewport");
    const colors = await reason.locator("[data-admin-file-reason-description]").evaluate((element) => ({ background: getComputedStyle(element.closest("[role=dialog]")).backgroundColor, color: getComputedStyle(element).color }));
    assert.notEqual(colors.color, colors.background, "texto legible sobre su fondo");
  });
}

test("ubicación abierta · carpetas y archivos se crean en la raíz, en la carpeta o en la subcarpeta abierta, sin selector", async (context) => {
  const backend = createBackend({ quotes: true });
  const page = await openFiles(context, backend);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  const nuevo = page.getByRole("button", { exact: true, name: "Nuevo archivo" });
  const lastPost = (pattern) => backend.requests.filter((request) => request.method === "POST" && pattern.test(request.path)).at(-1);

  // Raíz del proyecto: carpeta y archivo sin carpeta madre ni `folderId`.
  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).click();
  await tree.getByRole("button", { name: "Nueva carpeta en Quinta Bella Vista" }).click();
  const folderDialog = page.getByRole("dialog", { name: "Nueva carpeta" });
  await folderDialog.getByText("Destino: Quinta Bella Vista/", { exact: true }).waitFor();
  await folderDialog.getByLabel("Nombre de la carpeta").fill("Contratos");
  await folderDialog.getByRole("button", { name: "Crear" }).click();
  await folderDialog.waitFor({ state: "detached" });
  await tree.getByRole("button", { exact: true, name: "Contratos" }).waitFor();
  assert.deepEqual(lastPost(/\/projects\/1\/folders$/).body, { name: "Contratos", parentId: null });
  await nuevo.click();
  let dialog = uploadDialog(page);
  await dialog.getByText("Destino: Quinta Bella Vista/", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: /^Destino/ }).count(), 0, "sin selector de destino");
  assert.equal(await dialog.getByRole("combobox").count(), 0, "sin selector de destino");
  await dialog.locator("input[type='file']").setInputFiles([pdfFile("Acta de inicio.pdf")]);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("«Acta de inicio.pdf» se subió a Quinta Bella Vista (raíz del proyecto). Queda pendiente de revisión en «Pendientes por aprobación».").waitFor();
  assert.deepEqual(lastPost(/\/projects\/1\/files$/).search, {}, "la raíz no envía carpeta");

  // Carpeta abierta («Cotizaciones»): la subcarpeta nueva cuelga de ella.
  await tree.getByRole("button", { name: "Mostrar carpetas de Casa Cotizada" }).click();
  await tree.getByRole("button", { name: "Mostrar carpetas de Documentos" }).last().click();
  await tree.getByRole("button", { exact: true, name: "Cotizaciones" }).click();
  await tree.getByRole("button", { name: "Nueva carpeta en Cotizaciones" }).click();
  await folderDialog.getByText("Destino: Casa Cotizada/Documentos/Cotizaciones", { exact: true }).waitFor();
  await folderDialog.getByLabel("Nombre de la carpeta").fill("Borradores");
  await folderDialog.getByRole("button", { name: "Crear" }).click();
  await folderDialog.waitFor({ state: "detached" });
  assert.deepEqual(lastPost(/\/projects\/3\/folders$/).body, { name: "Borradores", parentId: 510 });
  const borradores = tree.getByRole("button", { exact: true, name: "Borradores" });
  await borradores.waitFor();
  assert.equal(await tree.getByRole("button", { exact: true, name: "Cotizaciones" }).getAttribute("aria-current"), "true", "crear no cambia la carpeta abierta");

  // Desplegar otra carpeta sin abrirla no cambia el destino: sigue «Cotizaciones».
  await tree.getByRole("button", { name: "Mostrar carpetas de Renders e imágenes" }).last().click();
  await nuevo.click();
  dialog = uploadDialog(page);
  await dialog.getByText("Destino: Casa Cotizada/Documentos/Cotizaciones", { exact: true }).waitFor();
  await dialog.getByRole("button", { exact: true, name: "Cerrar" }).click();
  await dialog.waitFor({ state: "detached" });

  // Subcarpeta abierta: se usa su id, no el de su madre ni el de la categoría.
  await borradores.click();
  const borradoresId = backend.projects.find((project) => project.id === 3).folders.find((folder) => folder.name === "Borradores").id;
  await nuevo.click();
  dialog = uploadDialog(page);
  await dialog.getByText("Destino: Casa Cotizada/Documentos/Cotizaciones/Borradores", { exact: true }).waitFor();
  await dialog.locator("input[type='file']").setInputFiles([pdfFile("Propuesta comercial.pdf")]);
  // Un cambio de navegación con el diálogo abierto (aquí, un clic programático en otra carpeta del
  // árbol) no altera el destino ya fijado.
  await page.evaluate(() => [...document.querySelectorAll("aside button")].find((button) => button.textContent.trim() === "Quinta Bella Vista").click());
  await dialog.getByText("Destino: Casa Cotizada/Documentos/Cotizaciones/Borradores", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(lastPost(/\/projects\/3\/files$/).search, { folderId: String(borradoresId) });
  await page.getByText("«Propuesta comercial.pdf» se subió a Casa Cotizada/Documentos/Cotizaciones/Borradores. Queda pendiente de revisión en «Pendientes por aprobación».").waitFor();
});

for (const theme of ["light", "dark"]) {
  for (const width of [360, 375, 390, 768, 1440, 1920]) {
    test(`ubicación abierta · la ruta «Proyecto/Carpeta/Subcarpeta» se lee completa y sin selector en ambos diálogos (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      backend.projects.find((project) => project.id === 1).folders.push(
        { fileCount: 0, id: 160, name: LONG_FOLDER, parentId: 150, systemKey: null },
        { fileCount: 0, id: 161, name: UNBROKEN_FOLDER, parentId: 160, systemKey: null },
      );
      const page = await openFiles(context, backend, { theme, viewport: { height: width < 800 ? 740 : 900, width } });
      await selectQuintaFolder(page, ["Documentos", "Planos de obra", LONG_FOLDER, UNBROKEN_FOLDER]);
      const expected = `Destino: Quinta Bella Vista/Documentos/Planos de obra/${LONG_FOLDER}/${UNBROKEN_FOLDER}`;
      /**
       * Comprueba que la etiqueta del diálogo abierto se lee completa y cabe sin desbordar.
       *
       * @param {string} selector - Diálogo.
       * @returns {Promise<void>}
       */
      const assertLocation = async (selector) => {
        await page.waitForTimeout(300);
        const layout = await page.evaluate((root) => {
          const dialogElement = document.querySelector(root);
          const label = dialogElement.querySelector("[data-admin-file-destination] > span");
          const style = getComputedStyle(label);
          const box = dialogElement.getBoundingClientRect();
          const labelBox = label.getBoundingClientRect();
          const destination = dialogElement.querySelector("[data-admin-file-destination]");
          return {
            controls: destination.querySelectorAll("input, button, select, [role='combobox'], [contenteditable='true']").length, icon: Boolean(destination.querySelector("svg[aria-hidden='true']")),
            clipped: label.scrollWidth > label.clientWidth + 1, ellipsis: style.textOverflow === "ellipsis", inside: labelBox.left >= box.left && labelBox.right <= box.right,
            nowrap: style.whiteSpace === "nowrap", overflow: document.documentElement.scrollWidth - innerWidth, right: box.right, text: label.textContent, width: innerWidth,
          };
        }, selector);
        assert.equal(layout.text, expected);
        assert.deepEqual([layout.icon, layout.controls], [true, 0], "icono de carpeta del árbol y ruta solo informativa");
        assert.deepEqual([layout.clipped, layout.ellipsis, layout.nowrap], [false, false, false], JSON.stringify(layout));
        assert.ok(layout.inside && layout.overflow <= 0 && layout.right <= layout.width, JSON.stringify(layout));
      };
      await page.getByRole("button", { exact: true, name: "Nuevo archivo" }).click();
      const dialog = uploadDialog(page);
      await dialog.getByText(expected, { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: /^Destino/ }).count(), 0, "sin selector de destino");
      await assertLocation("[data-admin-file-upload='upload']");
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/location-upload-${theme}-${width}.png` });
      await dialog.getByRole("button", { exact: true, name: "Cerrar" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("complementary", { name: "Proyectos" }).getByRole("button", { name: /^Nueva carpeta en / }).click();
      const folderDialog = page.getByRole("dialog", { name: "Nueva carpeta" });
      await folderDialog.getByText(expected, { exact: true }).waitFor();
      await assertLocation("[data-admin-file-folder-dialog]");
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/location-folder-${theme}-${width}.png` });
    });
  }
}

test("nombre único por carpeta · el mismo nombre que un archivo de «Garantías» se sube a la raíz del proyecto", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).click();
  await page.getByRole("button", { name: /^Nuevo archivo/ }).click();
  const dialog = uploadDialog(page);
  await dialog.getByText("Destino: Quinta Bella Vista/", { exact: true }).waitFor();
  await dialog.locator("input[type='file']").setInputFiles([pdfFile("Garantía impermeabilización.pdf")]);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText(/«Garantía impermeabilización\.pdf» se subió a Quinta Bella Vista \(raíz del proyecto\)/).waitFor();
  // Los elementos son versiones: se agrupan por archivo.
  const homonyms = new Map(backend.items.filter((item) => item.project.id === 1 && item.name === "Garantía impermeabilización.pdf").map((item) => [item.fileId, item.folder?.id ?? null]));
  assert.equal(homonyms.size, 2, "dos archivos independientes");
  assert.equal(new Set(homonyms.values()).size, 2, "en ubicaciones distintas: «Garantías» y la raíz");
});
// ---------------------------------------------------------------------------------------------
// Conflicto de nombre (409) con rutas largas: el motivo se lee completo en la tarjeta, sin «…».

const LONG_FOLDER = "Carpeta de documentación técnica con un nombre deliberadamente largo para el ajuste de línea";
const UNBROKEN_FOLDER = "Expediente_definitivo_sin_espacios_para_forzar_el_corte_de_palabras_en_moviles_2026";

for (const theme of ["light", "dark"]) {
  for (const width of [360, 375, 390, 768, 1440, 1920]) {
    test(`409 · el conflicto se lee completo con rutas largas y varias tarjetas (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      const quinta = backend.projects.find((project) => project.id === 1);
      quinta.folders.push(
        { fileCount: 0, id: 160, name: LONG_FOLDER, parentId: 150, systemKey: null },
        { fileCount: 0, id: 161, name: UNBROKEN_FOLDER, parentId: 160, systemKey: null },
      );
      // Todos los archivos ya existen en el destino: la API responde 409 como el backend real.
      backend.uploadHook = async ({ route }) => {
        await route.fulfill({ body: JSON.stringify({ code: "DUPLICATE_PROJECT_FILE", message: "Ya existe un archivo con ese nombre en esta carpeta." }), contentType: "application/json", status: 409 });
        return true;
      };
      const page = await openFiles(context, backend, { theme, viewport: { height: width < 800 ? 740 : 900, width } });
      await selectQuintaFolder(page, ["Documentos", "Planos de obra", LONG_FOLDER, UNBROKEN_FOLDER]);
      await page.getByRole("button", { name: "Nuevo archivo" }).click();
      const dialog = uploadDialog(page);
      await dialog.locator("input[type='file']").setInputFiles([pdfFile("plano.pdf"), pdfFile("memoria.pdf"), pdfFile("acta-de-inicio.pdf")]);
      await dialog.getByRole("button", { name: "Confirmar" }).click();
      await dialog.getByText("Fallido").nth(2).waitFor();
      await page.waitForTimeout(350);

      const layout = await page.evaluate(() => {
        const root = document.querySelector("[data-admin-file-upload]");
        const dialogBox = root.getBoundingClientRect();
        const errors = [...root.querySelectorAll("[id$='-error']")];
        return {
          cards: errors.map((error) => {
            const card = document.getElementById(error.id.replace(/-error$/, ""));
            const style = getComputedStyle(error);
            const button = [...card.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Eliminar");
            const box = card.getBoundingClientRect();
            const buttonBox = button.getBoundingClientRect();
            return {
              bottom: box.bottom, buttonInside: buttonBox.left >= box.left && buttonBox.right <= box.right && buttonBox.top >= box.top && buttonBox.bottom <= box.bottom,
              clipped: error.scrollWidth > error.clientWidth + 1, describedBy: (button.getAttribute("aria-describedby") || "").split(" ").includes(error.id),
              ellipsis: style.textOverflow === "ellipsis", inDialog: box.left >= dialogBox.left && box.right <= dialogBox.right, nowrap: style.whiteSpace === "nowrap",
              text: error.textContent, top: box.top,
            };
          }),
          dialog: { left: dialogBox.left, right: dialogBox.right },
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          viewport: window.innerWidth,
        };
      });
      const detail = JSON.stringify(layout);
      assert.equal(layout.cards.length, 3, `las tres tarjetas se conservan: ${detail}`);
      assert.ok(layout.pageOverflow <= 0 && layout.dialog.left >= 0 && layout.dialog.right <= layout.viewport, `sin desbordamiento: ${detail}`);
      for (const card of layout.cards) {
        assert.ok(card.text.includes(`Quinta Bella Vista/Documentos/Planos de obra/${LONG_FOLDER}/${UNBROKEN_FOLDER}`), "la ruta completa, con nombres largos");
        assert.ok(card.text.endsWith("No se reemplazó nada: cancela o usa «Reemplazar archivo» en ese archivo para subir una versión nueva."), "el mensaje termina completo");
        assert.deepEqual([card.ellipsis, card.nowrap, card.clipped], [false, false, false], `sin recorte: ${detail}`);
        assert.ok(card.inDialog && card.buttonInside, `tarjeta y acción dentro de su contenedor: ${detail}`);
        assert.equal(card.describedBy, true, "el motivo describe el botón «Eliminar»");
      }
      const sorted = [...layout.cards].sort((left, right) => left.top - right.top);
      for (let index = 1; index < sorted.length; index += 1) assert.ok(sorted[index].top >= sorted[index - 1].bottom - 0.5, `las tarjetas no se superponen: ${detail}`);
      assert.equal(await dialog.getByRole("button", { name: "Intenta de nuevo" }).count(), 0, "un conflicto no ofrece reintento");
      // Con varias tarjetas el área se desplaza: cada acción y el pie del diálogo siguen alcanzables.
      for (const button of await dialog.getByRole("button", { exact: true, name: "Eliminar" }).all()) {
        await button.scrollIntoViewIfNeeded();
        assert.equal(await button.isVisible(), true);
      }
      assert.equal(await dialog.getByRole("button", { exact: true, name: "Cerrar" }).isVisible(), true);
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/conflict-${theme}-${width}.png` });
    });
  }
}
