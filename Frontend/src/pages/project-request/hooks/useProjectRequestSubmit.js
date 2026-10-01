import { useRef, useState } from "react";
import { api } from "../../../api/http.js";
import { buildProjectRequestPayload } from "../../../utils/projectRequestValidation.js";

export function useProjectRequestSubmit({
  viewRequest,
  setIsSidebarExpanded,
  form,
  draftId,
  setDraftId,
  files,
  updateFileItem,
}) {
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);

  const [validationCode, setValidationCode] = useState("");

  const [isRequestReceived, setIsRequestReceived] = useState(Boolean(viewRequest));

  const [receivedRequest, setReceivedRequest] = useState(viewRequest);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [submitError, setSubmitError] = useState("");

  const submissionIdRef = useRef(null);

  const handleValidationSubmit = async (code) => {
    if (isSubmitting || !/^\d{6}$/.test(String(code ?? "").trim())) {
      return;
    }
    setValidationCode("");
    setIsSubmitting(true);
    setSubmitError("");

    try {
      if (!submissionIdRef.current) submissionIdRef.current = window.crypto.randomUUID();
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
        if (!nextDraftId) throw new Error("No se pudo identificar el borrador de la solicitud.");
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
      setIsSidebarExpanded(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSubmitError(error.message || "No se pudo enviar la solicitud. Puedes reintentarlo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isValidationModalOpen,
    setIsValidationModalOpen,
    validationCode,
    setValidationCode,
    isRequestReceived,
    setIsRequestReceived,
    receivedRequest,
    setReceivedRequest,
    isSubmitting,
    submitError,
    setSubmitError,
    submissionIdRef,
    handleValidationSubmit,
  };
}
