import { fileRuleResult, pendingFileDecision } from "./projectFileDecisions.js";

// Revisión y versiones de archivos de proyecto (Fase 1.2, B2). Dominio puro, sin PostgreSQL ni
// almacenamiento; ningún flujo lo usa todavía. Clasificación, aprobación y visibilidad son
// independientes: este módulo solo decide estados de revisión y versiones; quién ve cada versión lo
// decide `projectFileAccess.js`.
//
// Reglas:
// - una versión se revisa una sola vez: pending → approved o pending → rejected (motivo obligatorio);
// - las versiones anteriores a la revisión (review_status NULL, «heredadas») cuentan como vigentes y
//   no se revisan;
// - la versión vigente es la aprobada (o heredada) de mayor número;
// - reemplazar y restaurar crean una versión nueva con motivo del cambio (Figma «Motivo del
//   cambio *»); restaurar reutiliza el objeto almacenado y conserva el historial completo;
// - propuestas pendientes de aprobación (FILE_PROPOSED_RULES): como máximo una versión pendiente
//   por archivo (PR1), solo se restauran versiones aprobadas distintas de la vigente (PR2) y el
//   motivo de rechazo admite hasta 500 caracteres (PR4);
// - quién aprueba (DA5) y la aprobación automática (DA2) siguen pendientes de decisión.

export const FILE_VERSION_REVIEW_STATUS = Object.freeze({
  APPROVED: "approved",
  PENDING: "pending",
  REJECTED: "rejected",
});

// Longitudes: `change_note` es VARCHAR(255) en file_versions. El límite de 500 del motivo de rechazo
// es la propuesta PR4: `review_reason` es TEXT en PostgreSQL y no impone ningún máximo.
export const CHANGE_NOTE_MAX_LENGTH = 255;
export const REVIEW_REASON_MAX_LENGTH = 500;

const NEW_VERSION_KINDS = new Set(["first_upload", "replace", "restore"]);

/**
 * Indica si una versión cuenta como aprobada para elegir la vigente o restaurarla.
 * Las heredadas (sin estado de revisión) se tratan como lo que son hoy: vigentes para su audiencia.
 *
 * @param {{ reviewStatus?: string|null, deletedAt?: unknown }} version - Versión.
 * @returns {boolean} true si está aprobada o es heredada y no está retirada.
 */
export function isVersionEffectivelyApproved(version) {
  if (!version || version.deletedAt) return false;
  return version.reviewStatus === null || version.reviewStatus === undefined || version.reviewStatus === FILE_VERSION_REVIEW_STATUS.APPROVED;
}

/**
 * Elige la versión vigente de un archivo: la aprobada (o heredada) de mayor número.
 * Una versión pendiente o rechazada nunca desplaza a la vigente.
 *
 * @param {Array<{ id: number, versionNumber: number, reviewStatus?: string|null, deletedAt?: unknown }>} versions - Versiones del archivo.
 * @returns {object|null} Versión vigente o null si ninguna está aprobada.
 */
export function resolveCurrentVersion(versions) {
  return (versions || [])
    .filter(isVersionEffectivelyApproved)
    .reduce((current, version) => (!current || version.versionNumber > current.versionNumber ? version : current), null);
}

/**
 * Normaliza un texto obligatorio y comprueba su longitud máxima.
 * Lo comparten el motivo del cambio y el motivo del rechazo.
 *
 * @param {unknown} value - Texto recibido.
 * @param {number} maxLength - Longitud máxima tras recortar.
 * @returns {{ text: string, error: "required"|"too_long"|null }} Texto recortado y su problema, si lo hay.
 */
function normalizeRequiredText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) return { error: "required", text };
  if (text.length > maxLength) return { error: "too_long", text };
  return { error: null, text };
}

