import { useId, useState } from "react";
import clsx from "clsx";
import TabItem from "./TabItem/TabItem.jsx";

const DEFAULT_ITEMS = [
  { id: "profile", label: "Perfil", icon: "profile" },
  { id: "security", label: "Seguridad", icon: "security" },
  { id: "preferences", label: "Preferencias", icon: "preferences" },
  { id: "support", label: "Soporte", icon: "support" },
];

function ProfileIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 10.0003C12.3012 10.0003 14.1667 8.13485 14.1667 5.83366C14.1667 3.53247 12.3012 1.66699 10 1.66699C7.69885 1.66699 5.83337 3.53247 5.83337 5.83366C5.83337 8.13485 7.69885 10.0003 10 10.0003Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.1583 18.3333C17.1583 15.1083 13.95 12.5 10 12.5C6.05001 12.5 2.84167 15.1083 2.84167 18.3333"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SecurityIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8.74179 1.85781L4.58346 3.41614C3.62513 3.77448 2.8418 4.9078 2.8418 5.9328V12.1245C2.8418 13.1078 3.49181 14.3995 4.28347 14.9911L7.8668 17.6661C9.0418 18.5495 10.9751 18.5495 12.1501 17.6661L15.7335 14.9911C16.5251 14.3995 17.1751 13.1078 17.1751 12.1245V5.9328C17.1751 4.9078 16.3918 3.77448 15.4335 3.41614L11.2751 1.85781C10.5668 1.59948 9.43345 1.59948 8.74179 1.85781Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.0001 9.10034C9.96674 9.10034 9.92507 9.10034 9.89173 9.10034C9.1084 9.07534 8.4834 8.42533 8.4834 7.63367C8.4834 6.82533 9.14174 6.16699 9.95007 6.16699C10.7584 6.16699 11.4167 6.82533 11.4167 7.63367C11.4084 8.43367 10.7834 9.07534 10.0001 9.10034Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.3417 11.4338C7.5417 11.9671 7.5417 12.8421 8.3417 13.3754C9.25003 13.9838 10.7417 13.9838 11.65 13.3754C12.45 12.8421 12.45 11.9671 11.65 11.4338C10.75 10.8255 9.25837 10.8255 8.3417 11.4338Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PreferencesIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M18.3334 5.41699H13.3334"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.99996 5.41699H1.66663"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.33329 8.33333C9.94412 8.33333 11.25 7.0275 11.25 5.41667C11.25 3.80584 9.94412 2.5 8.33329 2.5C6.72246 2.5 5.41663 3.80584 5.41663 5.41667C5.41663 7.0275 6.72246 8.33333 8.33329 8.33333Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.3333 14.583H15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.66663 14.583H1.66663"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.6667 17.5003C13.2775 17.5003 14.5833 16.1945 14.5833 14.5837C14.5833 12.9728 13.2775 11.667 11.6667 11.667C10.0558 11.667 8.75 12.9728 8.75 14.5837C8.75 16.1945 10.0558 17.5003 11.6667 17.5003Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SupportIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M4.55004 15.408V12.9747C4.55004 12.1663 5.18337 11.4413 6.08337 11.4413C6.89171 11.4413 7.61671 12.0747 7.61671 12.9747V15.3163C7.61671 16.9413 6.26671 18.2913 4.64171 18.2913C3.01671 18.2913 1.66671 16.933 1.66671 15.3163V10.183C1.57504 5.49967 5.27504 1.70801 9.95837 1.70801C14.6417 1.70801 18.3334 5.49967 18.3334 10.0913V15.2247C18.3334 16.8497 16.9834 18.1997 15.3584 18.1997C13.7334 18.1997 12.3834 16.8497 12.3834 15.2247V12.883C12.3834 12.0747 13.0167 11.3497 13.9167 11.3497C14.725 11.3497 15.45 11.983 15.45 12.883V15.408"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getIcon(icon, className) {
  if (icon === "security") {
    return <SecurityIcon className={className} />;
  }

  if (icon === "preferences") {
    return <PreferencesIcon className={className} />;
  }

  if (icon === "support") {
    return <SupportIcon className={className} />;
  }

  return <ProfileIcon className={className} />;
}

