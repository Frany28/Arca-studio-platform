import { useRef } from "react";

import useMobileLayout from "../hooks/useMobileLayout.js";
import useScrollDirectionVisibility from "../hooks/useScrollDirectionVisibility.js";
import { formatEnvironmentDate } from "../utils/environmentDate.js";
import NavigationBar from "./ui/NavigationBar/NavigationBar.jsx";

const ENVIRONMENT_NAVBAR_CLASS_NAME =
  "mx-auto w-full max-w-[1200px] px-[16px] py-[12px] min-[768px]:px-[24px] min-[1024px]:px-[48px]";

/**
 * Navbar único del entorno autenticado. En móvil usa los botones de 44 px de Figma
 * (3727:678728); en tablet y escritorio conserva el tamaño S existente.
 *
 * @param {Object} props Callbacks funcionales y estado activo que proporciona la página.
 * @returns {import("react").ReactElement} Navbar sticky con ocultación por scroll.
 */
function EnvironmentNavigationBar(props) {
  const navbarRef = useRef(null);
  const isMobileLayout = useMobileLayout();

  useScrollDirectionVisibility(navbarRef);

  return (
    <div
      ref={navbarRef}
      className="sticky top-0 z-30 w-full shrink-0 bg-[var(--color-neutral-bg)] will-change-transform"
      data-scroll-direction-navbar
    >
      <NavigationBar
        {...props}
        variant="utility"
        showUtilityMenu={Boolean(props.onMenuClick)}
        utilityLayout={isMobileLayout ? "mobile" : "default"}
        utilityText={formatEnvironmentDate()}
        className={ENVIRONMENT_NAVBAR_CLASS_NAME}
      />
    </div>
  );
}

export default EnvironmentNavigationBar;
