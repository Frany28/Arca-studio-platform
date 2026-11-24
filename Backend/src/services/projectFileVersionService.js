import { randomUUID } from "node:crypto";

import { withTransaction } from "../config/db.js";
import {
  buildStorageFileUrl,
  buildStorageObjectKey,
  getFileExtension,
  sanitizeStorageFileName,
} from "../config/storage.js";
import {
  FILE_ACCESS_POLICY,
  FILE_STATUS,
  evaluateFileVersionAccess,
  evaluateVersionAuthoring,
  hasProjectStaffAccess,
  resolveClientAudienceOnApproval,
} from "../domain/projectFileAccess.js";
import { getShowcaseFileName } from "../domain/projectPublicView.js";
import {
  evaluateReviewTransition,
  evaluateReviewer,
  planNewVersion,
  resolveCurrentVersion,
  resolveInitialReviewStatus,
} from "../domain/projectFileReview.js";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import { getFileType, isFileVersionObjectRecorded } from "../repositories/fileRepository.js";
import {
  approvePendingFileVersion,
  findActiveAudienceGrants,
  findProjectFileContext,
  insertFileReviewNotification,
  insertPendingFileVersion,
  listFileVersions,
  rejectPendingFileVersion,
} from "../repositories/projectFileVersionRepository.js";
import { decodeCursor, encodeCursor, parsePageLimit } from "../utils/pagination.js";
import { objectStorage } from "./objectStorage.js";
import { assertOperationallyMutableProjectState } from "./projectMutationPolicy.js";
import { storeThenRecord } from "./storedUpload.js";

// Versiones y revisión de archivos de proyecto (Fase 1.2, B4). Solo se usa con la activación
// coordinada encendida (config/projectFileReview.js); las rutas responden 404 cuando está apagada.
//
// Reglas confirmadas: toda versión nueva nace pendiente (también la del administrador); una sola
// pendiente por archivo; reemplazar exige motivo; restaurar una versión aprobada crea una pendiente
// nueva que reutiliza su objeto; solo el administrador aprueba y rechaza (motivo de hasta 500
// caracteres); aprobar no comparte. Quién reemplaza y restaura aplica la propuesta PR5. Nada se
// borra: las versiones anteriores, rechazadas y sus objetos se conservan.

const FILE_NOT_FOUND_MESSAGE = "No se encontro el archivo en este proyecto.";

/**
 * Crea el 404 público de un archivo inexistente o inaccesible, sin revelar cuál de los dos es.
 * Lo usan todas las operaciones de versiones, igual que la descarga y la retirada de archivos.
 *
 * @returns {NotFoundError} Error 404 FILE_NOT_FOUND.
 */
function fileNotFound() {
  return new NotFoundError("FILE_NOT_FOUND", FILE_NOT_FOUND_MESSAGE);
}

/**
 * Traduce un rechazo del dominio de versiones a su error público.
 * Los motivos de entrada son errores de validación del campo indicado; los de estado, 409.
 *
 * @param {{ reason: string }} result - Resultado prohibido del dominio.
 * @param {string} field - Campo de validación del motivo del cambio o del rechazo.
 * @returns {Error} Error de aplicación.
 */
function toVersionRuleError(result, field) {
  switch (result.reason) {
    case "CHANGE_NOTE_REQUIRED":
      return new ValidationError(undefined, { [field]: "Indica el motivo del cambio." });
    case "CHANGE_NOTE_TOO_LONG":
      return new ValidationError(undefined, { [field]: "El motivo del cambio admite hasta 255 caracteres." });
    case "REJECTION_REASON_REQUIRED":
      return new ValidationError(undefined, { [field]: "Indica el motivo del rechazo." });
    case "REJECTION_REASON_TOO_LONG":
      return new ValidationError(undefined, { [field]: "El motivo del rechazo admite hasta 500 caracteres." });
    case "VERSION_PENDING_REVIEW":
      return new ConflictError("FILE_VERSION_PENDING_REVIEW", "El archivo ya tiene una versión pendiente de revisión.");
    case "VERSION_ALREADY_REVIEWED":
    case "LEGACY_VERSION_NOT_REVIEWABLE":
      return new ConflictError("FILE_VERSION_NOT_PENDING", "La versión no está pendiente de revisión.");
    case "RESTORE_SOURCE_NOT_APPROVED":
      return new ConflictError("FILE_VERSION_NOT_APPROVED", "Solo se puede restaurar una versión aprobada.");
    case "RESTORE_SOURCE_NOT_FOUND":
      return new NotFoundError("FILE_VERSION_NOT_FOUND", "No se encontró la versión.");
    default:
      return new ConflictError("FILE_VERSION_CONFLICT", "No se pudo registrar la versión. Recarga el historial e inténtalo de nuevo.");
  }
}

