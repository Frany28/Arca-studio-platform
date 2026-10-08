import { useState } from "react";
import clsx from "clsx";
import Button from "../Button/Button.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import HorizontalTabMenu from "../HorizontalTabMenu/HorizontalTabMenu.jsx";
import MainLogo from "../../../assets/logos/MainLogo.jsx";

function MenuIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="20"
      viewBox="0 0 22 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2 5H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M2 10H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M2 15H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BellIcon({ className }) {
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
        d="M10.0163 2.42578C7.25798 2.42578 5.01631 4.66745 5.01631 7.42578V9.83412C5.01631 10.3424 4.79965 11.1174 4.54131 11.5508L3.58298 13.1424C2.99131 14.1258 3.39965 15.2174 4.48298 15.5841C8.07465 16.7841 11.9496 16.7841 15.5413 15.5841C16.5496 15.2508 16.9913 14.0591 16.4413 13.1424L15.483 11.5508C15.233 11.1174 15.0163 10.3424 15.0163 9.83412V7.42578C15.0163 4.67578 12.7663 2.42578 10.0163 2.42578Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
      />
      <path
        d="M11.5582 2.66719C11.2999 2.59219 11.0332 2.53385 10.7582 2.50052C9.95825 2.40052 9.19158 2.45885 8.47491 2.66719C8.71658 2.05052 9.31658 1.61719 10.0166 1.61719C10.7166 1.61719 11.3166 2.05052 11.5582 2.66719Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.5163 15.8828C12.5163 17.2578 11.3913 18.3828 10.0163 18.3828C9.33296 18.3828 8.69963 18.0995 8.24963 17.6495C7.79963 17.1995 7.5163 16.5661 7.5163 15.8828"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
      />
    </svg>
  );
}

function NavigationBar({
  className,
  navItems = [],
  activeIndex = -1,
  defaultActiveIndex = -1,
  showContactButton = true,
  showLoginButton = true,
  contactLabel = "Contáctanos",
  loginLabel = "Iniciar sesión",
  mobileMenuLabel = "Abrir menú",
  utilityText = "Lunes, 23 de Marzo",
  showUtilityMenu = false,
  mobileMenuExpanded,
  utilityLayout = "default",
  variant = "desktop",
  onNavChange,
  onContactClick,
  onLoginClick,
  onMenuClick,
  onUtilityActionClick,
  utilityActionActive = false,
  logo,
  ...props
}) {
  const [internalActiveIndex, setInternalActiveIndex] = useState(
    Number.isInteger(defaultActiveIndex) ? defaultActiveIndex : -1,
  );
  const isMobile = variant === "mobile";
  const isUtility = variant === "utility";
  // "mobile" aplica la barra MOBILE de Figma: botones de 44 px y fecha en Headings/h8.
  const isMobileUtility = utilityLayout === "mobile";
  const utilityButtonSize = isMobileUtility ? "M" : "S";
  const isNavControlled = Number.isInteger(activeIndex) && activeIndex >= 0;
  const resolvedActiveIndex = isNavControlled
    ? activeIndex
    : internalActiveIndex;

  const handleNavChange = (index) => {
    if (!isNavControlled) {
      setInternalActiveIndex(index);
    }

    onNavChange?.(index);
  };

  if (isUtility) {
    return (
      <nav
        className={clsx(
          "flex w-full items-center justify-between bg-neutral-bg",
          // El padding por defecto solo aplica sin className: dos utilidades px-* del mismo
          // nivel no tienen precedencia garantizada y ocultaban el padding móvil de 16 px.
          className || "px-[24px] py-[12px]",
        )}
        aria-label="Navigation bar"
        {...props}
      >
        {/* Figma móvil (3727:678728): línea inferior interna sin alterar la altura de 68 px. */}
        <div className="flex w-full flex-1 items-center justify-between max-[767px]:shadow-[inset_0_-1px_0_var(--color-neutral-200)]">
          {showUtilityMenu ? (
            <Button
              theme="Primary"
              type="Ghost"
              size={utilityButtonSize}
              showText={false}
              showLeftIcon
              showRightIcon={false}
              iconLeft={<MenuIcon className="size-5" />}
              aria-label={mobileMenuLabel}
              aria-expanded={mobileMenuExpanded}
              className="min-[768px]:hidden"
              onClick={onMenuClick}
            />
          ) : null}

          <span className={clsx(isMobileUtility ? "text-heading-8" : "text-body-3", "text-[var(--color-text-100)]")}>
            {utilityText}
          </span>

          <Button
            theme="Primary"
            type="Ghost"
            size={utilityButtonSize}
            showText={false}
            showLeftIcon
            showRightIcon={false}
            iconLeft={
              <BellIcon className="text-[var(--color-primary-200)] dark:text-[var(--color-text-200)]" />
            }
            aria-label="Notificaciones"
            aria-expanded={utilityActionActive}
            className={clsx(
              utilityActionActive &&
                "!bg-[var(--color-neutral-10)] !text-[var(--color-primary-200)]",
            )}
            onClick={onUtilityActionClick}
          />
        </div>
      </nav>
    );
  }

  return (
    <nav
      className={clsx(
        "flex w-full items-center justify-between bg-neutral-bg",
        isMobile ? "px-[16px] py-[16px]" : "px-[48px] py-[16px]",
        className,
      )}
      aria-label="Navigation bar"
      {...props}
    >
      <div className="flex w-full items-center justify-between gap-[20px]">
        <div className="flex h-[32px] w-[174.32px] shrink-0 items-center">
          {logo ?? <MainLogo size="32px" />}
        </div>

        {isMobile ? (
          <Tooltip asChild portal showTip text={mobileMenuLabel} tipPosition="Bottom left">
            <button
              type="button"
              aria-label={mobileMenuLabel}
              onClick={onMenuClick}
              className="flex items-center justify-center gap-[8px] rounded-[var(--radius-2)] border border-[var(--color-neutral-300)] bg-transparent p-[8px] text-[var(--color-primary-200)] transition-colors duration-200 hover:border-[var(--color-neutral-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-10)] dark:text-[var(--color-text-200)]"
            >
              <MenuIcon />
            </button>
          </Tooltip>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 justify-center">
              <HorizontalTabMenu
                items={navItems}
                activeIndex={resolvedActiveIndex}
                interactive
                onChange={handleNavChange}
                filled="off"
                style="Brand"
                className="max-w-full"
              />
            </div>

            <div className="flex shrink-0 items-center gap-[8px]">
              {showContactButton ? (
                <Button
                  theme="Primary"
                  type="Outline"
                  size="S"
                  fitContent
                  showLeftIcon={false}
                  showRightIcon={false}
                  onClick={onContactClick}
                >
                  {contactLabel}
                </Button>
              ) : null}

              {showLoginButton ? (
                <Button
                  theme="Primary"
                  type="Solid"
                  size="S"
                  fitContent
                  showLeftIcon={false}
                  showRightIcon={false}
                  onClick={onLoginClick}
                >
                  {loginLabel}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

export default NavigationBar;
