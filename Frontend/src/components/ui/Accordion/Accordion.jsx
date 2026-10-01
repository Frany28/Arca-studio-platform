/* Renderiza un acordeón accesible con estado controlado o interno y animación de apertura. */
import { useId, useState } from "react";
import clsx from "clsx";
import {
  ACCORDION_DEFAULT_PROPS,
  ACCORDION_STATES,
  ACCORDION_STATE_STYLES,
} from "./accordionConfig.js";

// Icono usado cuando el acordeón está cerrado.
function AddIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 7V17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7 12H17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Icono usado cuando el acordeón está abierto.
function MinusIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7 12H17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Icono auxiliar mostrado opcionalmente al lado derecho.
function QuestionCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 18.3333C14.6024 18.3333 18.3333 14.6024 18.3333 10C18.3333 5.39762 14.6024 1.66666 10 1.66666C5.39763 1.66666 1.66667 5.39762 1.66667 10C1.66667 14.6024 5.39763 18.3333 10 18.3333Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7.57501 7.50001C7.77085 6.94384 8.15715 6.4749 8.66546 6.17783C9.17377 5.88076 9.77094 5.77475 10.3499 5.87864C10.9289 5.98253 11.4525 6.28952 11.8282 6.74544C12.2038 7.20137 12.4074 7.77594 12.4025 8.36816C12.4025 10.0417 9.89168 10.8333 9.89168 10.8333"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 14.1667H10.0083"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Coordina estado abierto/cerrado, hover y atributos accesibles del acordeón.
function Accordion({
  className,
  title = ACCORDION_DEFAULT_PROPS.title,
  description = ACCORDION_DEFAULT_PROPS.description,
  state,
  interactive = ACCORDION_DEFAULT_PROPS.interactive,
  open,
  defaultOpen = ACCORDION_DEFAULT_PROPS.defaultOpen,
  onOpenChange,
  showRightIcon = ACCORDION_DEFAULT_PROPS.showRightIcon,
  leftIcon,
  rightIcon,
  onClick,
  ...props
}) {
  const descriptionId = useId();
  const [isHovered, setIsHovered] = useState(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = typeof open === "boolean";
  const currentOpen = isControlled ? open : internalOpen;
  const usesForcedState = ACCORDION_STATES.includes(state);
  const resolvedState = usesForcedState
    ? state
    : currentOpen
      ? "Open"
      : isHovered
        ? "Hover"
        : "Default";
  const isOpenState = resolvedState === "Open";
  const isInteractive = interactive || typeof onOpenChange === "function";
  const Element = isInteractive ? "button" : "div";
  const styles = ACCORDION_STATE_STYLES[resolvedState];
  const resolvedLeftIcon =
    leftIcon ?? (isOpenState ? <MinusIcon className="size-5" /> : <AddIcon className="size-5" />);

  function handleToggle(event) {
    if (!isInteractive) {
      onClick?.(event);
      return;
    }

    const nextOpen = !currentOpen;

    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
    onClick?.(event);
  }

  return (
    <Element
      type={isInteractive ? "button" : undefined}
      className={clsx(
        "flex w-full gap-[12px] rounded-[var(--radius-3)] p-[12px] text-left transition-[background-color,border-color] duration-150",
        styles.container,
        styles.alignment,
        isInteractive &&
          "appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-bg)]",
        className,
      )}
      data-state={resolvedState.toLowerCase()}
      aria-expanded={isInteractive ? isOpenState : undefined}
      aria-controls={isOpenState ? descriptionId : undefined}
      onMouseEnter={isInteractive ? () => setIsHovered(true) : undefined}
      onMouseLeave={isInteractive ? () => setIsHovered(false) : undefined}
      onClick={handleToggle}
      {...props}
    >
      <div
        className="inline-flex size-[24px] shrink-0 items-center justify-center text-[var(--color-text-200)]"
        aria-hidden="true"
      >
        {resolvedLeftIcon}
      </div>

      <div className="flex min-h-px min-w-px flex-1 flex-col gap-[8px]">
        <div className="text-body-4 text-left font-medium tracking-[-0.5px] text-[var(--color-text-300)]">
          {title}
        </div>

        <div
          id={descriptionId}
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{
            gridTemplateRows: isOpenState ? "1fr" : "0fr",
            opacity: isOpenState ? 1 : 0,
          }}
          aria-hidden={!isOpenState}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className="text-body-4 pt-[8px] text-left font-normal tracking-[-0.5px] text-[var(--color-text-200)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{
                transform: isOpenState ? "translateY(0)" : "translateY(-4px)",
              }}
            >
              {description}
            </div>
          </div>
        </div>
      </div>

      {showRightIcon ? (
        <div
          className="inline-flex size-[24px] shrink-0 items-center justify-center text-[var(--color-text-200)]"
          aria-hidden="true"
        >
          {rightIcon ?? <QuestionCircleIcon className="size-5" />}
        </div>
      ) : null}
    </Element>
  );
}

export default Accordion;
