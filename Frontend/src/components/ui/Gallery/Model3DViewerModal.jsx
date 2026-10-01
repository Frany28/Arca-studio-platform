import {
  Model3DCommentMarkers,
  Model3DHotspots,
} from "./model3d/Model3DAnnotations.jsx";
import { isPanoramaPointSelection } from "./model3d/model3DSelection.js";
import GeneralCommentsDrawer from "./GeneralCommentsDrawer.jsx";
import { CloseIcon } from "./viewerIcons.jsx";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import "../../../config/modelViewer.js";
import MainLogo from "../../../assets/logos/MainLogo.jsx";
import Button from "../../ui/Button/Button.jsx";
import { getFileDisplayName } from "../../../utils/fileDisplayName.js";
import { getToggledCommentId } from "../../../utils/commentSelection.js";
import { getPanoramaOrientation } from "../../../utils/panoramaCoordinates.js";
import {
  canObservePanoramaViewer,
  canShowPanoramaAnnotations,
} from "../../../utils/panoramaViewerState.js";
import useModelRenderSettings from "../../../hooks/useModelRenderSettings.js";
import useVrViewerLaunch from "../../../hooks/useVrViewerLaunch.js";
import {
  classifyArchitecturalMaterial,
  enhanceModelViewerMaterials,
  getStableMaterialKey,
  getArchitecturalEnvironmentImage,
} from "../../../utils/architecturalRendering.js";
import Model3DViewerControls from "./Model3DViewerControls.jsx";
import Model3DLoadingState from "./Model3DLoadingState.jsx";
import ArchitecturalModelEffects from "./ArchitecturalModelEffects.jsx";
import ArchitecturalSettingsPanel from "./ArchitecturalSettingsPanel.jsx";
import ImageHighlighter from "./ImageHighlighter.jsx";
import { useImageComments } from "./useImageComments.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import VRModelViewer from "./VRModelViewer.jsx";
import {
  MODEL_3D_NAVIGATION_MODES,
  MODEL_3D_TEXTURE_PRESETS,
  MODEL_3D_CAMERA_CONTROLS,
} from "./model3DViewerConfig.js";
import { useSketchfabLikeModelWheel } from "../../../hooks/useSketchfabLikeModelWheel.js";
import {
  getFiniteVector,
  getFiniteCameraOrbit,
  getModelViewerDimensions,
} from "../../../utils/modelViewerCamera.js";

