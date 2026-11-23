import { query, withTransaction } from "../config/db.js";
import { evaluateFolderOperation, getSystemFolder, orderFolderTree } from "../domain/projectFolderCatalog.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import {
  listFileManagerItems,
  listFileManagerProjects,
  listFolderAncestors,
  listFoldersOfProjects,
  readFileManagerMetrics,
  searchFileManagerFolders,
} from "../repositories/fileManagerRepository.js";
import {
  deleteEmptyProjectFolder,
  findProjectFolder,
  insertProjectFolder,
  listProjectFolders,
  lockProjectForConfiguration,
  renameProjectFolder,
} from "../repositories/projectConfigurationRepository.js";
import { decodeCursor, encodeCursor } from "../utils/pagination.js";
import { translateProjectConfigurationError } from "./projectConfigurationErrors.js";
import { assertOperationallyMutableProjectState } from "./projectMutationPolicy.js";

// Administrador de archivos (Fase 1.2, B7). Solo el administrador, con la revisión activada: como
// equipo de todos los proyectos ve todas las versiones (política común de B4/B5), también las
// pendientes y rechazadas y las de proyectos draft. Clasificación (carpeta), revisión (pestaña) y
// visibilidad (audiencias) son independientes: aquí no se comparte ni se publica nada.
//
// Carpetas: se aplican solo las reglas confirmadas del catálogo (domain/projectFolderCatalog.js):
// personalizadas dentro de otras carpetas salvo la portada; las predeterminadas no se renombran ni
// eliminan; se eliminan solo las personalizadas vacías (borrado lógico). Crear en la raíz depende de
// D7 y mover carpetas de D13: la API responde 409 PROJECT_FOLDER_DECISION_PENDING y no ofrece mover.

/**
 * Lanza el error de cursor inválido con el contrato habitual de validación.
 * Se usa cuando el cursor no se puede decodificar o no corresponde a la consulta.
 *
 * @returns {never} Nunca retorna.
 * @throws {ValidationError} Siempre.
 */
function invalidCursor() {
  throw new ValidationError("Los datos enviados no son válidos.", { "query.cursor": "Cursor inválido." });
}

/**
 * Comprueba que una carpeta pedida como ámbito existe y pertenece al proyecto indicado.
 * La validación de entrada ya exige el proyecto cuando llega una carpeta.
 *
 * @param {{ projectId: number|null, folderId: number|null }} scope - Ámbito.
 * @returns {Promise<void>}
 * @throws {NotFoundError} Si la carpeta no existe en el proyecto.
 */
async function assertScopeFolder({ folderId, projectId }) {
  if (folderId && !(await findProjectFolder({ query }, projectId, folderId))) {
    throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "Carpeta no encontrada.");
  }
}

/**
 * Devuelve las métricas del administrador en el ámbito pedido (todo, un proyecto o una carpeta con
 * sus subcarpetas). Una carpeta exige su proyecto y debe pertenecerle.
 *
 * @param {{ projectId?: number, folderId?: number }} scope - Ámbito.
 * @returns {Promise<object>} Métricas y su ámbito.
 * @throws {NotFoundError} Si la carpeta no existe en el proyecto.
 */
export async function getFileManagerMetrics({ folderId = null, projectId = null }) {
  await assertScopeFolder({ folderId, projectId });
  const metrics = await readFileManagerMetrics({ folderId, projectId });
  return { metrics: { ...metrics, scope: { folderId, projectId } } };
}

/**
 * Agrupa las carpetas leídas por proyecto, en el orden de presentación del árbol.
 * Usa orderFolderTree: preorden, predeterminadas según el catálogo y personalizadas por nombre.
 *
 * @param {Array<object>} rows - Filas de carpetas.
 * @returns {Map<number, Array<object>>} Proyecto → carpetas ordenadas.
 */
function foldersByProject(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const projectId = Number(row.project_id);
    const folder = {
      fileCount: Number(row.file_count),
      id: Number(row.id),
      name: row.name,
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      systemKey: row.system_key ?? null,
    };
    grouped.set(projectId, [...(grouped.get(projectId) || []), folder]);
  }
  for (const [projectId, folders] of grouped) grouped.set(projectId, orderFolderTree(folders));
  return grouped;
}

/**
 * Devuelve una página del árbol: proyectos (nombre, cliente, estado y archivos) con sus carpetas en
 * preorden y nombres visibles. Pagina por proyectos con cursor (nombre e id).
 *
 * @param {{ cursor?: string, limit: number, search?: string }} options - Página y búsqueda.
 * @returns {Promise<{ projects: object[], nextCursor: string|null }>} Página del árbol.
 * @throws {ValidationError} Si el cursor no es válido.
 */