function getNextIndex(currentIndex, total, direction) {
  if (total <= 0) {
    return currentIndex;
  }

  return (currentIndex + direction + total) % total;
}

// Teclas que mueven la selección según la orientación del tablist (patrón WAI-ARIA Tabs).
const NAVIGATION_KEYS = Object.freeze({
  horizontal: { next: "ArrowRight", previous: "ArrowLeft" },
  vertical: { next: "ArrowDown", previous: "ArrowUp" },
});

/**
 * Menú de pestañas de Configuración. En vertical (por defecto) es el «Vertical tab menu» de
 * escritorio y tablet: 160 px con `TabItem` Divider M. En horizontal es el «Horizontal tab menu»
 * móvil de Figma (3727:688316): `TabItem` Underline S (32 px) con icono, 16 px entre pestañas,
 * borde inferior `neutral-200` y desplazamiento horizontal propio cuando no caben, sin barra
 * nativa visible. Las flechas siguen la orientación (izquierda/derecha o arriba/abajo).
 *
 * @param {Object} props - Pestañas, selección, orientación y callbacks.
 * @param {"vertical"|"horizontal"} [props.orientation="vertical"] - Disposición del menú.
 * @returns {import("react").ReactElement} Tablist.
 */
function SettingsVerticalTabMenu({
  items = DEFAULT_ITEMS,
  activeItemId,
  defaultActiveItemId = DEFAULT_ITEMS[0].id,
  onChange,
  orientation = "vertical",
  className,
  ...props
}) {
  const isHorizontal = orientation === "horizontal";
  const keys = isHorizontal ? NAVIGATION_KEYS.horizontal : NAVIGATION_KEYS.vertical;
  const generatedId = useId();
  const [internalActiveItemId, setInternalActiveItemId] = useState(
    defaultActiveItemId,
  );
  const normalizedItems =
    Array.isArray(items) && items.length > 0 ? items : DEFAULT_ITEMS;
  const isControlled =
    typeof activeItemId === "string" && activeItemId.length > 0;
  const resolvedActiveItemId = isControlled
    ? activeItemId
    : internalActiveItemId;
  const activeIndex = normalizedItems.findIndex(
    (item) => item.id === resolvedActiveItemId,
  );

  function handleSelect(item) {
    if (item.id === resolvedActiveItemId) {
      return;
    }

    if (!isControlled) {
      setInternalActiveItemId(item.id);
    }

    onChange?.(item.id);
  }

  function handleKeyDown(event, index) {
    let nextIndex = null;

    if (event.key === keys.next) {
      nextIndex = getNextIndex(index, normalizedItems.length, 1);
    } else if (event.key === keys.previous) {
      nextIndex = getNextIndex(index, normalizedItems.length, -1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = normalizedItems.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    handleSelect(normalizedItems[nextIndex]);

    const tabs =
      event.currentTarget.parentElement?.querySelectorAll('[role="tab"]');
    tabs?.[nextIndex]?.focus();
    // En horizontal la pestaña enfocada puede quedar fuera del área visible del desplazamiento.
    if (isHorizontal) tabs?.[nextIndex]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  return (
    <div
      className={clsx(
        isHorizontal
          ? "flex w-full items-center gap-[16px] overflow-x-auto overscroll-x-contain border-b border-[var(--color-neutral-200)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex w-[160px] flex-col items-start justify-center gap-[var(--Spacing-Gap-XS,8px)]",
        className,
      )}
      role="tablist"
      aria-orientation={isHorizontal ? "horizontal" : "vertical"}
      {...props}
    >
      {normalizedItems.map((item, index) => {
        const isActive = item.id === resolvedActiveItemId;

        return (
          <TabItem
            key={item.id}
            label={item.label}
            size={isHorizontal ? "S" : "M"}
            style={isHorizontal ? "Underline" : "Divider"}
            selected={isActive}
            interactive
            iconLeft={false}
            iconRight={false}
            leftIcon={getIcon(item.icon, "size-5 shrink-0")}
            className={isHorizontal ? "shrink-0" : "w-full"}
            id={`${generatedId}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive || activeIndex === -1 ? 0 : -1}
            aria-label={item.label}
            onClick={() => handleSelect(item)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          />
        );
      })}
    </div>
  );
}

export default SettingsVerticalTabMenu;