/**
 * Comprueba que un usuario puede crear una versión nueva de un archivo: archivo activo con la
 * política 1.2, acceso según la propuesta PR5 y proyecto no de solo lectura (un draft solo para el
 * administrador). Un archivo heredado no admite versiones hasta su compatibilidad.
 *
 * @param {{ file: object, project: object }|null} context - Archivo y proyecto.
 * @param {object} user - Usuario autenticado.
 * @returns {void}
 * @throws {NotFoundError|ConflictError} Si el archivo no es alcanzable o no admite versiones.
 */
function assertCanAuthorVersion(context, user) {
  if (!context || context.file.status !== FILE_STATUS.ACTIVE || context.file.deletedAt) throw fileNotFound();
  const actor = toActor(user);
  if (evaluateVersionAuthoring(actor, context.project, context.file).outcome !== "allowed") throw fileNotFound();
  assertOperationallyMutableProjectState(context.project, { allowDraft: actor.role === "admin" });
  if (context.file.accessPolicy !== FILE_ACCESS_POLICY.PHASE_1_2) {
    throw new ConflictError(
      "FILE_VERSIONING_UNAVAILABLE",
      "Este archivo usa todavía la regla de acceso anterior y no admite versiones nuevas hasta completar su compatibilidad.",
    );
  }
}

/**
 * Adapta el usuario autenticado al actor de las reglas del dominio.
 * Las reglas de acceso solo necesitan su id, su rol y, en un cliente, su cliente.
 *
 * @param {{ id: number, clientId?: number|null, role?: { code?: string } }} user - Usuario autenticado.
 * @returns {{ id: number, role: string, clientId: number|null }} Actor.
 */
function toActor(user) {
  return { clientId: user?.clientId ?? null, id: Number(user?.id), role: user?.role?.code ?? "" };
}

/**
 * Registra en auditoría una operación sobre una versión, dentro de la transacción en curso.
 * Si la auditoría falla, la transacción entera se revierte y la operación no se aplica.
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {object} entry - Registro de auditoría.
 * @param {string} entry.action - Acción (`project_file.version_*`).
 * @param {string} entry.description - Descripción legible.
 * @param {object} entry.newValues - Valores resultantes.
 * @param {object|null} [entry.oldValues] - Valores anteriores.
 * @param {number} entry.userId - Usuario responsable.
 * @param {number} entry.versionId - Versión afectada.
 * @returns {Promise<number>} Id del registro.
 */
function auditVersion(client, { action, description, newValues, oldValues = null, userId, versionId }) {
  return insertAuditLog({ action, description, entityId: versionId, entityType: "file_version", newValues, oldValues, userId }, client);
}

/**
 * Sube el contenido de una versión nueva (reemplazo) y la registra pendiente de revisión.
 * Transfiere el objeto sin retener conexiones con una clave única por intento; después, con el
 * archivo bloqueado, repite permisos, estado, «una sola pendiente» y el número de versión. Si el
 * registro falla, el objeto se descarta solo si ninguna versión lo registró (compensación verificada).
 *
 * @param {object} request - Datos del reemplazo.
 * @param {number} request.projectId - Proyecto.
 * @param {number} request.fileId - Archivo.
 * @param {object} request.user - Usuario autenticado.
 * @param {string} request.changeNote - Motivo del cambio.
 * @param {{ body: unknown, contentType: string, originalName: string, size: number }} request.upload - Contenido validado.
 * @returns {Promise<object>} Versión pendiente creada.
 * @throws {NotFoundError|ConflictError|ValidationError} Si no se puede crear la versión.
 */
