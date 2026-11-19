import { isProjectFileReviewEnabled } from "../config/projectFileReview.js";
import { canReceiveCommentAudience, classifyCommentAudience } from "../domain/projectCommentAudience.js";
import { findCommentAudienceTarget } from "../repositories/projectCommentAudienceRepository.js";
import { publishProjectEvent, publishProjectEventToRecipients } from "./projectEvents.js";

/*
 * Eventos SSE de comentarios y de cambios de acceso (Fase 1.2, B6).
 *
 * Se publican siempre después de confirmar la transacción que los origina: quien llama lo hace cuando
 * el repositorio o el servicio ya devolvieron (commit hecho); un rollback lanza antes y no publica
 * nada. La publicación es complementaria: el estado está en PostgreSQL y el frontend se pone al día
 * con lecturas incrementales y de respaldo, así que un fallo al publicar se registra
 * (`project_event_publish_failed`) y nunca cambia la respuesta HTTP ya confirmada.
 *
 * - `project.comment.created`: cada destinatario recibe el comentario solo si puede verlo, con la
 *   audiencia leída en el momento de publicar y su usuario y acceso al proyecto revalidados.
 * - `project.access.changed`: sin contenido (solo proyecto y fecha). Indica que cambió qué versiones
 *   puede ver alguien; el cliente recarga la lista completa de comentarios y retira lo que ya no
 *   recibe. No revela archivos, versiones, nombres ni contadores.
 *
 * Con la activación apagada, `project.comment.created` se difunde como antes y no hay eventos de acceso.
 */

export const PROJECT_ACCESS_CHANGED_EVENT = "project.access.changed";
export const PROJECT_COMMENT_CREATED_EVENT = "project.comment.created";

/**
 * Registra un fallo de publicación sin datos del comentario ni del usuario, según la convención de
 * registros estructurados del backend. No relanza: la operación ya está confirmada.
 *
 * @param {string} eventName - Evento que no se pudo publicar.
 * @param {number} projectId - Proyecto.
 * @param {unknown} error - Error original.
 * @returns {void}
 */
function reportPublishFailure(eventName, projectId, error) {
  console.error(JSON.stringify({
    code: error?.code || error?.name || "UNKNOWN",
    eventName,
    projectId: Number(projectId),
    type: "project_event_publish_failed",
  }));
}

/**
 * Selector de contenido de un comentario: lo entrega solo a quien puede ver su audiencia.
 * Se evalúa por destinatario con su usuario vigente.
 *
 * @param {object} audience - Audiencia clasificada del comentario.
 * @param {object} comment - Comentario público.
 * @returns {(recipient: object) => object|null} Selector para publishProjectEventToRecipients.
 */
function commentPayloadFor(audience, comment) {
  return function selectCommentPayload(recipient) {
    return canReceiveCommentAudience(audience, recipient) ? { comment } : null;
  };
}

/**
 * Selector que entrega el mismo contenido sin datos sensibles a todo destinatario vigente.
 * Lo usa el aviso de cambio de acceso, que no contiene archivos, versiones ni contadores.
 *
 * @param {object} payload - Contenido común.
 * @returns {() => object} Selector para publishProjectEventToRecipients.
 */
function sameForEveryRecipient(payload) {
  return function selectSharedPayload() {
    return payload;
  };
}

/**
 * Publica un comentario recién confirmado. Con la revisión activada, lo entrega solo a los
 * destinatarios que pueden ver la versión que comenta; apagada, lo difunde como siempre.
 *
 * @param {{ comment: object, projectId: number }} options - Comentario creado y proyecto.
 * @returns {Promise<void>} Termina cuando se atendió a todos los destinatarios; nunca rechaza.
 */
export async function publishCommentCreated({ comment, projectId }) {
  try {
    if (!isProjectFileReviewEnabled()) {
      publishProjectEvent({ eventName: PROJECT_COMMENT_CREATED_EVENT, payload: { comment }, projectId });
      return;
    }
    const target = await findCommentAudienceTarget(comment.id);
    if (!target) return;
    const audience = classifyCommentAudience(target);
    await publishProjectEventToRecipients({
      eventName: PROJECT_COMMENT_CREATED_EVENT,
      projectId,
      selectPayload: commentPayloadFor(audience, comment),
    });
  } catch (error) {
    reportPublishFailure(PROJECT_COMMENT_CREATED_EVENT, projectId, error);
  }
}

/**
 * Avisa a los streams del proyecto de que cambió el acceso a sus versiones (autorización concedida,
 * sustituida o revocada). Cada destinatario se revalida antes de recibirlo.
 *
 * @param {{ projectId: number }} options - Proyecto afectado.
 * @returns {Promise<void>} Termina cuando se atendió a todos los destinatarios; nunca rechaza.
 */
export async function publishProjectAccessChanged({ projectId }) {
  try {
    if (!isProjectFileReviewEnabled()) return;
    const payload = { projectId: Number(projectId), timestamp: new Date().toISOString() };
    await publishProjectEventToRecipients({ eventName: PROJECT_ACCESS_CHANGED_EVENT, projectId, selectPayload: sameForEveryRecipient(payload) });
  } catch (error) {
    reportPublishFailure(PROJECT_ACCESS_CHANGED_EVENT, projectId, error);
  }
}
