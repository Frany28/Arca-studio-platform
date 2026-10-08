import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import { isAllowedProjectRequestType } from "../domain/projectRequest.js";
import { evaluateProjectCompatibility, publicCompatibility } from "../domain/projectRequestCompatibility.js";
import { buildProjectRequestMetrics } from "../domain/projectRequestEvaluation.js";
import {
  createProjectRequestDraft,
  findExistingProjectNameForClient,
  findProjectRequestBySubmissionId,
  findProjectRequestOwnedByUser,
  submitProjectRequestForUser,
  updateProjectRequestDraft,
} from "../repositories/projectRequestRepository.js";

/**
 * Exige el valor de cliente y detiene el flujo cuando la condición no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {void} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
function requireClient(user) {
  if (!user?.clientId) {
    throw new AppError({
      code: "CLIENT_REQUIRED",
      message: "Solo los clientes pueden gestionar solicitudes de proyecto.",
      status: 403,
    });
  }
}

/**
 * Transforma el registro de la solicitud a su contrato público.
 * Expone la compatibilidad persistida y calcula al vuelo la completitud y la viabilidad
 * financiera; son métricas separadas que no modifican ni se derivan del score.
 *
 * @param {object} record - Registro obtenido del repositorio de solicitudes.
 * @returns {object} Solicitud pública con `compatibility`, `completeness` y `financialViability`.
 */
export function toPublicProjectRequest(record) {
  const { compatibility, submissionId: _submissionId, ...projectRequest } = record;
  return {
    ...projectRequest,
    ...buildProjectRequestMetrics(record),
    compatibility: publicCompatibility(compatibility),
  };
}

/**
 * Rechaza tipos retirados salvo que se conserve el del registro previamente autorizado.
 * Protege creación y edición sin reclasificar solicitudes históricas ni cambiar sus métricas.
 *
 * @param {string} projectType - Tipo recibido en el payload validado.
 * @param {string|null} [previousType=null] - Tipo del registro accesible al usuario.
 * @returns {void} Finaliza cuando el tipo está permitido.
 * @throws {ValidationError} Cuando se intenta introducir un tipo retirado o desconocido.
 */
function assertAllowedProjectType(projectType, previousType = null) {
  if (!isAllowedProjectRequestType(projectType, previousType)) {
    throw new ValidationError("Selecciona un tipo de proyecto vigente.", {
      "body.projectType": "Este tipo solo puede conservarse en la solicitud histórica que ya lo utiliza.",
    });
  }
}

/**
 * Comprueba el valor de available nombre y rechaza la operación cuando no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @param {string} [excludeProjectRequestId] - Valor de `excludeProjectRequestId` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
async function assertAvailableName(user, payload, excludeProjectRequestId = null) {
  const existing = await findExistingProjectNameForClient(
    user.clientId,
    payload.projectName,
    { excludeProjectRequestId },
  );
  if (existing) {
    throw new ConflictError(
      "PROJECT_NAME_ALREADY_EXISTS",
      "Ya existe un proyecto o solicitud activa con ese nombre.",
    );
  }
}

/**
 * Crea una solicitud con tipo vigente y los datos validados recibidos.
 * Conserva idempotencia y unicidad del nombre; rechaza tipos retirados antes de guardar.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.payload - Valor de `options.payload` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function createProjectRequest({ payload, user }) {
  requireClient(user);
  assertAllowedProjectType(payload.projectType);
  const idempotentDraft = await findProjectRequestBySubmissionId(payload.submissionId, user);
  if (idempotentDraft) return toPublicProjectRequest(idempotentDraft);

  await assertAvailableName(user, payload);
  try {
    const draft = await createProjectRequestDraft(user, payload);
    return toPublicProjectRequest(draft);
  } catch (error) {
    if (error?.code === "23505") {
      const retryDraft = await findProjectRequestBySubmissionId(payload.submissionId, user);
      if (retryDraft) return toPublicProjectRequest(retryDraft);
      throw new ConflictError(
        "PROJECT_NAME_ALREADY_EXISTS",
        "Ya existe un proyecto o solicitud activa con ese nombre.",
        error,
      );
    }
    throw error;
  }
}

/**
 * Actualiza un borrador accesible conservando las reglas de acceso e integridad.
 * Permite mantener su tipo histórico o elegir uno vigente, sin asignar tipos retirados nuevos.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.payload - Valor de `options.payload` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function updateProjectRequest({ payload, projectRequestId, user }) {
  requireClient(user);
  const current = await findProjectRequestOwnedByUser(projectRequestId, user);
  if (!current || !["draft", "changes_requested"].includes(current.status)) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "No se encontró un borrador editable.",
    );
  }
  assertAllowedProjectType(payload.projectType, current.projectType);
  await assertAvailableName(user, payload, projectRequestId);
  let updated;
  try {
    updated = await updateProjectRequestDraft(projectRequestId, user, payload);
  } catch (error) {
    if (error?.code === "23505") {
      throw new ConflictError(
        "PROJECT_NAME_ALREADY_EXISTS",
        "Ya existe un proyecto o solicitud activa con ese nombre.",
        error,
      );
    }
    throw error;
  }
  if (!updated) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "No se encontró un borrador editable.",
    );
  }
  return toPublicProjectRequest(updated);
}

/**
 * Envía la solicitud de proyecto después de validar el estado y las reglas aplicables.
 * Calcula la compatibilidad vigente desde las respuestas guardadas (los adjuntos no puntúan)
 * y la persiste en PostgreSQL junto con el cambio de estado y su auditoría.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function submitProjectRequest({ projectRequestId, user }) {
  requireClient(user);
  const current = await findProjectRequestOwnedByUser(projectRequestId, user);
  if (!current) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "No se encontró la solicitud de proyecto.",
    );
  }
  if (
    ["pending_verification", "pending_review"].includes(current.status)
    && current.compatibility
  ) {
    return toPublicProjectRequest(current);
  }
  if (!["draft", "changes_requested"].includes(current.status)) {
    throw new AppError({
      code: "PROJECT_REQUEST_NOT_SUBMITTABLE",
      message: "La solicitud no se encuentra en un estado que permita enviarla.",
      status: 409,
    });
  }

  await assertAvailableName(user, current, projectRequestId);
  // Desde 3.2 los adjuntos no puntúan: la evaluación usa solo las respuestas guardadas.
  const evaluation = evaluateProjectCompatibility(current);
  let submitted;
  try {
    submitted = await submitProjectRequestForUser(projectRequestId, user, evaluation);
  } catch (error) {
    if (error?.code === "23505") {
      throw new ConflictError(
        "PROJECT_NAME_ALREADY_EXISTS",
        "Ya existe un proyecto o solicitud activa con ese nombre.",
        error,
      );
    }
    throw error;
  }
  return toPublicProjectRequest(submitted);
}
