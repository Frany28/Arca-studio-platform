import { query, withTransaction } from "../config/db.js";
import { isProjectFileReviewEnabled } from "../config/projectFileReview.js";
import { evaluateWarrantyDocumentLink, evaluateWarrantyDocumentMove } from "../domain/projectWarrantyDocuments.js";
import { planWarrantySave } from "../domain/projectWarrantySave.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import { lockProjectForConfiguration } from "../repositories/projectConfigurationRepository.js";
import {
  closeWarrantyDocumentLink,
  countActiveLinksByWarranty,
  findProjectWarranty,
  insertWarranty,
  insertWarrantyDocumentLink,
  listActiveWarrantyIdsForFile,
  listFolderChain,
  listWarrantiesWithVisibleDocuments,
  lockActiveWarranties,
  lockProjectFileForLink,
  retireWarranties,
  updateWarranty,
} from "../repositories/projectWarrantyRepository.js";
import { getProjectAccessCondition } from "../utils/projectCommentAccessSql.js";
import { translateProjectConfigurationError } from "./projectConfigurationErrors.js";
import { assertOperationallyMutableProjectState } from "./projectMutationPolicy.js";

// Garantías con identificadores estables y documentos vinculados (Fase 1.2, B8).
// - Guardado estable (configuración del draft): domain/projectWarrantySave.js. Funciona con la
//   revisión apagada (solo columnas anteriores); la protección de vínculos solo existe encendida,
//   porque los vínculos dependen de la migración de B3 y solo se crean con ella.
// - Vínculos, regla de movimiento y lectura: solo con PROJECT_FILE_REVIEW_ENABLED. Reglas en
//   domain/projectWarrantyDocuments.js; versión visible con la política común de archivos.

const LINK_ERRORS = Object.freeze({
  FILE_NOT_ACTIVE: ["FILE_NOT_ACTIVE", "El documento no está activo."],
  FILE_OUTSIDE_WARRANTY_FOLDER: ["WARRANTY_DOCUMENT_OUTSIDE_FOLDER", "El documento debe estar en «Documentos › Garantías» o en una de sus subcarpetas."],
  WARRANTY_RETIRED: ["WARRANTY_RETIRED", "La garantía está retirada."],
});

/**
 * Aplica el guardado estable de «Garantías» dentro de la transacción de la configuración (proyecto
 * bloqueado y en draft): actualiza por id, inserta las nuevas y retira las omitidas conservando su
 * historial y sus vínculos.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ createdBy: number, projectId: number, warranties: object[] }} request - Garantías validadas.
 * @returns {Promise<void>}
 * @throws {ValidationError|ConflictError} Id ajeno o repetido, o envío sin ids que rompería vínculos.
 */
export async function saveStableProjectWarranties(client, { createdBy, projectId, warranties }) {
  const existing = await lockActiveWarranties(client, projectId);
  const activeLinkCounts = isProjectFileReviewEnabled()
    ? await countActiveLinksByWarranty(client, existing.map((warranty) => warranty.id))
    : new Map();
  const plan = planWarrantySave({ activeLinkCounts, existing, submitted: warranties });
  if (plan.outcome === "invalid") {
    const message = plan.reason === "DUPLICATE_WARRANTY_ID" ? "La garantía está repetida." : "La garantía no existe en este proyecto o está retirada.";
    throw new ValidationError(undefined, { [`body.warranties.${plan.index}.id`]: message });
  }
  if (plan.outcome === "conflict") {
    throw new ConflictError(
      "WARRANTY_REFERENCES_REQUIRED",
      "Recarga la configuración: el guardado debe identificar las garantías existentes porque tienen documentos vinculados.",
    );
  }
  for (const warranty of plan.updates) await updateWarranty(client, { projectId, warranty });
  for (const warranty of plan.inserts) await insertWarranty(client, { createdBy, projectId, warranty });
  await retireWarranties(client, { ids: plan.retireIds, projectId });
}

/**
 * Ejecuta un cambio de vínculos con el proyecto bloqueado y operativo (un draft también, porque lo
 * prepara el administrador; archivado y finalizado son de solo lectura).
 *
 * @param {number} projectId - Proyecto.
 * @param {(client: import("pg").PoolClient) => Promise<object>} write - Cambio.
 * @returns {Promise<object>} Resultado del cambio.
 */
