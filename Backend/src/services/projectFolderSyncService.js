import { CLIENT_FILES_FOLDER_KEY, describeCatalogPath, resolveDocumentLocation, resolveFileOrigin } from "../domain/documentClassification.js";
import { assignUniqueFileNames } from "../domain/projectFileNames.js";
import { planMissingSystemFolders, PROJECT_SYSTEM_FOLDERS, QUOTE_DOCUMENTS_FOLDER_KEY } from "../domain/projectFolderCatalog.js";
import { isActiveAdmin } from "../repositories/projectFileCompatibilityRepository.js";
import {
  assignRequestAttachmentsToFolder,
  countProjectQuotes,
  insertFolderSyncAudit,
  loadProjectFolders,
  loadSystemFolderFileTitles,
  loadUnfolderedFiles,
} from "../repositories/projectFolderSyncRepository.js";
import { ensureProjectSystemFolders } from "../repositories/projectSystemFolderRepository.js";
import { canonicalJson, sha256 } from "./projectFileCompatibilityService.js";

// Sincronización de proyectos existentes con el catálogo de carpetas y clasificación documental
// (archivística). En tres pasos, como la compatibilidad B9:
// 1. Plan (solo lectura, simulación): carpetas que faltan, conflictos de nombre, archivos con
//    ubicación comprobable y reporte de pendientes. Se guarda con su huella SHA-256.
// 2. Aplicación: solo con el plan revisado y su huella. Por proyecto y en su transacción: crea las
//    carpetas predeterminadas que faltan (idempotente, sin adoptar ni renombrar carpetas existentes)
//    y ubica los archivos clasificables. Reejecutarla no cambia nada más.
// 3. Verificación: vuelve a planificar y comprueba que no queda nada aplicable.
// Nunca elimina carpetas ni archivos, no crea versiones, no mueve objetos de almacenamiento y no
// cambia audiencias: la carpeta es solo la ubicación lógica (no concede acceso).

// Versión 2: las entradas ubicables pueden llevar `logicalTitle` (homónimos con sufijo). Un plan de la
// versión 1 se rechaza y hay que volver a planificar.
export const FOLDER_SYNC_PLAN_VERSION = 2;
export const FOLDER_SYNC_AUDIT_ACTION = "project_folders.synchronized";

/**
 * Agrupa filas por proyecto conservando su orden de lectura.
 * Las claves son números para no confundir ids de texto de `pg`.
 *
 * @param {Array<object>} rows - Filas con `project_id`.
 * @returns {Map<number, Array<object>>} Proyecto → filas.
 */
function byProject(rows) {
  const grouped = new Map();
  for (const row of rows) grouped.set(Number(row.project_id), [...(grouped.get(Number(row.project_id)) || []), row]);
  return grouped;
}

/**
 * Planifica un proyecto: carpetas que faltan, conflictos, archivos ubicables y pendientes, con las reglas
 * de domain/documentClassification.js. Un homónimo en la carpeta destino se ubica con un nombre lógico
 * con sufijo «nombre (2).ext» (`logicalTitle`); su nombre original sigue en sus versiones.
 *
 * @param {object} project - Proyecto.
 * @param {Array<object>} folderRows - Carpetas vigentes del proyecto.
 * @param {Array<object>} fileRows - Archivos sin carpeta del proyecto.
 * @param {number} quotes - Cotizaciones vigentes del proyecto.
 * @param {Array<{ system_key: string, title: string }>} [occupiedRows] - Nombres ya ubicados en
 *   carpetas predeterminadas del proyecto.
 * @returns {object} Entrada del plan.
 */
