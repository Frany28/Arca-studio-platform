import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ButtonGroup } from "../ButtonGroupItem/ButtonGroupItem.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import { MODEL_3D_NAVIGATION_MODES, MODEL_3D_TEXTURE_PRESETS } from "./model3DViewerConfig.js";

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

export default function Model3DViewerControls({
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

