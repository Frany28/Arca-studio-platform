import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LockCircle, MinusCirlce, More, TickCircle, UserTick } from "iconsax-react";

import Button from "../../components/ui/Button/Button.jsx";

const MENU_WIDTH = 160;
const MENU_ITEM_HEIGHT = 38;
const VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;

function getMenuPosition(anchor, itemCount) {
  const rect = anchor.getBoundingClientRect();
  const menuHeight = itemCount * MENU_ITEM_HEIGHT + 6;
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
    window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
  );
  const fitsBelow = rect.bottom + MENU_GAP + menuHeight <= window.innerHeight - VIEWPORT_MARGIN;

  return {
    left,
    top: fitsBelow
      ? rect.bottom + MENU_GAP
      : Math.max(VIEWPORT_MARGIN, rect.top - MENU_GAP - menuHeight),
  };
}

function getStatusActions(status) {
  if (status === "blocked") {
    return [
      { icon: UserTick, label: "Reactivar", status: "active" },
      { icon: LockCircle, label: "Deshabilitar", status: "inactive" },
    ];
  }

  if (status === "inactive") {
    return [{ icon: TickCircle, label: "Activar", status: "active" }];
  }

  return [
    { icon: MinusCirlce, label: "Suspender", status: "blocked" },
    { icon: LockCircle, label: "Deshabilitar", status: "inactive" },
  ];
}

function AdminUserActionsMenu({ disabled = false, onStatusChange, user }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const focusFirstItemOnOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const actions = getStatusActions(user.status);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;

    const updatePosition = () => setPosition(getMenuPosition(triggerRef.current, actions.length));
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [actions.length, open]);

  useEffect(() => {
    if (!open) return undefined;

    let focusFrameId;

    const closeOnOutsidePress = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.querySelector("button")?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape);
    if (focusFirstItemOnOpenRef.current) {
      focusFrameId = window.requestAnimationFrame(() => {
        menuRef.current?.querySelector("button")?.focus();
      });
    }
    focusFirstItemOnOpenRef.current = false;

    return () => {
      window.cancelAnimationFrame(focusFrameId);
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggleMenu(event) {
    focusFirstItemOnOpenRef.current = event.detail === 0;
    setOpen((current) => !current);
  }

  function selectStatus(status) {
    setOpen(false);
    onStatusChange(user, status);
  }

  function handleMenuKeyDown(event) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        <Button
          theme="Primary"
          type="Ghost"
          size="S"
          state={open ? "Focused" : "Default"}
          showText={false}
          showLeftIcon
          iconLeft={<More size="20" color="currentColor" />}
          showRightIcon={false}
          disabled={disabled}
          tooltip="Más opciones"
          aria-label={`Más opciones para ${user.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggleMenu}
        />
      </span>

      {open && position && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Acciones para ${user.name}`}
            className="fixed z-[var(--z-tooltip)] flex w-[160px] flex-col gap-[2px] rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-bg)] px-[8px] pb-[2px] pt-[4px] shadow-[0_8px_24px_rgba(0,0,0,0.24)]"
            style={position}
            onKeyDown={handleMenuKeyDown}
          >
            {actions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <Button layout="content"
                  key={action.label}
                  htmlType="button"
                  role="menuitem"
                  className="text-heading-8 flex h-[36px] w-full items-center gap-[12px] rounded-[var(--radius-2)] px-[8px] text-left text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-200)] focus:bg-[var(--color-neutral-200)] focus:outline-none"
                  onClick={() => selectStatus(action.status)}
                >
                  <ActionIcon size="20" color="currentColor" aria-hidden="true" />
                  <span>{action.label}</span>
                </Button>
              );
            })}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

export default AdminUserActionsMenu;
