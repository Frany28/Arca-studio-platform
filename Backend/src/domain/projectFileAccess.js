import { fileRuleResult, pendingFileDecision } from "./projectFileDecisions.js";
import { isVersionEffectivelyApproved } from "./projectFileReview.js";
import { isProjectDraft, isProjectFinalized } from "./projectStatus.js";

// Audiencias de las versiones de archivos de proyecto (Fase 1.2, B2). Dominio puro: describe quién
// puede ver cada versión; los listados, descargas, miniaturas, comentarios y SSE lo aplicarán en
// entregas posteriores. Ningún flujo lo usa todavía.
//
// Dos políticas conviven hasta completar la compatibilidad:
// - heredada (`accessPolicy` NULL): reproduce exactamente el acceso actual del código (versión
//   vigente para quien accede al proyecto; imágenes y videos vigentes de proyectos públicos);
// - 1.2 (`accessPolicy` 1): el equipo ve todas las versiones; el cliente propietario, la versión que
//   se le compartió (`clientVersionId`); el escaparate, la versión autorizada (`showcaseVersionId`).
//
// Regla unificada de versiones pendientes y rechazadas: las ve quien tiene acceso de equipo al
// proyecto o su autor mientras conserve el acceso al proyecto. Un draft solo existe para el
// administrador. Que un proyecto sea público nunca da acceso de equipo.

export const FILE_ACCESS_POLICY = Object.freeze({ LEGACY: null, PHASE_1_2: 1 });
export const FILE_STATUS = Object.freeze({ ACTIVE: "active", ARCHIVED: "archived", DELETED: "deleted" });

const SHOWCASE_MEDIA = /^(image|video)\//;

/**
 * Indica si el usuario tiene acceso de equipo al proyecto: administrador siempre (también en draft);
 * arquitecto asignado o responsable, salvo en un draft. La publicación del proyecto no cuenta.
 *
 * @param {{ id: number, role: string }} actor - Usuario autenticado.
 * @param {{ status: string, archivedFromStatus?: string|null, assignedArchitectId?: number|null, isAssignee?: boolean }} project -
 *   Proyecto; `isAssignee` indica si el usuario es responsable asignado.
 * @returns {boolean} true si tiene acceso de equipo.
 */
export function hasProjectStaffAccess(actor, project) {
  if (actor?.role === "admin") return true;
  if (actor?.role !== "architect" || isProjectDraft(project.status, project.archivedFromStatus)) return false;
  return Number(project.assignedArchitectId) === Number(actor.id) || project.isAssignee === true;
}

/**
 * Indica si el usuario es el cliente propietario del proyecto con acceso vigente (nunca en un draft).
 *
 * @param {{ role: string, clientId?: number|null }} actor - Usuario autenticado.
 * @param {{ status: string, archivedFromStatus?: string|null, clientId: number }} project - Proyecto.
 * @returns {boolean} true si es el propietario y el proyecto no es un draft.
 */
export function isProjectOwnerClient(actor, project) {
  return actor?.role === "client"
    && Boolean(actor.clientId)
    && Number(project.clientId) === Number(actor.clientId)
    && !isProjectDraft(project.status, project.archivedFromStatus);
}

/**
 * Evalúa con la política heredada, exactamente como el código actual: solo la versión vigente;
 * administrador siempre; equipo y propietario fuera de draft; los demás, imágenes y videos de un
 * proyecto público fuera de draft, con nombre anonimizado.
 *
 * @param {object} request - Usuario, proyecto, archivo, versión y versión vigente.
 * @param {{ id: number, role: string, clientId?: number|null }} request.actor - Usuario autenticado.
 * @param {number|null} request.currentVersionId - Versión vigente del archivo.
 * @param {{ fileType?: string }} request.file - Archivo.
 * @param {object} request.project - Proyecto (ver `hasProjectStaffAccess`) con `clientId` e `isPublic`.
 * @param {{ id: number }} request.version - Versión pedida.
 * @returns {{ outcome: "allowed"|"forbidden", reason: string, audience?: string, anonymized?: boolean }} Resultado.
 */
