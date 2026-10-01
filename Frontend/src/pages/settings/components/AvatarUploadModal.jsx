import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../../components/ui/Modal/Modal.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import Avatar from "../../../components/ui/Avatar/Avatar.jsx";
import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";

const AVATAR_UPLOAD_INITIAL_STATE = {
  errorMessage: "",
  file: null,
  progress: 0,
  status: "idle",
};
const AVATAR_PREVIEW_SIZE = 112;
const AVATAR_OUTPUT_SIZE = 512;

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("No se pudo preparar el avatar.")),
      "image/jpeg",
      0.9,
    );
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    image.src = url;
  });
}

async function createCroppedAvatar(file, offset) {
  const image = await loadImage(file);
  const scale = Math.max(
    AVATAR_PREVIEW_SIZE / image.naturalWidth,
    AVATAR_PREVIEW_SIZE / image.naturalHeight,
  );
  const sourceSize = AVATAR_PREVIEW_SIZE / scale;
  const centeredX = (image.naturalWidth - sourceSize) / 2;
  const centeredY = (image.naturalHeight - sourceSize) / 2;
  const sourceX = centeredX - offset.x / scale;
  const sourceY = centeredY - offset.y / scale;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_OUTPUT_SIZE,
    AVATAR_OUTPUT_SIZE,
  );
  const blob = await canvasToBlob(canvas);
  return new File([blob], `${file.name.replace(/\.[^/.]+$/, "") || "avatar"}.jpg`, {
    lastModified: Date.now(),
    type: "image/jpeg",
  });
}