export async function replaceProjectFileVersion({ changeNote, fileId, projectId, upload, user }) {
  const actor = toActor(user);
  const context = await findProjectFileContext({ fileId, projectId, userId: actor.id });
  assertCanAuthorVersion(context, user);
  if (resolveInitialReviewStatus({ uploaderRole: actor.role }).outcome !== "allowed") throw fileNotFound();
  const plan = planNewVersion({ changeNote, kind: "replace", versions: await listFileVersions(fileId) });
  if (plan.outcome !== "allowed") throw toVersionRuleError(plan, "headers.x-change-note");

  const originalName = String(upload.originalName || "archivo").trim();
  const contentType = getFileType(upload.contentType, originalName);
  const storageKey = buildStorageObjectKey({
    attemptId: randomUUID().replaceAll("-", "").slice(0, 12),
    belongsTo: "projects",
    fileId,
    originalName,
    ownerId: actor.id,
    parentId: projectId,
    uploadedAt: new Date(),
    versionNumber: plan.versionNumber,
  });

  return storeThenRecord({
    /**
     * Comprueba si alguna versión registró la clave de este intento antes de compensar.
     *
     * @returns {Promise<boolean>} true si el objeto quedó registrado.
     */
    isRecorded: () => isFileVersionObjectRecorded(storageKey),
    key: storageKey,
    scope: "project_file_version",
    /**
     * Transfiere el contenido de la versión nueva sin conexiones de PostgreSQL abiertas.
     *
     * @returns {Promise<unknown>} Respuesta del almacenamiento.
     */
    store: () => objectStorage.put({
      body: upload.body,
      contentLength: upload.size,
      contentType,
      key: storageKey,
      metadata: { belongs_to: "project", file_id: String(fileId), project_id: String(projectId), uploaded_by: String(actor.id) },
    }),
    /**
     * Registra la versión con el archivo bloqueado y repite todas las comprobaciones.
     *
     * @returns {Promise<object>} Versión creada.
     */
    record: () => withTransaction(async (client) => {
      const locked = await findProjectFileContext({ fileId, lock: true, projectId, userId: actor.id }, client);
      assertCanAuthorVersion(locked, user);
      const lockedPlan = planNewVersion({ changeNote, kind: "replace", versions: await listFileVersions(fileId, client) });
      if (lockedPlan.outcome !== "allowed") throw toVersionRuleError(lockedPlan, "headers.x-change-note");
      // La clave ya contiene el número planificado: si otra versión lo ocupó, se rechaza y se compensa.
      if (lockedPlan.versionNumber !== plan.versionNumber) throw toVersionRuleError({ reason: "VERSION_NUMBER_TAKEN" });
      const version = await insertPendingFileVersion(client, {
        changeNote: lockedPlan.changeNote,
        contentType,
        extension: getFileExtension(originalName),
        fileId,
        fileUrl: buildStorageFileUrl(storageKey),
        // Nombre legible para mostrar (U3); la clave de almacenamiento ya está saneada.
        originalName,
        restoredFromVersionId: null,
        size: upload.size,
        storageKey,
        uploadedBy: actor.id,
        versionNumber: lockedPlan.versionNumber,
      });
      await auditVersion(client, {
        action: "project_file.version_submitted",
        description: "Versión nueva de un archivo de proyecto pendiente de revisión.",
        newValues: { changeNote: version.changeNote, contentType, fileId, projectId, reviewStatus: "pending", versionNumber: version.versionNumber },
        userId: actor.id,
        versionId: version.id,
      });
      return toVersionView(version, { canSeeReview: true, currentVersionId: null });
    }),
  });
}

/**
 * Comprueba que el contenido de la versión que se restaura sigue en el almacenamiento antes de
 * registrar la nueva, que reutiliza su mismo objeto (no lo copia). Sin clave u objeto no se crea una
 * versión que no se podría revisar ni servir; un fallo del almacenamiento no se confunde con ausencia.
 *
 * @param {string|null} storageKey - Clave del objeto de la versión de origen.
 * @returns {Promise<void>}
 * @throws {ConflictError|AppError} FILE_VERSION_OBJECT_MISSING (409) o FILE_STORAGE_UNAVAILABLE (503).
 */
