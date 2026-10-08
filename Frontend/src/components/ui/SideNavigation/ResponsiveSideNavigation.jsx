import clsx from "clsx";

import useBodyScrollLock from "../../../hooks/useBodyScrollLock.js";
import { ModalCloseButton } from "../Modal/Modal.jsx";
import SideOverlayDrawer from "../SideOverlayDrawer.jsx";

import SideNavigation from "./SideNavigation.jsx";

/**
 * Ancho del drawer según Figma (312 px); en pantallas de 320 px conserva 32 px de overlay
 * visibles para poder cerrarlo tocando fuera del panel.
 */
const MOBILE_DRAWER_WIDTH_CLASS_NAME = "w-[min(312px,calc(100vw-32px))]";

/**
 * Envuelve un callback para cerrar primero el drawer y después ejecutar la acción original,
 * de modo que la navegación nunca deje el panel abierto sobre la nueva vista.
 *
 * @param {Function} close Cierra el drawer móvil.
 * @param {Function} [callback] Acción pública proporcionada por la página.
 * @returns {Function} Callback que conserva los argumentos originales.
 */
function closeBefore(close, callback) {
  return (...args) => {
    close();
    callback?.(...args);
  };
}

/**
 * Presenta la navegación lateral con el patrón responsive del entorno autenticado:
 * riel persistente expandible desde 768 px y drawer modal en móvil (Figma 3727:678728
 * cerrado y 3727:544029 abierto). Ambas presentaciones comparten items, permisos y
 * callbacks; el drawer no recibe la expansión del riel, así que abrirlo o cerrarlo nunca
 * modifica el estado de tablet o escritorio. Mientras está abierto bloquea el scroll del body.
 *
 * @param {Object} props Props públicas de SideNavigation y control del drawer móvil.
 * @param {boolean} props.mobileOpen Apertura del drawer, normalmente de useMobileNavigationDrawer.
 * @param {Function} props.onMobileClose Cierra el drawer (overlay, Escape, botón o navegación).
 * @param {string} [props.className] Clases adicionales solo para el riel persistente.
 * @returns {import("react").ReactElement} Riel persistente y drawer móvil en portal.
 */
export default function ResponsiveSideNavigation({
  mobileOpen,
  onMobileClose,
  className,
  expanded,
  defaultExpanded,
  onExpandedChange,
  onCollapseClick,
  onItemSelect,
  onNewOpportunityClick,
  onLogoutClick,
  ...sharedProps
}) {
  useBodyScrollLock(mobileOpen);

  return (
    <>
      <SideNavigation
        {...sharedProps}
        expanded={expanded}
        defaultExpanded={defaultExpanded}
        onExpandedChange={onExpandedChange}
        onCollapseClick={onCollapseClick}
        onItemSelect={onItemSelect}
        onNewOpportunityClick={onNewOpportunityClick}
        onLogoutClick={onLogoutClick}
        // Literal requerido por Tailwind; equivale a SIDE_NAVIGATION_PERSISTENT_MIN_WIDTH_PX.
        className={clsx(className, "max-[767px]:hidden")}
      />

      <SideOverlayDrawer
        open={mobileOpen}
        onClose={onMobileClose}
        side="left"
        trapFocus
        ariaLabel="Menú de navegación"
        widthClassName={MOBILE_DRAWER_WIDTH_CLASS_NAME}
        className="z-[80] min-[768px]:hidden"
      >
        {/* Figma no muestra un cierre visible: se cierra con overlay o Escape. Este botón
            solo aparece con foco de teclado y da a lectores de pantalla un cierre explícito. */}
        <ModalCloseButton
          ariaLabel="Cerrar menú de navegación"
          className="pointer-events-none absolute right-[16px] top-[max(16px,env(safe-area-inset-top))] z-10 bg-[var(--color-neutral-100)] opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100"
          onClick={onMobileClose}
        />

        <SideNavigation
          {...sharedProps}
          variant="drawer"
          onItemSelect={closeBefore(onMobileClose, onItemSelect)}
          onNewOpportunityClick={closeBefore(onMobileClose, onNewOpportunityClick)}
          onLogoutClick={closeBefore(onMobileClose, onLogoutClick)}
        />
      </SideOverlayDrawer>
    </>
  );
}
