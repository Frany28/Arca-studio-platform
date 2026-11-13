import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import { buildProjectRequestMetrics } from "../domain/projectRequestEvaluation.js";
import { buildProjectRequestReviewObservations } from "../domain/projectRequestReviewObservations.js";
import { listProjectRequestFiles } from "../repositories/fileRepository.js";
import {
  decideProjectRequest as decideProjectRequestRecord,
  findProjectRequestForAdmin,
  listProjectRequestReviewQueue,
  upsertProjectRequestReview,
} from "../repositories/projectRequestWorkflowRepository.js";

/**
 * Sustituye las respuestas internas de una solicitud de la cola por sus métricas públicas.
 * Calcula al vuelo completitud, viabilidad financiera y las observaciones sin puntos para la
 * revisión inicial (solo para administración), sin exponer las respuestas completas.
 *
 * @param {{answers: object}} request - Solicitud mapeada por el repositorio.
 * @returns {object} Solicitud de la cola con `completeness`, `financialViability` y `reviewObservations`.
 */
function toPublicWorkflowRequest({ answers, ...request }) {
  return {
    ...request,
    ...buildProjectRequestMetrics(answers),
    reviewObservations: buildProjectRequestReviewObservations(answers),
  };
}

/**
 * Carga la cola de revisión de solicitudes con sus métricas de evaluación separadas.
 * Respeta el alcance y la paginación del repositorio; no altera la compatibilidad guardada.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.cursor - Valor de `options.cursor` requerido por esta operación.
 * @param {number} options.limit - Valor de `options.limit` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<{items: Array<object>, nextCursor: string|null}>} Página de la cola técnica.
 */
export async function loadProjectRequestReviewQueue({ cursor, limit, user }) {
  const page = await listProjectRequestReviewQueue({ cursor, limit, user });
  return { ...page, items: page.items.map(toPublicWorkflowRequest) };
}

/**
 * Obtiene una solicitud enviada por ID para la consulta administrativa, con sus métricas
 * calculadas (algoritmo vigente, sin persistirlas), observaciones de revisión, responsables,
 * revisiones, proyecto convertido y los metadatos de sus adjuntos (sin descargar contenido).
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {number|string} options.projectRequestId - Solicitud a consultar.
 * @returns {Promise<object>} Solicitud pública con `files` (id, nombre, tipo, tamaño y fecha).
 * @throws {NotFoundError} PROJECT_REQUEST_NOT_FOUND si no existe, está eliminada o es un borrador.
 */
export async function getAdminProjectRequestDetail({ projectRequestId }) {
  const record = await findProjectRequestForAdmin(projectRequestId);
  if (!record) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "Solicitud de proyecto no encontrada.",
    );
  }

  const files = await listProjectRequestFiles(record.id);
  return { ...toPublicWorkflowRequest(record), files };
}

/**
 * Guarda la valoración de workflow, la decisión de reunión y su justificación en PostgreSQL.
 * Conserva permisos y estado; omitir la decisión de reunión preserva el valor registrado.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.payload - Valor de `options.payload` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function submitProjectRequestReview({ payload, projectRequestId, user }) {
  const result = await upsertProjectRequestReview({
    meetingRecommendation: payload.meetingRecommendation,
    note: payload.note,
    projectRequestId,
    recommendation: payload.recommendation,
    reviewerId: user.id,
    reviewerRole: user.role?.code,
  });

  if (!result.targetExists) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "Solicitud de proyecto no encontrada.",
    );
  }
  if (result.status !== "pending_review") {
    throw new ConflictError(
      "PROJECT_REQUEST_CLOSED",
      "La solicitud no se encuentra en revisión.",
    );
  }
  if (!result.allowed) {
    throw new AppError({
      code: "PROJECT_REQUEST_REVIEW_FORBIDDEN",
      message: "Solo los arquitectos asignados pueden revisar esta solicitud.",
      status: 403,
    });
  }
  return result.review;
}

// Unicidad del nombre de proyecto por cliente (proyectos no cancelados ni eliminados, drafts incluidos).
const PROJECT_NAME_UNIQUE_CONSTRAINT = "uq_projects_client_active_name";

/**
 * Traduce únicamente el conflicto de nombre al convertir una solicitud aprobada en proyecto: el
 * cliente ya tiene un proyecto con ese nombre (por ejemplo, un draft creado desde una cotización
 * mientras la solicitud estaba en revisión). Cualquier otro error, incluido otro 23505, se propaga.
 *
 * @param {Error & { code?: string, constraint?: string }} error - Error de la decisión.
 * @returns {Error} ConflictError PROJECT_NAME_ALREADY_EXISTS o el error original.
 */