function evaluateLegacyAccess({ actor, currentVersionId, file, project, version }) {
  if (Number(version.id) !== Number(currentVersionId)) return fileRuleResult("forbidden", "LEGACY_ONLY_CURRENT_VERSION");
  if (actor?.role === "admin") return fileRuleResult("allowed", "LEGACY_DIRECT_ACCESS", { anonymized: false, audience: "team" });
  if (isProjectDraft(project.status, project.archivedFromStatus)) return fileRuleResult("forbidden", "PROJECT_DRAFT_HIDDEN");
  if (hasProjectStaffAccess(actor, project)) return fileRuleResult("allowed", "LEGACY_DIRECT_ACCESS", { anonymized: false, audience: "team" });
  if (isProjectOwnerClient(actor, project)) return fileRuleResult("allowed", "LEGACY_DIRECT_ACCESS", { anonymized: false, audience: "client" });
  const showcaseRole = actor?.role === "architect" || (actor?.role === "client" && actor.clientId);
  if (showcaseRole && project.isPublic === true && SHOWCASE_MEDIA.test(String(file.fileType ?? ""))) {
    return fileRuleResult("allowed", "LEGACY_SHOWCASE", { anonymized: true, audience: "showcase" });
  }
  return fileRuleResult("forbidden", "NO_PROJECT_ACCESS");
}

/**
 * Evalúa si un usuario puede ver una versión concreta de un archivo de proyecto.
 * Aplica la política del archivo (heredada o 1.2), la regla unificada de versiones pendientes y
 * rechazadas, la restricción de los drafts y las audiencias explícitas de cliente y escaparate.
 *
 * @param {object} request - Datos necesarios para decidir.
 * @param {{ id: number, role: string, clientId?: number|null }} request.actor - Usuario autenticado.
 * @param {object} request.project - Proyecto (ver `hasProjectStaffAccess`) con `clientId` e `isPublic`.
 * @param {{ status: string, accessPolicy: number|null, fileType?: string, clientVersionId?: number|null, showcaseVersionId?: number|null }} request.file -
 *   Archivo.
 * @param {{ id: number, uploadedBy: number, reviewStatus?: string|null, deletedAt?: unknown }} request.version - Versión pedida.
 * @param {number|null} request.currentVersionId - Versión vigente del archivo (`resolveCurrentVersion`).
 * @param {number[]} [request.previouslySharedVersionIds] - Versiones compartidas antes con el cliente.
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, audience?: string,
 *   anonymized?: boolean, decision?: string }} Resultado.
 */
export function evaluateFileVersionAccess({ actor, currentVersionId, file, previouslySharedVersionIds = [], project, version }) {
  if (file.status === FILE_STATUS.DELETED) return fileRuleResult("forbidden", "FILE_RETIRED_LEGACY");
  if (version.deletedAt) return fileRuleResult("forbidden", "VERSION_RETIRED_LEGACY");
  if (file.status === FILE_STATUS.ARCHIVED) return pendingFileDecision("DA1", "ARCHIVED_FILE_ACCESS_UNDECIDED");
  if (file.status !== FILE_STATUS.ACTIVE) return fileRuleResult("forbidden", "UNKNOWN_FILE_STATUS");
  if (file.accessPolicy === FILE_ACCESS_POLICY.LEGACY || file.accessPolicy === undefined) {
    return evaluateLegacyAccess({ actor, currentVersionId, file, project, version });
  }

  if (actor?.role !== "admin" && isProjectDraft(project.status, project.archivedFromStatus)) {
    return fileRuleResult("forbidden", "PROJECT_DRAFT_HIDDEN");
  }
  const staff = hasProjectStaffAccess(actor, project);
  const owner = isProjectOwnerClient(actor, project);
  const author = Number(version.uploadedBy) === Number(actor?.id) && (staff || owner);
  if (staff) return fileRuleResult("allowed", "TEAM_ACCESS", { anonymized: false, audience: "team" });
  if (author) return fileRuleResult("allowed", "VERSION_AUTHOR", { anonymized: false, audience: "author" });
  if (!isVersionEffectivelyApproved(version)) return fileRuleResult("forbidden", "VERSION_NOT_APPROVED");

  if (owner) {
    if (Number(version.id) === Number(file.clientVersionId)) {
      return fileRuleResult("allowed", "SHARED_WITH_CLIENT", { anonymized: false, audience: "client" });
    }
    if (previouslySharedVersionIds.map(Number).includes(Number(version.id))) {
      return pendingFileDecision("D4", "PREVIOUSLY_SHARED_VERSION_UNDECIDED");
    }
    return fileRuleResult("forbidden", "NOT_SHARED_WITH_CLIENT");
  }

  const showcaseVisible = project.isPublic === true
    && isProjectFinalized(project.status)
    && Number(version.id) === Number(file.showcaseVersionId)
    && SHOWCASE_MEDIA.test(String(file.fileType ?? ""));
  if (showcaseVisible) return fileRuleResult("allowed", "SHOWCASE_VERSION", { anonymized: true, audience: "showcase" });
  return fileRuleResult("forbidden", "NO_PROJECT_ACCESS");
}

