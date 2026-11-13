import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import AuthToast from "../../../components/ui/AuthToast/AuthToast.jsx";
import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";

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

function getFileError(file, existingFiles) {
  const extension = getFileExtension(file.name);
  const normalizedName = String(file.name || "").trim().toLowerCase();

  if (!file.name || file.name.length > MAX_FILE_NAME_LENGTH) {
    return `El nombre del archivo no puede superar ${MAX_FILE_NAME_LENGTH} caracteres`;
  }

  if (
    existingFiles.some((item) =>
      String(item.file?.name || item.name || "")
        .trim()
        .toLowerCase() === normalizedName
    )
  ) {
    return "Ese archivo ya esta seleccionado";
  }

  if (!ALLOWED_FILE_EXTENSIONS.has(extension) || !ALLOWED_FILE_TYPES.has(file.type)) {
    return "Solo se permiten archivos JPEG, PNG, PDF y MP4";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "El archivo supera el tamano permitido de 50 MB";
  }

  return "";
}

export default function ProjectUploadFilesPanel({ onFilesChanged, projectId }) {
  // La subida sigue `uploadsLocked`: un draft admite archivos del administrador.
  const { message: readOnlyMessage, uploadsLocked: readOnly } = useProjectReadOnly();
  const [uploadToastTrigger, setUploadToastTrigger] = useState(null);
  const [files, setFiles] = useState([]);
  const [submitError, setSubmitError] = useState("");
  const uploadControllersRef = useRef(new Map());
  // Archivos vigentes para validar una selección fuera del actualizador de estado.
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    const controllers = uploadControllersRef.current;

    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    if (!readOnly) return;

    const controllers = uploadControllersRef.current;
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    queueMicrotask(() => {
      setFiles((current) => current.map((fileItem) =>
        fileItem.status === "uploading"
          ? {
              ...fileItem,
              canUpload: false,
              errorMessage: readOnlyMessage,
              progress: 0,
              status: "failed",
            }
          : fileItem,
      ));
      setSubmitError(readOnlyMessage);
    });
  }, [readOnly, readOnlyMessage]);

  const updateFile = (fileId, nextValues) => {
    setFiles((current) =>
      current.map((fileItem) =>
        fileItem.id === fileId ? { ...fileItem, ...nextValues } : fileItem,
      ),
    );
  };

  const uploadFile = async (fileItem) => {
    if (readOnly) return;
    if (!projectId) {
      updateFile(fileItem.id, {
        errorMessage: "No se encontro el proyecto para subir el archivo.",
        progress: 0,
        status: "failed",
      });
      setSubmitError("No se encontro el proyecto para subir el archivo.");
      return;
    }

    if (fileItem.canUpload === false) {
      return;
    }

    const controller = new AbortController();
    uploadControllersRef.current.set(fileItem.id, controller);

    updateFile(fileItem.id, {
      errorMessage: "",
      loadedBytes: 0,
      progress: 0,
      status: "uploading",
    });

    try {
      const uploadResult = await api.projects.uploadFile({
        file: fileItem.file,
        onUploadProgress: ({ loaded, progress, total }) => {
          updateFile(fileItem.id, {
            loadedBytes: loaded,
            progress,
            totalBytes: total,
          });
        },
        projectId,
        signal: controller.signal,
      });

      uploadControllersRef.current.delete(fileItem.id);
      updateFile(fileItem.id, {
        loadedBytes: fileItem.file?.size || fileItem.totalBytes || 0,
        progress: 100,
        status: "completed",
        uploadResult,
      });
      setUploadToastTrigger((current) => (current || 0) + 1);
      onFilesChanged?.();
    } catch (error) {
      uploadControllersRef.current.delete(fileItem.id);
      if (error.code === "UPLOAD_ABORTED") {
        return;
      }

      updateFile(fileItem.id, {
        canUpload: true,
        errorMessage: error.message || "No se pudo subir el archivo",
        progress: 0,
        status: "failed",
      });
      setSubmitError(error.message || "No se pudo subir el archivo.");
    }
  };

  const handleFilesSelected = (fileList) => {
    if (readOnly) return;
    const selectedFiles = Array.from(fileList || []);

    if (selectedFiles.length === 0) {
      return;
    }

    setSubmitError("");

    // Los ítems (con su id aleatorio) y las subidas se crean aquí, una vez por selección: un
    // actualizador de estado debe ser puro, porque React puede ejecutarlo más de una vez
    // (StrictMode lo hace siempre) y cada ejecución lanzaba subidas duplicadas.
    const knownFiles = [...filesRef.current];
    const selectedItems = [];

    for (const file of selectedFiles) {
      const errorMessage = getFileError(file, knownFiles);
      const fileItem = {
        canUpload: !errorMessage,
        errorMessage,
        file,
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        loadedBytes: 0,
        progress: 0,
        status: errorMessage ? "failed" : "pending",
        totalBytes: file.size || 0,
        uploadResult: null,
      };

      knownFiles.push(fileItem);
      selectedItems.push(fileItem);
    }

    filesRef.current = knownFiles;
    setFiles((currentFiles) => [...currentFiles, ...selectedItems]);
    // Las actualizaciones de cada subida se encolan después de añadir los ítems.
    selectedItems
      .filter((fileItem) => !fileItem.errorMessage)
      .forEach(uploadFile);
  };

  const handleFileRemove = async (fileItem) => {
    if (readOnly) return;
    setSubmitError("");
    const controller = uploadControllersRef.current.get(fileItem.id);

    if (controller) {
      controller.abort();
      uploadControllersRef.current.delete(fileItem.id);
    }

    setFiles((current) => current.filter((item) => item.id !== fileItem.id));

    const uploadedFileId = fileItem.uploadResult?.file?.id;

    if (!uploadedFileId || !projectId) {
      return;
    }

    try {
      await api.projects.deleteFile({
        fileId: uploadedFileId,
        projectId,
      });
      onFilesChanged?.();
    } catch (error) {
      setSubmitError(error.message || "No se pudo eliminar el archivo.");
      setFiles((current) =>
        current.some((item) => item.id === fileItem.id)
          ? current
          : [...current, fileItem],
      );
    }
  };

  const visibleFiles = files.map((fileItem) => {
    const file = fileItem.file || fileItem;
    const fileSize = file.size || fileItem.totalBytes || 0;
    const loadedSize =
      fileItem.status === "completed"
        ? fileSize
        : Math.min(fileItem.loadedBytes || 0, fileSize);

    return {
      currentSizeLabel: formatFileSize(loadedSize),
      errorMessage: fileItem.errorMessage,
      id: fileItem.id,
      name: file.name || fileItem.name,
      onRemove: () => handleFileRemove(fileItem),
      onRetryUpload: () => uploadFile(fileItem),
      progress: fileItem.progress || 0,
      status: fileItem.status || "pending",
      totalSizeLabel: formatFileSize(fileSize),
      type: file.type || fileItem.type || "Archivo",
    };
  });

  return (
    <section
      className="relative flex w-full items-start justify-between gap-[48px] max-lg:flex-col"
      aria-label="Subir archivos"
    >
      <div className="flex max-w-[360px] flex-col gap-[2px] pt-[2px] tracking-[-0.5px]">
        <h2 className="text-[14px] font-medium leading-[17px] text-[var(--color-text-300)]">
          Subir im&aacute;genes o documentos
        </h2>
        <HintText
          state="Default"
          hintText="Todos los archivos ser&aacute;n verificados por nuestro equipo."
          className="[&>span>svg]:size-[14px] [&>span]:size-[14px] [&>span]:text-[var(--color-text-100)] [&>p]:text-[10px] [&>p]:font-normal [&>p]:leading-[12px] [&>p]:tracking-[-0.5px] [&>p]:text-[var(--color-text-100)]"
        />
      </div>

      <div className="w-[528px] max-w-full shrink-0">
        <FileUploadSection
          className="w-full"
          disabled={readOnly}
          files={visibleFiles}
          title="Subir archivos"
          chooseFileLabel="Elige un archivo"
          separatorLabel="O"
          dropLabel="Arrastra y suelta"
          formatsLabel="Formatos JPEG, PNG, PDF y MP4, hasta 50 MB."
          viewportHeight={null}
          fileListViewportHeight={292}
          showUploadedFiles={visibleFiles.length > 0}
          onFilesSelected={handleFilesSelected}
          onRetryUpload={() => setUploadToastTrigger((current) => (current || 0) + 1)}
        />
        {readOnly ? (
          <HintText state="Default" hintText={readOnlyMessage} className="mt-[8px] w-full" />
        ) : null}
        {submitError ? (
          <HintText state="Error" hintText={submitError} className="mt-[8px] w-full" />
        ) : null}
      </div>

      <AuthToast
        trigger={uploadToastTrigger}
        title="Tus archivos se est&aacute;n subiendo"
        description={
          <>
            Nuestro equipo proceder&aacute; a verificar la informaci&oacute;n para
            garantizar su seguridad; en breve estar&aacute; disponible para su
            visualizaci&oacute;n.
          </>
        }
      />
    </section>
  );
}
