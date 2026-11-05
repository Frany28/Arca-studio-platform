import { Suspense } from "react";

import Loader from "../../../components/ui/Loader/Loader.jsx";
import { lazyWithRetry as lazy } from "../../../utils/lazyWithRetry.js";
import ProjectInfoPanel from "../panels/ProjectInfoPanel.jsx";
import { PROJECT_DETAIL_LOADER_SECTIONS } from "../projectDetailsData.js";

// Información es la pestaña inicial y se carga con la página. El resto se descarga al abrirla:
// Renders arrastra three.js y los visores, y retenerlos retrasaba las lecturas del detalle.
// lazyWithRetry recupera los chunks ausentes tras una publicación nueva.
const ProjectDocumentsPanel = lazy(() => import("../panels/ProjectDocumentsPanel.jsx"));
const ProjectRendersPanel = lazy(() => import("../panels/ProjectRendersPanel.jsx"));
const ProjectTrackingPanel = lazy(() => import("../panels/ProjectTrackingPanel.jsx"));
const ProjectUploadFilesPanel = lazy(() => import("../panels/ProjectUploadFilesPanel.jsx"));
const ProjectWarrantiesPanel = lazy(() => import("../panels/ProjectWarrantiesPanel.jsx"));

/**
 * Muestra el panel de la pestaña activa; los paneles diferidos usan su skeleton durante la carga.
 *
 * @param {Object} props - Pestaña activa, proyecto presentado y acciones de cada panel.
 * @returns {import("react").ReactElement} Panel activo.
 */
export default function ProjectActivePanel(props) {
  return (
    <Suspense
      fallback={
        <Loader
          preset="projectDetailPanel"
          section={PROJECT_DETAIL_LOADER_SECTIONS[props.activeProjectTabIndex] || "info"}
          label="Cargando sección del proyecto"
        />
      }
    >
      <ActivePanel {...props} />
    </Suspense>
  );
}

function ActivePanel({
  activeProjectTabIndex,
  clearFocusedRenderComment,
  filesSynchronizedAt,
  infoProps,
  openRecentDocument,
  presentedProject,
  refreshProjectFiles,
  resolvedProjectId,
  searchParams,
  trackingProps,
  warrantiesProps,
}) {
  if (activeProjectTabIndex === 1) {
    return (
      <ProjectRendersPanel
        focusedCommentId={searchParams.get("commentId")}
        focusedImageId={searchParams.get("imageId")}
        modelGallery={presentedProject.panoramaGallery}
        onClearFocusedComment={clearFocusedRenderComment}
        projectId={resolvedProjectId}
        renderGallery={presentedProject.renderGallery}
        videoGallery={presentedProject.videoGallery}
      />
    );
  }

  if (activeProjectTabIndex === 2) {
    return (
      <ProjectDocumentsPanel
        documents={presentedProject.documents}
        focusedCommentId={searchParams.get("commentId")}
        focusedDocumentId={searchParams.get("fileId")}
        lastSynchronizedAt={filesSynchronizedAt}
        projectId={resolvedProjectId}
      />
    );
  }

  if (activeProjectTabIndex === 3) {
    return <ProjectTrackingPanel {...trackingProps} />;
  }

  if (activeProjectTabIndex === 4) {
    return <ProjectWarrantiesPanel {...warrantiesProps} />;
  }

  if (activeProjectTabIndex === 5) {
    return (
      <ProjectUploadFilesPanel
        projectId={resolvedProjectId}
        onFilesChanged={refreshProjectFiles}
      />
    );
  }

  return (
    <ProjectInfoPanel
      {...infoProps}
      project={presentedProject}
      onViewDocument={openRecentDocument}
    />
  );
}