async function assertRestorableObject(storageKey) {
  /**
   * Error público del contenido ausente.
   *
   * @returns {ConflictError} 409 FILE_VERSION_OBJECT_MISSING.
   */
  const missing = () => new ConflictError("FILE_VERSION_OBJECT_MISSING", "El contenido de esa versión no está disponible en el almacenamiento: no se puede restaurar.");
  if (!storageKey) throw missing();
  let stored;
  try {
    stored = await objectStorage.head(storageKey, { bucket: process.env.SUPABASE_STORAGE_BUCKET });
  } catch (cause) {
    throw new AppError({ cause, code: "FILE_STORAGE_UNAVAILABLE", message: "No se pudo comprobar el contenido de la versión. Inténtalo de nuevo.", status: 503 });
  }
  if (!stored) throw missing();
}

/**
 * Restaura una versión aprobada creando una versión nueva pendiente que reutiliza su objeto
 * almacenado (misma clave, sin copiar) y registra su procedencia. Exige motivo, una sola pendiente
 * por archivo, que el usuario pueda ver la versión de origen y que su objeto siga almacenado.
 *
 * @param {object} request - Datos de la restauración.
 * @param {number} request.projectId - Proyecto.
 * @param {number} request.fileId - Archivo.
 * @param {number} request.versionId - Versión que se restaura.
 * @param {string} request.changeNote - Motivo del cambio.
 * @param {object} request.user - Usuario autenticado.
 * @returns {Promise<object>} Versión pendiente creada.
 * @throws {NotFoundError|ConflictError|ValidationError} Si no se puede restaurar.
 */
export async function restoreProjectFileVersion({ changeNote, fileId, projectId, user, versionId }) {
  const actor = toActor(user);
  return withTransaction(async (client) => {
    const context = await findProjectFileContext({ fileId, lock: true, projectId, userId: actor.id }, client);
    assertCanAuthorVersion(context, user);
    if (resolveInitialReviewStatus({ uploaderRole: actor.role }).outcome !== "allowed") throw fileNotFound();
    const versions = await listFileVersions(fileId, client);
    const source = versions.find((version) => version.id === Number(versionId));
    if (!source || !(await canViewVersion({ actor, context, executor: client, version: source, versions }))) {
      throw new NotFoundError("FILE_VERSION_NOT_FOUND", "No se encontró la versión.");
    }
    const plan = planNewVersion({ changeNote, kind: "restore", restoreFromVersionId: source.id, versions });
    if (plan.outcome !== "allowed") throw toVersionRuleError(plan, "body.changeNote");
    // Con el archivo bloqueado y el usuario ya autorizado: el contenido original debe existir.
    await assertRestorableObject(plan.storage.storageKey);
    const version = await insertPendingFileVersion(client, {
      changeNote: plan.changeNote,
      contentType: source.contentType ?? context.file.fileType,
      extension: source.extension,
      fileId,
      fileUrl: source.fileUrl,
      originalName: source.originalName,
      restoredFromVersionId: source.id,
      size: source.size,
      storageKey: plan.storage.storageKey,
      uploadedBy: actor.id,
      versionNumber: plan.versionNumber,
    });
    await auditVersion(client, {
      action: "project_file.version_restored",
      description: "Restauración de una versión aprobada como versión nueva pendiente.",
      newValues: { changeNote: version.changeNote, fileId, projectId, restoredFromVersionId: source.id, reviewStatus: "pending", versionNumber: version.versionNumber },
      userId: actor.id,
      versionId: version.id,
    });
    return toVersionView(version, { canSeeReview: true, currentVersionId: null });
  });
}

/**
 * Aprueba o rechaza una versión pendiente. Solo el administrador; el proyecto no puede ser de
 * solo lectura (un draft sí, porque lo configura el administrador). Aprobar convierte la versión en
 * la vigente y no comparte nada con el cliente; rechazar conserva la vigente y exige motivo.
 *
 * @param {object} request - Datos de la revisión.
 * @param {"approve"|"reject"} request.action - Acción.
 * @param {number} request.projectId - Proyecto.
 * @param {number} request.fileId - Archivo.
 * @param {number} request.versionId - Versión.
 * @param {string} [request.reason] - Motivo del rechazo.
 * @param {object} request.user - Administrador autenticado.
 * @returns {Promise<{ version: object, currentVersionId: number|null, sharedWithClient: false }>} Resultado.
 * @throws {NotFoundError|ConflictError|ValidationError} Si la revisión no procede.
 */