/**
 * Evalúa aprobar o rechazar una versión según su estado de revisión.
 * Solo una versión pendiente se revisa; rechazar exige un motivo. No decide quién revisa (DA5).
 *
 * @param {object} request - Versión, acción y motivo.
 * @param {{ reviewStatus?: string|null }} request.version - Versión que se revisa.
 * @param {"approve"|"reject"} request.action - Acción solicitada.
 * @param {string} [request.reason] - Motivo del rechazo.
 * @returns {{ outcome: "allowed"|"forbidden", reason: string, nextStatus?: string, rejectionReason?: string }} Resultado.
 * @throws {Error} UNKNOWN_REVIEW_ACTION si la acción no es conocida.
 */
export function evaluateReviewTransition({ action, reason, version }) {
  if (action !== "approve" && action !== "reject") {
    throw Object.assign(new Error(`Acción de revisión desconocida: ${action}`), { code: "UNKNOWN_REVIEW_ACTION" });
  }
  const status = version?.reviewStatus ?? null;
  if (status === null) return fileRuleResult("forbidden", "LEGACY_VERSION_NOT_REVIEWABLE");
  if (status !== FILE_VERSION_REVIEW_STATUS.PENDING) return fileRuleResult("forbidden", "VERSION_ALREADY_REVIEWED");
  if (action === "approve") return fileRuleResult("allowed", "VERSION_APPROVED", { nextStatus: FILE_VERSION_REVIEW_STATUS.APPROVED });

  const { error, text } = normalizeRequiredText(reason, REVIEW_REASON_MAX_LENGTH);
  if (error === "required") return fileRuleResult("forbidden", "REJECTION_REASON_REQUIRED");
  if (error === "too_long") return fileRuleResult("forbidden", "REJECTION_REASON_TOO_LONG", { proposal: "PR4" });
  return fileRuleResult("allowed", "VERSION_REJECTED", { nextStatus: FILE_VERSION_REVIEW_STATUS.REJECTED, rejectionReason: text });
}

/**
 * Evalúa si un usuario puede revisar versiones de un proyecto.
 * Confirmado: hace falta acceso de equipo al proyecto (ver `hasProjectStaffAccess`). Con él, qué
 * roles revisan depende de DA5.
 *
 * @param {{ hasStaffAccess: boolean }} reviewer - Acceso de equipo del revisor al proyecto.
 * @returns {{ outcome: "forbidden"|"pending_decision", reason: string, decision?: string }} Resultado.
 */
export function evaluateReviewer({ hasStaffAccess }) {
  if (!hasStaffAccess) return fileRuleResult("forbidden", "REVIEWER_WITHOUT_PROJECT_ACCESS");
  return pendingFileDecision("DA5", "REVIEWER_ROLE_UNDECIDED");
}

/**
 * Decide el estado de revisión con que nace una versión según el rol de quien la sube.
 * La subida del arquitecto pasa por revisión (Figma, pestaña «Pendientes»); que las del
 * administrador o del cliente nazcan aprobadas depende de DA2.
 *
 * @param {{ uploaderRole: string }} upload - Rol de quien sube, reemplaza o restaura.
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, status?: string, decision?: string }} Resultado.
 */
export function resolveInitialReviewStatus({ uploaderRole }) {
  if (uploaderRole === "architect") {
    return fileRuleResult("allowed", "TEAM_UPLOAD_REQUIRES_REVIEW", { status: FILE_VERSION_REVIEW_STATUS.PENDING });
  }
  if (uploaderRole === "admin" || uploaderRole === "client") return pendingFileDecision("DA2", "AUTOMATIC_APPROVAL_UNDECIDED");
  return fileRuleResult("forbidden", "UPLOADER_ROLE_NOT_ALLOWED");
}

