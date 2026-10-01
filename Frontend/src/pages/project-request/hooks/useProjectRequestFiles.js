import { toFileItems } from "../utils/projectRequestFiles.js";
import { useRef, useState } from "react";
import { getProjectRequestFileErrors } from "../../../utils/projectRequestValidation.js";

export function useProjectRequestFiles({
  hasAttemptedSubmit,
  setShowRequiredAlert,
  draftId,
  currentFieldErrors,
}) {
  const [files, setFiles] = useState([]);

  const [fileErrors, setFileErrors] = useState([]);

  const fileInputRef = useRef(null);

  const handleFilesChange = (fileList) => {
    if (draftId) {
      setFileErrors(["Ya existe un borrador en proceso. Reintenta el envío antes de cambiar los archivos."]);
      return;
    }
    const nextFiles = toFileItems(fileList);
    const nextErrors = getProjectRequestFileErrors(nextFiles);
    setFiles(nextFiles);
    setFileErrors(nextErrors);
    if (hasAttemptedSubmit && nextErrors.length === 0 && Object.keys(currentFieldErrors).length === 0) {
      setShowRequiredAlert(false);
    }
  };

  const updateFileItem = (id, values) => {
    setFiles((current) => current.map((item) => (item.id === id ? { ...item, ...values } : item)));
  };

  return {
    files,
    setFiles,
    fileErrors,
    setFileErrors,
    fileInputRef,
    handleFilesChange,
    updateFileItem,
  };
}