/**
 * Evalúa un cambio de audiencia: compartir o dejar de compartir con el cliente propietario y
 * autorizar o retirar el escaparate. Aplica las condiciones confirmadas del plan (acceso de equipo,
 * versión aprobada del mismo archivo, escaparate solo para imágenes y videos de proyectos públicos
 * finalizados y ya compartidos con el cliente); quién puede hacerlo depende de D3 y los archivos
 * archivados, de DA1.
 *
 * @param {object} request - Datos del cambio.
 * @param {"share_with_client"|"unshare_with_client"|"set_showcase"|"remove_showcase"} request.action - Cambio.
 * @param {{ id: number, role: string }} request.actor - Usuario autenticado.
 * @param {object} request.project - Proyecto.
 * @param {{ status: string, fileType?: string, clientVersionId?: number|null }} request.file - Archivo.
 * @param {{ reviewStatus?: string|null, deletedAt?: unknown }|null} [request.version] - Versión destino (al compartir o autorizar).
 * @returns {{ outcome: "forbidden"|"pending_decision", reason: string, decision?: string }} Resultado.
 * @throws {Error} UNKNOWN_AUDIENCE_ACTION si la acción no es conocida.
 */
export function evaluateFileAudienceChange({ action, actor, file, project, version = null }) {
  const actions = ["share_with_client", "unshare_with_client", "set_showcase", "remove_showcase"];
  if (!actions.includes(action)) {
    throw Object.assign(new Error(`Cambio de audiencia desconocido: ${action}`), { code: "UNKNOWN_AUDIENCE_ACTION" });
  }
  if (!hasProjectStaffAccess(actor, project)) return fileRuleResult("forbidden", "NO_TEAM_ACCESS");
  if (file.status === FILE_STATUS.DELETED) return fileRuleResult("forbidden", "FILE_RETIRED_LEGACY");
  if (file.status === FILE_STATUS.ARCHIVED) return pendingFileDecision("DA1", "ARCHIVED_FILE_AUDIENCE_UNDECIDED");
  const grants = action === "share_with_client" || action === "set_showcase";
  if (grants && !isVersionEffectivelyApproved(version)) return fileRuleResult("forbidden", "VERSION_NOT_APPROVED");
  if (action === "set_showcase") {
    if (!(project.isPublic === true && isProjectFinalized(project.status))) return fileRuleResult("forbidden", "SHOWCASE_REQUIRES_PUBLIC_FINISHED_PROJECT");
    if (!SHOWCASE_MEDIA.test(String(file.fileType ?? ""))) return fileRuleResult("forbidden", "SHOWCASE_MEDIA_ONLY");
    // Propuesta PR3 (pendiente de aprobación): el escaparate depende de una autorización del cliente.
    if (!file.clientVersionId) return fileRuleResult("forbidden", "SHOWCASE_REQUIRES_CLIENT_SHARE", { proposal: "PR3" });
  }
  return pendingFileDecision("D3", "AUDIENCE_MANAGER_UNDECIDED");
}

/**
 * Describe qué ocurre con la audiencia del cliente al aprobar una versión.
 * Regla confirmada (DA3): aprobar no comparte; la autorización del cliente es una acción aparte.
 *
 * @returns {{ outcome: "allowed", reason: string, sharesWithClient: false }} Resultado confirmado.
 */
export function resolveClientAudienceOnApproval() {
  return fileRuleResult("allowed", "APPROVAL_DOES_NOT_SHARE", { sharesWithClient: false });
}

/**
 * Evalúa si un usuario puede crear una versión nueva de un archivo (reemplazar o restaurar).
 * Aplica la propuesta PR5 (sin confirmar): quien tiene acceso de equipo al proyecto, o el autor del
 * archivo mientras conserve el acceso al proyecto. Un draft solo existe para el administrador.
 *
 * @param {{ id: number, role: string, clientId?: number|null }} actor - Usuario autenticado.
 * @param {object} project - Proyecto (ver `hasProjectStaffAccess`).
 * @param {{ uploadedBy: number }} file - Archivo.
 * @returns {{ outcome: "allowed"|"forbidden", reason: string, proposal?: string }} Resultado.
 */
export function evaluateVersionAuthoring(actor, project, file) {
  if (hasProjectStaffAccess(actor, project)) return fileRuleResult("allowed", "TEAM_ACCESS", { proposal: "PR5" });
  const keepsAccess = isProjectOwnerClient(actor, project) || hasProjectStaffAccess(actor, project);
  if (keepsAccess && Number(file.uploadedBy) === Number(actor?.id)) return fileRuleResult("allowed", "FILE_AUTHOR", { proposal: "PR5" });
  return fileRuleResult("forbidden", "NOT_TEAM_OR_FILE_AUTHOR", { proposal: "PR5" });
}