async function writeWarrantyLinks(projectId, write) {
  try {
    return await withTransaction(async (client) => {
      const project = await lockProjectForConfiguration(client, projectId);
      if (!project) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
      assertOperationallyMutableProjectState(project, { allowDraft: true });
      return write(client);
    });
  } catch (error) {
    throw translateProjectConfigurationError(error);
  }
}

/**
 * Busca la garantía del proyecto (vigente o retirada) o responde 404.
 * Una garantía de otro proyecto se trata como inexistente.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, warrantyId: number }} request - Garantía.
 * @returns {Promise<object>} Garantía.
 * @throws {NotFoundError} Si no existe en el proyecto.
 */
async function requireWarranty(client, request) {
  const warranty = await findProjectWarranty(client, request);
  if (!warranty) throw new NotFoundError("WARRANTY_NOT_FOUND", "Garantía no encontrada.");
  return warranty;
}

/**
 * Vincula un documento del proyecto a una garantía vigente. El documento debe estar en
 * «Documentos › Garantías» (o una subcarpeta) y puede respaldar varias garantías. Repetir el vínculo
 * no cambia nada. Queda auditado.
 *
 * @param {{ projectId: number, warrantyId: number, fileId: number, user: object }} request - Vínculo.
 * @returns {Promise<{ warrantyId: number, fileId: number, changed: boolean, linkedWarrantyIds: number[] }>} Estado.
 * @throws {NotFoundError|ConflictError} Garantía o archivo inexistentes, o regla incumplida.
 */
export async function linkWarrantyDocument({ fileId, projectId, user, warrantyId }) {
  return writeWarrantyLinks(projectId, async (client) => {
    const warranty = await requireWarranty(client, { projectId, warrantyId });
    const file = await lockProjectFileForLink(client, { fileId, projectId });
    if (!file || file.status === "deleted") throw new NotFoundError("FILE_NOT_FOUND", "No se encontro el archivo.");
    const linkedWarrantyIds = await listActiveWarrantyIdsForFile(client, fileId);
    const decision = evaluateWarrantyDocumentLink({ file, folderChain: await listFolderChain(client, file.folderId), linkedWarrantyIds, warranty });
    if (decision.reason === "ALREADY_LINKED") return { changed: false, fileId, linkedWarrantyIds, warrantyId };
    if (decision.outcome === "pending_decision") {
      throw new ConflictError("FILE_DECISION_PENDING", `Vincular este documento está pendiente de decisión (${decision.decision}).`);
    }
    if (decision.outcome !== "allowed") throw new ConflictError(...LINK_ERRORS[decision.reason]);
    const link = await insertWarrantyDocumentLink(client, { fileId, linkedBy: Number(user.id), projectId, warrantyId });
    await insertAuditLog({
      action: "project_warranty_document.linked",
      description: "Documento vinculado a una garantía.",
      entityId: link.id,
      entityType: "project_warranty_document",
      newValues: { fileId, projectId, warrantyId },
      userId: Number(user.id),
    }, client);
    return { changed: true, fileId, linkedWarrantyIds: [...linkedWarrantyIds, warrantyId], warrantyId };
  });
}

/**
 * Desvincula un documento de una garantía vigente: cierra el vínculo y lo conserva como historial.
 * El archivo, sus versiones y sus objetos no cambian. Queda auditado.
 *
 * @param {{ projectId: number, warrantyId: number, fileId: number, user: object }} request - Vínculo.
 * @returns {Promise<{ warrantyId: number, fileId: number, changed: true, linkedWarrantyIds: number[] }>} Estado.
 * @throws {NotFoundError|ConflictError} Sin vínculo activo o garantía retirada.
 */
