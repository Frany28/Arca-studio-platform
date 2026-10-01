
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Button from "../../../components/ui/Button/Button.jsx";
import GalleryImagesModal from "../../../components/ui/Gallery/GalleryImagesModal.jsx";
import ImageGallerySection from "../components/renders/ImageGallerySection.jsx";
import VideoGallerySection from "../components/renders/VideoGallerySection.jsx";
import GalleryVideosModal from "../../../components/ui/Gallery/GalleryVideosModal.jsx";
import ImageViewerModal from "../../../components/ui/Gallery/ImageViewerModal.jsx";
import Model3DViewerModal from "../../../components/ui/Gallery/Model3DViewerModal.jsx";
import RenderStage from "../components/renders/RenderStage.jsx";
import RenderThumbnailRail from "../components/renders/RenderThumbnailRail.jsx";
import VideoViewerModal from "../../../components/ui/Gallery/VideoViewerModal.jsx";
import VRModelViewer from "../../../components/ui/Gallery/VRModelViewer.jsx";
import { useImageComments } from "../../../components/ui/Gallery/useImageComments.js";
import MediaEmptyState from "../components/renders/MediaEmptyState.jsx";
import { PROJECT_RENDER_GALLERY } from "../projectRenderGalleryData.js";
import { PROJECT_VIDEO_GALLERY } from "../projectVideoGalleryData.js";
import useModelRenderSettings from "../../../hooks/useModelRenderSettings.js";
import useVrViewerLaunch from "../../../hooks/useVrViewerLaunch.js";

const MODEL_SLOW_LOADING_MS = 15000;
const MODEL_LOAD_TIMEOUT_MS = 45000;
function EmptyRenderOverview() {
  return (
    <section className="flex w-full flex-col gap-[8px]">
      <div className="flex w-full items-start gap-[12px] max-[1024px]:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
          <MediaEmptyState
            title="No se encontraron modelos 3D"
            description="Aún no se han subido modelos 3D."
            className="h-[398px]"
            panel
            circlePositionClassName="[&>div.pointer-events-none.absolute.z-0]:left-[444px] [&>div.pointer-events-none.absolute.z-0]:top-[-58px] [&>div.pointer-events-none.absolute.z-0]:translate-x-0 [&>div.pointer-events-none.absolute.z-0]:translate-y-0"
          />

          <h2 className="text-heading-4 text-[var(--color-text-300)]">
            Sin información
          </h2>
        </div>

        <aside className="flex h-[438px] w-[200px] shrink-0 flex-col justify-center overflow-visible max-[1024px]:h-auto max-[1024px]:w-full">
          <MediaEmptyState
            title="Aún no hay requerimientos"
            description="Aún no se han subido modelos 3D."
            className="h-full min-h-[206px] w-full"
            small
          />
        </aside>
      </div>

      <div
        aria-hidden="true"
        className="border-b border-[var(--color-neutral-200)] pb-[2px]"
      />
    </section>
  );
}

