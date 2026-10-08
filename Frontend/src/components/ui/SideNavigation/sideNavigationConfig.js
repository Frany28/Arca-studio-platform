import { TABLET_MIN_WIDTH_PX } from "../../../utils/layoutBreakpoints.js";

export const SIDE_NAVIGATION_DEFAULT_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    wrapperHeight: "44px",
  },
  {
    id: "requests",
    label: "Solicitudes",
    icon: "requests",
    wrapperHeight: "44px",
  },
  {
    id: "more-projects",
    label: "Ver más proyectos",
    icon: "discover",
    wrapperHeight: "56px",
  },
  {
    id: "settings",
    label: "Configuraciones",
    icon: "settings",
    wrapperHeight: "56px",
  },
];

/**
 * Ancho mínimo desde el que se muestra la navegación persistente (tablet y escritorio).
 * Debe coincidir con las clases `max-[767px]:hidden` y `min-[768px]:hidden` de
 * ResponsiveSideNavigation, que Tailwind necesita como literales.
 */
export const SIDE_NAVIGATION_PERSISTENT_MIN_WIDTH_PX = TABLET_MIN_WIDTH_PX;

/** Presentaciones admitidas: riel persistente expandible o panel del drawer móvil. */
export const SIDE_NAVIGATION_VARIANTS = ["persistent", "drawer"];

export const SIDE_NAVIGATION_DEFAULT_PROPS = {
  items: SIDE_NAVIGATION_DEFAULT_ITEMS,
  variant: "persistent",
  activeItemId: undefined,
  defaultActiveItemId: null,
  defaultExpanded: true,
  searchPlaceholder: "Buscar...",
  newOpportunityLabel: "Nueva oportunidad",
  userName: "Alan Wake",
  userEmail: "alanexample.com",
  "aria-label": "Navegación lateral",
};

export function createSideNavigationProps(overrides = {}) {
  return {
    ...SIDE_NAVIGATION_DEFAULT_PROPS,
    ...overrides,
  };
}

export function createSideNavigationShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createSideNavigationProps(overrides),
  };
}