function CloseIcon({ className }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2 2L10 10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M10 2L2 10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AvatarUploadModal({
  isSubmitting = false,
  open,
  onClose,
  onConfirm,
  onUpload,
}) {
  const uploadAbortControllerRef = useRef(null);
  const dragStateRef = useRef(null);
  const [uploadState, setUploadState] = useState(AVATAR_UPLOAD_INITIAL_STATE);
  const [previewDimensions, setPreviewDimensions] = useState(null);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const previewUrl = useMemo(
    () => (uploadState.file ? URL.createObjectURL(uploadState.file) : ""),
    [uploadState.file],
  );
  const isUploadBusy = isSubmitting || uploadState.status === "uploading";

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const resetUploadState = useCallback(() => {
    uploadAbortControllerRef.current?.abort();
    uploadAbortControllerRef.current = null;
    setUploadState(AVATAR_UPLOAD_INITIAL_STATE);
    setPreviewDimensions(null);
    setPreviewOffset({ x: 0, y: 0 });
  }, []);

  const handleClose = useCallback(() => {
    resetUploadState();
    onClose?.();
  }, [onClose, resetUploadState]);

  useEffect(() => {
    if (!open) {
      const frameId = window.requestAnimationFrame(() => {
        resetUploadState();
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    return undefined;
  }, [open, resetUploadState]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        handleClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClose, open]);

  const uploadFile = useCallback(
    async (file) => {
      if (!file || isUploadBusy) {
        return;
      }

      uploadAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      uploadAbortControllerRef.current = abortController;

      setUploadState({
        errorMessage: "",
        file,
        progress: 0,
        status: "uploading",
      });

      try {
        const result = await onUpload?.(file, {
          onUploadProgress: ({ progress }) => {
            setUploadState((current) => {
              if (current.file !== file) {
                return current;
              }

              return {
                ...current,
                progress,
                status: "uploading",
              };
            });
          },
          signal: abortController.signal,
        });

        setUploadState((current) => {
          if (current.file !== file) {
            return current;
          }

          return {
            ...current,
            progress: 100,
            result,
            status: "completed",
          };
        });
        return result;
      } catch (error) {
        if (error.code === "UPLOAD_ABORTED") {
          return;
        }

        setUploadState((current) => {
          if (current.file !== file) {
            return current;
          }

          return {
            ...current,
            errorMessage:
              error.message || "Error al subir, por favor intenta de nuevo",
            progress: 0,
            status: "failed",
          };
        });
      } finally {
        if (uploadAbortControllerRef.current === abortController) {
          uploadAbortControllerRef.current = null;
        }
      }
    },
    [isUploadBusy, onUpload],
  );

  const selectedFiles = useMemo(() => {
    const selectedFile = uploadState.file;

    if (!selectedFile) {
      return [];
    }

    const sizeInKb = Math.max(Math.ceil(selectedFile.size / 1024), 1);
    const type = selectedFile.name.split(".").pop()?.toUpperCase() || "FILE";
    const isFailed = uploadState.status === "failed";

    return [
      {
        currentSizeLabel: `${sizeInKb}KB`,
        errorMessage:
          uploadState.errorMessage ||
          "Error al subir, por favor intenta de nuevo",
        id: `${selectedFile.name}-${selectedFile.lastModified}`,
        name: selectedFile.name,
        onRemove:
          uploadState.status === "pending" || isFailed
            ? resetUploadState
            : undefined,
        progress: uploadState.progress,
        previewSrc: previewUrl,
        status: uploadState.status,
        totalSizeLabel: `${sizeInKb}KB`,
        type: type === "JPEG" ? "JPG" : type,
      },
    ];
  }, [previewUrl, resetUploadState, uploadState]);

  const handleFileSelection = (fileList) => {
    if (isUploadBusy) {
      return;
    }

    const nextFile = fileList?.[0];

    if (!nextFile) {
      return;
    }

    setPreviewDimensions(null);
    setPreviewOffset({ x: 0, y: 0 });
    setUploadState({
      errorMessage: "",
      file: nextFile,
      progress: 0,
      status: "pending",
    });
  };

  const clampOffset = useCallback((offset) => {
    if (!previewDimensions) return { x: 0, y: 0 };
    const scale = Math.max(
      AVATAR_PREVIEW_SIZE / previewDimensions.width,
      AVATAR_PREVIEW_SIZE / previewDimensions.height,
    );
    const maxX = Math.max((previewDimensions.width * scale - AVATAR_PREVIEW_SIZE) / 2, 0);
    const maxY = Math.max((previewDimensions.height * scale - AVATAR_PREVIEW_SIZE) / 2, 0);
    return {
      x: Math.max(-maxX, Math.min(maxX, offset.x)),
      y: Math.max(-maxY, Math.min(maxY, offset.y)),
    };
  }, [previewDimensions]);

  const handlePreviewPointerDown = (event) => {
    if (!uploadState.file || isUploadBusy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: previewOffset,
    };
  };

  const handlePreviewPointerMove = (event) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPreviewOffset(clampOffset({
      x: drag.offset.x + event.clientX - drag.startX,
      y: drag.offset.y + event.clientY - drag.startY,
    }));
  };

  const handlePreviewPointerUp = (event) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleConfirm = async () => {
    if (!uploadState.file || isUploadBusy) {
      return;
    }

    try {
      const croppedFile = await createCroppedAvatar(uploadState.file, previewOffset);
      setPreviewOffset({ x: 0, y: 0 });
      const result = await uploadFile(croppedFile);
      if (result) onConfirm?.(result);
    } catch (error) {
      setUploadState((current) => ({
        ...current,
        errorMessage: error.message || "No se pudo preparar el avatar.",
        status: "failed",
      }));
    }
  };

  return (
    <Modal
      visible={open}
      showDialog={false}
      onClick={handleClose}
      aria-modal="true"
      role="dialog"
      aria-labelledby="avatar-upload-modal-title"
    >
      <div className="flex size-full items-center justify-center px-[16px] py-[24px]">
        <section
          className="relative flex w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex w-full flex-col gap-[16px] px-[16px] pb-[16px] pt-[16px]">
            <Button layout="content"
              htmlType="button"
              className="absolute right-0 top-0 inline-flex size-9 items-center justify-center rounded-[var(--radius-2)] text-[var(--color-text-100)] transition-colors duration-150 hover:bg-[var(--color-neutral-200)]/40 hover:text-[var(--color-text-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-100)]"
              aria-label="Cerrar modal"
              onClick={handleClose}
            >
              <CloseIcon className="size-3" />
            </Button>

            <div className="flex w-full flex-col gap-[4px]">
              <h2
                id="avatar-upload-modal-title"
                className="w-full pr-[40px] text-[18px] font-bold leading-[22px] tracking-[-0.5px] text-[var(--color-text-300)]"
              >
                Avatar
              </h2>

              <div className="flex w-full flex-col items-center gap-[8px] pb-[20px]">
                <div
                  className="relative size-[112px] touch-none overflow-hidden rounded-full bg-[var(--color-neutral-200)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-100)]"
                  role={uploadState.file ? "application" : "img"}
                  aria-label={uploadState.file ? "Vista previa del avatar. Arrastra la imagen para ajustar el encuadre." : "Vista previa del avatar"}
                  tabIndex={uploadState.file ? 0 : undefined}
                  onPointerDown={handlePreviewPointerDown}
                  onPointerMove={handlePreviewPointerMove}
                  onPointerUp={handlePreviewPointerUp}
                  onPointerCancel={handlePreviewPointerUp}
                >
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Vista previa del avatar seleccionado"
                      draggable="false"
                      className="absolute left-1/2 top-1/2 max-w-none select-none"
                      style={previewDimensions ? {
                        width: `${previewDimensions.width * Math.max(AVATAR_PREVIEW_SIZE / previewDimensions.width, AVATAR_PREVIEW_SIZE / previewDimensions.height)}px`,
                        height: `${previewDimensions.height * Math.max(AVATAR_PREVIEW_SIZE / previewDimensions.width, AVATAR_PREVIEW_SIZE / previewDimensions.height)}px`,
                        transform: `translate3d(calc(-50% + ${previewOffset.x}px), calc(-50% + ${previewOffset.y}px), 0)`,
                      } : { width: "100%", height: "100%", objectFit: "cover", transform: "translate3d(-50%, -50%, 0)" }}
                      onLoad={(event) => setPreviewDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })}
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center" aria-hidden="true">
                      <Avatar
                        size="L"
                        theme="Brand 1"
                        content="Icon"
                        decorative
                        className="scale-[2]"
                      />
                    </div>
                  )}
                </div>
                {previewUrl ? (
                  <p className="text-center text-[12px] leading-[15px] text-[var(--color-text-100)]">
                    Arrastra la imagen para ajustar el encuadre
                  </p>
                ) : null}
              </div>

              <div className="w-full">
                <FileUploadSection
                  className="w-full"
                  title="Avatar"
                  chooseFileLabel="Elige un archivo"
                  separatorLabel="O"
                  dropLabel="Arrastra y suelta"
                  formatsLabel="Formatos JPEG, PNG, WEBP, hasta 50 MB."
                  files={selectedFiles}
                  showUploadedFiles={selectedFiles.length > 0}
                  viewportHeight={null}
                  fileInputAccept=".jpg,.jpeg,.png,.webp"
                  onFilesSelected={handleFileSelection}
                />
              </div>
            </div>
          </div>

          <div className="flex w-full items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
            <Button
              theme="Primary"
              type="Outline"
              size="S"
              showLeftIcon={false}
              showRightIcon={false}
              className="min-w-0 flex-1"
              onClick={handleClose}
            >
              Cerrar
            </Button>
            <Button
              theme="Primary"
              type="Solid"
              size="S"
              showLeftIcon={false}
              showRightIcon={false}
              className="min-w-0 flex-1"
              disabled={!uploadState.file || isUploadBusy}
              onClick={handleConfirm}
            >
              Confirmar
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

export default AvatarUploadModal;
