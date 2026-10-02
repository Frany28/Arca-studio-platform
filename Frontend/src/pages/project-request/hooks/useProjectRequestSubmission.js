import { useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { buildProjectRequestPayload } from "../../../utils/projectRequestValidation.js";

/**
 * Coordina borrador, uploads secuenciales y env?o final mediante la API de solicitudes.
 * Inicializa la vista recibida desde viewRequest y reutiliza el id inicial solo
 * para solicitudes changes_requested; conserva borrador y submissionId al reintentar.
 *
 * @param {Object} params - Datos del flujo y callback posterior.
 * @param {Object} params.form - Campos usados para construir el payload.
 * @param {Object|null} params.initialRequest - Solicitud inicial para recuperar un borrador corregible.
 * @param {Function} [params.onSubmitted] - Callback invocado tras el env?o exitoso; no se espera su resultado.
 * @param {Object|null} params.viewRequest - Solicitud para inicializar la vista recibida.
 * @returns {Object} Borrador, c?digo, modal, solicitud recibida, carga/error y acciones de env?o, vista y reset.
 */
export default function useProjectRequestSubmission({
  form,
  initialRequest,
  onSubmitted,
  viewRequest,
}) {
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [validationCode, setValidationCode] = useState("");
  const [isRequestReceived, setIsRequestReceived] = useState(Boolean(viewRequest));
  const [receivedRequest, setReceivedRequest] = useState(viewRequest);
  const [draftId, setDraftId] = useState(
    initialRequest?.status === "changes_requested" ? initialRequest.id : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submissionIdRef = useRef(null);

  const openValidation = () => {
    setSubmitError("");
    setValidationCode("");
    setIsValidationModalOpen(true);
  };

  const closeValidation = () => {
    if (!isSubmitting) {
      setIsValidationModalOpen(false);
    }
  };

  const showRequestForm = () => {
    setIsRequestReceived(false);
  };

  /**
   * Limpia modal, c?digo, vista recibida, borrador, error y submissionId local.
   * No elimina el borrador remoto ni reinicia los estados de formulario o archivos.
   *
   * @returns {void} Restablece el estado local indicado sin cambiar isSubmitting.
   */
  const resetSubmission = () => {
    setIsValidationModalOpen(false);
    setValidationCode("");
    setIsRequestReceived(false);
    setReceivedRequest(null);
    setDraftId(null);
    setSubmitError("");
    submissionIdRef.current = null;
  };

  /**
   * Comprueba localmente seis d?gitos y evita iniciar otro env?o mientras isSubmitting sea true.
   * Crea o actualiza el borrador, omite archivos uploaded y env?a tras completar los uploads.
   * El c?digo no se transmite a la API; los errores quedan en submitError y el item afectado.
   *
   * @param {string|number} code - Valor convertido a texto y validado por formato.
   * @param {Object} options - Archivos y actualizaci?n de su presentaci?n.
   * @param {Array} options.files - Items con id, file y status.
   * @param {Function} options.updateFileItem - Actualiza error, progreso y estado del item por id.
   * @returns {Promise<void>} Actualiza la vista recibida y llama onSubmitted tras ?xito; captura errores.
   */
  const submitValidation = async (code, { files, updateFileItem }) => {
    if (isSubmitting || !/^\d{6}$/.test(String(code ?? "").trim())) {
      return;
    }

    setValidationCode("");
    setIsSubmitting(true);
    setSubmitError("");

    try {
      if (!submissionIdRef.current) {
        submissionIdRef.current = window.crypto.randomUUID();
      }

      const payload = buildProjectRequestPayload(form, submissionIdRef.current);
      let nextDraftId = draftId;

      if (nextDraftId) {
        await api.projectRequests.update({
          payload: buildProjectRequestPayload(form),
          projectRequestId: nextDraftId,
        });
      } else {
        const created = await api.projectRequests.create(payload);
        nextDraftId = created?.projectRequest?.id;

        if (!nextDraftId) {
          throw new Error("No se pudo identificar el borrador de la solicitud.");
        }

        setDraftId(nextDraftId);
      }

      for (const item of files) {
        if (item.status === "uploaded") continue;

        updateFileItem(item.id, { error: "", progress: 0, status: "uploading" });

        try {
          await api.projectRequests.uploadFile({
            file: item.file,
            onUploadProgress: ({ progress }) => updateFileItem(item.id, { progress }),
            projectRequestId: nextDraftId,
          });
          updateFileItem(item.id, { progress: 100, status: "uploaded" });
        } catch (error) {
          updateFileItem(item.id, {
            error: error.message || "No se pudo subir el archivo.",
            status: "error",
          });
          throw error;
        }
      }

      const submitted = await api.projectRequests.submit(nextDraftId);
      setReceivedRequest(submitted?.projectRequest || null);
      setIsValidationModalOpen(false);
      setIsRequestReceived(true);
      onSubmitted?.();
    } catch (error) {
      setSubmitError(error.message || "No se pudo enviar la solicitud. Puedes reintentarlo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    closeValidation,
    draftId,
    isRequestReceived,
    isSubmitting,
    isValidationModalOpen,
    openValidation,
    receivedRequest,
    resetSubmission,
    setValidationCode,
    showRequestForm,
    submitError,
    submitValidation,
    validationCode,
  };
}