export async function reviewProjectFileVersion({ action, fileId, projectId, reason, user, versionId }) {
  const actor = toActor(user);
  return withTransaction(async (client) => {
    const context = await findProjectFileContext({ fileId, lock: true, projectId, userId: actor.id }, client);
    if (!context || context.file.status !== FILE_STATUS.ACTIVE || context.file.deletedAt) throw fileNotFound();
    const reviewer = evaluateReviewer({ hasStaffAccess: hasProjectStaffAccess(actor, context.project), role: actor.role });
    if (reviewer.outcome !== "allowed") throw fileNotFound();
    assertOperationallyMutableProjectState(context.project, { allowDraft: true });
    const versions = await listFileVersions(fileId, client);
    const target = versions.find((version) => version.id === Number(versionId));
    if (!target || target.deletedAt) throw new NotFoundError("FILE_VERSION_NOT_FOUND", "No se encontró la versión.");
    const transition = evaluateReviewTransition({ action, reason, version: target });
    if (transition.outcome !== "allowed") throw toVersionRuleError(transition, "body.reason");
    const previousCurrent = resolveCurrentVersion(versions);

    const reviewed = action === "approve"
      ? await approvePendingFileVersion(client, { fileId, reviewerId: actor.id, versionId: target.id })
      : await rejectPendingFileVersion(client, { fileId, reason: transition.rejectionReason, reviewerId: actor.id, versionId: target.id });
    if (!reviewed) throw toVersionRuleError({ reason: "VERSION_ALREADY_REVIEWED" });

    const currentVersionId = action === "approve" ? reviewed.id : previousCurrent?.id ?? null;
    await auditVersion(client, {
      action: action === "approve" ? "project_file.version_approved" : "project_file.version_rejected",
      description: action === "approve" ? "Aprobación de una versión de archivo de proyecto." : "Rechazo de una versión de archivo de proyecto.",
      newValues: {
        currentVersionId,
        fileId,
        projectId,
        reviewReason: reviewed.reviewReason,
        reviewStatus: reviewed.reviewStatus,
        // Regla confirmada (DA3): aprobar no comparte con el cliente.
        sharedWithClient: resolveClientAudienceOnApproval().sharesWithClient,
        versionNumber: reviewed.versionNumber,
      },
      oldValues: { currentVersionId: previousCurrent?.id ?? null, reviewStatus: "pending" },
      userId: actor.id,
      versionId: reviewed.id,
    });
    // Aviso a quien subió la versión (p. ej. el cliente), en la misma transacción que la decisión.
    await insertFileReviewNotification(client, {
      ...describeReviewNotification({ action, fileName: target.originalName || context.file.title, reason: reviewed.reviewReason, versionNumber: reviewed.versionNumber }),
      createdBy: actor.id,
      projectId: Number(projectId),
      userId: target.uploadedBy,
      versionId: reviewed.id,
    });
    return { currentVersionId, sharedWithClient: false, version: toVersionView(reviewed, { canSeeReview: true, currentVersionId }) };
  });
}

/**
 * Textos de la notificación de una revisión para quien subió la versión. Aprobar no comparte la
 * versión con nadie (DA3), así que el aviso no promete visibilidad; el rechazo incluye su motivo,
 * que el autor de la versión puede conocer.
 *
 * @param {{ action: "approve"|"reject", fileName: string, versionNumber: number, reason?: string|null }} review - Decisión.
 * @returns {{ title: string, message: string, type: string }} Notificación.
 */
export function describeReviewNotification({ action, fileName, reason = null, versionNumber }) {
  if (action === "approve") {
    return { message: `La versión V${versionNumber} de «${fileName}» fue aprobada por el equipo de ARCA Studio.`, title: "Archivo aprobado", type: "project_file.version_approved" };
  }
  return {
    // El motivo puede terminar en punto: se normaliza para no duplicarlo.
    message: `La versión V${versionNumber} de «${fileName}» fue rechazada. Motivo: ${String(reason ?? "").trim().replace(/[.\s]+$/, "")}. Puedes subir una versión corregida.`,
    title: "Archivo rechazado",
    type: "project_file.version_rejected",
  };
}

