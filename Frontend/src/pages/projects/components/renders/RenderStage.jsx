import { useEffect, useRef, useState } from "react";
import "../../../../config/modelViewer.js";
import MainLogo from "../../../../assets/logos/MainLogo.jsx";
import Model3DViewerControls from "../../../../components/ui/Gallery/Model3DViewerControls.jsx";
import {
  MODEL_3D_CAMERA_CONTROLS,
  MODEL_3D_NAVIGATION_MODES,
  MODEL_3D_TEXTURE_PRESETS,
} from "../../../../components/ui/Gallery/model3DViewerConfig.js";
import { useSketchfabLikeModelWheel } from "../../../../hooks/useSketchfabLikeModelWheel.js";
import {
  classifyArchitecturalMaterial,
  enhanceModelViewerMaterials,
  getStableMaterialKey,
  getArchitecturalEnvironmentImage,
} from "../../../../utils/architecturalRendering.js";
import ArchitecturalModelEffects from "../../../../components/ui/Gallery/ArchitecturalModelEffects.jsx";
import ArchitecturalSettingsPanel from "../../../../components/ui/Gallery/ArchitecturalSettingsPanel.jsx";
import { getFileDisplayName } from "../../../../utils/fileDisplayName.js";
import RenderLoadingState from "./RenderLoadingState.jsx";

const MODEL_VIEWER_BACKGROUND =
  "radial-gradient(circle at 50% 38%, #3b3b3b 0%, #232323 48%, #101010 100%)";
const MODEL_VIEWER_BACKGROUND_COLOR = "#171717";

export default function RenderStage({
  activeRender,
  isLoading,
  loadState,
  modelReloadKey,
  onModelRetry,
  progress,
  onModelError,
  onModelLoad,
  onModelProgress,
  onOpenModel,
  onOpenVR,
  isVrChecking,
  renderSettingsState,
}) {
  const modelViewerRef = useRef(null);
  const modelSrc = activeRender.modelUrl || activeRender.fileUrl || null;
  const hasInteractiveModel = Boolean(modelSrc);
  const hasPreviewImage = Boolean(activeRender.image);
  const [navigationMode, setNavigationMode] = useState("drag");
  const [texturePreset, setTexturePreset] = useState("auto");
  const [architecturalMaterials, setArchitecturalMaterials] = useState([]);
  const activeNavigationMode =
    MODEL_3D_NAVIGATION_MODES[navigationMode] ?? MODEL_3D_NAVIGATION_MODES.drag;
  const activeTexturePreset =
    MODEL_3D_TEXTURE_PRESETS[texturePreset] ?? MODEL_3D_TEXTURE_PRESETS.auto;
  const renderSettings = renderSettingsState.settings;

  useEffect(() => {
    setNavigationMode("drag");
    setTexturePreset("auto");
  }, [modelSrc]);

  useSketchfabLikeModelWheel(modelViewerRef, hasInteractiveModel && !isLoading);

  useEffect(() => {
    const modelViewer = modelViewerRef.current;

    if (!modelViewer || !hasInteractiveModel) {
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
      onModelLoad?.();
    }

    function handleError() {
      onModelError?.();
    }

    function handleProgress(event) {
      const totalProgress = Number(event.detail?.totalProgress);

      if (Number.isFinite(totalProgress)) {
        onModelProgress?.(Math.round(totalProgress * 100));
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
    hasInteractiveModel,
    modelReloadKey,
    modelSrc,
    onModelError,
    onModelLoad,
    onModelProgress,
    renderSettings,
  ]);

  return (
    <div className="flex w-[888px] max-w-full shrink-0 flex-col gap-[8px] max-[1280px]:min-w-0 max-[1280px]:flex-1 max-[1024px]:w-full max-[1024px]:flex-none">
      <div className="group relative h-[480px] w-full overflow-hidden rounded-[var(--radius-3)] bg-[#171717] text-left max-[1024px]:h-[398px] max-[640px]:h-[280px]">
        {hasInteractiveModel ? (
          <>
            <model-viewer
              key={`${modelSrc}-${modelReloadKey}`}
              ref={modelViewerRef}
              src={modelSrc}
              navigation-mode={navigationMode}
              quality-preset={texturePreset}
              poster={activeRender.image || undefined}
              alt={activeRender.title}
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
              style={{
                background: MODEL_VIEWER_BACKGROUND,
                backgroundColor: MODEL_VIEWER_BACKGROUND_COLOR,
                display: "block",
                filter: activeTexturePreset.filter,
                height: "100%",
                "--poster-color": "transparent",
                width: "100%",
              }}
            >
              <ArchitecturalModelEffects settings={renderSettings} />
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
            {isLoading ? (
              <RenderLoadingState
                image={activeRender.image}
                onRetry={onModelRetry}
                progress={progress}
                state={loadState}
              />
            ) : null}
          </>
        ) : hasPreviewImage ? (
          <button
            type="button"
            className="h-full w-full cursor-pointer text-left transition-opacity duration-150 hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-bg)]"
            onClick={onOpenModel}
            aria-label={`Abrir modelo 3D ${activeRender.title}`}
          >
            <img
              src={activeRender.image}
              alt={activeRender.title}
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-[8px] bg-[var(--color-neutral-200)] px-[24px] text-center">
            <span className="text-heading-4 text-[var(--color-text-300)]">
              Modelo 3D
            </span>
            <span className="max-w-[360px] text-body-3 text-[var(--color-text-100)]">
              {getFileDisplayName(activeRender.title)}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-[linear-gradient(180deg,rgba(0,0,0,0.22)_0%,rgba(0,0,0,0)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[156px] bg-[linear-gradient(0deg,rgba(0,0,0,0.28)_0%,rgba(0,0,0,0)_100%)]" />
        <div className="pointer-events-none absolute left-[12px] top-[12px] z-10">
          <MainLogo size="32px" appearance="dark" alt="ARCA Studio" />
        </div>

        {hasInteractiveModel || hasPreviewImage ? (
          <Model3DViewerControls
            onExpand={onOpenModel}
            navigationMode={navigationMode}
            onNavigationModeChange={hasInteractiveModel ? setNavigationMode : null}
            onTexturePresetChange={hasInteractiveModel ? setTexturePreset : null}
            onView={hasInteractiveModel ? onOpenVR : null}
            isViewDisabled={isVrChecking}
            viewLabel={isVrChecking ? "Comprobando visor VR" : "Ver en VR"}
            persistSelection={false}
            texturePreset={texturePreset}
            className="pointer-events-auto absolute bottom-[12px] right-[12px] z-20 opacity-100 [&_button]:h-[40px] [&_button]:min-w-[52px] [&_button]:px-[16px]"
          />
        ) : null}
      </div>

      <h2 className="text-heading-4 text-[var(--color-text-300)]">
        {getFileDisplayName(activeRender.title)}
      </h2>
    </div>
  );
}
