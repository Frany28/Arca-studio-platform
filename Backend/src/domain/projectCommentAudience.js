import { FILE_ACCESS_POLICY } from "./projectFileAccess.js";

/*
 * Audiencia de un comentario de proyecto (Fase 1.2, B6). Es la misma regla que
 * utils/projectCommentAudienceSql.js, expresada sin PostgreSQL para decidir qué destinatarios de un
 * evento SSE pueden recibir un comentario. Ambas versiones se comprueban juntas en
 * tests/projectCommentAudience.integration.test.js contra las descargas.
 *
 * Los destinatarios ya tienen acceso para comentar en el proyecto (se revalida al publicar), por lo
 * que «equipo» equivale a los roles admin y architect, y el resto es el cliente propietario.
 */

export const COMMENT_AUDIENCE_SCOPE = Object.freeze({
  // Comentario de archivo 1.2 sin versión inequívoca: el equipo y su autor (B9 decidirá su versión).
  AMBIGUOUS: "ambiguous",
  // General, sin archivo identificable o de archivo heredado: todo el proyecto (significado histórico).
  PROJECT: "project",
  // Comentario de una versión concreta de un archivo 1.2: la audiencia de esa versión.
  VERSION: "version",
});

const STAFF_ROLES = new Set(["admin", "architect"]);

/**
 * Clasifica la audiencia de un comentario a partir del archivo y la versión que comenta.
 * Los datos los aporta el repositorio con la misma resolución de archivo que el SQL común.
 *
 * @param {object} target - Comentario resuelto.
 * @param {number} target.authorId - Autor del comentario.
 * @param {{ accessPolicy: number|null }|null} target.file - Archivo comentado o null.
 * @param {number|null} target.fileVersionId - Versión comentada.
 * @param {number|null} [target.versionUploadedBy] - Autor de esa versión.
 * @param {number|null} [target.clientVersionId] - Versión con autorización activa del cliente.
 * @returns {{ scope: string, authorId: number, fileVersionId?: number, versionUploadedBy?: number|null, clientVersionId?: number|null }} Audiencia.
 */
export function classifyCommentAudience({ authorId, clientVersionId = null, file, fileVersionId, versionUploadedBy = null }) {
  if (!file || file.accessPolicy !== FILE_ACCESS_POLICY.PHASE_1_2) return { authorId, scope: COMMENT_AUDIENCE_SCOPE.PROJECT };
  if (!fileVersionId) return { authorId, scope: COMMENT_AUDIENCE_SCOPE.AMBIGUOUS };
  return { authorId, clientVersionId, fileVersionId, scope: COMMENT_AUDIENCE_SCOPE.VERSION, versionUploadedBy };
}

/**
 * Indica si un destinatario con acceso al proyecto puede recibir un comentario de esa audiencia.
 * Falla cerrado: una audiencia desconocida no se entrega a nadie salvo al equipo.
 *
 * @param {{ scope: string, authorId: number, fileVersionId?: number, versionUploadedBy?: number|null, clientVersionId?: number|null }} audience - Audiencia del comentario.
 * @param {{ id: number|string, role?: { code?: string } }} recipient - Usuario vigente del stream.
 * @returns {boolean} true si puede recibirlo.
 */
export function canReceiveCommentAudience(audience, recipient) {
  const recipientId = Number(recipient?.id);
  if (STAFF_ROLES.has(recipient?.role?.code)) return true;
  if (audience?.scope === COMMENT_AUDIENCE_SCOPE.PROJECT) return true;
  if (audience?.scope === COMMENT_AUDIENCE_SCOPE.AMBIGUOUS) return audience.authorId === recipientId;
  if (audience?.scope === COMMENT_AUDIENCE_SCOPE.VERSION) {
    return audience.fileVersionId === audience.clientVersionId || audience.versionUploadedBy === recipientId;
  }
  return false;
}
