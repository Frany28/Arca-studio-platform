import { useState } from "react";

import PdfViewerSurface from "../../../components/document-viewer/PdfViewerSurface.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Panorama360Viewer from "../../../components/ui/Gallery/Panorama360Viewer.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
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

/**
 * Imagen o vídeo de la versión a tamaño contenido, con estado de carga y de error. Se carga por URL
 * (la sesión viaja en la cookie), como en los visores del proyecto.
 *
 * @param {{ kind: "image"|"video", src: string, title: string }} props - Medio.
 * @returns {import("react").ReactElement} Medio.
 */
function MediaStage({ kind, src, title }) {
  const [status, setStatus] = useState({ src, value: "loading" });
  const current = status.src === src ? status.value : "loading";
  const done = () => setStatus({ src, value: "ready" });
  const failed = () => setStatus({ src, value: "error" });
  if (current === "error") return <SurfaceError description="Comprueba tu conexión e inténtalo nuevamente." />;
  return (
    <div className={`${STAGE_CLASS} relative`}>
      {current === "loading" ? <Loader preset="documentPreview" label={`Cargando ${title}`} className="absolute inset-0" /> : null}
      {kind === "image" ? (
        <img src={src} alt={title} className="max-h-full max-w-full object-contain" onLoad={done} onError={failed} />
      ) : (
        <video src={src} controls preload="metadata" className="max-h-full max-w-full" aria-label={title} onLoadedMetadata={done} onError={failed} />
      )}
    </div>
  );
}

/**
 * Área del visor de una versión según su tipo, reutilizando los visores de la aplicación: PDF con
 * PDF.js (`PdfViewerSurface`, con zoom, páginas y descarga del archivo mostrado), DOCX y XLSX con
 * `OfficeViewerSurface`, panorámicas con `Panorama360Viewer` integrado, e imágenes y vídeos con su
 * elemento nativo dentro del mismo marco. Todos son de solo consulta: sin observaciones.
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
 * @returns {import("react").ReactElement} Visor.
 */
function AdminFileVersionSurface({ content, downloading, kind, onDownload, onViewChange, src, title, view }) {
  let surface;
  if (kind === "image" || kind === "video") {
    surface = <MediaStage key={src} kind={kind} src={src} title={title} />;
  } else if (kind === "panorama") {
    surface = <Panorama360Viewer embedded item={{ fileUrl: src, id: src, title }} />;
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
