import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { HambergerMenu } from "iconsax-react";
import useHeaderBackground from "./useHeaderBackground.js";
import PublicSiteMobileMenu from "./PublicSiteMobileMenu.jsx";
import PublicSiteNavigationMenu from "./PublicSiteNavigationMenu.jsx";
import "./PublicSiteHeader.css";

import MainLogo from "../../../../assets/logos/MainLogo.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import useScrollDirectionVisibility, {
  NAVBAR_SCROLL_DURATION_SECONDS,
} from "../../../../hooks/useScrollDirectionVisibility.js";

const DEFAULT_NAVIGATION_ITEMS = [
  { id: "services", label: "Servicios" },
  { id: "featured-projects", label: "Proyectos destacados" },
  { id: "process", label: "Nuestros Procesos" },
  { id: "about", label: "Sobre nosotros" },
];

const MOBILE_MENU_ID = "public-site-mobile-menu";

function PublicSiteHeader({
  activeNavigationId,
  className,
  navigationItems = DEFAULT_NAVIGATION_ITEMS,
  onNavigate,
  onContact,
  scrollContainerRef,
}) {
  const headerRef = useRef(null);
  const menuToggleRef = useRef(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const backgroundAppearance = useHeaderBackground(headerRef, scrollContainerRef);

  useScrollDirectionVisibility(headerRef, { scrollContainerRef });

  const closeMobileMenu = useCallback((restoreFocus = false) => {
    setIsMobileMenuOpen(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => menuToggleRef.current?.focus());
    }
  }, []);

  const handleMobileNavigate = useCallback(
    (navigationId) => {
      closeMobileMenu();
      onNavigate?.(navigationId);
    },
    [closeMobileMenu, onNavigate],
  );

  const handleMobileContact = useCallback(() => {
    closeMobileMenu();
    onContact?.();
  }, [closeMobileMenu, onContact]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 768px)");
    const closeAtDesktop = (event) => {
      if (event.matches) setIsMobileMenuOpen(false);
    };

    closeAtDesktop(desktopQuery);
    desktopQuery.addEventListener("change", closeAtDesktop);
    return () => desktopQuery.removeEventListener("change", closeAtDesktop);
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMobileMenu(true);
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeMobileMenu, isMobileMenuOpen]);

  return (
    <header
      ref={headerRef}
      className={clsx(
        "main-tool-bar public-site-header dark relative flex h-[67px] w-full justify-center will-change-transform md:h-[64px]",
        className,
      )}
      data-node-id="4487:112595"
      data-background={backgroundAppearance}
      data-mobile-menu-open={isMobileMenuOpen}
    >
      <nav
        className="public-site-header__nav relative z-10 h-full w-full max-w-[1200px] px-[16px] pt-[12px] lg:px-[48px]"
        aria-label="Navegación principal"
        data-node-id="4487:112596"
      >
        <div
          className="public-site-header__layout relative h-[52px] w-full"
          data-node-id="4487:112597"
        >
          <Button layout="content"
            htmlType="button"
            className="absolute left-0 top-[6px] flex h-[32px] w-[152px] cursor-pointer items-center justify-start border-0 bg-transparent p-0 md:relative md:left-auto md:top-[3.5px] md:shrink-0 lg:absolute lg:left-0"
            aria-label="Ir al inicio"
            onClick={() => onNavigate?.("home")}
            data-node-id="4487:112602"
          >
            <MainLogo
              size="32px"
              appearance={backgroundAppearance}
              alt="ARCA Studio"
              className="h-[32px] w-[152px] justify-start"
            />
          </Button>

          <div className="public-site-desktop-navigation hidden min-w-0 flex-1 justify-center md:flex lg:absolute lg:left-1/2 lg:top-0 lg:block lg:flex-none lg:-translate-x-1/2">
            <PublicSiteNavigationMenu
              navigationItems={navigationItems}
              activeNavigationId={activeNavigationId}
              orientation="horizontal"
              onNavigate={onNavigate}
              data-node-id="4487:112598"
            />
          </div>

          <div
            className="absolute right-0 top-[3px] hidden items-center gap-[8px] md:relative md:right-auto md:flex md:shrink-0 lg:absolute lg:right-0"
            data-node-id="4487:112599"
          >
            <Button
              theme="Primary"
              type="Solid"
              size="S"
              fitContent
              showLeftIcon={false}
              showRightIcon={false}
              className="[&]:h-auto [&]:border-0"
              onClick={onContact}
              aria-disabled={!onContact || undefined}
              data-node-id="4781:135050"
            >
              Contáctanos
            </Button>
          </div>

          <Button
            ref={menuToggleRef}
            theme="Primary"
            type="Ghost"
            size="L"
            showText={false}
            showLeftIcon
            showRightIcon={false}
            iconLeft={
              isMobileMenuOpen ? (
                <span
                  className="public-site-menu-toggle__close-icon size-[20px]"
                  aria-hidden="true"
                />
              ) : (
                <HambergerMenu
                  className="size-[20px]"
                  color="currentColor"
                  size={20}
                  variant="Linear"
                  aria-hidden="true"
                />
              )
            }
            className="public-site-menu-toggle absolute -top-[4px] right-0 md:hidden"
            aria-label={isMobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={isMobileMenuOpen}
            aria-controls={MOBILE_MENU_ID}
            tooltip={isMobileMenuOpen ? false : "Abrir menú"}
            onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
            data-node-id={isMobileMenuOpen ? "5156:130000" : "5074:27974"}
          />
        </div>

        <PublicSiteMobileMenu
          id={MOBILE_MENU_ID}
          isOpen={isMobileMenuOpen}
          activeNavigationId={activeNavigationId}
          navigationItems={navigationItems}
          contactDisabled={!onContact}
          onNavigate={handleMobileNavigate}
          onContact={handleMobileContact}
        />
      </nav>
    </header>
  );
}

export {
  DEFAULT_NAVIGATION_ITEMS,
  NAVBAR_SCROLL_DURATION_SECONDS as HEADER_SCROLL_DURATION_SECONDS,
};
export default PublicSiteHeader;