export async function getFileManagerTree({ cursor, limit, search = null }) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) invalidCursor();
  const rows = await listFileManagerProjects({ cursor: decoded, limit, search });
  const page = rows.slice(0, limit);
  const folders = foldersByProject(await listFoldersOfProjects(page.map((row) => Number(row.id))));
  const last = page.at(-1);
  return {
    nextCursor: rows.length > limit && last ? encodeCursor([last.sort_name, String(last.id)]) : null,
    projects: page.map((row) => ({
      client: { name: row.client_name },
      fileCount: Number(row.file_count),
      folders: folders.get(Number(row.id)) || [],
      id: Number(row.id),
      name: row.name,
      status: row.status,
    })),
  };
}

/**
 * Busca carpetas por su nombre visible y devuelve cada una con su ruta legible
 * (cliente › proyecto › carpetas), paginada por cursor.
 *
 * @param {{ search: string, projectId?: number, cursor?: string, limit: number }} options - Búsqueda y página.
 * @returns {Promise<{ folders: object[], nextCursor: string|null }>} Carpetas encontradas.
 * @throws {ValidationError} Si el cursor no es válido.
 */
export async function searchFolders({ cursor, limit, projectId = null, search }) {
  const decoded = cursor ? decodeCursor(cursor, 3) : null;
  if (cursor && !decoded) invalidCursor();
  const rows = await searchFileManagerFolders({ cursor: decoded, limit, projectId, search });
  const page = rows.slice(0, limit);
  const chains = new Map();
  for (const ancestor of await listFolderAncestors(page.map((row) => Number(row.id)))) {
    const originId = Number(ancestor.origin_id);
    chains.set(originId, [...(chains.get(originId) || []), { id: Number(ancestor.id), name: ancestor.name }]);
  }
  const last = page.at(-1);
  return {
    folders: page.map((row) => ({
      client: { name: row.client_name },
      id: Number(row.id),
      name: row.name,
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      path: chains.get(Number(row.id)) || [],
      project: { id: Number(row.project_id), name: row.project_name },
      systemKey: row.system_key ?? null,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor([last.sort_name, String(last.project_id), String(last.id)]) : null,
  };
}

/**
 * Representa una versión listada: `fileCategory` elige el visor y `folder.section` es la sección de
 * la carpeta predeterminada más cercana; `source` distingue archivos (`file`) de PDF de cotizaciones
 * (`quote`, sin `fileId` ni revisión, con `quote` y el `versionId` de la versión comercial).
 *
 * @param {object} row - Fila del repositorio.
 * @returns {object} Elemento público.
 */
function toFileManagerItem(row) {
  const isQuote = row.source === "quote";
  return {
    contentType: row.content_type,
    createdAt: row.created_at,
    extension: row.file_extension,
    fileId: isQuote ? null : Number(row.file_id),
    fileCategory: row.file_category ?? null,
    folder: row.folder_id === null ? null : {
      id: Number(row.folder_id),
      name: row.folder_name,
      section: getSystemFolder(row.folder_classification_key)?.section ?? null,
    },
    isCurrent: Boolean(row.is_current),
    name: row.name,
    project: { id: Number(row.project_id), name: row.project_name, status: row.project_status },
    quote: isQuote ? {
      code: row.quote_code,
      id: Number(row.quote_id),
      pdf: { errorCode: row.pdf_error_code ?? null, status: row.pdf_status },
    } : null,
    restoredFromVersionId: row.restored_from_version_id === null ? null : Number(row.restored_from_version_id),
    review: isQuote ? null : {
      reason: row.review_reason ?? null,
      reviewedAt: row.reviewed_at ?? null,
      reviewerName: row.reviewer_name || null,
      status: row.review_status ?? "legacy",
    },
    size: row.file_size === null ? null : Number(row.file_size),
    source: isQuote ? "quote" : "file",
    uploadedBy: row.uploader_id === null ? null : { id: Number(row.uploader_id), name: row.uploader_name || "Usuario" },
    versionId: Number(row.version_id),
    versionNumber: Number(row.version_number),
  };
}

/**
 * Decodifica el cursor de una pestaña y comprueba que corresponde a la misma pestaña, orden y
 * sentido. El cursor actual guarda también el origen de la última fila (archivo o cotización); se
 * aceptan los de cinco elementos anteriores a la integración de cotizaciones (origen archivo).
 *
 * @param {string} cursor - Cursor recibido.
 * @param {{ tab: string, sort: string, order: string }} query - Consulta actual.
 * @returns {[string, number, string]} Valor de ordenación, origen e id.
 * @throws {ValidationError} Si el cursor no es válido o no corresponde.
 */
function decodeTabCursor(cursor, { order, sort, tab }) {
  const parsed = decodeCursor(cursor, 6) ?? decodeCursor(cursor, 5);
  if (!parsed || parsed[0] !== tab || parsed[1] !== sort || parsed[2] !== order) invalidCursor();
  if (parsed.length === 5) return [parsed[3], 0, parsed[4]];
  const rank = Number(parsed[4]);
  if (rank !== 0 && rank !== 1) invalidCursor();
  return [parsed[3], rank, parsed[5]];
}

/**
 * Lista una pestaña del administrador (aprobados, pendientes o rechazados) con filtros, ordenación y
 * cursor. Aprobados incluye los PDF de cotizaciones de cada proyecto (carpeta «Documentos»). El cursor queda ligado a la pestaña, la ordenación y el sentido: reutilizarlo con otros
 * responde 400, en lugar de devolver páginas incoherentes.
 *
 * @param {object} options - Pestaña, ámbito, filtros, orden y página (validados por Zod).
 * @param {string} [options.cursor] - Cursor de la página anterior.
 * @param {string[]} options.extensions - Extensiones admitidas.
 * @param {number} [options.folderId] - Carpeta.
 * @param {boolean} options.includeSubfolders - Incluye subcarpetas.
 * @param {number} options.limit - Tamaño de página.
 * @param {"asc"|"desc"} options.order - Sentido.
 * @param {number} [options.projectId] - Proyecto.
 * @param {string} [options.search] - Texto en el nombre.
 * @param {"date"|"name"|"size"} options.sort - Ordenación.
 * @param {"approved"|"pending"|"rejected"} options.tab - Pestaña.
 * @returns {Promise<{ items: object[], nextCursor: string|null }>} Página.
 * @throws {ValidationError|NotFoundError} Si el cursor no corresponde o la carpeta no existe.
 */
export async function listFileManagerTab({ cursor, extensions, folderId, includeSubfolders, limit, order, projectId, search, sort, tab }) {
  const decoded = cursor ? decodeTabCursor(cursor, { order, sort, tab }) : null;
  await assertScopeFolder({ folderId, projectId });
  const rows = await listFileManagerItems({
    cursor: decoded, extensions, folderId, includeSubfolders, limit, order, projectId, search, sort, tab,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toFileManagerItem),
    nextCursor: rows.length > limit && last
      ? encodeCursor([tab, sort, order, String(last.cursor_value), Number(last.source_rank), String(last.version_id)])
      : null,
  };
}

/**
 * Bloquea el proyecto y comprueba que admite cambios en su organización: no archivado ni finalizado;
 * un draft sí, porque lo prepara el administrador (como la configuración).
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {number} projectId - Proyecto.
 * @returns {Promise<object>} Proyecto bloqueado.
 * @throws {NotFoundError|ConflictError} Si no existe o es de solo lectura.
 */
async function lockMutableProject(client, projectId) {
  const project = await lockProjectForConfiguration(client, projectId);
  if (!project) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  return assertOperationallyMutableProjectState(project, { allowDraft: true });
}

/**
 * Traduce el resultado de una regla del catálogo de carpetas a un error público.
 * Una regla pendiente de decisión nunca se aplica con un valor supuesto: responde 409.
 *
 * @param {{ outcome: string, reason: string, decision?: string }} evaluation - Resultado del dominio.
 * @returns {void}
 * @throws {ConflictError} Si la operación está prohibida o pendiente de decisión.
 */
function assertFolderRule(evaluation) {
  if (evaluation.outcome === "allowed") return;
  if (evaluation.outcome === "pending_decision") {
    throw new ConflictError("PROJECT_FOLDER_DECISION_PENDING", `Esta operación de carpetas está pendiente de decisión (${evaluation.decision}).`);
  }
  if (evaluation.reason === "FOLDER_DOES_NOT_ALLOW_SUBFOLDERS") {
    throw new ConflictError("PROJECT_FOLDER_SUBFOLDERS_NOT_ALLOWED", "Esta carpeta no admite subcarpetas.");
  }
  if (evaluation.reason === "FOLDER_NOT_EMPTY") throw new ConflictError("PROJECT_FOLDER_NOT_EMPTY", "La carpeta tiene archivos o subcarpetas.");
  throw new ConflictError("PROJECT_FOLDER_PROTECTED", "Las carpetas predeterminadas del proyecto no se pueden renombrar ni eliminar.");
}

/**
 * Ejecuta un cambio de carpetas en una transacción con el proyecto bloqueado, traduce los fallos de
 * PostgreSQL conocidos (nombre repetido entre hermanas) y devuelve las carpetas actualizadas.
 *
 * @param {number} projectId - Proyecto.
 * @param {(client: import("pg").PoolClient) => Promise<object|void>} write - Cambio.
 * @returns {Promise<{ folder: object|null, folders: object[] }>} Resultado y carpetas del proyecto.
 */
async function writeFolders(projectId, write) {
  try {
    const folder = await withTransaction(async (client) => {
      await lockMutableProject(client, projectId);
      return write(client);
    });
    return { folder: folder ?? null, folders: await listProjectFolders(projectId) };
  } catch (error) {
    throw translateProjectConfigurationError(error);
  }
}

/**
 * Crea una carpeta personalizada dentro de otra carpeta del proyecto (anidada a cualquier nivel),
 * salvo en la portada. En la raíz depende de D7. Queda auditada.
 *
 * @param {{ projectId: number, parentId: number|null, name: string, user: object }} request - Carpeta.
 * @returns {Promise<{ folder: object, folders: object[] }>} Carpeta creada y árbol del proyecto.
 */
export async function createFileManagerFolder({ name, parentId, projectId, user }) {
  return writeFolders(projectId, async (client) => {
    const parent = parentId ? await findProjectFolder(client, projectId, parentId) : null;
    if (parentId && !parent) throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "La carpeta superior no existe.");
    assertFolderRule(evaluateFolderOperation({ operation: "create_child", parent }));
    const folder = await insertProjectFolder(client, { createdBy: user.id, name, parentId, projectId });
    await insertAuditLog({
      action: "project_folder.created",
      description: "Carpeta personalizada creada en el administrador de archivos.",
      entityId: folder.id,
      entityType: "project_folder",
      newValues: { name, parentId, projectId },
      userId: Number(user.id),
    }, client);
    return folder;
  });
}

/**
 * Renombra una carpeta personalizada; una predeterminada responde 409 PROJECT_FOLDER_PROTECTED.
 * Queda auditada.
 *
 * @param {{ projectId: number, folderId: number, name: string, user: object }} request - Carpeta y nombre.
 * @returns {Promise<{ folder: null, folders: object[] }>} Árbol del proyecto.
 */
export async function renameFileManagerFolder({ folderId, name, projectId, user }) {
  return writeFolders(projectId, async (client) => {
    const folder = await findProjectFolder(client, projectId, folderId);
    if (!folder) throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "Carpeta no encontrada.");
    assertFolderRule(evaluateFolderOperation({ folder, operation: "rename" }));
    if ((await renameProjectFolder(client, { folderId, name, projectId })) !== "renamed") {
      throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "Carpeta no encontrada.");
    }
    await insertAuditLog({
      action: "project_folder.renamed",
      description: "Carpeta personalizada renombrada en el administrador de archivos.",
      entityId: folderId,
      entityType: "project_folder",
      newValues: { name, projectId },
      userId: Number(user.id),
    }, client);
  });
}