/**
 * Elige la versión vigente de un archivo según su política. En un archivo heredado es exactamente
 * la que usa el código anterior (`files.current_version`, no retirada); en uno de la Fase 1.2, la
 * aprobada de mayor número.
 *
 * @param {{ file: object }} context - Archivo y proyecto.
 * @param {object[]} versions - Todas las versiones del archivo.
 * @returns {object|null} Versión vigente o null.
 */
function resolveFileCurrentVersion(context, versions) {
  if (context.file.accessPolicy === FILE_ACCESS_POLICY.PHASE_1_2) return resolveCurrentVersion(versions);
  return versions.find((version) => version.versionNumber === context.file.currentVersion && !version.deletedAt) ?? null;
}

/**
 * Evalúa si el usuario puede ver una versión concreta con la política del archivo y las
 * autorizaciones activas. Las decisiones pendientes (D4, DA1) no conceden acceso.
 *
 * @param {object} request - Usuario, contexto, versión y versiones del archivo.
 * @param {object} request.actor - Actor del dominio.
 * @param {{ file: object, project: object }} request.context - Archivo y proyecto.
 * @param {object} request.version - Versión pedida.
 * @param {object[]} request.versions - Todas las versiones del archivo.
 * @param {{ query: Function }} [request.executor] - Pool o cliente.
 * @param {object} [request.grants] - Autorizaciones activas ya leídas.
 * @returns {Promise<object|false>} Resultado permitido del dominio o false.
 */
async function canViewVersion({ actor, context, executor, grants, version, versions }) {
  // Como la consulta anterior, un archivo con deleted_at nunca se sirve, sea cual sea su estado.
  if (context.file.deletedAt) return false;
  const active = grants ?? await findActiveAudienceGrants(context.file.id, executor);
  const access = evaluateFileVersionAccess({
    actor,
    currentVersionId: resolveFileCurrentVersion(context, versions)?.id ?? null,
    file: {
      ...context.file,
      clientVersionId: active.clientVersionId,
      showcaseVersionId: active.showcaseVersionIds.includes(version.id) ? version.id : null,
    },
    project: context.project,
    version,
  });
  return access.outcome === "allowed" ? access : false;
}

/**
 * Representa una versión para la API. El motivo del rechazo y el revisor solo se muestran a quien
 * puede ver los datos de revisión (equipo o autor de la versión).
 *
 * @param {object} version - Versión del repositorio.
 * @param {{ canSeeReview: boolean, currentVersionId: number|null }} options - Visibilidad y vigente.
 * @returns {object} Versión pública.
 */
function toVersionView(version, { canSeeReview, currentVersionId }) {
  return {
    changeNote: version.changeNote,
    contentType: version.contentType,
    createdAt: version.createdAt,
    extension: version.extension,
    id: version.id,
    isCurrent: currentVersionId !== null && version.id === currentVersionId,
    originalName: version.originalName,
    restoredFromVersionId: version.restoredFromVersionId,
    review: {
      reason: canSeeReview ? version.reviewReason : null,
      reviewedAt: version.reviewedAt,
      reviewerName: canSeeReview ? version.reviewerName : null,
      status: version.reviewStatus ?? "legacy",
    },
    size: version.size,
    uploadedBy: { id: version.uploadedBy, name: version.uploaderName },
    versionNumber: version.versionNumber,
  };
}

/**
 * Lista el historial de versiones que el usuario puede ver, de la más reciente a la más antigua,
 * con cursor por número de versión. El equipo ve todas; el autor, las suyas; el cliente, la
 * compartida con él. Un archivo sin ninguna versión visible responde 404.
 *
 * @param {object} request - Consulta.
 * @param {number} request.projectId - Proyecto.
 * @param {number} request.fileId - Archivo.
 * @param {object} request.user - Usuario autenticado.
 * @param {string} [request.cursor] - Cursor de la página anterior.
 * @param {number} [request.limit] - Tamaño de página (máximo 100).
 * @returns {Promise<{ currentVersionId: number|null, versions: object[], nextCursor: string|null }>} Página.
 * @throws {NotFoundError} Si el archivo no existe o no tiene versiones visibles para el usuario.
 */
