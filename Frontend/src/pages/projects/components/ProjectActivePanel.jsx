import ProjectDocumentsPanel from "../panels/ProjectDocumentsPanel.jsx";
import ProjectInfoPanel from "../panels/ProjectInfoPanel.jsx";
import ProjectRendersPanel from "../panels/ProjectRendersPanel.jsx";
import ProjectTrackingPanel from "../panels/ProjectTrackingPanel.jsx";
import ProjectUploadFilesPanel from "../panels/ProjectUploadFilesPanel.jsx";
import ProjectWarrantiesPanel from "../panels/ProjectWarrantiesPanel.jsx";

export default function ProjectActivePanel({
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
