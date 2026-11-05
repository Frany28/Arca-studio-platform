import { useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { buildProjectRequestPayload } from "../../../utils/projectRequestValidation.js";

export const REQUEST_VIEWS = Object.freeze({ form: "form", status: "status", summary: "summary" });

// Estado de la emisión del código de validación que el backend envía al correo del cliente.
export const VERIFICATION_CODE_STATUS = Object.freeze({
  error: "error",
  idle: "idle",
  sending: "sending",
  sent: "sent",
});

/**
 * Coordina borrador, código de validación, uploads secuenciales y envío final con la API.
 *
 * Al abrir la validación guarda el borrador (lo crea o lo actualiza) y pide al backend un código
 * que se envía al correo del cliente; el código se puede reenviar. Al confirmar sube los adjuntos
 * pendientes y envía la solicitud con el código, que el backend verifica y consume: el envío no
 * puede omitir la validación. Conserva borrador y submissionId al reintentar, y reutiliza el id
 * inicial solo para solicitudes changes_requested (la corrección actualiza la misma solicitud).
 * La vista inicia en "status" con viewRequest; tras enviar pasa a "status" y desde ahí solo
 * alterna con "summary" (consulta de solo lectura), sin reabrir el formulario editable.
 *
 * @param {Object} params - Datos del flujo y callback posterior.
 * @param {Object} params.form - Campos usados para construir el payload.
 * @param {Object|null} params.initialRequest - Solicitud inicial para recuperar un borrador corregible.
 * @param {Function} [params.onSubmitted] - Callback invocado tras el envío exitoso; no se espera su resultado.
 * @param {Object|null} params.viewRequest - Solicitud para inicializar la vista recibida.
 * @returns {Object} Borrador, código, estado de su emisión, modal, solicitud recibida, carga/error
 *   y acciones de validación, reenvío, envío, vista y reset.
 */
export default function useProjectRequestSubmission({
  form,
  initialRequest,
  onSubmitted,
  viewRequest,
}) {
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [validationCode, setValidationCode] = useState("");
  // Vista activa: formulario editable, estado de la solicitud enviada o consulta de solo lectura.
  const [requestView, setRequestView] = useState(viewRequest ? REQUEST_VIEWS.status : REQUEST_VIEWS.form);
  const [receivedRequest, setReceivedRequest] = useState(viewRequest);
  const initialDraftId = initialRequest?.status === "changes_requested" ? initialRequest.id : null;
  const [draftId, setDraftId] = useState(initialDraftId);
  // Copia síncrona del borrador: la emisión del código y el envío ocurren en manejadores distintos.
  const draftIdRef = useRef(initialDraftId);
  const [codeStatus, setCodeStatus] = useState(VERIFICATION_CODE_STATUS.idle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submissionIdRef = useRef(null);
  // Descarta respuestas de emisiones anteriores (reapertura, reenvío o reset) para no mezclar estados.
  const codeRequestRef = useRef(0);

  /**
   * Registra el borrador remoto en el estado y en la copia síncrona.
   *
   * @param {number|string|null} id - Borrador creado o null al reiniciar.
   * @returns {void}
   */
  const rememberDraft = (id) => {
    draftIdRef.current = id;
    setDraftId(id);
  };

  /**
   * Crea el borrador con el submissionId idempotente o actualiza el existente con el formulario.
   *
   * @returns {Promise<number|string>} Id del borrador guardado.
   * @throws {Error} Error de la API o borrador sin identificador.
   */
  const saveDraft = async () => {
    if (!submissionIdRef.current) {
      submissionIdRef.current = window.crypto.randomUUID();
    }
    if (draftIdRef.current) {
      await api.projectRequests.update({
        payload: buildProjectRequestPayload(form),
        projectRequestId: draftIdRef.current,
      });
      return draftIdRef.current;
    }

    const created = await api.projectRequests.create(buildProjectRequestPayload(form, submissionIdRef.current));
    const createdId = created?.projectRequest?.id;
    if (!createdId) {
      throw new Error("No se pudo identificar el borrador de la solicitud.");
    }
    rememberDraft(createdId);
    return createdId;
  };

  /**
   * Pide al backend un código para el borrador; ignora la respuesta si otra emisión la reemplazó.
   *
   * @param {Function} getDraftId - Devuelve (o guarda y devuelve) el borrador del código.
   * @returns {Promise<void>} Actualiza codeStatus y submitError.
   */
  const issueCode = async (getDraftId) => {
    const requestId = codeRequestRef.current + 1;
    codeRequestRef.current = requestId;
    setCodeStatus(VERIFICATION_CODE_STATUS.sending);
    setSubmitError("");
    try {
      const projectRequestId = await getDraftId();
      await api.projectRequests.requestVerificationCode(projectRequestId);
      if (codeRequestRef.current === requestId) setCodeStatus(VERIFICATION_CODE_STATUS.sent);
    } catch (error) {
      if (codeRequestRef.current !== requestId) return;
      setCodeStatus(VERIFICATION_CODE_STATUS.error);
      setSubmitError(error.message || "No se pudo enviar el código de validación.");
    }
  };

  /**
   * Abre la validación: guarda el borrador con el formulario actual y envía el código al correo.
   *
   * @returns {void}
   */
  const openValidation = () => {
    setValidationCode("");
    setIsValidationModalOpen(true);
    void issueCode(saveDraft);
  };

  /**
   * Solicita otro código para el mismo borrador (o lo guarda si aún no existe).
   *
   * @returns {void}
   */
  const resendCode = () => {
    if (isSubmitting || codeStatus === VERIFICATION_CODE_STATUS.sending) return;
    setValidationCode("");
    void issueCode(() => draftIdRef.current || saveDraft());
  };

  const closeValidation = () => {
    if (!isSubmitting) {
      setIsValidationModalOpen(false);
    }
  };

  // Una solicitud enviada solo se consulta: desde estas vistas no se vuelve al formulario.
  const showRequestStatus = () => setRequestView(REQUEST_VIEWS.status);
  const showRequestSummary = () => setRequestView(REQUEST_VIEWS.summary);

  /**
   * Limpia modal, código, emisión, vista recibida, borrador, error y submissionId local.
   * No elimina el borrador remoto ni reinicia los estados de formulario o archivos.
   *
   * @returns {void} Restablece el estado local indicado sin cambiar isSubmitting.
   */
  const resetSubmission = () => {
    codeRequestRef.current += 1;
    setIsValidationModalOpen(false);
    setValidationCode("");
    setCodeStatus(VERIFICATION_CODE_STATUS.idle);
    setRequestView(REQUEST_VIEWS.form);
    setReceivedRequest(null);
    rememberDraft(null);
    setSubmitError("");
    submissionIdRef.current = null;
  };

  /**
   * Sube los adjuntos pendientes y envía la solicitud con el código de seis dígitos, que el
   * backend verifica y consume. Evita iniciar otro envío mientras isSubmitting sea true y
   * requiere un borrador guardado al abrir la validación. Un código incorrecto, vencido o
   * bloqueado deja el modal abierto con el motivo; los adjuntos ya subidos no se repiten.
   *
   * @param {string|number} code - Código recibido por correo.
   * @param {Object} options - Archivos y actualización de su presentación.
   * @param {Array} options.files - Items con id, file y status.
   * @param {Function} options.updateFileItem - Actualiza error, progreso, estado e id remoto del item.
   * @returns {Promise<void>} Actualiza la vista recibida y llama onSubmitted tras éxito; captura errores.
   */
  const submitValidation = async (code, { files, updateFileItem }) => {
    const verificationCode = String(code ?? "").trim();
    const projectRequestId = draftIdRef.current;
    if (isSubmitting || !projectRequestId || !/^\d{6}$/.test(verificationCode)) {
      return;
    }

    setValidationCode("");
    setIsSubmitting(true);
    setSubmitError("");

    try {
      for (const item of files) {
        if (item.status === "uploaded") continue;

        updateFileItem(item.id, { error: "", progress: 0, status: "uploading" });

        try {
          const uploaded = await api.projectRequests.uploadFile({
            file: item.file,
            onUploadProgress: ({ progress }) => updateFileItem(item.id, { progress }),
            projectRequestId,
          });
          // El id remoto permite eliminar el adjunto si el envío no termina y se corrige.
          updateFileItem(item.id, { progress: 100, remoteId: uploaded?.file?.id ?? null, status: "uploaded" });
        } catch (error) {
          updateFileItem(item.id, {
            error: error.message || "No se pudo subir el archivo.",
            status: "error",
          });
          throw error;
        }
      }

      const submitted = await api.projectRequests.submit(projectRequestId, verificationCode);
      setReceivedRequest(submitted?.projectRequest || null);
      setIsValidationModalOpen(false);
      setCodeStatus(VERIFICATION_CODE_STATUS.idle);
      setRequestView(REQUEST_VIEWS.status);
      onSubmitted?.();
    } catch (error) {
      setSubmitError(error.message || "No se pudo enviar la solicitud. Puedes reintentarlo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    closeValidation,
    codeStatus,
    draftId,
    isRequestReceived: requestView !== REQUEST_VIEWS.form,
    isSubmitting,
    isValidationModalOpen,
    openValidation,
    receivedRequest,
    requestView,
    resendCode,
    resetSubmission,
    setValidationCode,
    showRequestStatus,
    showRequestSummary,
    submitError,
    submitValidation,
    validationCode,
  };
}
