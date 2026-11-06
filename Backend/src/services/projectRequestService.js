import { withTransaction } from "../config/db.js";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import { isAllowedProjectRequestType } from "../domain/projectRequest.js";
import { toCurrentProjectType } from "../domain/projectRequestStand.js";
import { clientCompatibility, evaluateProjectCompatibility } from "../domain/projectRequestCompatibility.js";
import { buildProjectRequestMetrics } from "../domain/projectRequestEvaluation.js";
import { verifyAndConsumeProjectRequestCode } from "./projectRequestVerificationService.js";
import {
  findIncompleteProjectRequestFields,
  isEmptyProjectRequestDraftBody,
} from "../validation/projectRequestSchemas.js";
import {
  createEmptyProjectRequestDraft,
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
 * Expone de la compatibilidad persistida solo nivel y puntuación (hallazgos y observaciones son
 * internos de la revisión) y calcula al vuelo la completitud y la viabilidad financiera.
 *
 * @param {object} record - Registro obtenido del repositorio de solicitudes.
 * @returns {object} Solicitud pública con `compatibility`, `completeness` y `financialViability`.
 */
export function toPublicProjectRequest(record) {
  const { compatibility, submissionId: _submissionId, ...projectRequest } = record;
  return {
    ...projectRequest,
    ...buildProjectRequestMetrics(record),
    compatibility: clientCompatibility(compatibility),
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
 * Crea una solicitud con tipo vigente y los datos validados recibidos, o un borrador vacío cuando
 * solo llega `submissionId` (adjuntos antes de completar el formulario). Conserva idempotencia y
 * unicidad del nombre; rechaza tipos retirados antes de guardar.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {object} options.payload - Cuerpo validado (completo o solo `submissionId`).
 * @param {object} options.user - Cliente autenticado.
 * @returns {Promise<object>} Solicitud pública creada o existente con ese submissionId.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function createProjectRequest({ payload, user }) {
  requireClient(user);
  if (isEmptyProjectRequestDraftBody(payload)) {
    return toPublicProjectRequest(await createEmptyProjectRequestDraft(user, payload.submissionId));
  }
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
  // Renombramiento del identificador histórico de stands (Propuesta V3.3 §11): se guarda el
  // tipo vigente sobre la misma solicitud, que además es el único que admite requisitos del stand.
  const currentPayload = { ...payload, projectType: toCurrentProjectType(payload.projectType) };
  let updated;
  try {
    updated = await updateProjectRequestDraft(projectRequestId, user, currentPayload);
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
 * Exige el código de validación emitido para esta solicitud y este usuario: se verifica y se
 * consume en la misma transacción que el cambio de estado, con la fila bloqueada, de modo que
 * el envío no puede omitir la validación ni reutilizar un código. Un intento fallido se confirma
 * antes de responder el error. El reintento idempotente de una solicitud ya enviada no lo exige.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @param {string} options.verificationCode - Código de seis dígitos recibido por correo.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function submitProjectRequest({ projectRequestId, user, verificationCode }) {
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

  // Un borrador creado al adjuntar archivos puede no estar completo: se valida el registro entero
  // con las reglas del formulario antes de consumir el código o cambiar el estado.
  const incompleteFields = findIncompleteProjectRequestFields(current);
  if (incompleteFields) {
    throw new ValidationError("Completa la información de la solicitud antes de enviarla.", incompleteFields);
  }
  await assertAvailableName(user, current, projectRequestId);
  // Desde 3.2 los adjuntos no puntúan: la evaluación usa solo las respuestas guardadas.
  const evaluation = evaluateProjectCompatibility(current);
  let outcome;
  try {
    outcome = await withTransaction(async (client) => {
      const verificationError = await verifyAndConsumeProjectRequestCode(client, {
        code: verificationCode,
        projectRequestId,
        user,
      });
      if (verificationError) return { verificationError };
      return { submitted: await submitProjectRequestForUser(projectRequestId, user, evaluation, client) };
    });
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
  if (outcome.verificationError) throw outcome.verificationError;
  return toPublicProjectRequest(outcome.submitted);
}
