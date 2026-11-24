import { useState } from "react";

import MainLogo from "../../../assets/logos/MainLogo.jsx";
import PdfViewerSurface from "../../../components/document-viewer/PdfViewerSurface.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import ImageViewerStage from "../../../components/ui/Gallery/ImageViewerStage.jsx";
import Panorama360Viewer from "../../../components/ui/Gallery/Panorama360Viewer.jsx";
import VideoViewerStage from "../../../components/ui/Gallery/VideoViewerStage.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { CloseIcon } from "../../../components/document-viewer/DocumentViewerControls.jsx";
import { ProjectReadOnlyProvider } from "../../../contexts/ProjectReadOnlyContext.jsx";
import OfficeViewerSurface from "../../projects/components/document-preview/OfficeViewerSurface.jsx";

const STAGE_CLASS = "flex size-full items-center justify-center overflow-hidden rounded-[var(--radius-3)] bg-[var(--color-primary-300)]";
// Las observaciones se gestionan en el proyecto: aquí el visor es de solo consulta.
const READ_ONLY_MESSAGE = "Las observaciones se gestionan desde el proyecto.";

/**
 * Estado de error con reintento dentro del área del visor.
 *
 * @param {{ description: string, onRetry?: () => void }} props - Motivo y reintento.
 * @returns {import("react").ReactElement} Estado de error.
 */
function SurfaceError({ description, onRetry }) {
  return (
    <div className={`${STAGE_CLASS} p-[24px]`}>
      <EmptyState
        title="No se pudo cargar el archivo"
        description={description}
        size="S"
        showFeaturedIcon
        showActions={Boolean(onRetry)}
        showSecondaryAction={false}
        primaryActionLabel="Reintentar"
        onPrimaryAction={onRetry}
      />
    </div>
  );
}

const MEDIA_ERROR = "Comprueba tu conexión e inténtalo nuevamente.";

/**
 * Imagen de la versión en el escenario de galería de Proyectos (ImageViewerStage) en modo
 * `contain`: sin recortes ni deformaciones, con logo, «Cerrar», carga y error. Se carga por URL
 * (la sesión viaja en la cookie), como en los visores del proyecto.
 *
 * @param {{ src: string, title: string, onClose: () => void }} props - Imagen y cierre.
 * @returns {import("react").ReactElement} Escenario.
 */
function ImageMediaStage({ onClose, onMediaSize, src, title }) {
  const [status, setStatus] = useState("loading");
  return (
    <ImageViewerStage
      fit="contain"
      imageSrc={src}
      imageAlt={title}
      closeLabel="Cerrar visor"
      className="size-full"
      onClose={onClose}
      onImageLoad={(event) => {
        setStatus("ready");
        const { naturalHeight, naturalWidth } = event?.currentTarget ?? {};
        if (naturalWidth > 0 && naturalHeight > 0) onMediaSize?.({ height: naturalHeight, src, width: naturalWidth });
      }}
      onImageError={() => setStatus("error")}
    >
      {status === "loading" ? <Loader preset="documentPreview" label={`Cargando ${title}`} className="absolute inset-0" /> : null}
      {status === "error" ? <div className="absolute inset-0 z-10"><SurfaceError description={MEDIA_ERROR} /></div> : null}
    </ImageViewerStage>
  );
}

/**
 * Vídeo de la versión en el escenario de Proyectos (VideoViewerStage): proporción conservada,
 * reproducir, volumen y pantalla completa; sin «Comentar video», porque aquí no hay observaciones.
 *
 * @param {{ src: string, title: string, onClose: () => void }} props - Vídeo y cierre.
 * @returns {import("react").ReactElement} Escenario.
 */
function VideoMediaStage({ onClose, onMediaSize, src, title }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    // El error conserva «Cerrar» del escenario: sin él solo quedarían Escape y el fondo.
    return (
      <div className="relative flex size-full">
        <SurfaceError description={MEDIA_ERROR} />
        <Button theme="Primary" type="Solid" size="S" showText={false} showLeftIcon showRightIcon={false} iconLeft={<CloseIcon />} aria-label="Cerrar visor" tooltip={false} onClick={onClose} className="absolute right-[8px] top-[8px] z-30 size-9 text-[var(--color-text-200)]" />
      </div>
    );
  }
  return (
    <VideoViewerStage
      item={{ title, video: src }}
      closeLabel="Cerrar visor"
      className="size-full"
      showCommentButton={false}
      onClose={onClose}
      onVideoError={() => setFailed(true)}
      onVideoMetadata={(size) => onMediaSize?.({ ...size, src })}
    />
  );
}

/**
 * Panorámica 360 integrada con el logo y «Cerrar» del escenario de galería (Figma 3940:666189).
 *
 * @param {{ src: string, title: string, onClose: () => void }} props - Panorámica y cierre.
 * @returns {import("react").ReactElement} Escenario.
 */