/**
 * Retira (borrado lógico) una carpeta personalizada vacía; con contenido responde 409
 * PROJECT_FOLDER_NOT_EMPTY y una predeterminada 409 PROJECT_FOLDER_PROTECTED. Nunca toca archivos.
 *
 * @param {{ projectId: number, folderId: number, user: object }} request - Carpeta.
 * @returns {Promise<{ folder: null, folders: object[] }>} Árbol del proyecto.
 */
export async function deleteFileManagerFolder({ folderId, projectId, user }) {
  return writeFolders(projectId, async (client) => {
    const outcome = await deleteEmptyProjectFolder(client, { folderId, projectId });
    if (outcome === "not_found") throw new NotFoundError("PROJECT_FOLDER_NOT_FOUND", "Carpeta no encontrada.");
    if (outcome === "protected") assertFolderRule({ outcome: "forbidden", reason: "SYSTEM_FOLDER_PROTECTED" });
    if (outcome === "not_empty") assertFolderRule({ outcome: "forbidden", reason: "FOLDER_NOT_EMPTY" });
    await insertAuditLog({
      action: "project_folder.deleted",
      description: "Carpeta personalizada vacía retirada en el administrador de archivos.",
      entityId: folderId,
      entityType: "project_folder",
      newValues: { projectId },
      userId: Number(user.id),
    }, client);
  });
}