export async function listProjectFileVersions({ cursor, fileId, limit, projectId, user }) {
  const actor = toActor(user);
  const context = await findProjectFileContext({ fileId, projectId, userId: actor.id });
  if (!context || context.file.status === FILE_STATUS.DELETED || context.file.deletedAt) throw fileNotFound();
  const versions = await listFileVersions(fileId);
  const grants = await findActiveAudienceGrants(fileId);
  const staff = hasProjectStaffAccess(actor, context.project);
  const visible = [];
  for (const version of versions) {
    if (await canViewVersion({ actor, context, grants, version, versions })) visible.push(version);
  }
  if (!visible.length) throw fileNotFound();

  const currentVersionId = resolveFileCurrentVersion(context, versions)?.id ?? null;
  const pageSize = parsePageLimit(limit);
  const after = decodeCursor(cursor);
  const remaining = after ? visible.filter((version) => version.versionNumber < Number(after[0])) : visible;
  const page = remaining.slice(0, pageSize);
  const last = page.at(-1);
  return {
    currentVersionId,
    nextCursor: remaining.length > pageSize && last ? encodeCursor([last.versionNumber, last.id]) : null,
    versions: page.map((version) => toVersionView(version, {
      canSeeReview: staff || version.uploadedBy === actor.id,
      currentVersionId,
    })),
  };
}

/**
 * Ordena las versiones candidatas a la descarga sin `versionId`, igual que la política SQL común
 * (utils/projectFileAudienceSql.js): heredado y equipo, la vigente; el resto, la autorizada al
 * cliente y después las demás de mayor a menor número (la primera visible es la que se sirve).
 *
 * @param {object} request - Actor, contexto, autorizaciones activas y versiones.
 * @param {object} request.actor - Actor del dominio.
 * @param {{ file: object, project: object }} request.context - Archivo y proyecto.
 * @param {{ clientVersionId: number|null }} request.grants - Autorizaciones activas.
 * @param {object[]} request.versions - Versiones del archivo.
 * @returns {object[]} Versiones en orden de preferencia.
 */
function defaultDownloadCandidates({ actor, context, grants, versions }) {
  const current = resolveFileCurrentVersion(context, versions);
  if (context.file.accessPolicy !== FILE_ACCESS_POLICY.PHASE_1_2 || hasProjectStaffAccess(actor, context.project)) {
    return current ? [current] : [];
  }
  const byNumber = [...versions].sort((left, right) => right.versionNumber - left.versionNumber);
  const shared = byNumber.find((version) => version.id === grants.clientVersionId);
  return shared ? [shared, ...byNumber.filter((version) => version !== shared)] : byNumber;
}

/**
 * Resuelve qué versión se descarga y con qué metadatos, con la política del archivo: sin
 * `versionId`, la visible preferente (vigente para el equipo, compartida para el cliente);
 * con él, esa versión si el usuario puede verla. Sirve el formato propio
 * de la versión (o el del archivo en las heredadas) y anonimiza el nombre en el escaparate.
 *
 * @param {{ fileId: number, projectId: number, user: object, versionId?: number }} request - Descarga.
 * @returns {Promise<object|null>} Datos para transmitir el objeto o null si no es accesible.
 */
export async function resolveProjectFileDownload({ fileId, projectId, user, versionId }) {
  const actor = toActor(user);
  const context = await findProjectFileContext({ fileId, projectId, userId: actor.id });
  if (!context) return null;
  const versions = await listFileVersions(fileId);
  const grants = await findActiveAudienceGrants(fileId);
  const candidates = versionId
    ? versions.filter((version) => version.id === Number(versionId))
    : defaultDownloadCandidates({ actor, context, grants, versions });
  let target = null;
  let access = false;
  for (const candidate of candidates) {
    access = await canViewVersion({ actor, context, grants, version: candidate, versions });
    if (access) {
      target = candidate;
      break;
    }
  }
  if (!target) return null;
  const fileType = target.contentType ?? context.file.fileType;
  const showcaseName = getShowcaseFileName({ extension: target.extension, fileType, id: context.file.id });
  return {
    // La ETag y la caché inmutable se calculan sobre la versión servida (su contenido no cambia).
    currentVersionId: target.id,
    directAccess: !access.anonymized,
    fileName: target.storageKey,
    fileSize: target.size,
    fileType,
    id: context.file.id,
    originalName: access.anonymized ? showcaseName : target.originalName || context.file.title || "archivo",
    title: access.anonymized ? showcaseName : context.file.title,
  };
}