function PanoramaMediaStage({ onClose, src, title }) {
  return (
    <div className="relative flex size-full overflow-hidden rounded-[var(--radius-3)]">
      <Panorama360Viewer embedded item={{ fileUrl: src, id: src, title }} />
      <div className="pointer-events-none absolute left-[12px] top-[12px] z-30">
        <MainLogo size="32px" appearance="dark" alt="ARCA Studio" />
      </div>
      <Button theme="Primary" type="Solid" size="S" showText={false} showLeftIcon showRightIcon={false} iconLeft={<CloseIcon />} aria-label="Cerrar visor" tooltip={false} onClick={onClose} className="absolute right-[8px] top-[8px] z-30 size-9 text-[var(--color-text-200)]" />
    </div>
  );
}

/**
 * Área del visor de una versión según su tipo, reutilizando los visores de la aplicación: PDF con
 * PDF.js (`PdfViewerSurface`, con zoom, páginas y descarga del archivo mostrado), DOCX y XLSX con
 * `OfficeViewerSurface`; imágenes, vídeos y panorámicas con los escenarios de galería de Proyectos
 * (`ImageViewerStage`, `VideoViewerStage`, `Panorama360Viewer`), que llevan su propio «Cerrar».
 * Cada escenario se reinicia con su URL (`key`), así que cambiar de versión no mezcla estados y
 * redibujar el drawer no reinicia la reproducción. Todos son de solo consulta: sin observaciones.
 *
 * @param {Object} props - Tipo, contenido descargado, URL y navegación.
 * @param {string} props.kind - Tipo de visor (getViewerKind).
 * @param {Object} props.content - Estado de useAdminFileVersionContent.
 * @param {string} props.src - URL del contenido para imagen, vídeo y panorámica.
 * @param {string} props.title - Nombre accesible del archivo.
 * @param {{ page: number, zoom: number }} props.view - Página y zoom del PDF.
 * @param {(view: { page: number, zoom: number }) => void} props.onViewChange - Cambia página o zoom.
 * @param {() => void} props.onDownload - Descarga la versión mostrada.
 * @param {boolean} props.downloading - Descarga en curso.
 * @param {() => void} [props.onClose] - «Cerrar» de los escenarios de imagen, vídeo y panorámica.
 * @param {(size: { src: string, width: number, height: number }) => void} [props.onMediaSize] - Dimensiones
 *   naturales de la imagen o el vídeo cargados (el visor ajusta su escenario a esa proporción).
 * @returns {import("react").ReactElement} Visor.
 */
function AdminFileVersionSurface({ content, downloading, kind, onClose, onDownload, onMediaSize, onViewChange, src, title, view }) {
  let surface;
  if (kind === "image") {
    surface = <ImageMediaStage key={src} src={src} title={title} onClose={onClose} onMediaSize={onMediaSize} />;
  } else if (kind === "video") {
    surface = <VideoMediaStage key={src} src={src} title={title} onClose={onClose} onMediaSize={onMediaSize} />;
  } else if (kind === "panorama") {
    surface = <PanoramaMediaStage key={src} src={src} title={title} onClose={onClose} />;
  } else if (kind === "unsupported") {
    surface = (
      <div className={`${STAGE_CLASS} p-[24px]`}>
        <EmptyState
          title="Sin vista previa"
          description="Este formato no tiene vista previa. Descarga la versión para revisarla."
          size="S"
          showFeaturedIcon
          showActions
          showSecondaryAction={false}
          primaryActionLabel={downloading ? "Descargando..." : "Descargar versión"}
          onPrimaryAction={downloading ? undefined : onDownload}
        />
      </div>
    );
  } else if (content.status === "error") {
    surface = <SurfaceError description={content.error} onRetry={content.retry} />;
  } else if (content.status !== "ready") {
    surface = <Loader preset="documentPreview" label={`Cargando ${title}`} className="h-full overflow-hidden" />;
  } else if (kind === "pdf") {
    surface = (
      <PdfViewerSurface
        className="size-full rounded-[var(--radius-3)]"
        documentProxy={content.documentProxy}
        expandable={false}
        onDownload={onDownload}
        downloadDisabled={downloading}
        page={view.page}
        pageCount={content.pageCount}
        title={title}
        updatePage={(page) => onViewChange({ ...view, page })}
        updateZoom={(zoom) => onViewChange({ ...view, zoom })}
        zoom={view.zoom}
      />
    );
  } else {
    surface = (
      <div className="size-full overflow-auto rounded-[var(--radius-3)] bg-[var(--color-neutral-100)]">
        <OfficeViewerSurface kind={kind} data={content.data} title={title} />
      </div>
    );
  }
  return (
    <ProjectReadOnlyProvider readOnly message={READ_ONLY_MESSAGE}>
      {surface}
    </ProjectReadOnlyProvider>
  );
}

export default AdminFileVersionSurface;
