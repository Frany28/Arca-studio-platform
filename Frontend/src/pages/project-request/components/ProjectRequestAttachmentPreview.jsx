import { useRef } from "react";

import { api } from "../../../api/http.js";
import FileAttachmentIcons from "../../../components/ui/FileAttachmentIcons.jsx";
import PlayIcon from "../../../components/ui/Gallery/PlayIcon.jsx";
import { useVideoThumbnailState } from "../../../components/ui/Gallery/useVideoThumbnail.js";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import useNearViewport from "../../../hooks/useNearViewport.js";
import { isVideoAttachment } from "../../../utils/projectRequestAttachments.js";

// Figma «video item» (2282:37784, 150 × 90 en la solicitud): radio 4, elevación E2 y, en vídeos,
// degradado inferior con el icono de reproducción centrado.
const FRAME_CLASS_NAME = "relative flex h-[90px] w-[150px] shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-1)] bg-[var(--color-neutral-200)] shadow-[var(--shadow-e2)]";

/**
 * Deduce la extensión que muestra el icono de adjunto a partir del MIME o del nombre.
 *
 * @param {{fileType?: string|null, name?: string}} file - Adjunto persistido.
 * @returns {string} Extensión en mayúsculas (JPG, PNG, PDF, MP4...) o cadena vacía.
 */
function getAttachmentExtension(file) {
  const fromName = String(file?.name || "").split(".").pop();
  const fromMime = String(file?.fileType || "").split(";")[0].split("/").pop();
  return (fromName && fromName !== file?.name ? fromName : fromMime).toUpperCase();
}

/**
 * Miniatura de un vídeo adjunto. Reutiliza el mecanismo de la galería (`useVideoThumbnailState`),
 * que lee los metadatos y un fotograma mediante peticiones parciales del endpoint autenticado de
 * contenido, y solo empieza cuando la tarjeta se acerca al viewport. Si el fotograma no se puede
 * obtener, se muestra la presentación por tipo.
 *
 * @param {Object} props - Adjunto y solicitud.
 * @param {Object} props.file - Adjunto de vídeo.
 * @param {number|string} props.projectRequestId - Solicitud propietaria.
 * @returns {import("react").ReactElement} Miniatura del vídeo.
 */
function VideoAttachmentPreview({ file, projectRequestId }) {
  const frameRef = useRef(null);
  const isNear = useNearViewport(frameRef);
  const videoSrc = isNear ? api.projectRequests.getFileContentUrl({ fileId: file.id, projectRequestId }) : "";
  const { status, thumbnail } = useVideoThumbnailState(videoSrc);

  return (
    <span ref={frameRef} className={FRAME_CLASS_NAME} data-preview={thumbnail ? "thumbnail" : "type"}>
      {thumbnail ? (
        <img src={thumbnail} alt="" className="content-reveal-media absolute inset-0 size-full object-cover" />
      ) : isNear && status === "loading" ? (
        <Loader preset="videoThumbnail" label={`Cargando miniatura de ${file.name}`} className="absolute inset-0 size-full" />
      ) : (
        <FileAttachmentIcons type={getAttachmentExtension(file)} aria-hidden="true" />
      )}
      {thumbnail ? (
        <>
          <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0)_100%)]" />
          <span aria-hidden="true" className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center p-[8px] text-[var(--color-neutral-100-uniform)]">
            <PlayIcon className="size-5" />
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Vista previa de un adjunto de solicitud en el área de 150 × 90 de Figma. Los vídeos muestran
 * un fotograma real (lectura diferida y parcial); imágenes y documentos usan la presentación por
 * tipo porque no existe una miniatura reducida en el backend y generarla exigiría descargar el
 * archivo completo.
 *
 * @param {Object} props - Adjunto y solicitud.
 * @param {Object} props.file - Adjunto persistido con `id`, `name` y `fileType`.
 * @param {number|string} props.projectRequestId - Solicitud propietaria.
 * @returns {import("react").ReactElement} Área visual del adjunto.
 */
export default function ProjectRequestAttachmentPreview({ file, projectRequestId }) {
  if (isVideoAttachment(file)) {
    return <VideoAttachmentPreview file={file} projectRequestId={projectRequestId} />;
  }

  return (
    <span className={FRAME_CLASS_NAME} data-preview="type">
      <FileAttachmentIcons type={getAttachmentExtension(file)} aria-hidden="true" />
    </span>
  );
}
