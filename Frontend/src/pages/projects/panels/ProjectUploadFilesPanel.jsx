import { useState } from "react";

import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import AuthToast from "../../../components/ui/AuthToast/AuthToast.jsx";
import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import IconContainer from "../../../components/ui/IconContainer/IconContainer.jsx";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import { useProjectUploadFiles } from "../hooks/useProjectUploadFiles.js";
import { formatProjectUploadSize, PROJECT_UPLOAD_ACCEPT } from "../utils/projectUploadFiles.js";

/**
 * Presenta la zona de carga del proyecto, las tarjetas de la sesión y el resultado de la API.
 * El cliente puede revisar la selección antes de confirmar el envío.
 *
 * @param {Object} props - Proyecto, modo de envío y callback de actualización.
 * @returns {import("react").ReactElement} Pestaña «Subir archivos».
 */
export default function ProjectUploadFilesPanel({ manualUpload = false, onFilesChanged, projectId }) {
  // La subida sigue `uploadsLocked`: un draft admite archivos del administrador.
  const { message: readOnlyMessage, uploadsLocked: readOnly } = useProjectReadOnly();
  const [successTrigger, setSuccessTrigger] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const queue = useProjectUploadFiles({
    projectId,
    manualUpload,
    readOnly,
    readOnlyMessage,
    onFilesChanged,
    onSuccess: () => setSuccessTrigger((current) => current + 1),
    onError: (message) => setUploadError({ message }),
  });
  const files = queue.files.map((item) => {
    const completed = item.status === "completed";
    return {
      currentSizeLabel: formatProjectUploadSize(Math.min(item.loadedBytes, item.file.size)),
      errorMessage: item.validationError || item.errorMessage,
      hideCompletedAction: true,
      id: item.id,
      name: item.file.name,
      onRemove: completed ? undefined : () => queue.removeFile(item.id),
      onRetryUpload: item.status === "failed" && !item.validationError ? () => queue.uploadFile(item.id) : undefined,
      progress: item.progress,
      removeTooltip: item.status === "uploading" ? "Cancelar subida" : "Quitar de la selección",
      removeWhenFailed: true,
      showUploadPercentage: false,
      status: item.status,
      totalSizeLabel: formatProjectUploadSize(item.file.size),
      type: item.file.type,
    };
  });
  const pending = files.some((file) => file.status === "pending");
  const busy = files.some((file) => file.status === "uploading");

  return (
    <section className="@container w-full min-w-0 dark:[--color-text-100:var(--color-neutral-600)]" aria-label="Subir archivos">
      <div className="grid min-w-0 items-start gap-[16px] @min-[760px]:grid-cols-2 @min-[1000px]:grid-cols-[minmax(0,1fr)_512px] @min-[1000px]:pr-[16px]">
        <div className="flex min-w-0 flex-col gap-[4px]">
          <h2 className="text-heading-8 text-[var(--color-text-300)]">
            Subir imágenes o documentos
          </h2>
          <HintText hintText="Todos los archivos serán verificados por nuestro equipo." />
        </div>

        <div className="w-full min-w-0 max-w-[512px]">
          <FileUploadSection
            aria-label="Selección de archivos del proyecto"
            disabled={readOnly}
            dropzoneVariant="project"
            fileInputAccept={PROJECT_UPLOAD_ACCEPT}
            files={files}
            title="Archivos seleccionados"
            viewportHeight={null}
            fileListViewportHeight={files.length > 3 ? 292 : null}
            showUploadedFiles={files.length > 0}
            onFilesSelected={queue.selectFiles}
            uploadAction={manualUpload ? { busy, onUpload: pending ? queue.uploadPending : undefined } : undefined}
          />
          {readOnly ? (
            <HintText hintText={readOnlyMessage} className="mt-[8px] w-full" />
          ) : null}
        </div>
      </div>

      <AuthToast
        trigger={successTrigger || null}
        mount="viewport"
        containerClassName="z-[var(--z-tooltip)] sm:w-[395px] dark:[--color-text-100:var(--color-neutral-600)] dark:[--color-text-200:var(--color-neutral-600)]"
        leading={<IconContainer size="M" type="Outline" />}
        title="Tus archivos se están subiendo"
        description="Nuestro equipo procederá a verificar la información para garantizar su seguridad; en breve estará disponible para su visualización."
      />
      <AlertToast
        trigger={uploadError}
        title="No se pudo subir el archivo"
        description={uploadError?.message}
        theme="Danger"
        aria-label="Error de subida"
      />
    </section>
  );
}
