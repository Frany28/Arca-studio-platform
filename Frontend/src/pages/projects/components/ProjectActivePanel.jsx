import { Suspense } from "react";

import Loader from "../../../components/ui/Loader/Loader.jsx";
import ProjectInfoPanel from "../panels/ProjectInfoPanel.jsx";
import { PROJECT_DETAIL_LOADER_SECTIONS } from "../projectDetailsData.js";
import {
  ProjectDocumentsPanel,
  ProjectRendersPanel,
  ProjectTrackingPanel,
  ProjectUploadFilesPanel,
  ProjectWarrantiesPanel,
} from "./projectPanelModules.js";

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
