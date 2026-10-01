import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import "../../../config/modelViewer.js";
import MainLogo from "../../../assets/logos/MainLogo.jsx";
import AvatarLabel from "../../ui/AvatarLabel/AvatarLabel.jsx";
import Button from "../../ui/Button/Button.jsx";
import { ButtonGroup } from "../../ui/ButtonGroupItem/ButtonGroupItem.jsx";
import Label from "../../ui/Label/Label.jsx";
import TextArea from "../../ui/TextArea/TextArea.jsx";
import Tooltip from "../../ui/Tooltip/Tooltip.jsx";
import {
  getObservationTypeLabel,
  orderCommentsByThread,
} from "../../../utils/commentDisplay.js";
import { getFileDisplayName } from "../../../utils/fileDisplayName.js";
import { getToggledCommentId } from "../../../utils/commentSelection.js";
import { getVideoObservationTiming } from "../../../utils/videoObservation.js";
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
import ArchitecturalModelEffects from "./ArchitecturalModelEffects.jsx";
import ArchitecturalSettingsPanel from "./ArchitecturalSettingsPanel.jsx";
import ImageHighlighter from "./ImageHighlighter.jsx";
import { useImageComments } from "./useImageComments.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import VRModelViewer from "./VRModelViewer.jsx";
import ObservationTooltip from "../ObservationTooltip/ObservationTooltip.jsx";
import FileAttachmentIcons from "../FileAttachmentIcons/FileAttachmentIcons.jsx";
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
const VIEWER_3D_OBSERVATION_LABEL = getObservationTypeLabel("panorama");

function CloseIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.195262 0.195262C0.455612 -0.0650874 0.877722 -0.0650874 1.13807 0.195262L6 5.05719L10.8619 0.195263C11.1223 -0.0650867 11.5444 -0.0650866 11.8047 0.195263C12.0651 0.455612 12.0651 0.877722 11.8047 1.13807L6.94281 6L11.8047 10.8619C12.0651 11.1223 12.0651 11.5444 11.8047 11.8047C11.5444 12.0651 11.1223 12.0651 10.8619 11.8047L6 6.94281L1.13807 11.8047C0.877722 12.0651 0.455612 12.0651 0.195262 11.8047C-0.0650873 11.5444 -0.0650873 11.1223 0.195262 10.8619L5.05719 6L0.195262 1.13807C-0.0650874 0.877722 -0.0650874 0.455612 0.195262 0.195262Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MoreIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M4.167 10H4.176M10 10H10.009M15.833 10H15.842"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.92473 3.52462L15.0581 7.09129C18.2581 8.69129 18.2581 11.308 15.0581 12.908L7.92473 16.4746C3.12473 18.8746 1.1664 16.908 3.5664 12.1163L4.2914 10.6746C4.47473 10.308 4.47473 9.69962 4.2914 9.33296L3.5664 7.88296C1.1664 3.09129 3.13306 1.12462 7.92473 3.52462Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.53345 10H9.03345"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
        stroke="white"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 12.8804V11.1204C2 10.0804 2.85 9.22043 3.9 9.22043C5.71 9.22043 6.45 7.94042 5.54 6.37042C5.02 5.47042 5.33 4.30042 6.24 3.78042L7.97 2.79042C8.76 2.32042 9.78 2.60042 10.25 3.39042L10.36 3.58042C11.26 5.15042 12.74 5.15042 13.65 3.58042L13.76 3.39042C14.23 2.60042 15.25 2.32042 16.04 2.79042L17.77 3.78042C18.68 4.30042 18.99 5.47042 18.47 6.37042C17.56 7.94042 18.3 9.22043 20.11 9.22043C21.15 9.22043 22.01 10.0704 22.01 11.1204V12.8804C22.01 13.9204 21.16 14.7804 20.11 14.7804C18.3 14.7804 17.56 16.0604 18.47 17.6304C18.99 18.5404 18.68 19.7004 17.77 20.2204L16.04 21.2104C15.25 21.6804 14.23 21.4004 13.76 20.6104L13.65 20.4204C12.75 18.8504 11.27 18.8504 10.36 20.4204L10.25 20.6104C9.78 21.4004 8.76 21.6804 7.97 21.2104L6.24 20.2204C5.33 19.7004 5.02 18.5304 5.54 17.6304C6.45 16.0604 5.71 14.7804 3.9 14.7804C2.85 14.7804 2 13.9204 2 12.8804Z"
        stroke="white"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 10C2 9.46957 2.21071 8.96086 2.58579 8.58579C2.96086 8.21071 3.46957 8 4 8H20C20.5304 8 21.0391 8.21071 21.4142 8.58579C21.7893 8.96086 22 9.46957 22 10V17C22 17.5304 21.7893 18.0391 21.4142 18.4142C21.0391 18.7893 20.5304 19 20 19H16.132C15.7866 19 15.4471 18.9106 15.1466 18.7404C14.8461 18.5702 14.5947 18.3252 14.417 18.029L12.857 15.429C12.7681 15.2811 12.6425 15.1588 12.4923 15.0739C12.3421 14.989 12.1725 14.9443 12 14.9443C11.8275 14.9443 11.6579 14.989 11.5077 15.0739C11.3575 15.1588 11.2319 15.2811 11.143 15.429L9.583 18.029C9.40531 18.3252 9.15395 18.5702 8.8534 18.7404C8.55286 18.9106 8.21337 19 7.868 19H4C3.46957 19 2.96086 18.7893 2.58579 18.4142C2.21071 18.0391 2 17.5304 2 17V10ZM3.813 6.781C4.17819 6.23329 4.67291 5.78418 5.25327 5.4735C5.83364 5.16282 6.48171 5.00018 7.14 5H16.858C17.5165 5.00001 18.1647 5.16257 18.7453 5.47326C19.3258 5.78395 19.8207 6.23315 20.186 6.781L21 8H3L3.813 6.781Z"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M21 9V3H15"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 15V21H9"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 3L13.5 10.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 13.5L3 21"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      aria-hidden="true"
    >
      <path
        d="M16.25 5.625L8.125 13.75L3.75 9.375"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      aria-hidden="true"
    >
      <path
        d="M7.5 4.375L13.125 10L7.5 15.625"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      aria-hidden="true"
    >
      <path
        d="M12.5 4.375L6.875 10L12.5 15.625"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Model3DSettingsMenu({
  navigationMode,
  onClose,
  onNavigationModeChange,
  onTexturePresetChange,
  texturePreset,
}) {
  const [menuView, setMenuView] = useState("main");
  const menuItemClassName =
    "flex !h-[34px] !min-w-0 w-full items-center justify-between gap-[18px] rounded-[var(--radius-1)] !px-[8px] text-left text-body-3 text-[var(--color-neutral-100-uniform)] transition-colors hover:bg-[rgba(255,255,255,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neutral-100-uniform)]";
  const mutedClassName = "text-[rgba(255,255,255,0.72)]";

  const handleNavigationSelect = (nextMode) => {
    onNavigationModeChange(nextMode);
    onClose();
  };

  const handleTextureSelect = (nextPreset) => {
    onTexturePresetChange(nextPreset);
    onClose();
  };

  if (menuView === "navigation") {
    return (
      <div className="flex w-[224px] flex-col gap-[4px]">
        <button
          type="button"
          className={clsx(menuItemClassName, "justify-start gap-[6px]")}
          onClick={() => setMenuView("main")}
        >
          <ChevronLeftIcon />
          <span>Volver</span>
        </button>
        <div className="h-px bg-[rgba(255,255,255,0.12)]" />
        {Object.values(MODEL_3D_NAVIGATION_MODES).map((item) => (
          <button
            key={item.id}
            type="button"
            className={menuItemClassName}
            onClick={() => handleNavigationSelect(item.id)}
          >
            <span className="flex items-center gap-[8px]">
              <span className="inline-flex w-[16px] items-center justify-center">
                {navigationMode === item.id ? <CheckIcon /> : null}
              </span>
              <span>{item.label}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (menuView === "textures") {
    return (
      <div className="flex w-[224px] flex-col gap-[4px]">
        <button
          type="button"
          className={clsx(menuItemClassName, "justify-start gap-[6px]")}
          onClick={() => setMenuView("main")}
        >
          <ChevronLeftIcon />
          <span>Volver</span>
        </button>
        <div className="h-px bg-[rgba(255,255,255,0.12)]" />
        {Object.values(MODEL_3D_TEXTURE_PRESETS).map((item) => (
          <button
            key={item.id}
            type="button"
            className={menuItemClassName}
            onClick={() => handleTextureSelect(item.id)}
          >
            <span className="flex items-center gap-[8px]">
              <span className="inline-flex w-[16px] items-center justify-center">
                {texturePreset === item.id ? <CheckIcon /> : null}
              </span>
              <span>{item.label}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-[224px] flex-col gap-[4px]">
      <button
        type="button"
        className={menuItemClassName}
        onClick={() => setMenuView("navigation")}
      >
        <span className={mutedClassName}>Navegación</span>
        <span className="flex items-center gap-[6px]">
          <span>{MODEL_3D_NAVIGATION_MODES[navigationMode]?.label}</span>
          <ChevronRightIcon />
        </span>
      </button>
      <button
        type="button"
        className={menuItemClassName}
        onClick={() => setMenuView("textures")}
      >
        <span className={mutedClassName}>Calidad</span>
        <span className="flex items-center gap-[6px]">
          <span>{MODEL_3D_TEXTURE_PRESETS[texturePreset]?.label}</span>
          <ChevronRightIcon />
        </span>
      </button>
    </div>
  );
}

export function Model3DViewerControls({
  className,
  navigationMode = "drag",
  onNavigationModeChange,
  onView,
  isViewDisabled = false,
  viewLabel = "Abrir modo VR",
  onExpand,
  onTexturePresetChange,
  persistSelection = true,
  selectedIndex = null,
  texturePreset = "auto",
}) {
  const settingsMenuRef = useRef(null);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const canShowSettings = Boolean(onNavigationModeChange && onTexturePresetChange);
  const buttonGroupItems = useMemo(
    () => [
      {
        label: "Ajustes",
        showText: false,
        icon: <SettingsIcon />,
        disabled: !canShowSettings,
        "aria-label": "Ajustes del modelo 3D",
      },
      {
        label: "VR",
        showText: false,
        icon: <ViewIcon />,
        disabled: !onView || isViewDisabled,
        "aria-label": viewLabel,
      },
      {
        label: "Expandir",
        showText: false,
        icon: <ExpandIcon />,
        disabled: !onExpand,
        "aria-label": "Expandir modelo 3D",
      },
    ],
    [canShowSettings, isViewDisabled, onExpand, onView, viewLabel],
  );

  useEffect(() => {
    if (!isSettingsMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (settingsMenuRef.current?.contains(event.target)) {
        return;
      }

      setIsSettingsMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isSettingsMenuOpen]);

  if (canShowSettings) {
    return (
      <div ref={settingsMenuRef} className={className}>
        {isSettingsMenuOpen ? (
          <div className="absolute bottom-full right-0 z-30 mb-[8px]">
            <Tooltip
              content={
                <Model3DSettingsMenu
                  navigationMode={navigationMode}
                  texturePreset={texturePreset}
                  onClose={() => setIsSettingsMenuOpen(false)}
                  onNavigationModeChange={onNavigationModeChange}
                  onTexturePresetChange={onTexturePresetChange}
                />
              }
              showTip={false}
              className="border-[rgba(255,255,255,0.12)] bg-[rgba(20,24,27,0.88)] p-[6px] shadow-[0_12px_32px_rgba(0,0,0,0.32)] backdrop-blur-[10px]"
              aria-label="Ajustes del modelo 3D"
            />
          </div>
        ) : null}

        <ButtonGroup
          items={buttonGroupItems}
          persistSelection={persistSelection}
          selectedIndex={selectedIndex}
          onChange={(index) => {
            if (index === 0) {
              setIsSettingsMenuOpen((current) => !current);
            }

            if (index === 1) {
              setIsSettingsMenuOpen(false);
              onView?.();
            }

            if (index === 2) {
              setIsSettingsMenuOpen(false);
              onExpand?.();
            }
          }}
        />
      </div>
    );
  }

  return (
    <ButtonGroup
      items={buttonGroupItems}
      className={className}
      persistSelection={persistSelection}
      selectedIndex={selectedIndex}
      onChange={(index) => {
        if (index === 1) {
          onView?.();
        }

        if (index === 2) {
          onExpand?.();
        }
      }}
    />
  );
}

export function Model3DLoadingState({
  image,
  onRetry,
  progress,
  state = "loading",
}) {
  const isError = state === "error";
  const isSlow = state === "slow";
  const title = isError
    ? "No se pudo cargar la panorámica"
    : isSlow
      ? "La panorámica sigue cargando"
      : "Cargando panorámica 360";
  const description = isError
    ? "Revisa la conexión o intenta cargar el visor nuevamente."
    : isSlow
      ? "La imagen panorámica puede ser pesada o la conexión puede estar lenta."
      : "";

  return (
    <div className="pointer-events-auto absolute inset-0 z-10 h-full w-full overflow-hidden">
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-[-18px] h-[calc(100%+36px)] w-[calc(100%+36px)] object-cover blur-[14px] scale-105"
          aria-hidden="true"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_43%,#3a3a3a_0%,#262626_44%,#121212_100%)]" />
      )}
      <div className="absolute inset-0 bg-[rgba(0,0,0,0.58)] backdrop-blur-[12px]" />

      <div className="absolute left-1/2 top-1/2 flex w-[320px] max-w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[8px] text-center">
        <div className="flex w-full items-start justify-center">
          <p className="text-heading-8 text-[var(--color-neutral-100-uniform)]">
            {title}
          </p>
        </div>

        {description ? (
          <p className="text-body-3 text-[rgba(255,255,255,0.78)]">
            {description}
          </p>
        ) : null}

        {!isError ? (
          <div className="relative h-[8px] w-full overflow-hidden rounded-full bg-[var(--color-neutral-200)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent-300)] transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="mt-[4px] h-[36px] cursor-pointer rounded-[var(--radius-2)] bg-[var(--color-neutral-100)] px-[14px] text-heading-8 text-[var(--color-text-300)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
            onClick={onRetry}
          >
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

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
function ReplyArrowIcon({ className }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx("h-[16.5px] w-[16.5px] shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M6.75 13.5H4.5C3.25736 13.5 2.25 12.4926 2.25 11.25V4.5"
        stroke="var(--color-neutral-300)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.75 11.25L9 13.5L6.75 15.75"
        stroke="var(--color-neutral-300)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplyButton() {
  return (
    <div className="flex items-center gap-[4px]">
      <ReplyArrowIcon />
      <Button
        theme="Primary"
        type="Ghost"
        size="S"
        fitContent
        showLeftIcon={false}
        showRightIcon={false}
        className="!h-auto !px-0 !py-0 text-[var(--color-text-300)] hover:!bg-transparent hover:opacity-75"
      >
        Responder
      </Button>
    </div>
  );
}

function CommentCard({
  id,
  author,
  avatarSrc,
  time,
  body,
  image,
  mediaItem,
  mediaType = "render",
  message,
  name,
  observationTypeLabel,
  pointNumber,
  selection,
  selectionDisabled = false,
  timestamp,
  type = "comment",
  selectionActive = false,
  showReplyAction = false,
  onMoreClick,
  onReplyClick,
  onSelectionClick,
}) {
  const isReply = type === "reply";
  const displayAuthor = name ?? author;
  const displayTime = time ?? timestamp;
  const displayBody = body ?? message;
  const resolveString = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (typeof value === "object") {
      return value.name ?? value.email ?? JSON.stringify(value);
    }
    return String(value);
  };

  const safeDisplayAuthor = resolveString(displayAuthor);
  const safeDisplayTime = resolveString(displayTime);

  return (
    <div
      className={clsx(
        "flex w-full items-start",
        isReply ? "gap-[4px]" : "gap-0",
      )}
    >
      {isReply ? (
        <span className="mt-0 inline-flex size-[16.5px] shrink-0 items-start justify-center">
          <ReplyArrowIcon />
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
        <article className="relative flex min-w-0 flex-1 flex-col gap-[2px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-10)] p-[8px] transition-colors">
          <div className="flex w-full items-start pr-[28px]">
            <div className="flex min-w-0 items-center gap-[8px]">
              <AvatarLabel
                size="S"
                label={safeDisplayAuthor}
                showSubtitle={false}
                avatarTheme="Neutral"
                avatarContent={avatarSrc ? "Image" : "Text"}
                avatarName={safeDisplayAuthor}
                avatarSrc={avatarSrc}
                avatarAlt={safeDisplayAuthor}
                avatarDecorative={false}
              />
              <span className="shrink-0 text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
                {safeDisplayTime}
              </span>
            </div>

            <Tooltip
              asChild
              portal
              showTip
              text="Más opciones"
              tipPosition="Bottom right"
            >
              <button
                type="button"
                aria-label="Más opciones"
                aria-expanded={showReplyAction}
                aria-controls={`image-reply-action-${id}`}
                className="absolute right-[-1px] top-[-1px] flex cursor-pointer shrink-0 items-center justify-center rounded-[var(--radius-2)] p-[8px] text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-10)] hover:text-[var(--color-text-300)]"
                data-reply-interaction="true"
                onClick={onMoreClick}
              >
                <MoreIcon className="size-5" />
              </button>
            </Tooltip>
          </div>

          <p className="text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)]">
            {displayBody}
          </p>

          {selection && !isReply ? (
            <SelectionPreview
              active={selectionActive}
              fileType={mediaItem?.fileType}
              image={image}
              mediaType={mediaType}
              observationTitle={observationTypeLabel}
              pointNumber={pointNumber}
              selection={selection}
              disabled={selectionDisabled}
              compact
              onSelect={onSelectionClick}
            />
          ) : !isReply && mediaType === "video" ? (
            <MediaReferencePreview
              imageSrc={image?.src || mediaItem?.image}
              subtitle="Vista asociada a la observación"
              title="Video adjunto"
            />
          ) : null}
        </article>

        {showReplyAction ? (
          <Tooltip
            asChild
            text="Presiona para responder"
            tipPosition="Top center"
            showTip
            portal
          >
            <button
              id={`image-reply-action-${id}`}
              type="button"
              className="w-fit cursor-pointer"
              data-reply-interaction="true"
              onClick={onReplyClick}
            >
              <ReplyButton />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

export function SelectionPreview({
  active = false,
  compact = false,
  disabled = false,
  fileType = "PDF",
  image,
  mediaType = "render",
  observationTitle,
  onClear,
  onSelect,
  pointNumber,
  selection,
}) {
  if (!selection) {
    return null;
  }

  const videoTiming = getVideoObservationTiming(selection);
  const Container = onSelect && !onClear ? "button" : "div";

  if (videoTiming) {
    return (
      <Container
        type={onSelect ? "button" : undefined}
        disabled={onSelect ? disabled : undefined}
        className={clsx(
          "flex w-full items-center gap-[8px] rounded-[var(--radius-2)] border bg-[var(--color-neutral-100)] p-[6px] text-left transition-colors",
          active
            ? "border-[var(--color-accent-300)]"
            : "border-[var(--color-neutral-200)]",
          onSelect && !disabled &&
            "cursor-pointer hover:border-[var(--color-neutral-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]",
          onSelect && disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={onSelect}
      >
        <div className="flex size-[44px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-neutral-200)] text-[12px] font-semibold text-[var(--color-text-300)]">
          {videoTiming.videoTimeLabel}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-300)]">
            {observationTitle || "Observación sobre video"}
          </p>
          <p className="truncate text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
            Momento {videoTiming.videoTimeLabel}
          </p>
        </div>
        {onClear ? (
          <button
            type="button"
            aria-label="Quitar referencia"
            className="flex size-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
          >
            <CloseIcon className="size-3" />
          </button>
        ) : null}
      </Container>
    );
  }

  const isViewerPoint = ["panorama-point", "viewer3d-point"].includes(selection.kind);
  const isDocumentPoint = selection.kind === "document-point";
  const pixels = selection.imagePixels ?? selection.displayPixels;
  const naturalSize = selection.naturalSize ?? {
    height: pixels?.height || 1,
    width: pixels?.width || 1,
  };
  const imageSrc = image?.src ?? selection.imageSrc;
  const safeWidth = Math.max(pixels?.width || 1, 1);
  const safeHeight = Math.max(pixels?.height || 1, 1);
  const panoramaOrientation = isViewerPoint
    ? getPanoramaOrientation(selection)
    : null;
  const panoramaU = panoramaOrientation
    ? ((((panoramaOrientation.yaw + 180) % 360) + 360) % 360) / 360
    : null;
  const panoramaV = panoramaOrientation
    ? Math.min(Math.max((90 - panoramaOrientation.pitch) / 180, 0), 1)
    : null;
  const bgSize = imageSrc
    ? isViewerPoint && panoramaOrientation
      ? "400% 200%"
      : `${(naturalSize.width / safeWidth) * 100}% ${(naturalSize.height / safeHeight) * 100}%`
    : undefined;
  const bgPosition = imageSrc
    ? isViewerPoint && panoramaOrientation
      ? `${Math.min(Math.max(((panoramaU * 4 - 0.5) / 3) * 100, 0), 100)}% ${Math.min(Math.max((panoramaV * 2 - 0.5) * 100, 0), 100)}%`
      : `${naturalSize.width === safeWidth ? 0 : (pixels.x / (naturalSize.width - safeWidth)) * 100}% ${
          naturalSize.height === safeHeight
            ? 0
            : (pixels.y / (naturalSize.height - safeHeight)) * 100
        }%`
    : undefined;

  const referenceNumber = Number(pointNumber) || null;
  const documentReferenceLabel = isDocumentPoint
    ? String(selection.pageNumber || "—")
    : selection.kind === "document-section-point"
      ? String(Number(selection.sectionIndex) + 1)
      : selection.kind === "document-cell-point"
        ? selection.cell
        : "—";
  const documentReferenceCaption = isDocumentPoint
    ? "Página"
    : selection.kind === "document-section-point"
      ? "Sección"
      : selection.kind === "document-cell-point"
        ? "Celda"
        : "Referencia";
  const referenceTitle =
    observationTitle ||
    (mediaType === "panorama"
      ? "Observación en panorámica 360"
      : mediaType === "image"
      ? "Observación sobre imagen"
      : mediaType === "video"
        ? "Observación sobre video"
        : mediaType === "document"
          ? "Observación sobre documento"
          : "Observación en modelo 3D");
  const referenceSubtitle =
    mediaType === "panorama"
      ? "Punto señalado en la panorámica"
      : mediaType === "image"
      ? "Área señalada en la imagen"
      : isDocumentPoint
        ? `Página ${selection.pageNumber}`
        : mediaType === "document"
          ? `${documentReferenceCaption} ${documentReferenceLabel}`
        : "Punto señalado en el modelo 3D";

  return (
    <Container
      type={onSelect ? "button" : undefined}
      disabled={onSelect ? disabled : undefined}
      className={clsx(
        "flex w-full items-center gap-[8px] rounded-[var(--radius-2)] border bg-[var(--color-neutral-100)] p-[6px] text-left transition-colors",
        active
          ? "border-[var(--color-accent-300)]"
          : "border-[var(--color-neutral-200)]",
        onSelect && !disabled &&
          "cursor-pointer hover:border-[var(--color-neutral-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]",
        onSelect && disabled && "cursor-not-allowed opacity-60",
      )}
      onClick={onSelect}
    >
      <div
        className={clsx(
          "relative shrink-0 overflow-hidden rounded-[6px] bg-[var(--color-neutral-200)]",
          isViewerPoint &&
            !imageSrc &&
            "relative bg-[radial-gradient(circle_at_50%_50%,rgba(255,68,49,0.42)_0%,rgba(255,68,49,0.18)_24%,rgba(42,41,41,0.95)_25%,rgba(42,41,41,0.95)_100%)]",
          mediaType === "document" &&
            "flex items-center justify-center rounded-[var(--radius-1)] border-0 bg-transparent",
          mediaType === "document"
            ? compact ? "size-[36px]" : "size-[40px]"
            : compact ? "size-[44px]" : "size-[56px]",
        )}
        style={
          imageSrc
            ? {
                backgroundImage: `url(${imageSrc})`,
                backgroundPosition: bgPosition,
                backgroundRepeat: "no-repeat",
                backgroundSize: bgSize,
              }
            : undefined
        }
        aria-hidden="true"
      >
        {isViewerPoint && !imageSrc ? (
          <span className="absolute left-1/2 top-1/2 size-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent-300)] shadow-[0_0_0_4px_rgba(255,68,49,0.22)]" />
        ) : null}
        {mediaType === "document" ? (
          <FileAttachmentIcons
            aria-label={`Documento ${fileType}`}
            className="scale-[0.8]"
            type={fileType}
          />
        ) : referenceNumber ? (
          <span className="absolute left-1/2 top-1/2 flex size-[24px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--color-neutral-100-uniform)] bg-[var(--color-accent-300)] text-[11px] font-semibold leading-none text-[var(--color-neutral-100-uniform)] shadow-[0_0_0_4px_rgba(255,68,49,0.22),0_2px_8px_rgba(0,0,0,0.28)]">
            {referenceNumber}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-300)]">
          {referenceTitle}
        </p>
        <p className="truncate text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
          {referenceSubtitle}
        </p>
      </div>
      {onClear ? (
        <button
          type="button"
          aria-label="Quitar referencia"
          className="flex size-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
        >
          <CloseIcon className="size-3" />
        </button>
      ) : null}
    </Container>
  );
}

function MediaReferencePreview({ imageSrc, subtitle, title }) {
  if (!imageSrc) {
    return null;
  }

  return (
    <div className="flex w-full items-center gap-[8px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[6px] text-left">
      <div
        className="relative size-[44px] shrink-0 overflow-hidden rounded-[6px] bg-[var(--color-neutral-200)] bg-cover bg-center"
        style={{ backgroundImage: `url(${imageSrc})` }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-300)]">
          {title}
        </p>
        <p className="truncate text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function MessageInput({
  disabled = false,
  fileType,
  focusSignal,
  mediaType = "render",
  onClearSelection,
  onSubmit,
  pendingSelection,
  placeholder,
  multiline = false,
  requireSelection = false,
}) {
  const fieldRef = useRef(null);
  const fieldId = useId();
  const [textAreaValue, setTextAreaValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedValue = textAreaValue.trim();

  useEffect(() => {
    if (!focusSignal) {
      return;
    }

    const field = fieldRef.current?.querySelector("textarea, input");

    field?.focus?.();
    field?.scrollIntoView?.({
      block: "nearest",
      behavior: "smooth",
    });
  }, [focusSignal]);

  async function handleSubmit() {
    if (disabled || isSubmitting || !trimmedValue || (requireSelection && !pendingSelection)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit?.(trimmedValue);
      setTextAreaValue("");
    } catch {
      // The caller renders the request error; keep the draft available to retry.
    } finally {
      setIsSubmitting(false);
    }
  }

  return multiline ? (
    <div ref={fieldRef} className="flex flex-col gap-[8px]">
      <Label
        htmlFor={fieldId}
        label="Observación general"
        information={false}
        required={false}
      />
      {pendingSelection ? (
        <SelectionPreview
          fileType={fileType}
          image={pendingSelection.image}
          mediaType={mediaType}
          pointNumber={pendingSelection.pointNumber}
          selection={pendingSelection}
          onClear={onClearSelection}
        />
      ) : null}
      <TextArea
        id={fieldId}
        disabled={disabled || isSubmitting || (requireSelection && !pendingSelection)}
        showLabel={false}
        placeholder={
          disabled
            ? placeholder
            : requireSelection && !pendingSelection
              ? "Selecciona un punto en el documento"
              : placeholder
        }
        value={textAreaValue}
        showHint={false}
        showLabelInfo={false}
        minHeight={104}
        rows={4}
        className="!max-w-none"
        onChange={(event) => setTextAreaValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      />
      <div className="flex justify-end">
        <Tooltip asChild portal showTip text="Enviar observación" tipPosition="Top right">
          <button
            type="button"
            aria-label="Enviar observación"
            disabled={
              disabled ||
              isSubmitting ||
              !trimmedValue ||
              (requireSelection && !pendingSelection)
            }
            className="flex size-8 cursor-pointer items-center justify-center rounded-[var(--radius-2)] text-[var(--color-neutral-300)] transition-colors hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-300)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleSubmit}
          >
            <SendIcon className="size-5" />
          </button>
        </Tooltip>
      </div>
    </div>
  ) : (
    <div ref={fieldRef} className="flex w-full items-start gap-[4px]">
      <ReplyArrowIcon />

      <div className="flex min-w-0 flex-1 items-center rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[12px] py-[8px]">
        <input
          type="text"
          placeholder={placeholder}
          value={textAreaValue}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)] outline-none placeholder:text-[var(--color-text-100)]"
          onChange={(event) => setTextAreaValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />

        <Tooltip asChild portal showTip text="Enviar mensaje" tipPosition="Top right">
          <button
            type="button"
            aria-label="Enviar mensaje"
            disabled={!trimmedValue}
            className="flex size-5 cursor-pointer shrink-0 items-center justify-center text-[var(--color-neutral-300)] hover:text-[var(--color-text-300)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleSubmit}
          >
            <SendIcon className="size-5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function ReplyComposer({ disabled = false, focusSignal, onSubmit, placeholder = "Escribe tu mensaje..." }) {
  return (
    <div data-reply-interaction="true">
      <MessageInput disabled={disabled} focusSignal={focusSignal} placeholder={placeholder} onSubmit={onSubmit} />
    </div>
  );
}

function isPanoramaPointSelection(selection) {
  return ["panorama-point", "viewer3d-point"].includes(selection?.kind);
}

function getViewerPointPosition(selection) {
  if (isPanoramaPointSelection(selection) && selection.viewerPoint) {
    const x = Number(selection.viewerPoint.normalizedX);
    const y = Number(selection.viewerPoint.normalizedY);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      x,
      y,
    };
  }

  const pixels = selection?.displayPixels ?? selection?.imagePixels;
  const naturalSize = selection?.naturalSize;

  if (!pixels || !naturalSize?.width || !naturalSize?.height) {
    return null;
  }

  const x = (pixels.x + pixels.width / 2) / naturalSize.width;
  const y = (pixels.y + pixels.height / 2) / naturalSize.height;

  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function formatModelViewerPosition(vector) {
  if (!vector) {
    return null;
  }

  if (typeof vector === "string") {
    const position = vector
      .trim()
      .split(/\s+/)
      .map((value) => (/[a-z%]+$/i.test(value) ? value : `${value}m`))
      .join(" ");

    return position ? position : null;
  }

  const { x, y, z } = vector;

  if (![x, y, z].every((value) => Number.isFinite(value))) {
    return null;
  }

  return `${x}m ${y}m ${z}m`;
}

function getModelViewerDimensionRadius(modelViewer) {
  const dimensions = getModelViewerDimensions(modelViewer);

  if (!dimensions) {
    return null;
  }

  return Math.max(dimensions.max * 0.08, dimensions.min * 0.8, 0.25);
}

function formatModelViewerNormal(vector) {
  if (!vector) {
    return null;
  }

  if (typeof vector === "string") {
    const normal = vector.trim();

    return normal ? normal : null;
  }

  const { x, y, z } = vector;

  if (![x, y, z].every((value) => Number.isFinite(value))) {
    return null;
  }

  return `${x} ${y} ${z}`;
}

function getViewerModelPoint(selection) {
  const viewerPoint = selection?.viewerPoint;
  const position = formatModelViewerPosition(viewerPoint?.modelPosition);
  const normal = formatModelViewerNormal(viewerPoint?.modelNormal);

  if (!position || !normal) {
    return null;
  }

  return { normal, position };
}

function Model3DAnnotationMarker({
  active = false,
  className,
  item,
  onSelect,
  onReply,
  style,
  ...props
}) {
  const markerRef = useRef(null);
  const tooltipCloseTimerRef = useRef(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  useEffect(() => () => window.clearTimeout(tooltipCloseTimerRef.current), []);
  const pointNumber = Number(item.pointNumber) || "";
  const tooltipText = pointNumber
    ? `${VIEWER_3D_OBSERVATION_LABEL} ${pointNumber}`
    : VIEWER_3D_OBSERVATION_LABEL;
  const canShowTooltip =
    tooltipOpen && !item.pending && tooltipPosition && typeof document !== "undefined";

  const openTooltip = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
    const rect = markerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setTooltipPosition({
      anchorBottom: rect.bottom,
      anchorTop: rect.top,
      anchorX: rect.left + rect.width / 2,
    });
    setTooltipOpen(true);
  };
  const scheduleTooltipClose = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
    tooltipCloseTimerRef.current = window.setTimeout(() => setTooltipOpen(false), 120);
  };

  useEffect(() => {
    if (!tooltipOpen) return undefined;
    let frameId;
    let previous = "";
    const followMarker = () => {
      const rect = markerRef.current?.getBoundingClientRect();
      if (rect) {
        const signature = `${rect.left.toFixed(1)}:${rect.top.toFixed(1)}:${rect.bottom.toFixed(1)}:${rect.width.toFixed(1)}`;
        if (signature !== previous) {
          previous = signature;
          setTooltipPosition({
            anchorBottom: rect.bottom,
            anchorTop: rect.top,
            anchorX: rect.left + rect.width / 2,
          });
        }
      }
      frameId = window.requestAnimationFrame(followMarker);
    };
    frameId = window.requestAnimationFrame(followMarker);
    return () => window.cancelAnimationFrame(frameId);
  }, [tooltipOpen]);

  return (
    <>
      <button
        type="button"
        ref={markerRef}
        className={clsx(
          "group relative flex size-[40px] appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 transition-[opacity,transform] duration-200 ease-out",
          item.pending
            ? "pointer-events-none"
            : "pointer-events-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neutral-100-uniform)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-accent-300)]",
          active && "scale-125",
          item.pending && "animate-pulse",
          className,
        )}
        style={style}
        aria-label={tooltipText}
        onFocus={openTooltip}
        onBlur={scheduleTooltipClose}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleTooltipClose}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!item.pending) {
            onSelect?.(item.id);
          }
        }}
        {...props}
      >
        <span className="flex h-[24px] min-h-[24px] w-[24px] min-w-[24px] flex-none items-center justify-center rounded-full border-2 border-[var(--color-neutral-100-uniform)] bg-[var(--color-accent-300)] text-[11px] font-semibold leading-none text-[var(--color-neutral-100-uniform)] shadow-[0_0_0_4px_rgba(255,68,49,0.22),0_2px_8px_rgba(0,0,0,0.28)] transition-[box-shadow,transform,filter] duration-200 ease-out group-hover:scale-[1.08] group-hover:brightness-110 group-hover:shadow-[0_0_0_6px_rgba(255,68,49,0.18),0_4px_12px_rgba(0,0,0,0.32)] group-focus-visible:scale-[1.08]">
          {item.pending ? "" : pointNumber}
        </span>
      </button>

      {canShowTooltip ? (
        <ObservationTooltip
          authorName={item.name || item.author?.name}
          avatarSrc={item.avatarSrc}
          message={item.message || item.content}
          replyCount={item.replyCount}
          open={tooltipOpen}
          position={tooltipPosition}
          onOpenChange={(nextOpen) => nextOpen ? openTooltip() : scheduleTooltipClose()}
          onReply={onReply ? () => onReply(item.id) : undefined}
        />
      ) : null}
    </>
  );
}

function Model3DHotspots({
  annotations = [],
  focusedAnnotationId = null,
  onAnnotationReply,
  onAnnotationSelect,
  pendingSelection = null,
}) {
  const hotspotItems = [
    ...annotations.map((comment) => ({
      id: comment.id,
      active: String(comment.id) === String(focusedAnnotationId),
      pointNumber: comment.pointNumber,
      selection: comment.selection,
      name: comment.name,
      avatarSrc: comment.avatarSrc,
      message: comment.message,
      author: comment.author,
      content: comment.content,
      replyCount: comment.replyCount,
    })),
    pendingSelection
      ? {
          id: "pending",
          active: true,
          pending: true,
          selection: pendingSelection,
        }
      : null,
  ].filter(Boolean);

  return (
    <>
      {hotspotItems.map((item) => {
        const point = getViewerModelPoint(item.selection);

        if (!point) {
          return null;
        }

        return (
          <Model3DAnnotationMarker
            key={item.id}
            item={item}
            slot={`hotspot-viewer3d-comment-${item.id}`}
            data-position={point.position}
            data-normal={point.normal}
            data-visibility-attribute="visible"
            style={{
              opacity: "var(--min-hotspot-opacity, 1)",
            }}
            active={item.active}
            onSelect={onAnnotationSelect}
            onReply={onAnnotationReply}
          />
        );
      })}
    </>
  );
}

function Model3DCommentMarkers({
  annotations = [],
  focusedAnnotationId = null,
  modelViewerRef,
  onAnnotationReply,
  onAnnotationSelect,
  pendingSelection = null,
}) {
  const markerItems = useMemo(
    () => [
      ...annotations.map((comment) => ({
        id: comment.id,
        active: String(comment.id) === String(focusedAnnotationId),
        pointNumber: comment.pointNumber,
        selection: comment.selection,
        name: comment.name,
        avatarSrc: comment.avatarSrc,
        message: comment.message,
        author: comment.author,
        content: comment.content,
        replyCount: comment.replyCount,
      })),
      pendingSelection
        ? {
            id: "pending",
            active: true,
            pending: true,
            selection: pendingSelection,
          }
        : null,
    ].filter(Boolean),
    [annotations, focusedAnnotationId, pendingSelection],
  );
  const [projectedPoints, setProjectedPoints] = useState({});

  useEffect(() => {
    let frameId;
    let previousSignature = "";
    const update = () => {
      const viewer = modelViewerRef?.current;
      const next = {};
      markerItems.forEach((item) => {
        const orientation = getPanoramaOrientation(item.selection);
        const projected = orientation
          ? viewer?.projectPanoramaPoint?.(orientation.yaw, orientation.pitch)
          : null;
        const fallback = getViewerPointPosition(item.selection);
        next[item.id] = projected || (fallback
          ? { visible: true, x: fallback.x, y: fallback.y }
          : { visible: false, x: 0, y: 0 });
      });
      const signature = Object.entries(next)
        .map(([id, point]) => `${id}:${point.visible ? 1 : 0}:${point.x.toFixed(4)}:${point.y.toFixed(4)}`)
        .join("|");
      if (signature !== previousSignature) {
        previousSignature = signature;
        setProjectedPoints(next);
      }
      frameId = window.requestAnimationFrame(update);
    };
    frameId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameId);
  }, [markerItems, modelViewerRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[12]">
      {markerItems.map((item) => {
        const point = projectedPoints[item.id];

        if (!point?.visible) {
          return null;
        }

        return (
          <Model3DAnnotationMarker
            key={item.id}
            item={item}
            className="-translate-x-1/2 -translate-y-1/2 transition-transform"
            style={{
              left: `${Math.min(Math.max(point.x, 0), 1) * 100}%`,
              position: "absolute",
              top: `${Math.min(Math.max(point.y, 0), 1) * 100}%`,
            }}
            active={item.active}
            onSelect={onAnnotationSelect}
            onReply={onAnnotationReply}
          />
        );
      })}
    </div>
  );
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

export function GeneralCommentsDrawer({
  composerDisabled = false,
  composerDisabledMessage = "",
  commentsError = "",
  composerFocusSignal,
  comments = [],
  focusedSelectionCommentId = null,
  mediaItem = null,
  mediaType = "render",
  onClearSelection,
  onSelectionPreviewClick,
  onSubmitComment,
  pendingSelection,
  replyRequest = null,
  requireSelectionForRoot = false,
  selectionDisabled = false,
}) {
  const { message: readOnlyMessage, readOnly } = useProjectReadOnly();
  const [visibleReplyAction, setVisibleReplyAction] = useState(null);
  const [activeReplyComposer, setActiveReplyComposer] = useState(null);
  const commentRefs = useRef(new Map());
  const orderedComments = orderCommentsByThread(comments);
  const resolvedComposerDisabled = composerDisabled || readOnly;
  const resolvedComposerDisabledMessage = readOnly
    ? readOnlyMessage
    : composerDisabledMessage;
  const resolvedSelectionDisabled = selectionDisabled || readOnly;

  useEffect(() => {
    if (!replyRequest?.commentId) return;
    const frameId = window.requestAnimationFrame(() => {
      setVisibleReplyAction(null);
      setActiveReplyComposer(replyRequest.commentId);
      commentRefs.current.get(String(replyRequest.commentId))?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [replyRequest]);

  useEffect(() => {
    if (!focusedSelectionCommentId) {
      return;
    }

    const element = commentRefs.current.get(String(focusedSelectionCommentId));

    element?.scrollIntoView?.({
      block: "nearest",
      behavior: "smooth",
    });
  }, [focusedSelectionCommentId]);

  useEffect(() => {
    if (!visibleReplyAction && !activeReplyComposer) {
      return undefined;
    }

    function handlePointerDown(event) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-reply-interaction='true']")
      ) {
        return;
      }

      setVisibleReplyAction(null);
      setActiveReplyComposer(null);
    }

    window.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [visibleReplyAction, activeReplyComposer]);

  function handleMoreClick(commentId) {
    if (resolvedComposerDisabled) return;
    setActiveReplyComposer(null);
    setVisibleReplyAction((currentId) =>
      currentId === commentId ? null : commentId,
    );
  }

  function handleReplyClick(commentId) {
    if (resolvedComposerDisabled) return;
    setVisibleReplyAction(null);
    setActiveReplyComposer(commentId);
  }

  async function handleCommentSubmit(message, parentComment = null) {
    const parentCommentId =
      parentComment && typeof parentComment === "object"
        ? parentComment.parentCommentId || parentComment.id
        : parentComment;

    await onSubmitComment?.({
      message,
      parentCommentId,
      selection: parentCommentId ? null : pendingSelection,
    });

    if (parentCommentId) {
      setActiveReplyComposer(null);
    }
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px]">
      <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <MessageInput
          disabled={resolvedComposerDisabled}
          fileType={mediaItem?.fileType}
          focusSignal={composerFocusSignal}
          multiline
          mediaType={mediaType}
          pendingSelection={pendingSelection}
          requireSelection={requireSelectionForRoot}
          placeholder="Escribe algo..."
          onClearSelection={onClearSelection}
          onSubmit={(message) => handleCommentSubmit(message)}
        />
        {resolvedComposerDisabled && resolvedComposerDisabledMessage ? (
          <p className="text-[12px] leading-[16px] text-[var(--color-text-100)]">
            {resolvedComposerDisabledMessage}
          </p>
        ) : null}
        {commentsError ? (
          <p role="alert" className="text-[12px] leading-[16px] text-[var(--color-danger-300)]">
            {commentsError}
          </p>
        ) : null}

        <div className="flex flex-col gap-[8px]">
          {orderedComments.map((comment) => (
            <div
              key={comment.id}
              ref={(element) => {
                const key = String(comment.id);

                if (element) {
                  commentRefs.current.set(key, element);
                  return;
                }

                commentRefs.current.delete(key);
              }}
              className="flex flex-col gap-[8px]"
            >
              <CommentCard
                {...comment}
                mediaItem={mediaItem}
                mediaType={mediaType}
                selectionActive={
                  String(focusedSelectionCommentId) === String(comment.id)
                }
                selectionDisabled={resolvedSelectionDisabled}
                showReplyAction={!resolvedComposerDisabled && visibleReplyAction === comment.id}
                onMoreClick={resolvedComposerDisabled ? undefined : () => handleMoreClick(comment.id)}
                onReplyClick={resolvedComposerDisabled ? undefined : () => handleReplyClick(comment.id)}
                onSelectionClick={
                  comment.selection
                    ? () => onSelectionPreviewClick?.(comment.id)
                    : undefined
                }
              />

              {activeReplyComposer === comment.id ? (
                <ReplyComposer
                  disabled={resolvedComposerDisabled}
                  focusSignal={replyRequest?.requestId || comment.id}
                  onSubmit={(message) =>
                    handleCommentSubmit(message, comment)
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
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