function planProject(project, folderRows, fileRows, quotes, occupiedRows = []) {
  const folders = folderRows.map((row) => ({ id: Number(row.id), name: row.name, parentId: row.parent_id === null ? null : Number(row.parent_id), systemKey: row.system_key ?? null }));
  const { blocked, conflicts, missing } = planMissingSystemFolders(folders);
  const present = new Set(folders.filter((folder) => folder.systemKey).map((folder) => folder.systemKey));
  /**
   * Indica si la carpeta predeterminada existe o se creará con este plan.
   *
   * @param {string} key - Clave funcional.
   * @returns {boolean} Disponible tras aplicar.
   */
  const available = (key) => present.has(key) || missing.includes(key);
  const classify = [];
  const pending = [];
  for (const file of fileRows) {
    const location = resolveDocumentLocation({
      fileCategory: file.file_category,
      origin: resolveFileOrigin({ folderId: null, originProjectRequestId: file.origin_project_request_id }),
    });
    const entry = { category: file.file_category, fileId: Number(file.id), title: file.title };
    if (location.status === "classified" && available(location.folderKey)) {
      classify.push({ ...entry, folderKey: location.folderKey, reason: location.reason });
    } else {
      const reason = location.status === "classified" ? "TARGET_FOLDER_CONFLICT" : location.reason;
      const suggestedKey = location.status === "classified" ? location.folderKey : location.suggestedKey;
      pending.push({ ...entry, reason, suggestedKey, suggestedPath: describeCatalogPath(suggestedKey) });
    }
  }
  // Nombre lógico único por carpeta destino, frente a lo ya ubicado y al resto del lote.
  for (const folderKey of new Set(classify.map((file) => file.folderKey))) {
    const batch = classify.filter((file) => file.folderKey === folderKey);
    const taken = occupiedRows.filter((row) => row.system_key === folderKey).map((row) => row.title);
    const names = assignUniqueFileNames(batch.map((file) => ({ id: file.fileId, title: file.title })), { taken });
    for (const file of batch) if (names.get(file.fileId) !== file.title) file.logicalTitle = names.get(file.fileId);
  }
  return {
    classify,
    conflicts,
    blockedFolders: blocked,
    createFolders: missing,
    name: project.name,
    pending,
    projectId: Number(project.id),
    quotes: { count: quotes, folderKey: available(QUOTE_DOCUMENTS_FOLDER_KEY) ? QUOTE_DOCUMENTS_FOLDER_KEY : "documents" },
  };
}

/**
 * Resume el plan: totales, archivos ubicables por categoría y destino, y pendientes por motivo.
 *
 * @param {Array<object>} projects - Entradas del plan.
 * @returns {object} Resumen.
 */
export function summarizeFolderSync(projects) {
  /**
   * Cuenta elementos por el valor de un campo.
   *
   * @param {Array<object>} items - Elementos.
   * @param {string} key - Campo.
   * @returns {Record<string, number>} Recuento.
   */
  const count = (items, key) => items.reduce((totals, item) => ({ ...totals, [item[key]]: (totals[item[key]] || 0) + 1 }), {});
  const classify = projects.flatMap((project) => project.classify);
  const pending = projects.flatMap((project) => project.pending);
  return {
    classifyByCategory: count(classify, "category"),
    classifyByFolder: count(classify, "folderKey"),
    conflicts: projects.reduce((total, project) => total + project.conflicts.length, 0),
    filesToClassify: classify.length,
    foldersToCreate: projects.reduce((total, project) => total + project.createFolders.length, 0),
    pendingByCategory: count(pending, "category"),
    pendingByReason: count(pending, "reason"),
    pendingFiles: pending.length,
    projects: projects.length,
    projectsToUpdate: projects.filter((project) => project.createFolders.length || project.classify.length).length,
    quotesByFolder: projects.reduce((totals, project) => ({ ...totals, [project.quotes.folderKey]: (totals[project.quotes.folderKey] || 0) + project.quotes.count }), {}),
  };
}

/**
 * Construye el plan de sincronización (solo lectura): es la vista previa que se revisa antes de aplicar.
 *
 * @param {{ query: Function }} client - Cliente PostgreSQL.
 * @param {{ target: string, now?: Date }} options - Destino confirmado y fecha.
 * @returns {Promise<object>} Plan.
 */
export async function buildFolderSyncPlan(client, { now = new Date(), target }) {
  const { folders, projects } = await loadProjectFolders(client);
  const files = byProject(await loadUnfolderedFiles(client));
  const folderMap = byProject(folders);
  const occupied = byProject(await loadSystemFolderFileTitles(client));
  const quotes = new Map((await countProjectQuotes(client)).map((row) => [Number(row.project_id), Number(row.quotes)]));
  const entries = projects.map((project) => planProject(
    project,
    folderMap.get(Number(project.id)) || [],
    files.get(Number(project.id)) || [],
    quotes.get(Number(project.id)) || 0,
    occupied.get(Number(project.id)) || [],
  ));
  return {
    catalogKeys: PROJECT_SYSTEM_FOLDERS.map((folder) => folder.key),
    generatedAt: now.toISOString(),
    projects: entries,
    summary: summarizeFolderSync(entries),
    target,
    version: FOLDER_SYNC_PLAN_VERSION,
  };
}

/**
 * Lee un plan y comprueba su huella (la del texto revisado) y su versión.
 *
 * @param {string} text - Contenido del archivo del plan.
 * @param {string} expectedSha256 - Huella indicada por el operador.
 * @returns {object} Plan.
 * @throws {Error} Si la huella no coincide o el plan no es de esta versión.
 */