export default function ProjectRendersPanel({
  focusedCommentId,
  focusedImageId,
  modelGallery,
  onClearFocusedComment,
  projectId,
  renderGallery = PROJECT_RENDER_GALLERY,
  videoGallery = PROJECT_VIDEO_GALLERY,
}) {
  const resolvedModelGallery = modelGallery ?? renderGallery;
  const [activeRenderId, setActiveRenderId] = useState(
    resolvedModelGallery[0]?.id,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadState, setLoadState] = useState("loading");
  const [modelReloadKey, setModelReloadKey] = useState(0);
  const [progress, setProgress] = useState(0);
  const slowLoadingTimeoutRef = useRef(null);
  const loadTimeoutRef = useRef(null);
  const [isImageGalleryModalOpen, setIsImageGalleryModalOpen] = useState(false);
  const [isVideoGalleryModalOpen, setIsVideoGalleryModalOpen] = useState(false);
  const vrLaunch = useVrViewerLaunch();
  const [selectedModel3D, setSelectedModel3D] = useState(null);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState(null);
  const [selectedGalleryVideo, setSelectedGalleryVideo] = useState(null);
  const selectedActiveRenderId = resolvedModelGallery.some(
    (item) => item.id === activeRenderId,
  )
    ? activeRenderId
    : resolvedModelGallery[0]?.id;

  const activeRender = useMemo(
    () =>
      resolvedModelGallery.find((item) => item.id === selectedActiveRenderId) ??
      resolvedModelGallery[0],
    [resolvedModelGallery, selectedActiveRenderId],
  );
  const activeModelSrc = activeRender?.modelUrl || activeRender?.fileUrl || null;
  const renderSettingsState = useModelRenderSettings({
    fileId: Number(activeRender?.id) || null,
    projectId: Number(projectId) || null,
  });
  const activeRenderIdForLoading = activeRender?.id || null;
  const {
    addComment: addVRObservation,
    comments: vrObservations,
  } = useImageComments(activeRender, {
    commentType: "panorama",
    projectId,
  });

  const clearModelLoadingTimers = useCallback(() => {
    window.clearTimeout(slowLoadingTimeoutRef.current);
    window.clearTimeout(loadTimeoutRef.current);
  }, []);

  useEffect(() => {
    clearModelLoadingTimers();

    if (!activeModelSrc) {
      const frameId = window.requestAnimationFrame(() => {
        setIsLoading(false);
        setLoadState("loaded");
        setProgress(100);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    setIsLoading(true);
    setLoadState("loading");
    setProgress(0);

    slowLoadingTimeoutRef.current = window.setTimeout(() => {
      setLoadState((current) =>
        current === "loading" ? "slow" : current,
      );
    }, MODEL_SLOW_LOADING_MS);

    loadTimeoutRef.current = window.setTimeout(() => {
      setIsLoading(true);
      setLoadState((current) =>
        current === "loading" || current === "slow" ? "error" : current,
      );
    }, MODEL_LOAD_TIMEOUT_MS);

    return () => {
      clearModelLoadingTimers();
    };
  }, [
    activeModelSrc,
    activeRenderIdForLoading,
    clearModelLoadingTimers,
    modelReloadKey,
  ]);

  const handleModelLoad = useCallback(() => {
    clearModelLoadingTimers();
    setProgress(100);
    setLoadState("loaded");
    setIsLoading(false);
  }, [clearModelLoadingTimers]);

  const handleModelError = useCallback(() => {
    clearModelLoadingTimers();
    setProgress(100);
    setLoadState("error");
    setIsLoading(true);
  }, [clearModelLoadingTimers]);

  const handleModelProgress = useCallback((nextProgress) => {
    if (nextProgress > 0) {
      setLoadState((current) => (current === "error" ? current : "loading"));
    }

    setProgress((current) =>
      Math.max(current, Math.min(Math.max(nextProgress, 0), 99)),
    );
  }, []);

  const handleModelRetry = useCallback(() => {
    clearModelLoadingTimers();
    setIsLoading(true);
    setLoadState("loading");
    setProgress(0);
    setModelReloadKey((current) => current + 1);
  }, [clearModelLoadingTimers]);

  const handleCloseFocusedMedia = useCallback((closeMedia) => {
    closeMedia();
    onClearFocusedComment?.();
  }, [onClearFocusedComment]);

  useEffect(() => {
    if (!focusedImageId || !renderGallery.length) {
      return;
    }

    const focusedImage = renderGallery.find((item) => {
      const normalizedFocusedImageId = String(focusedImageId);

      return (
        String(item.id) === normalizedFocusedImageId ||
        String(item.title) === normalizedFocusedImageId ||
        String(item.label) === normalizedFocusedImageId ||
        String(item.image) === normalizedFocusedImageId
      );
    });

    if (!focusedImage) {
      const focusedModel = resolvedModelGallery.find((item) => {
        const normalizedFocusedImageId = String(focusedImageId);

        return (
          String(item.id) === normalizedFocusedImageId ||
          String(item.title) === normalizedFocusedImageId ||
          String(item.label) === normalizedFocusedImageId ||
          String(item.image) === normalizedFocusedImageId ||
          String(item.modelUrl) === normalizedFocusedImageId
        );
      });

      if (!focusedModel) {
        const focusedVideo = videoGallery.find((item) => {
          const normalizedFocusedImageId = String(focusedImageId);

          return (
            String(item.id) === normalizedFocusedImageId ||
            String(item.title) === normalizedFocusedImageId ||
            String(item.label) === normalizedFocusedImageId ||
            String(item.image) === normalizedFocusedImageId ||
            String(item.video) === normalizedFocusedImageId
          );
        });

        if (!focusedVideo) {
          return undefined;
        }

        const frameId = window.requestAnimationFrame(() => {
          setSelectedGalleryVideo(focusedVideo);
        });

        return () => {
          window.cancelAnimationFrame(frameId);
        };
      }

      const frameId = window.requestAnimationFrame(() => {
        setSelectedModel3D(focusedModel);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    const frameId = window.requestAnimationFrame(() => {
      setSelectedGalleryImage(focusedImage);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [focusedImageId, renderGallery, resolvedModelGallery, videoGallery]);

  if (!activeRender) {
    return (
      <>
        <section className="flex w-full flex-col gap-[48px]">
          <EmptyRenderOverview />
          <ImageGallerySection
            items={renderGallery}
            onOpenGallery={() => setIsImageGalleryModalOpen(true)}
            onSelectImage={setSelectedGalleryImage}
          />
          <VideoGallerySection
            items={videoGallery}
            onOpenGallery={() => setIsVideoGalleryModalOpen(true)}
            onOpenVideo={setSelectedGalleryVideo}
          />
        </section>

        <GalleryImagesModal
          visible={isImageGalleryModalOpen}
          items={renderGallery}
          projectId={projectId}
          onClose={() => setIsImageGalleryModalOpen(false)}
        />
        <GalleryVideosModal
          visible={isVideoGalleryModalOpen}
          items={videoGallery}
          onClose={() => setIsVideoGalleryModalOpen(false)}
          onWatchVideo={setSelectedGalleryVideo}
        />
        <Model3DViewerModal
          focusedCommentId={focusedCommentId}
          visible={Boolean(selectedModel3D)}
          item={selectedModel3D}
          projectId={projectId}
          onClose={() =>
            handleCloseFocusedMedia(() => setSelectedModel3D(null))
          }
        />
        <VideoViewerModal
          visible={Boolean(selectedGalleryVideo)}
          item={selectedGalleryVideo}
          projectId={projectId}
          onClose={() =>
            handleCloseFocusedMedia(() => setSelectedGalleryVideo(null))
          }
        />
        <ImageViewerModal
          focusedCommentId={focusedCommentId}
          visible={Boolean(selectedGalleryImage)}
          items={renderGallery}
          initialItem={selectedGalleryImage}
          projectId={projectId}
          onClose={() =>
            handleCloseFocusedMedia(() => setSelectedGalleryImage(null))
          }
        />
      </>
    );
  }

  return (
    <>
      <section className="flex w-full flex-col gap-[48px]">
        <div className="flex w-full items-start gap-[12px] max-[1024px]:flex-col">
          <RenderStage
            activeRender={activeRender}
            isLoading={isLoading}
            loadState={loadState}
            modelReloadKey={modelReloadKey}
            onModelRetry={handleModelRetry}
            progress={progress}
            onModelError={handleModelError}
            onModelLoad={handleModelLoad}
            onModelProgress={handleModelProgress}
            onOpenModel={() => setSelectedModel3D(activeRender)}
            onOpenVR={vrLaunch.open}
            isVrChecking={vrLaunch.isChecking}
            renderSettingsState={renderSettingsState}
          />
          <RenderThumbnailRail
            items={resolvedModelGallery}
            activeRenderId={selectedActiveRenderId}
            onSelect={setActiveRenderId}
          />
        </div>

        <ImageGallerySection
          items={renderGallery}
          onOpenGallery={() => setIsImageGalleryModalOpen(true)}
          onSelectImage={setSelectedGalleryImage}
        />
        <VideoGallerySection
          items={videoGallery}
          onOpenGallery={() => setIsVideoGalleryModalOpen(true)}
          onOpenVideo={setSelectedGalleryVideo}
        />
      </section>

      <GalleryImagesModal
        visible={isImageGalleryModalOpen}
        items={renderGallery}
        projectId={projectId}
        onClose={() => setIsImageGalleryModalOpen(false)}
      />
      <GalleryVideosModal
        visible={isVideoGalleryModalOpen}
        items={videoGallery}
        onClose={() => setIsVideoGalleryModalOpen(false)}
        onWatchVideo={setSelectedGalleryVideo}
      />
      <Model3DViewerModal
        focusedCommentId={focusedCommentId}
        visible={Boolean(selectedModel3D)}
        item={selectedModel3D}
        projectId={projectId}
        onClose={() =>
          handleCloseFocusedMedia(() => setSelectedModel3D(null))
        }
      />
      {vrLaunch.viewer.visible ? (
        <VRModelViewer
          annotations={vrObservations}
          item={activeRender}
          modelSrc={activeModelSrc}
          onSubmitObservation={addVRObservation}
          poster={activeRender.image || undefined}
          title={activeRender.title}
          renderSettings={renderSettingsState.settings}
          visible={vrLaunch.viewer.visible}
          mode={vrLaunch.viewer.mode}
          initialSession={vrLaunch.viewer.initialSession}
          notice={vrLaunch.viewer.notice}
          onImmersiveEnd={vrLaunch.handleImmersiveEnd}
          onClose={vrLaunch.close}
        />
      ) : null}
      <VideoViewerModal
        visible={Boolean(selectedGalleryVideo)}
        item={selectedGalleryVideo}
        projectId={projectId}
        onClose={() =>
          handleCloseFocusedMedia(() => setSelectedGalleryVideo(null))
        }
      />
      <ImageViewerModal
        focusedCommentId={focusedCommentId}
        visible={Boolean(selectedGalleryImage)}
        items={renderGallery}
        initialItem={selectedGalleryImage}
        projectId={projectId}
        onClose={() =>
          handleCloseFocusedMedia(() => setSelectedGalleryImage(null))
        }
      />
    </>
  );
}
