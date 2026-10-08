import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import Button from "../../../components/ui/Button/Button.jsx";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import TextArea from "../../../components/ui/TextArea/TextArea.jsx";
import { InfoCircleIcon } from "../settingsIcons.jsx";
import { SETTINGS_MOBILE_FIELD_CLASS_NAME, SETTINGS_MOBILE_ROW_CLASS_NAME } from "../settingsLayoutClassNames.js";

const ALLOWED_FILE_EXTENSIONS = new Set(["jpeg", "jpg", "mp4", "pdf", "png"]);
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "video/mp4",
]);
const MAX_FILE_NAME_LENGTH = 150;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

function getFileExtension(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  const lastDotIndex = normalized.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === normalized.length - 1) {
    return "";
  }

  return normalized.slice(lastDotIndex + 1);
}

function formatFileSize(size) {
  const bytes = Number(size) || 0;

  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(Math.ceil(bytes / 1024), bytes > 0 ? 1 : 0)}KB`;
}

function getFileError(file) {
  const extension = getFileExtension(file.name);

  if (!file.name || file.name.length > MAX_FILE_NAME_LENGTH) {
    return `El nombre del archivo no puede superar ${MAX_FILE_NAME_LENGTH} caracteres`;
  }

  if (!ALLOWED_FILE_EXTENSIONS.has(extension) || !ALLOWED_FILE_TYPES.has(file.type)) {
    return "Solo se permiten archivos JPEG, PNG, PDF y MP4";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "El archivo supera el tamano permitido de 50 MB";
  }

  return "";
}

export default function SupportPanel({
  supportIssueType,
  setSupportIssueType,
  isSupportIssueTypeMenuOpen,
  setIsSupportIssueTypeMenuOpen,
  supportSubject,
  setSupportSubject,
  supportDescription,
  setSupportDescription,
  onSubmit,
}) {
  const [supportFile, setSupportFile] = useState(null);
  const [supportError, setSupportError] = useState("");
  const [supportRequestId, setSupportRequestId] = useState(null);
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);
  const uploadControllerRef = useRef(null);

  useEffect(() => {
    return () => {
      uploadControllerRef.current?.abort();
    };
  }, []);
  const supportIssueItems = [
    {
      id: "platform-error",
      label: "Error en la plataforma",
      type: "Checkbox",
      checked: supportIssueType === "platform-error" ? "Yes" : "No",
    },
    {
      id: "access-account",
      label: "Acceso o cuenta",
      type: "Checkbox",
      checked: supportIssueType === "access-account" ? "Yes" : "No",
    },
    {
      id: "files-documents",
      label: "Archivos o documentos",
      type: "Checkbox",
      checked: supportIssueType === "files-documents" ? "Yes" : "No",
    },
    {
      id: "guarantees",
      label: "Garantías",
      type: "Checkbox",
      checked: supportIssueType === "guarantees" ? "Yes" : "No",
    },
    {
      id: "other",
      label: "Otro",
      type: "Checkbox",
      checked: supportIssueType === "other" ? "Yes" : "No",
    },
  ];
  const selectedSupportIssue =
    supportIssueItems.find((item) => item.id === supportIssueType) ?? null;
  const updateSupportFile = (nextValues) => {
    setSupportFile((current) => (current ? { ...current, ...nextValues } : current));
  };
  const uploadSupportFile = async (fileItem, nextSupportRequestId) => {
    if (!fileItem?.file || !nextSupportRequestId || fileItem.canUpload === false) {
      return;
    }

    const controller = new AbortController();
    uploadControllerRef.current = controller;
    updateSupportFile({
      errorMessage: "",
      loadedBytes: 0,
      progress: 0,
      status: "uploading",
    });

    try {
      const uploadResult = await api.support.uploadFile({
        file: fileItem.file,
        onUploadProgress: ({ loaded, progress, total }) => {
          updateSupportFile({
            loadedBytes: loaded,
            progress,
            totalBytes: total,
          });
        },
        signal: controller.signal,
        supportRequestId: nextSupportRequestId,
      });

      uploadControllerRef.current = null;
      updateSupportFile({
        loadedBytes: fileItem.file?.size || fileItem.totalBytes || 0,
        progress: 100,
        status: "completed",
        uploadResult,
      });
    } catch (error) {
      uploadControllerRef.current = null;
      if (error.code === "UPLOAD_ABORTED") {
        return;
      }

      updateSupportFile({
        canUpload: true,
        errorMessage: error.message || "No se pudo subir el archivo",
        progress: 0,
        status: "failed",
      });
      throw error;
    }
  };

  const handleFilesSelected = (fileList) => {
    const file = Array.from(fileList || [])[0];

    if (!file) {
      return;
    }

    const errorMessage = getFileError(file);

    setSupportError("");
    setSupportFile({
      canUpload: !errorMessage,
      errorMessage,
      file,
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      loadedBytes: 0,
      progress: 0,
      status: errorMessage ? "failed" : "pending",
      totalBytes: file.size || 0,
      uploadResult: null,
    });
  };

  const handleFileRemove = () => {
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    setSupportFile(null);
    setSupportError("");
  };

  const handleSupportSubmit = async () => {
    const normalizedSubject = String(supportSubject || "").trim();
    const normalizedDescription = String(supportDescription || "").trim();

    if (!supportIssueType || !normalizedSubject || !normalizedDescription) {
      setSupportError("Completa el tipo de problema, asunto y descripcion.");
      return;
    }

    if (supportFile?.canUpload === false) {
      setSupportError("Elimina el archivo con errores antes de enviar.");
      return;
    }

    setIsSubmittingSupport(true);
    setSupportError("");

    try {
      let nextSupportRequestId = supportRequestId;

      if (!nextSupportRequestId) {
        const data = await api.support.createRequest({
          description: normalizedDescription,
          issueType: supportIssueType,
          subject: normalizedSubject,
        });
        nextSupportRequestId = data.supportRequest?.id;
        setSupportRequestId(nextSupportRequestId);
      }

      if (supportFile && supportFile.status !== "completed") {
        await uploadSupportFile(supportFile, nextSupportRequestId);
      }

      setSupportFile(null);
      setSupportRequestId(null);
      setSupportIssueType(null);
      setSupportSubject("");
      setSupportDescription("");
      onSubmit?.();
    } catch (error) {
      setSupportError(error.message || "No se pudo enviar la solicitud.");
    } finally {
      setIsSubmittingSupport(false);
    }
  };

  const visibleSupportFiles = supportFile
    ? [
        {
          currentSizeLabel: formatFileSize(
            supportFile.status === "completed"
              ? supportFile.totalBytes
              : supportFile.loadedBytes,
          ),
          errorMessage: supportFile.errorMessage,
          id: supportFile.id,
          name: supportFile.file?.name || "Archivo",
          onRemove: handleFileRemove,
          onRetryUpload: handleSupportSubmit,
          progress: supportFile.progress || 0,
          status: supportFile.status || "pending",
          totalSizeLabel: formatFileSize(supportFile.totalBytes),
          type: supportFile.file?.type || "Archivo",
        },
      ]
    : [];

  return (
    <div className="flex flex-1 flex-col items-center gap-4">
      <div className="relative flex w-[664px] max-w-full flex-col gap-[24px]">
        <div className="flex w-full flex-col gap-[2px] border-b border-[var(--color-neutral-200)] pb-[24px]">
          <h2 className="text-[24px] font-bold leading-[30px] tracking-[-0.5px] text-[var(--color-text-300)]">
            Contactar Soporte
          </h2>
          <p className="w-[340px] max-w-full text-[16px] leading-[19px] tracking-[-0.5px] text-[var(--color-text-200)]">
            Nuestro equipo te ayudará lo antes posible.
          </p>
        </div>

        <div className={clsx("flex w-full items-start justify-between", SETTINGS_MOBILE_ROW_CLASS_NAME)}>
          <span className="pt-[2px] text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
            Tipo de problema
          </span>
                  <div className="flex flex-col gap-[16px]">
            <div className="flex flex-col gap-[8px]">
              <DropdownMenu
                type="Text"
                label={
                  selectedSupportIssue?.label ?? "Seleccionar tipo de problema"
                }
                supportingText=""
                items={supportIssueItems}
                selectedItemId={selectedSupportIssue?.id}
                open={isSupportIssueTypeMenuOpen}
                onOpenChange={setIsSupportIssueTypeMenuOpen}
                onItemSelect={(item) => {
                  setSupportIssueType(item.id);
                  setIsSupportIssueTypeMenuOpen(false);
                }}
                interactive
                className={clsx("w-[320px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
                aria-label="Seleccionar tipo de problema"
              />
              <HintText
                state="Default"
                hintText="Esto nos ayuda a dirigir tu solicitud correctamente"
                icon={<InfoCircleIcon className="size-4" />}
                className={clsx("w-[320px] items-start [&>p]:whitespace-normal [&>p]:break-words", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
              />
            </div>
            <Input
              label="Asunto"
              required
              information={false}
              showLabelInfo={false}
              showHint={false}
              size="S"
              type="Default input"
              state={supportSubject ? "Filled" : "Default"}
              value={supportSubject}
              placeholder="Ej. No puedo visualizar los renders"
              onChange={(event) => setSupportSubject(event.target.value)}
              className={clsx("w-[320px] max-w-none", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
            />
          </div>
        </div>

        <div className={clsx("flex w-full items-start justify-between", SETTINGS_MOBILE_ROW_CLASS_NAME)}>
          <div />
          <div className={clsx("flex w-[325px] max-w-none flex-col gap-[8px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}>
            <TextArea
              label="Descripción"
              required
              information={false}
              showLabelInfo={false}
              showHint={false}
              value={supportDescription}
              placeholder="Describe el problema con el mayor detalle posible. Puedes incluir qué ocurrió, cuándo sucedió y qué esperabas que pasara."
              onChange={(event) => setSupportDescription(event.target.value)}
              minHeight={106}
              rows={5}
              className="!w-full !max-w-none"
            />
            <HintText
              state="Default"
              hintText="Mientras más detalles proporciones, más rápido podremos ayudarte."
              icon={<InfoCircleIcon className="size-4" />}
              className="w-full items-start [&>p]:whitespace-normal [&>p]:break-words"
            />
          </div>
        </div>

        <div className="h-px w-full bg-[var(--color-neutral-200)]" />

          <div className={clsx("flex w-full items-start justify-between gap-[16px]", SETTINGS_MOBILE_ROW_CLASS_NAME)}>
            <span className="pt-[2px] text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
              Imagen de referencia (opcional)
            </span>
          <div className={clsx("w-[447px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}>
            <FileUploadSection
              className="h-[177px] w-full"
              title="Imagen de referencia"
              chooseFileLabel="Elige un archivo"
              separatorLabel="O"
              dropLabel="Arrastra y suelta"
              formatsLabel="Formatos JPEG, PNG, PDF y MP4, hasta 50 MB."
              files={visibleSupportFiles}
              showUploadedFiles={visibleSupportFiles.length > 0}
              viewportHeight={null}
              onFilesSelected={handleFilesSelected}
            />
            {supportError ? (
              <HintText state="Error" hintText={supportError} className="mt-[8px] w-full" />
            ) : null}
          </div>
        </div>

        <div className="h-px w-full bg-[var(--color-neutral-200)]" />

        <div className="flex w-full flex-col items-end gap-[var(--spacing-gap-2)]">
          {isSubmittingSupport ? (
            <Loader
              preset="action"
              label="Enviando solicitud de soporte"
            />
          ) : null}
          <Button
            theme="Primary"
            type="Solid"
            size="S"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            disabled={isSubmittingSupport}
            onClick={handleSupportSubmit}
          >
            Enviar solicitud
          </Button>
        </div>
      </div>
    </div>
  );
}
