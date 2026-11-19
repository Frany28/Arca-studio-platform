import { WARRANTY_DOCUMENTS_FOLDER_KEY, resolveFolderClassification } from "./projectFolderCatalog.js";
import { FILE_STATUS, evaluateFileVersionAccess, hasProjectStaffAccess } from "./projectFileAccess.js";
import { fileRuleResult, pendingFileDecision } from "./projectFileDecisions.js";
import { resolveCurrentVersion } from "./projectFileReview.js";

// Documentos de garantías (Fase 1.2, B2). Dominio puro. Desde B8 lo aplican el vínculo y el movimiento
// de archivos (services/projectWarrantyService.js); la lectura usa la política común en SQL
// (utils/projectFileAudienceSql.js), que elige la misma versión que resolveWarrantyDocumentVersion.
//
// Reglas:
// - los documentos se guardan en el árbol del proyecto, en «Documentos › Garantías»
//   (`documents.warranties`) o en una carpeta personalizada dentro de ella;
// - un documento se vincula solo con garantías del mismo proyecto y puede respaldar varias;
// - el documento no tiene permisos propios: se resuelve con la política común de archivos. El equipo
//   recibe la versión vigente y el cliente, la versión que se le compartió;
// - sin versión compartida, o si se retira ese acceso, la garantía sigue visible y el documento se
//   omite (la descarga responde 404); el vínculo se conserva y reaparece al volver a compartirlo;
// - retirar una garantía conserva sus vínculos como historial y no admite vínculos nuevos.

/**
 * Indica si una carpeta está dentro de «Documentos › Garantías» según su cadena de ancestros.
 * Usa la carpeta predeterminada más cercana, así que las subcarpetas personalizadas también cuentan.
 *
 * @param {Array<{ systemKey: string|null }>} folderChain - Cadena desde la raíz hasta la carpeta del archivo.
 * @returns {boolean} true si el archivo está en la ubicación de garantías.
 */
export function isInWarrantyDocumentsFolder(folderChain) {
  return resolveFolderClassification(folderChain || []).systemKey === WARRANTY_DOCUMENTS_FOLDER_KEY;
}

/**
 * Evalúa si se puede vincular un documento a una garantía.
 * Exige el mismo proyecto, una garantía vigente, un archivo activo dentro de «Garantías» y que el
 * vínculo no exista ya. Un archivo archivado depende de DA1.
 *
 * @param {object} request - Garantía, archivo y vínculos activos.
 * @param {{ id: number, projectId: number, retired?: boolean }} request.warranty - Garantía.
 * @param {{ id: number, projectId: number, status: string }} request.file - Documento.
 * @param {Array<{ systemKey: string|null }>} request.folderChain - Ubicación del documento.
 * @param {number[]} [request.linkedWarrantyIds] - Garantías con vínculo activo con este documento.
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, decision?: string }} Resultado.
 */
export function evaluateWarrantyDocumentLink({ file, folderChain, linkedWarrantyIds = [], warranty }) {
  if (Number(warranty.projectId) !== Number(file.projectId)) return fileRuleResult("forbidden", "WARRANTY_FROM_OTHER_PROJECT");
  if (warranty.retired) return fileRuleResult("forbidden", "WARRANTY_RETIRED");
  if (file.status === FILE_STATUS.ARCHIVED) return pendingFileDecision("DA1", "ARCHIVED_FILE_LINK_UNDECIDED");
  if (file.status !== FILE_STATUS.ACTIVE) return fileRuleResult("forbidden", "FILE_NOT_ACTIVE");
  if (!isInWarrantyDocumentsFolder(folderChain)) return fileRuleResult("forbidden", "FILE_OUTSIDE_WARRANTY_FOLDER");
  if (linkedWarrantyIds.map(Number).includes(Number(warranty.id))) return fileRuleResult("forbidden", "ALREADY_LINKED");
  return fileRuleResult("allowed", "WARRANTY_DOCUMENT_LINKABLE");
}

/**
 * Evalúa si un documento con vínculos activos puede moverse a otra carpeta.
 * Mientras respalde alguna garantía debe seguir dentro de «Garantías».
 *
 * @param {{ activeLinkCount: number, targetFolderChain: Array<{ systemKey: string|null }> }} request - Vínculos y destino.
 * @returns {{ outcome: "allowed"|"forbidden", reason: string }} Resultado.
 */
export function evaluateWarrantyDocumentMove({ activeLinkCount, targetFolderChain }) {
  if (activeLinkCount > 0 && !isInWarrantyDocumentsFolder(targetFolderChain)) {
    return fileRuleResult("forbidden", "LINKED_DOCUMENT_MUST_STAY_IN_WARRANTY_FOLDER");
  }
  return fileRuleResult("allowed", "MOVE_KEEPS_WARRANTY_LINKS");
}

/**
 * Elige qué versión de un documento vinculado recibe un usuario, con la política común de archivos.
 * El equipo recibe la versión vigente; el resto, la versión vigente si el archivo es heredado o la
 * versión compartida con el cliente si sigue la política 1.2. Si no puede verla, el documento se
 * omite sin revelar por qué (la garantía sigue visible).
 *
 * @param {object} request - Usuario, proyecto, archivo y versiones.
 * @param {object} request.actor - Usuario autenticado.
 * @param {object} request.project - Proyecto (ver `projectFileAccess.js`).
 * @param {object} request.file - Archivo vinculado.
 * @param {Array<object>} request.versions - Versiones del archivo.
 * @returns {{ visible: boolean, versionId: number|null, access: object|null }} Versión visible o documento omitido.
 */
export function resolveWarrantyDocumentVersion({ actor, file, project, versions }) {
  const current = resolveCurrentVersion(versions);
  const legacy = file.accessPolicy === null || file.accessPolicy === undefined;
  const candidate = hasProjectStaffAccess(actor, project) || legacy
    ? current
    : (versions || []).find((version) => Number(version.id) === Number(file.clientVersionId)) ?? null;
  if (!candidate) return { access: null, versionId: null, visible: false };
  const access = evaluateFileVersionAccess({ actor, currentVersionId: current?.id ?? null, file, project, version: candidate });
  // El escaparate nunca expone documentos de garantía, aunque el archivo fuera una imagen.
  const visible = access.outcome === "allowed" && access.audience !== "showcase";
  return { access, versionId: visible ? Number(candidate.id) : null, visible };
}
