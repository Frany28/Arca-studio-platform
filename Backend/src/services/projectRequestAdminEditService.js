import { withTransaction } from "../config/db.js";
import { ConflictError, NotFoundError } from "../errors/appError.js";
import {
  ADMIN_EDITABLE_PROJECT_REQUEST_STATUSES,
  isProjectRequestEditableByAdmin,
  isSameProjectRequestVersion,
  listChangedProjectRequestAnswers,
  listReviewRelevantChanges,
} from "../domain/projectRequestAdminEdit.js";
import { evaluateProjectCompatibility } from "../domain/projectRequestCompatibility.js";
import { toCurrentProjectType } from "../domain/projectRequestStand.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import { listProjectRequestFiles } from "../repositories/fileRepository.js";
import {
  findProjectRequestForAdminEdit,
  updateProjectRequestAnswers,
  updateProjectRequestCompatibility,
} from "../repositories/projectRequestRepository.js";
import {
  assertAllowedProjectType,
  assertProjectRequestNameAvailable,
  toPublicProjectRequest,
} from "./projectRequestService.js";

// Señal interna: guardar sin cambios revierte la transacción para no mover la versión ni auditar.
const NO_CHANGES = Symbol("project-request-admin-edit-no-changes");

/**
 * Construye la representación editable de una solicitud para el formulario administrativo: las
 * respuestas en la forma de la consulta del propietario, sus métricas, los metadatos de los
 * adjuntos (sin contenido) y si la política permite editarla en su estado actual.
 *
 * @param {object} record - Registro de la solicitud (toProjectRequestRecord).
 * @param {Array<object>} files - Adjuntos de la solicitud (listProjectRequestFiles).
 * @returns {object} Solicitud con `files` y `editable`.
 */
function toAdminEditableProjectRequest(record, files) {
  return {
    ...toPublicProjectRequest(record),
    editable: isProjectRequestEditableByAdmin(record.status),
    files,
  };
}

/**
 * Error 404 común de la edición administrativa: la solicitud no existe, está eliminada o es un
 * borrador (que pertenece solo al cliente).
 *
 * @returns {NotFoundError} PROJECT_REQUEST_NOT_FOUND.
 */
function projectRequestNotFound() {
  return new NotFoundError("PROJECT_REQUEST_NOT_FOUND", "Solicitud de proyecto no encontrada.");
}

/**
 * Error 409 cuando el estado de la solicitud no admite edición administrativa: ya tiene una
 * decisión o está en manos del cliente (ver ADMIN_EDITABLE_PROJECT_REQUEST_STATUSES).
 *
 * @returns {ConflictError} PROJECT_REQUEST_NOT_EDITABLE.
 */
function projectRequestNotEditable() {
  return new ConflictError(
    "PROJECT_REQUEST_NOT_EDITABLE",
    "Solo se pueden editar solicitudes pendientes de evaluación o revisión.",
  );
}

/**
 * Lee una solicitud enviada por ID para precargar el formulario de edición administrativa. Se
 * puede consultar en cualquier estado no borrador; `editable` indica si además se puede guardar.
 *
 * @param {object} options - Opciones de la lectura.
 * @param {number|string} options.projectRequestId - Solicitud a consultar.
 * @returns {Promise<object>} Solicitud editable con respuestas, adjuntos, `updatedAt` y `editable`.
 * @throws {NotFoundError} PROJECT_REQUEST_NOT_FOUND si no existe, está eliminada o es un borrador.
 */
export async function getProjectRequestForAdminEdit({ projectRequestId }) {
  const record = await findProjectRequestForAdminEdit(projectRequestId);
  if (!record) throw projectRequestNotFound();
  return toAdminEditableProjectRequest(record, await listProjectRequestFiles(record.id));
}