/**
 * Planifica la versión que crea una subida, un reemplazo o una restauración, sin escribir nada.
 * Reemplazar y restaurar exigen motivo y que no haya otra versión pendiente; restaurar solo admite
 * una versión aprobada distinta de la vigente y reutiliza su objeto almacenado (no lo copia).
 *
 * @param {object} request - Versiones existentes y operación.
 * @param {Array<{ id: number, versionNumber: number, reviewStatus?: string|null, storageKey?: string, deletedAt?: unknown }>} request.versions -
 *   Todas las versiones del archivo, incluidas las rechazadas y las retiradas heredadas.
 * @param {"first_upload"|"replace"|"restore"} request.kind - Operación.
 * @param {string} [request.changeNote] - Motivo del cambio (obligatorio al reemplazar y restaurar).
 * @param {number} [request.restoreFromVersionId] - Versión que se restaura.
 * @returns {{ outcome: "allowed"|"forbidden", reason: string, versionNumber?: number, storage?: object,
 *   restoredFromVersionId?: number|null, changeNote?: string|null }} Plan o motivo del rechazo.
 * @throws {Error} UNKNOWN_VERSION_KIND si la operación no es conocida.
 */
export function planNewVersion({ changeNote, kind, restoreFromVersionId, versions = [] }) {
  if (!NEW_VERSION_KINDS.has(kind)) {
    throw Object.assign(new Error(`Operación de versión desconocida: ${kind}`), { code: "UNKNOWN_VERSION_KIND" });
  }
  if (kind === "first_upload") {
    if (versions.length) return fileRuleResult("forbidden", "FILE_ALREADY_HAS_VERSIONS");
    const note = String(changeNote ?? "").trim();
    if (note.length > CHANGE_NOTE_MAX_LENGTH) return fileRuleResult("forbidden", "CHANGE_NOTE_TOO_LONG");
    return fileRuleResult("allowed", "FIRST_VERSION", { changeNote: note || null, restoredFromVersionId: null, storage: { mode: "new_object" }, versionNumber: 1 });
  }

  if (!versions.length) return fileRuleResult("forbidden", "FILE_HAS_NO_VERSIONS");
  const note = normalizeRequiredText(changeNote, CHANGE_NOTE_MAX_LENGTH);
  if (note.error === "required") return fileRuleResult("forbidden", "CHANGE_NOTE_REQUIRED");
  if (note.error === "too_long") return fileRuleResult("forbidden", "CHANGE_NOTE_TOO_LONG");
  // Propuesta PR1 (pendiente de aprobación): una sola versión pendiente por archivo.
  const hasPending = versions.some((version) => !version.deletedAt && version.reviewStatus === FILE_VERSION_REVIEW_STATUS.PENDING);
  if (hasPending) return fileRuleResult("forbidden", "VERSION_PENDING_REVIEW", { proposal: "PR1" });
  // La numeración cuenta todas las versiones: (file_id, version_number) es único y nada se reutiliza.
  const versionNumber = Math.max(...versions.map((version) => Number(version.versionNumber))) + 1;

  if (kind === "replace") {
    return fileRuleResult("allowed", "NEW_VERSION", { changeNote: note.text, restoredFromVersionId: null, storage: { mode: "new_object" }, versionNumber });
  }

  const source = versions.find((version) => Number(version.id) === Number(restoreFromVersionId));
  if (!source) return fileRuleResult("forbidden", "RESTORE_SOURCE_NOT_FOUND");
  // Propuesta PR2 (pendiente de aprobación): solo versiones aprobadas y distintas de la vigente.
  if (!isVersionEffectivelyApproved(source)) return fileRuleResult("forbidden", "RESTORE_SOURCE_NOT_APPROVED", { proposal: "PR2" });
  if (Number(resolveCurrentVersion(versions)?.id) === Number(source.id)) return fileRuleResult("forbidden", "RESTORE_SOURCE_IS_CURRENT", { proposal: "PR2" });
  return fileRuleResult("allowed", "RESTORED_VERSION", {
    changeNote: note.text,
    restoredFromVersionId: Number(source.id),
    storage: { mode: "reuse_object", storageKey: source.storageKey ?? null },
    versionNumber,
  });
}