export async function unlinkWarrantyDocument({ fileId, projectId, user, warrantyId }) {
  return writeWarrantyLinks(projectId, async (client) => {
    const warranty = await requireWarranty(client, { projectId, warrantyId });
    // Los vínculos de una garantía retirada son evidencia de lo que respaldaba: no se modifican.
    if (warranty.retired) throw new ConflictError(...LINK_ERRORS.WARRANTY_RETIRED);
    const closed = await closeWarrantyDocumentLink(client, { fileId, projectId, unlinkedBy: Number(user.id), warrantyId });
    if (!closed) throw new NotFoundError("WARRANTY_DOCUMENT_LINK_NOT_FOUND", "El documento no está vinculado a esta garantía.");
    await insertAuditLog({
      action: "project_warranty_document.unlinked",
      description: "Documento desvinculado de una garantía.",
      entityId: closed.id,
      entityType: "project_warranty_document",
      newValues: { fileId, projectId, warrantyId },
      userId: Number(user.id),
    }, client);
    return { changed: true, fileId, linkedWarrantyIds: await listActiveWarrantyIdsForFile(client, fileId), warrantyId };
  });
}

/**
 * Regla de protección para cualquier cambio de carpeta de un archivo, con el proyecto ya bloqueado:
 * mientras respalde alguna garantía vigente, el documento debe seguir dentro de «Documentos ›
 * Garantías». Los vínculos de garantías retiradas no lo retienen. Sin revisión activada no hay vínculos.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ fileId: number, targetFolderId: number|null }} request - Archivo y carpeta destino.
 * @returns {Promise<void>}
 * @throws {ConflictError} WARRANTY_DOCUMENT_MOVE_FORBIDDEN si el destino queda fuera.
 */
export async function assertWarrantyDocumentMove(client, { fileId, targetFolderId }) {
  if (!isProjectFileReviewEnabled()) return;
  const activeLinkCount = (await listActiveWarrantyIdsForFile(client, fileId)).length;
  if (!activeLinkCount) return;
  const decision = evaluateWarrantyDocumentMove({ activeLinkCount, targetFolderChain: await listFolderChain(client, targetFolderId) });
  if (decision.outcome !== "allowed") {
    throw new ConflictError("WARRANTY_DOCUMENT_MOVE_FORBIDDEN", "El documento respalda garantías: debe permanecer en «Documentos › Garantías».");
  }
}

/**
 * Comprueba el acceso directo al proyecto (administrador; arquitecto asignado o responsable y cliente
 * propietario fuera de draft), el mismo que los comentarios. El escaparate no expone garantías.
 *
 * @param {number} projectId - Proyecto.
 * @param {object} user - Usuario autenticado.
 * @returns {Promise<boolean>} true si tiene acceso.
 */
async function hasDirectProjectAccess(projectId, user) {
  const access = getProjectAccessCondition(user);
  const result = await query(
    `select 1 from public.projects p where p.id = $${access.params.length + 1} and p.deleted_at is null and (${access.sql})`,
    [...access.params, projectId],
  );
  return result.rowCount > 0;
}

/**
 * Devuelve las garantías vigentes de un proyecto con sus documentos vinculados en la versión que el
 * usuario puede ver (política común): el equipo, la vigente; el cliente, la autorizada para él (o una
 * suya). Los documentos internos no aparecen en su respuesta; las garantías, siempre.
 *
 * @param {{ projectId: number, user: object }} request - Proyecto y usuario.
 * @returns {Promise<{ warranties: object[] }>} Garantías con documentos.
 * @throws {NotFoundError} Si el usuario no tiene acceso directo al proyecto.
 */
export async function getProjectWarranties({ projectId, user }) {
  if (!(await hasDirectProjectAccess(projectId, user))) throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  const { documents, warranties } = await listWarrantiesWithVisibleDocuments({ projectId, user });
  const byWarranty = new Map();
  for (const row of documents) {
    const warrantyId = Number(row.warranty_id);
    byWarranty.set(warrantyId, [...(byWarranty.get(warrantyId) || []), {
      contentType: row.content_type,
      extension: row.file_extension,
      fileId: Number(row.file_id),
      linkedAt: row.linked_at,
      name: row.name,
      size: row.file_size === null ? null : Number(row.file_size),
      versionId: Number(row.version_id),
      versionNumber: Number(row.version_number),
    }]);
  }
  return {
    warranties: warranties.map((row) => ({
      code: row.code,
      documents: byWarranty.get(Number(row.id)) || [],
      endDate: row.end_date,
      id: Number(row.id),
      model: row.model,
      product: row.product,
      serviceDate: row.service_date,
      startDate: row.start_date,
    })),
  };
}