export function readFolderSyncPlan(text, expectedSha256) {
  if (sha256(text) !== String(expectedSha256).toLowerCase()) throw new Error("La huella del plan no coincide: revisa el archivo indicado.");
  const plan = JSON.parse(text);
  if (plan?.version !== FOLDER_SYNC_PLAN_VERSION || !Array.isArray(plan.projects)) throw new Error("El plan no corresponde a esta versión de la sincronización.");
  return plan;
}

/**
 * Aplica un plan revisado. Cada proyecto va en su propia transacción: crea las carpetas que faltan
 * (con el proyecto bloqueado, omitiendo conflictos) y ubica los archivos del plan que siguen sin
 * carpeta. Un proyecto con error se revierte sin afectar a los demás. Es idempotente.
 *
 * @param {import("pg").Client} client - Cliente PostgreSQL dedicado.
 * @param {{ plan: object, planSha256: string, operatorUserId: number, target: string }} options - Plan y operador.
 * @returns {Promise<{ results: Array<object>, summary: object }>} Resultado por proyecto.
 * @throws {Error} Si el destino no coincide o el operador no es un administrador activo.
 */
export async function applyFolderSyncPlan(client, { operatorUserId, plan, planSha256, target }) {
  if (plan.target !== target) throw new Error(`El plan es de ${plan.target}, no de ${target}.`);
  if (!(await isActiveAdmin(client, operatorUserId))) throw new Error("El operador debe ser un administrador activo.");
  const results = [];
  for (const entry of plan.projects) {
    if (!entry.createFolders.length && !entry.classify.length) continue;
    try {
      await client.query("begin");
      const folders = await ensureProjectSystemFolders(client, { createdBy: operatorUserId, projectId: entry.projectId, skipNameConflicts: true });
      const planned = entry.classify.filter((file) => file.folderKey === CLIENT_FILES_FOLDER_KEY)
        .map((file) => ({ fileId: file.fileId, title: file.logicalTitle ?? file.title }));
      const classified = await assignRequestAttachmentsToFolder(client, { files: planned, projectId: entry.projectId, systemKey: CLIENT_FILES_FOLDER_KEY });
      // Nombre original → nombre lógico de los ubicados con sufijo (el original sigue en sus versiones).
      const renamedFiles = entry.classify
        .filter((file) => file.logicalTitle && classified.includes(file.fileId))
        .map((file) => ({ fileId: file.fileId, originalTitle: file.title, title: file.logicalTitle }));
      if (folders.created || classified.length) {
        await insertFolderSyncAudit(client, {
          action: FOLDER_SYNC_AUDIT_ACTION,
          newValues: { classifiedFileIds: classified, conflicts: folders.conflicts, createdFolders: folders.created, planSha256, ...(renamedFiles.length ? { renamedFiles } : {}) },
          projectId: entry.projectId,
          userId: operatorUserId,
        });
      }
      await client.query("commit");
      results.push({
        classifiedFiles: classified.length, conflicts: folders.conflicts.length, createdFolders: folders.created,
        outcome: "applied", projectId: entry.projectId, skippedFiles: planned.length - classified.length,
      });
    } catch (error) {
      await client.query("rollback").catch(() => {});
      results.push({ error: error?.code || error?.message, outcome: "error", projectId: entry.projectId });
    }
  }
  /**
   * Suma un campo numérico de los resultados.
   *
   * @param {string} key - Campo.
   * @returns {number} Total.
   */
  const total = (key) => results.reduce((sum, result) => sum + (result[key] || 0), 0);
  return {
    results,
    summary: { classifiedFiles: total("classifiedFiles"), createdFolders: total("createdFolders"), errors: results.filter((result) => result.outcome === "error").length, projects: results.length },
  };
}

/**
 * Verifica la base después de aplicar: vuelve a planificar y comprueba que no queden carpetas por
 * crear ni archivos ubicables (los conflictos y pendientes se informan, pero requieren revisión humana).
 *
 * @param {{ query: Function }} client - Cliente PostgreSQL.
 * @param {{ target: string }} options - Destino.
 * @returns {Promise<{ ok: boolean, summary: object }>} Resultado.
 */
export async function verifyFolderSync(client, { target }) {
  const plan = await buildFolderSyncPlan(client, { target });
  return { ok: plan.summary.foldersToCreate === 0 && plan.summary.filesToClassify === 0, summary: plan.summary };
}

/**
 * Texto canónico de un plan (para guardar y firmar siempre con la misma huella).
 *
 * @param {object} plan - Plan.
 * @returns {string} JSON con sangría y salto final.
 */
export function serializeFolderSyncPlan(plan) {
  return `${JSON.stringify(JSON.parse(canonicalJson(plan)), null, 2)}\n`;
}
