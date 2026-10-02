import { useRef, useState } from "react";

import { getProjectRequestFileErrors } from "../../../utils/projectRequestValidation.js";

function toFileItems(fileList) {
  return Array.from(fileList || []).map((file, index) => ({
    error: "",
    file,
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    progress: 0,
    status: "pending",
  }));
}

export default function useProjectRequestFiles({
  currentFieldErrors,
  draftId,
  hasAttemptedSubmit,
  setShowRequiredAlert,
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

    if (
      hasAttemptedSubmit
      && nextErrors.length === 0
      && Object.keys(currentFieldErrors).length === 0
    ) {
      setShowRequiredAlert(false);
    }
  };

  const updateFileItem = (id, values) => {
    setFiles((current) => current.map((item) => (
      item.id === id ? { ...item, ...values } : item
    )));
  };

  const resetFiles = () => {
    setFiles([]);
    setFileErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return {
    fileErrors,
    fileInputRef,
    files,
    handleFilesChange,
    resetFiles,
    setFileErrors,
    updateFileItem,
  };
}