function translateProjectNameConflict(error) {
  if (error?.code === "23505" && error.constraint === PROJECT_NAME_UNIQUE_CONSTRAINT) {
    return new ConflictError(
      "PROJECT_NAME_ALREADY_EXISTS",
      "El cliente ya tiene un proyecto con el nombre de esta solicitud. Solicita correcciones para que el cliente cambie el nombre.",
      error,
    );
  }
  return error;
}

/**
 * Traduce la excepción de aprobación con revisiones desactualizadas: la confirmación y la
 * justificación deben llegar juntas; sin ambas no hay excepción.
 *
 * @param {object} payload - Cuerpo validado de la decisión.
 * @returns {{justification: string}|null} Excepción explícita o null.
 * @throws {ValidationError} Si solo llega una de las dos partes.
 */
function toOutdatedReviewsOverride(payload) {
  const acknowledged = payload.acknowledgeOutdatedReviews === true;
  const justification = payload.outdatedReviewsJustification || "";
  if (acknowledged !== Boolean(justification)) {
    throw new ValidationError("Confirma y justifica la aprobación con revisiones desactualizadas.", {
      [acknowledged ? "body.outdatedReviewsJustification" : "body.acknowledgeOutdatedReviews"]:
        "La confirmación y la justificación deben enviarse juntas.",
    });
  }
  return acknowledged ? { justification } : null;
}

/**
 * Aplica la decisión administrativa (aprobar, rechazar o solicitar correcciones) en PostgreSQL.
 * Aprobar con revisiones técnicas anteriores a la última edición relevante de la solicitud
 * exige una excepción explícita (confirmación y justificación) que queda auditada; sin ella
 * responde 409 PROJECT_REQUEST_REVIEWS_OUTDATED y no cambia nada.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.payload - Valor de `options.payload` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function applyProjectRequestDecision({
  payload,
  projectRequestId,
  user,
}) {
  let result;
  try {
    result = await decideProjectRequestRecord({
      action: payload.action,
      internalNotes: payload.internalNotes || null,
      outdatedReviewsOverride: payload.action === "approve" ? toOutdatedReviewsOverride(payload) : null,
      projectRequestId,
      reason: payload.reason || null,
      reviewedBy: user.id,
    });
  } catch (error) {
    throw translateProjectNameConflict(error);
  }

  if (result.outcome === "not_found") {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "Solicitud de proyecto no encontrada.",
    );
  }
  if (result.outcome === "outdated_reviews") {
    throw new ConflictError(
      "PROJECT_REQUEST_REVIEWS_OUTDATED",
      result.outdatedReviews === 1
        ? "Hay 1 revisión técnica anterior a los últimos cambios de la solicitud. Pide una revisión actualizada o confirma y justifica la aprobación."
        : `Hay ${result.outdatedReviews} revisiones técnicas anteriores a los últimos cambios de la solicitud. Pide una revisión actualizada o confirma y justifica la aprobación.`,
    );
  }
  if (result.outcome === "invalid_state") {
    throw new ConflictError(
      "PROJECT_REQUEST_INVALID_STATE",
      "Solo se pueden decidir solicitudes pendientes de evaluación o revisión.",
    );
  }
  return result;
}