function Model3DUsageHint() {
  const items = [
    "Arrastra para girar el modelo",
    "Usa la rueda o pellizca para acercarte",
    "Haz clic en el modelo para comentar",
  ];

  return (
    <div className="pointer-events-none absolute bottom-[12px] left-[12px] z-20 max-w-[360px] rounded-[8px] border border-white/10 bg-black/58 p-[12px] text-[12px] leading-[16px] text-white/74 shadow-[0_12px_32px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <ul className="list-disc space-y-[2px] pl-[16px]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const GENERAL_COMMENTS = [
  {
    id: "comment-1",
    type: "comment",
    author: "John Doe",
    time: "Hace 2 horas",
    body: "¿Podemos ajustar la iluminación en esta área?",
  },
  {
    id: "reply-1",
    type: "reply",
    author: "Arq. Armando",
    time: "Hace 2 horas",
    body: "Sí, claro.",
  },
  {
    id: "comment-2",
    type: "comment",
    author: "John Doe",
    time: "Hace 2 horas",
    body: "¿Podemos ajustar la iluminación en esta área?",
  },
  {
    id: "reply-2",
    type: "reply",
    author: "Arq. Armando",
    time: "Hace 2 horas",
    body: "Sí, claro.",
  },
  {
    id: "reply-3",
    type: "reply",
    author: "Arq. Wilmer",
    time: "Hace 2 horas",
    body: "Sí, claro.",
  },
];

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";
const MODEL_SLOW_LOADING_MS = 15000;
const MODEL_LOAD_TIMEOUT_MS = 45000;
const MODEL_VIEWER_BACKGROUND =
  "radial-gradient(circle at 50% 38%, #3b3b3b 0%, #232323 48%, #101010 100%)";
const MODEL_VIEWER_BACKGROUND_COLOR = "#171717";
function getModelViewerDimensionRadius(modelViewer) {
  const dimensions = getModelViewerDimensions(modelViewer);

  if (!dimensions) {
    return null;
  }

  return Math.max(dimensions.max * 0.08, dimensions.min * 0.8, 0.25);
}

function getRootCommentId(comments, commentId) {
  if (!commentId) {
    return null;
  }

  const comment = comments.find(
    (currentComment) => String(currentComment.id) === String(commentId),
  );

  return comment?.parentCommentId || comment?.id || commentId;
}

export default function Model3DViewerModal({
  focusedCommentId,
  visible = false,
  item,
  projectId,
  onClose,
}) {
  const { readOnly } = useProjectReadOnly();
  const [shouldRender, setShouldRender] = useState(visible);
  const [isActive, setIsActive] = useState(false);
  const [displayItem, setDisplayItem] = useState(item);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadState, setModelLoadState] = useState("loading");
  const [modelProgress, setModelProgress] = useState(0);
  const [modelReloadKey, setModelReloadKey] = useState(0);
  const [navigationMode, setNavigationMode] = useState("drag");
  const [texturePreset, setTexturePreset] = useState("auto");
  const vrLaunch = useVrViewerLaunch();
  const closeVrOnModalReset = useEffectEvent(() => {
    vrLaunch.close();
  });
  const [architecturalMaterials, setArchitecturalMaterials] = useState([]);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);
  const modelStageRef = useRef(null);
  const modelViewerRef = useRef(null);
  const modelPointerRef = useRef(null);
  const slowLoadingTimeoutRef = useRef(null);
  const loadTimeoutRef = useRef(null);
  const { addComment, comments } = useImageComments(displayItem, {
    commentType: "panorama",
    projectId,
  });
  const annotationComments = useMemo(() => {
    const repliesByRootId = new Map();
    comments.forEach((comment) => {
      if (!comment.parentCommentId) return;
      const rootId = String(comment.parentCommentId);
      repliesByRootId.set(rootId, (repliesByRootId.get(rootId) || 0) + 1);
    });
    return comments
      .filter((comment) => comment.selection && !comment.parentCommentId)
      .map((comment) => ({
        ...comment,
        replyCount: repliesByRootId.get(String(comment.id)) || 0,
      }));
  }, [comments]);
  const [pendingSelection, setPendingSelection] = useState(null);
  const [focusedSelectionCommentId, setFocusedSelectionCommentId] =
    useState(focusedCommentId);
  const [replyRequest, setReplyRequest] = useState(null);
  const renderSettingsState = useModelRenderSettings({
    fileId: Number(displayItem?.id) || null,
    projectId: Number(projectId) || null,
  });
  const renderSettings = renderSettingsState.settings;
  const focusedAnnotationId = useMemo(
    () => getRootCommentId(comments, focusedSelectionCommentId),
    [comments, focusedSelectionCommentId],
  );

  const clearModelLoadingTimers = useCallback(() => {
    window.clearTimeout(slowLoadingTimeoutRef.current);
    window.clearTimeout(loadTimeoutRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.clearTimeout(closeTimeoutRef.current);
    window.cancelAnimationFrame(frameRef.current);

    if (visible && item) {
      queueMicrotask(() => {
        if (cancelled) {
          return;
        }

        setDisplayItem(item);
        setIsActive(false);
        setModelReloadKey(0);
        setNavigationMode("drag");
        setTexturePreset("auto");
        closeVrOnModalReset();
        setPendingSelection(null);
        setShouldRender(true);
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => {
            setIsActive(true);
          });
        });
      });

      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setIsActive(false);
      closeTimeoutRef.current = window.setTimeout(() => {
        setShouldRender(false);
      }, MODAL_TRANSITION_MS);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [visible, item]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
      clearModelLoadingTimers();
    },
    [clearModelLoadingTimers],
  );

  const modelSrc = displayItem?.modelUrl || displayItem?.fileUrl || null;
  const hasInteractiveModel = Boolean(modelSrc);
  const hasPreviewImage = Boolean(displayItem?.image);
  const showPanoramaAnnotations = canShowPanoramaAnnotations({
    isLoading: isModelLoading,
    loadState: modelLoadState,
    viewerLoaded: modelViewerRef.current?.loaded === true,
    visible,
  });

  useEffect(() => {
    if (!showPanoramaAnnotations) {
      setFocusedSelectionCommentId(null);
      return;
    }

    setFocusedSelectionCommentId(focusedCommentId);
  }, [focusedCommentId, showPanoramaAnnotations]);
  const activeNavigationMode =
    MODEL_3D_NAVIGATION_MODES[navigationMode] ?? MODEL_3D_NAVIGATION_MODES.drag;
  const activeTexturePreset =
    MODEL_3D_TEXTURE_PRESETS[texturePreset] ?? MODEL_3D_TEXTURE_PRESETS.auto;

  useSketchfabLikeModelWheel(
    modelViewerRef,
    visible && hasInteractiveModel && !isModelLoading,
  );

  useEffect(() => {
    if (!visible || !shouldRender || !hasInteractiveModel) {
      setIsModelLoading(false);
      clearModelLoadingTimers();
      return undefined;
    }

    setIsModelLoading(true);
    setModelLoadState("loading");
    setModelProgress(0);

    slowLoadingTimeoutRef.current = window.setTimeout(() => {
      setModelLoadState((current) =>
        current === "loading" ? "slow" : current,
      );
    }, MODEL_SLOW_LOADING_MS);

    loadTimeoutRef.current = window.setTimeout(() => {
      setIsModelLoading(true);
      setModelLoadState((current) =>
        current === "loading" || current === "slow" ? "error" : current,
      );
    }, MODEL_LOAD_TIMEOUT_MS);

    return () => {
      clearModelLoadingTimers();
    };
  }, [
    clearModelLoadingTimers,
    displayItem?.id,
    hasInteractiveModel,
    modelReloadKey,
    modelSrc,
    shouldRender,
    visible,
  ]);

  useEffect(() => {
    const modelViewer = modelViewerRef.current;

    if (
      !canObservePanoramaViewer({
        hasInteractiveModel,
        shouldRender,
        viewerAvailable: Boolean(modelViewer),
        visible,
      })
    ) {
      return undefined;
    }

    function handleLoad() {
      enhanceModelViewerMaterials(modelViewer, renderSettings);
      setArchitecturalMaterials(
        (modelViewer.model?.materials || []).map((material, index) => ({
          category: classifyArchitecturalMaterial(material.name),
          key: getStableMaterialKey(material, index),
          name: material.name || `Material ${index + 1}`,
        })),
      );
      clearModelLoadingTimers();
      setModelProgress(100);
      setModelLoadState("loaded");
      setIsModelLoading(false);
    }

    function handleError() {
      clearModelLoadingTimers();
      setModelProgress(100);
      setModelLoadState("error");
      setIsModelLoading(true);
    }

    function handleProgress(event) {
      const totalProgress = Number(event.detail?.totalProgress);

      if (Number.isFinite(totalProgress)) {
        setModelLoadState((current) =>
          current === "error" ? current : "loading",
        );
        setModelProgress((current) =>
          Math.max(current, Math.min(Math.round(totalProgress * 100), 99)),
        );
      }
    }

    if (modelViewer.loaded) {
      handleLoad();
      return undefined;
    }

    modelViewer.addEventListener("load", handleLoad);
    modelViewer.addEventListener("error", handleError);
    modelViewer.addEventListener("progress", handleProgress);

    return () => {
      modelViewer.removeEventListener("load", handleLoad);
      modelViewer.removeEventListener("error", handleError);
      modelViewer.removeEventListener("progress", handleProgress);
    };
  }, [
    clearModelLoadingTimers,
    hasInteractiveModel,
    modelReloadKey,
    modelSrc,
    renderSettings,
    shouldRender,
    visible,
  ]);

  function handleModelRetry() {
    clearModelLoadingTimers();
    setIsModelLoading(true);
    setModelLoadState("loading");
    setModelProgress(8);
    setModelReloadKey((current) => current + 1);
  }

  function handleOpenVRViewer() {
    if (!hasInteractiveModel) {
      return;
    }
    vrLaunch.open();
  }

  function restoreViewerCamera(selection) {
    const modelViewer = modelViewerRef.current;
    const viewerPoint = selection?.viewerPoint;

    const panoramaOrientation = getPanoramaOrientation(selection);
    if (modelViewer && panoramaOrientation) {
      modelViewer.lookAtPanoramaPoint?.(
        panoramaOrientation.yaw,
        panoramaOrientation.pitch,
        viewerPoint?.fieldOfView,
      );
      return;
    }

    if (!modelViewer || !viewerPoint) {
      return;
    }

    const modelPosition = getFiniteVector(viewerPoint.modelPosition);
    const savedOrbit = getFiniteCameraOrbit(viewerPoint.cameraOrbit);
    const currentOrbit = getFiniteCameraOrbit(modelViewer.getCameraOrbit?.());
    const theta = Number.isFinite(savedOrbit?.theta)
      ? savedOrbit.theta
      : Number.isFinite(currentOrbit?.theta)
        ? currentOrbit.theta
        : null;
    const phi = Number.isFinite(savedOrbit?.phi)
      ? savedOrbit.phi
      : Number.isFinite(currentOrbit?.phi)
        ? currentOrbit.phi
        : null;
    const closeRadius = getModelViewerDimensionRadius(modelViewer);
    const savedRadius = Number.isFinite(savedOrbit?.radius)
      ? savedOrbit.radius
      : null;
    const currentRadius = Number.isFinite(currentOrbit?.radius)
      ? currentOrbit.radius
      : null;
    const radius =
      closeRadius && savedRadius
        ? Math.min(savedRadius, closeRadius)
        : closeRadius || savedRadius || currentRadius;

    if (modelPosition) {
      modelViewer.cameraTarget = `${modelPosition.x}m ${modelPosition.y}m ${modelPosition.z}m`;
    }

    if (
      Number.isFinite(theta) &&
      Number.isFinite(phi) &&
      Number.isFinite(radius)
    ) {
      modelViewer.cameraOrbit = `${theta}rad ${phi}rad ${radius}m`;
    } else if (Number.isFinite(radius)) {
      modelViewer.cameraOrbit = `135deg 68deg ${radius}m`;
    } else {
      modelViewer.cameraOrbit = "135deg 68deg 120%";
    }

    modelViewer.fieldOfView = Number.isFinite(viewerPoint.fieldOfView)
      ? `${Math.min(viewerPoint.fieldOfView, 0.55)}rad`
      : "28deg";

    window.requestAnimationFrame(() => {
      modelViewer.jumpCameraToGoal?.();
    });
  }

  useEffect(() => {
    if (!showPanoramaAnnotations || !focusedAnnotationId) {
      return;
    }

    const comment = comments.find(
      (currentComment) =>
        String(currentComment.id) === String(focusedAnnotationId),
    );

    if (isPanoramaPointSelection(comment?.selection)) {
      restoreViewerCamera(comment.selection);
    }
  }, [comments, focusedAnnotationId, showPanoramaAnnotations]);

  if (!shouldRender || !displayItem || typeof document === "undefined") {
    return null;
  }

  const transitionStyle = {
    transitionDuration: `${MODAL_TRANSITION_MS}ms`,
    transitionTimingFunction: MODAL_EASING,
  };

  function handleSelectionChange(selection) {
    if (readOnly) return;
    const previewImage = displayItem.image || displayItem.poster || null;

    setFocusedSelectionCommentId(null);
    setPendingSelection({
      ...selection,
      image: {
        id: displayItem.id,
        src: previewImage,
        title: displayItem.title,
      },
      imageSrc: previewImage,
    });
  }

  function getViewerCameraSnapshot() {
    const modelViewer = modelViewerRef.current;
    const cameraOrbit = getFiniteCameraOrbit(modelViewer?.getCameraOrbit?.());
    const fieldOfView = modelViewer?.getFieldOfView?.();

    return {
      cameraOrbit,
      fieldOfView: Number.isFinite(fieldOfView) ? fieldOfView : null,
    };
  }

  function handleModelPointerDown(event) {
    if (readOnly || !hasInteractiveModel || isModelLoading || event.button !== 0) {
      return;
    }

    modelPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      time: Date.now(),
    };
  }

  function handleModelPointerUp(event) {
    const pointerStart = modelPointerRef.current;
    modelPointerRef.current = null;

    if (readOnly || !pointerStart || !hasInteractiveModel || isModelLoading) {
      return;
    }

    const movement = Math.hypot(
      event.clientX - pointerStart.clientX,
      event.clientY - pointerStart.clientY,
    );

    if (movement > 6) {
      return;
    }

    const modelViewer = modelViewerRef.current;
    const rect = modelViewer?.getBoundingClientRect();

    if (!modelViewer || !rect?.width || !rect?.height) {
      return;
    }

    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const hit = modelViewer.positionAndNormalFromPoint?.(x, y);

    if (!hit?.position || !hit?.normal) {
      return;
    }

    const markerSize = 18;
    const camera = getViewerCameraSnapshot();
    const previewImage = displayItem.image || displayItem.poster || null;
    const orientation = getPanoramaOrientation({
      viewerPoint: { modelPosition: hit.position },
    });

    setFocusedSelectionCommentId(null);
    setPendingSelection({
      kind: "panorama-point",
      displayPixels: {
        height: markerSize,
        width: markerSize,
        x: Math.round(x - markerSize / 2),
        y: Math.round(y - markerSize / 2),
      },
      image: {
        id: displayItem.id,
        src: previewImage,
        title: displayItem.title,
      },
      imageSrc: previewImage,
      yaw: orientation?.yaw,
      pitch: orientation?.pitch,
      naturalSize: {
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      },
      viewerPoint: {
        cameraOrbit: camera.cameraOrbit,
        fieldOfView: camera.fieldOfView,
        modelNormal: {
          x: hit.normal.x,
          y: hit.normal.y,
          z: hit.normal.z,
        },
        modelPosition: {
          x: hit.position.x,
          y: hit.position.y,
          z: hit.position.z,
        },
        normalizedX: x / rect.width,
        normalizedY: y / rect.height,
        x: Math.round(x),
        y: Math.round(y),
      },
    });
  }

  function handleSelectionPreviewClick(commentId) {
    if (!showPanoramaAnnotations) {
      return;
    }

    const nextCommentId = getToggledCommentId(
      focusedSelectionCommentId,
      commentId,
    );
    const comment = comments.find(
      (currentComment) => String(currentComment.id) === String(nextCommentId),
    );

    if (isPanoramaPointSelection(comment?.selection)) {
      restoreViewerCamera(comment.selection);
    }

    setFocusedSelectionCommentId(nextCommentId);
  }

  function handleAnnotationMarkerClick(commentId) {
    if (!showPanoramaAnnotations) {
      return false;
    }

    const comment = comments.find(
      (currentComment) => String(currentComment.id) === String(commentId),
    );

    if (isPanoramaPointSelection(comment?.selection)) {
      restoreViewerCamera(comment.selection);
    }

    setPendingSelection(null);
    setFocusedSelectionCommentId(commentId);
    return true;
  }

  function handleAnnotationReply(commentId) {
    if (!handleAnnotationMarkerClick(commentId)) {
      return;
    }

    setReplyRequest({ commentId, requestId: Date.now() });
  }

  async function handleSubmitComment({ message, parentCommentId, selection }) {
    const comment = await addComment({ message, parentCommentId, selection });
    if (comment && !parentCommentId) {
      setPendingSelection(null);
    }
  }

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-[60] overflow-hidden bg-[#777777] transition-opacity",
        isActive ? "opacity-100" : "opacity-0",
      )}
      style={transitionStyle}
    >
      <section
        className={clsx(
          "flex h-dvh w-dvw gap-[16px] p-[8px] transition-[opacity,transform] transform-gpu will-change-transform will-change-opacity max-[920px]:flex-col max-[920px]:overflow-y-auto",
          isActive
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-[12px] scale-[0.985] opacity-0",
        )}
        style={transitionStyle}
        role="dialog"
        aria-modal="true"
        aria-label={displayItem.title}
        onClick={onClose}
      >
        <div
          ref={modelStageRef}
          className={clsx(
            "relative min-w-0 flex-1 overflow-hidden",
            "rounded-[var(--radius-3)] bg-[#171717]",
            "h-[calc(100dvh-16px)]",
            "max-[920px]:h-[62dvh] max-[920px]:min-h-[360px] max-[920px]:flex-none",
            "max-[520px]:h-[58dvh] max-[520px]:min-h-[300px]",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {hasInteractiveModel ? (
            <>
              <model-viewer
                key={`${modelSrc}-${modelReloadKey}`}
                ref={modelViewerRef}
                src={modelSrc}
                navigation-mode={navigationMode}
                quality-preset={texturePreset}
                poster={displayItem.image || undefined}
                alt={displayItem.title}
                with-credentials
                camera-controls
                auto-rotate-delay="0"
                camera-orbit={activeNavigationMode.cameraOrbit}
                min-camera-orbit="auto 4deg 1.5%"
                max-camera-orbit="auto 88deg 520%"
                field-of-view={activeNavigationMode.fieldOfView}
                min-field-of-view="8deg"
                max-field-of-view="70deg"
                environment-image={getArchitecturalEnvironmentImage()}
                shadow-intensity={renderSettings.shadowIntensity}
                shadow-softness={activeTexturePreset.shadowSoftness}
                exposure={renderSettings.exposure}
                tone-mapping={activeTexturePreset.toneMapping}
                interpolation-decay={MODEL_3D_CAMERA_CONTROLS.interpolationDecay}
                orbit-sensitivity={MODEL_3D_CAMERA_CONTROLS.orbitSensitivity}
                pan-sensitivity={MODEL_3D_CAMERA_CONTROLS.panSensitivity}
                zoom-sensitivity={MODEL_3D_CAMERA_CONTROLS.zoomSensitivity}
                interaction-prompt={activeNavigationMode.interactionPrompt}
                loading="eager"
                reveal="auto"
                touch-action="none"
                onPointerDown={handleModelPointerDown}
                onPointerUp={handleModelPointerUp}
                onPointerCancel={() => {
                  modelPointerRef.current = null;
                }}
                style={{
                  background: MODEL_VIEWER_BACKGROUND,
                  backgroundColor: MODEL_VIEWER_BACKGROUND_COLOR,
                  display: "block",
                  filter: activeTexturePreset.filter,
                  height: "100%",
                  inset: 0,
                  position: "absolute",
                  "--poster-color": "transparent",
                  width: "100%",
                }}
              >
                <ArchitecturalModelEffects settings={renderSettings} />
                {showPanoramaAnnotations ? (
                  <Model3DHotspots
                    annotations={annotationComments}
                    focusedAnnotationId={focusedAnnotationId}
                    onAnnotationReply={handleAnnotationReply}
                    onAnnotationSelect={handleAnnotationMarkerClick}
                    pendingSelection={pendingSelection}
                  />
                ) : null}
              </model-viewer>
              <ArchitecturalSettingsPanel
                error={renderSettingsState.error}
                isSaving={renderSettingsState.isSaving}
                settings={renderSettings}
                materials={architecturalMaterials}
                onChange={(patch) =>
                  renderSettingsState.setSettings((current) => ({
                    ...current,
                    ...patch,
                  }))
                }
                onSave={() => renderSettingsState.save(renderSettings)}
              />
              {isModelLoading ? (
                <Model3DLoadingState
                  image={displayItem.image}
                  onRetry={handleModelRetry}
                  progress={modelProgress}
                  state={modelLoadState}
                />
              ) : null}
              {showPanoramaAnnotations ? (
                <Model3DCommentMarkers
                  annotations={annotationComments}
                  focusedAnnotationId={focusedAnnotationId}
                  modelViewerRef={modelViewerRef}
                  onAnnotationReply={handleAnnotationReply}
                  onAnnotationSelect={handleAnnotationMarkerClick}
                  pendingSelection={pendingSelection}
                />
              ) : null}
              {!isModelLoading ? <Model3DUsageHint /> : null}
            </>
          ) : hasPreviewImage ? (
            <ImageHighlighter
              annotations={annotationComments}
              focusedAnnotationId={focusedAnnotationId}
              imageSrc={displayItem.image}
              onSelectionChange={readOnly ? undefined : handleSelectionChange}
              showAnnotationPoints
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-[16px] bg-[var(--color-neutral-200)] px-[24px] text-center">
              <div className="flex max-w-[420px] flex-col gap-[6px]">
                <h3 className="text-heading-4 text-[var(--color-text-300)]">
                  {getFileDisplayName(displayItem.title)}
                </h3>
                <p className="text-body-3 text-[var(--color-text-100)]">
                  Archivo de modelo 3D cargado desde S3.
                </p>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,rgba(0,0,0,0)_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[156px] bg-[linear-gradient(0deg,rgba(0,0,0,0.34)_0%,rgba(0,0,0,0)_100%)]" />

          <div className="absolute left-[12px] top-[12px] z-20">
            <MainLogo size="32px" appearance="dark" alt="ARCA Studio" />
          </div>

          <Button
            theme="Primary"
            type="Solid"
            size="S"
            showText={false}
            showLeftIcon
            showRightIcon={false}
            iconLeft={<CloseIcon className="size-3" />}
            aria-label="Cerrar modelo 3D"
            tooltip={false}
            onClick={onClose}
            className="absolute right-[8px] top-[8px] z-20 size-9 text-[var(--color-text-200)]"
          />

          {hasInteractiveModel || hasPreviewImage ? (
            <Model3DViewerControls
              onExpand={null}
              navigationMode={navigationMode}
              onNavigationModeChange={hasInteractiveModel ? setNavigationMode : null}
              onTexturePresetChange={hasInteractiveModel ? setTexturePreset : null}
              onView={hasInteractiveModel ? handleOpenVRViewer : null}
              isViewDisabled={vrLaunch.isChecking}
              viewLabel={vrLaunch.isChecking ? "Comprobando visor VR" : "Ver en VR"}
              selectedIndex={2}
              texturePreset={texturePreset}
              className="absolute bottom-[12px] right-[12px] z-20 [&_button]:h-[40px] [&_button]:min-w-[52px] [&_button]:px-[16px]"
            />
          ) : null}
        </div>

        <div
          className={clsx(
            "min-h-0 w-[296px] shrink-0",
            "max-[920px]:h-[360px] max-[920px]:w-full max-[920px]:shrink-0",
            "max-[520px]:h-[320px]",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <GeneralCommentsDrawer
            comments={comments}
            focusedSelectionCommentId={focusedSelectionCommentId}
            mediaItem={displayItem}
            mediaType="panorama"
            pendingSelection={pendingSelection}
            replyRequest={replyRequest}
            selectionDisabled={!showPanoramaAnnotations}
            onClearSelection={() => setPendingSelection(null)}
            onSelectionPreviewClick={handleSelectionPreviewClick}
            onSubmitComment={handleSubmitComment}
          />
        </div>
      </section>

      {vrLaunch.viewer.visible ? (
        <VRModelViewer
          annotations={annotationComments}
          item={displayItem}
          modelSrc={modelSrc}
          onSubmitObservation={readOnly ? undefined : handleSubmitComment}
          poster={displayItem.image || undefined}
          title={displayItem.title}
          renderSettings={renderSettings}
          visible={vrLaunch.viewer.visible}
          mode={vrLaunch.viewer.mode}
          initialSession={vrLaunch.viewer.initialSession}
          notice={vrLaunch.viewer.notice}
          onImmersiveEnd={vrLaunch.handleImmersiveEnd}
          onClose={vrLaunch.close}
        />
      ) : null}
    </div>,
    document.body,
  );
}