/**
 * Guarda la edición administrativa de una solicitud en una transacción de PostgreSQL con la fila
 * bloqueada: exige un estado editable y la misma versión que se abrió (`expectedUpdatedAt`),
 * conserva el tipo histórico o uno vigente y la unicidad del nombre del cliente, sustituye solo
 * las respuestas del formulario, recalcula la compatibilidad derivada y audita los nombres de los
 * campos cambiados y cuáles afectan a la revisión técnica (las revisiones previas quedan marcadas
 * como anteriores a esos cambios, sin modificarse). No cambia el estado, el cliente, los responsables, las revisiones ni los
 * adjuntos, y no crea proyectos. Guardar sin cambios no escribe nada.
 *
 * @param {object} options - Datos de la edición.
 * @param {object} options.payload - Respuestas validadas y `expectedUpdatedAt`.
 * @param {number|string} options.projectRequestId - Solicitud a editar.
 * @param {{id: number}} options.user - Administrador autenticado.
 * @returns {Promise<{changedFields: Array<string>, projectRequest: object}>} Solicitud resultante y campos cambiados.
 * @throws {NotFoundError} PROJECT_REQUEST_NOT_FOUND si no existe o es un borrador.
 * @throws {ConflictError} PROJECT_REQUEST_NOT_EDITABLE, PROJECT_REQUEST_EDIT_CONFLICT o PROJECT_NAME_ALREADY_EXISTS.
 * @throws {ValidationError} Si se intenta introducir un tipo de proyecto retirado.
 */
export async function updateProjectRequestAsAdmin({ payload, projectRequestId, user }) {
  const { expectedUpdatedAt, ...answers } = payload;
  let unchanged = null;
  try {
    return await withTransaction(async (client) => {
      const current = await findProjectRequestForAdminEdit(projectRequestId, { executor: client, forUpdate: true });
      if (!current) throw projectRequestNotFound();
      if (!isProjectRequestEditableByAdmin(current.status)) throw projectRequestNotEditable();
      if (!isSameProjectRequestVersion(current.updatedAt, expectedUpdatedAt)) {
        throw new ConflictError(
          "PROJECT_REQUEST_EDIT_CONFLICT",
          "La solicitud cambió desde que abriste el formulario. Recárgala para ver la versión vigente antes de guardar.",
        );
      }
      assertAllowedProjectType(answers.projectType, current.projectType);
      await assertProjectRequestNameAvailable(current.clientId, answers.projectName, {
        excludeProjectRequestId: current.id,
        executor: client,
      });

      // Como en el formulario del cliente, el identificador histórico de stands se guarda como el vigente.
      const updated = await updateProjectRequestAnswers(
        current.id,
        { ...answers, projectType: toCurrentProjectType(answers.projectType) },
        ADMIN_EDITABLE_PROJECT_REQUEST_STATUSES,
        client,
      );
      if (!updated) throw projectRequestNotEditable();
      const changedFields = listChangedProjectRequestAnswers(current, updated);
      if (!changedFields.length) {
        unchanged = current;
        throw NO_CHANGES;
      }

      // Indicador derivado de las respuestas: se recalcula sin tocar decisiones ni revisiones.
      const evaluation = evaluateProjectCompatibility(updated);
      const evaluated = await updateProjectRequestCompatibility(current.id, evaluation, client);
      await insertAuditLog({
        action: "project_request.admin_update",
        description: "Solicitud editada por administración",
        entityId: current.id,
        entityType: "project_request",
        // Solo nombres de campos y la compatibilidad: las respuestas del cliente no se copian al registro.
        // `reviewRelevantFields` no vacío marca como anteriores las revisiones técnicas previas.
        newValues: {
          changedFields,
          compatibility: { level: evaluation.level, score: evaluation.score },
          reviewRelevantFields: listReviewRelevantChanges(changedFields),
        },
        oldValues: { compatibility: current.compatibility ? { level: current.compatibility.level, score: current.compatibility.score } : null, status: current.status },
        userId: user.id,
      }, client);
      const files = await listProjectRequestFiles(current.id, client);
      return { changedFields, projectRequest: toAdminEditableProjectRequest(evaluated, files) };
    });
  } catch (error) {
    if (error === NO_CHANGES) {
      return { changedFields: [], projectRequest: toAdminEditableProjectRequest(unchanged, await listProjectRequestFiles(unchanged.id)) };
    }
    if (error?.code === "23505") {
      throw new ConflictError("PROJECT_NAME_ALREADY_EXISTS", "Ya existe un proyecto o solicitud activa con ese nombre.", error);
    }
    throw error;
  }
}
