import { useRef, useState } from "react";

import { api } from "../../../api/http.js";

export const REQUEST_VIEWS = Object.freeze({ form: "form", status: "status", summary: "summary" });

// Estado de la emisión del código de validación que el backend envía al correo del cliente.
export const VERIFICATION_CODE_STATUS = Object.freeze({
  error: "error",
  idle: "idle",
  sending: "sending",
  sent: "sent",
});

// Modo de validación que informa el backend al emitir el código. `test` es la validación temporal
// de staging para cuentas autorizadas: no se envía correo y se acepta cualquier código de 6 dígitos.
export const VERIFICATION_MODES = Object.freeze({ email: "email", test: "test" });

/**
 * Coordina código de validación y envío final con la API sobre el borrador compartido.
 *
 * Al abrir la validación guarda el formulario completo en el borrador (`draft.saveForm`, que lo
 * crea si aún no existe) y pide al backend un código para el correo del cliente; el código se
 * puede reenviar. Al confirmar solo envía la solicitud con el código, que el backend verifica y
 * consume: los adjuntos ya se subieron al seleccionarlos y no se vuelven a transferir, y el envío
 * se bloquea mientras haya archivos sin guardar (`blockedReason`). Un código incorrecto deja la
 * solicitud como borrador con sus adjuntos. Si el backend informa el modo de pruebas, no hay correo
 * ni reenvío. La vista inicia en "status" con viewRequest; tras enviar pasa a "status" y desde ahí
 * solo alterna con "summary" (consulta de solo lectura), sin reabrir el formulario editable.
 *
 * @param {Object} params - Datos del flujo y callback posterior.
 * @param {{draftId: number|string|null, ensureDraft: Function, saveForm: Function}} params.draft - Borrador compartido.
 * @param {Function} [params.onSubmitted] - Callback invocado tras el envío exitoso; no se espera su resultado.
 * @param {Object|null} params.viewRequest - Solicitud para inicializar la vista recibida.
 * @returns {Object} Código, estado y modo de su emisión, modal, solicitud recibida, carga/error y
 *   acciones de validación, reenvío, envío, vista y reset.
 */
export default function useProjectRequestSubmission({ draft, onSubmitted, viewRequest }) {
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [validationCode, setValidationCode] = useState("");
  // Vista activa: formulario editable, estado de la solicitud enviada o consulta de solo lectura.
  const [requestView, setRequestView] = useState(viewRequest ? REQUEST_VIEWS.status : REQUEST_VIEWS.form);
  const [receivedRequest, setReceivedRequest] = useState(viewRequest);
  const [codeStatus, setCodeStatus] = useState(VERIFICATION_CODE_STATUS.idle);
  const [verificationMode, setVerificationMode] = useState(VERIFICATION_MODES.email);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // Descarta respuestas de emisiones anteriores (reapertura, reenvío o reset) para no mezclar estados.
  const codeRequestRef = useRef(0);

  /**
   * Pide al backend un código para el borrador; ignora la respuesta si otra emisión la reemplazó.
   * VERIFICATION_CODE_RECENTLY_SENT (429) no es un fallo del envío: el código anterior sigue vigente
   * (guardar el borrador no lo invalida), así que la emisión queda como enviada y se muestra el plazo
   * del backend. Ocurre al reenviar o al cerrar y reabrir la validación antes del plazo.
   *
   * @param {Function} getDraftId - Devuelve (o guarda y devuelve) el borrador del código.
   * @returns {Promise<void>} Actualiza codeStatus, verificationMode y submitError.
   */
  const issueCode = async (getDraftId) => {
    const requestId = codeRequestRef.current + 1;
    codeRequestRef.current = requestId;
    setCodeStatus(VERIFICATION_CODE_STATUS.sending);
    setSubmitError("");
    try {
      const projectRequestId = await getDraftId();
      const response = await api.projectRequests.requestVerificationCode(projectRequestId);
      if (codeRequestRef.current !== requestId) return;
      setVerificationMode(response?.verification?.mode === VERIFICATION_MODES.test ? VERIFICATION_MODES.test : VERIFICATION_MODES.email);
      setCodeStatus(VERIFICATION_CODE_STATUS.sent);
    } catch (error) {
      if (codeRequestRef.current !== requestId) return;
      const codeStillValid = error?.code === "VERIFICATION_CODE_RECENTLY_SENT";
      setCodeStatus(codeStillValid ? VERIFICATION_CODE_STATUS.sent : VERIFICATION_CODE_STATUS.error);
      setSubmitError(error.message || "No se pudo enviar el código de validación.");
    }
  };

  /**
   * Abre la validación: guarda el formulario completo en el borrador y pide el código.
   *
   * @returns {void}
   */
  const openValidation = () => {
    setValidationCode("");
    setIsValidationModalOpen(true);
    void issueCode(draft.saveForm);
  };

  /**
   * Solicita otro código para el mismo borrador (o lo guarda si aún no existe). En modo de pruebas
   * no hay correo que reenviar.
   *
   * @returns {void}
   */
  const resendCode = () => {
    if (isSubmitting || codeStatus === VERIFICATION_CODE_STATUS.sending || verificationMode === VERIFICATION_MODES.test) return;
    setValidationCode("");
    void issueCode(() => draft.draftId || draft.saveForm());
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
   * Limpia modal, código, emisión, vista recibida y error. Conserva el borrador remoto y sus
   * adjuntos guardados (se eliminan con su botón) y no reinicia los estados de formulario o archivos.
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
    setSubmitError("");
  };

  /**
   * Envía la solicitud con el código de seis dígitos, que el backend verifica y consume. No sube
   * archivos: si alguno no está guardado (`blockedReason`), informa el motivo sin llamar a la API.
   * Evita iniciar otro envío mientras isSubmitting sea true y requiere el borrador guardado al
   * abrir la validación. Un código incorrecto, vencido o bloqueado deja el modal abierto con el
   * motivo, y la solicitud sigue como borrador con sus adjuntos.
   *
   * @param {string|number} code - Código recibido por correo (o cualquiera en modo de pruebas).
   * @param {Object} [options] - Estado de los adjuntos.
   * @param {string} [options.blockedReason=""] - Motivo por el que los adjuntos impiden enviar.
   * @returns {Promise<void>} Actualiza la vista recibida y llama onSubmitted tras éxito; captura errores.
   */
  const submitValidation = async (code, { blockedReason = "" } = {}) => {
    const verificationCode = String(code ?? "").trim();
    const projectRequestId = draft.draftId;
    if (isSubmitting || !projectRequestId || !/^\d{6}$/.test(verificationCode)) {
      return;
    }
    if (blockedReason) {
      setSubmitError(blockedReason);
      return;
    }

    setValidationCode("");
    setIsSubmitting(true);
    setSubmitError("");

    try {
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
    verificationMode,
  };
}
