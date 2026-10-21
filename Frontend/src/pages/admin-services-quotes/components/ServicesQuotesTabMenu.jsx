import { Grid6, Ruler } from "iconsax-react";

import documentNormalIcon from "../../../assets/icons/document-normal.svg";
import HorizontalTabMenu from "../../../components/ui/HorizontalTabMenu/HorizontalTabMenu.jsx";
import { SERVICES_QUOTES_TABS } from "../utils/servicesQuotesTabs.js";

/**
 * Icono `vuesax/linear/document-normal` de Figma. La versión de iconsax-react instalada no
 * incluye este portapapeles sin contenido, así que se usa el SVG exportado sin modificar como
 * máscara (patrón de AdminRequestEvaluation): hereda `currentColor` en ambos temas.
 *
 * @returns {import("react").ReactElement} Icono decorativo de 20 px.
 */
function DocumentNormalIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-5 shrink-0 bg-current [mask-position:center] [mask-repeat:no-repeat] [mask-size:100%_100%]"
      style={{ maskImage: `url("${documentNormalIcon}")` }}
    />
  );
}

// Iconos de Figma por pestaña: document-normal, grid-6 y ruler (vuesax/linear, 20 px).
const TAB_ICONS = {
  quotes: <DocumentNormalIcon />,
  services: <Grid6 size="20" variant="Linear" color="currentColor" aria-hidden="true" />,
  units: <Ruler size="20" variant="Linear" color="currentColor" aria-hidden="true" />,
};

const TAB_ITEMS = SERVICES_QUOTES_TABS.map((tab) => (
  <span className="inline-flex items-center gap-[8px]">
    {TAB_ICONS[tab.id]}
    {tab.label}
  </span>
));

/**
 * Pestañas horizontales del módulo (Figma 5792:252484): variante `Underlined` del
 * HorizontalTabMenu compartido con icono y texto. La pestaña activa la decide la ruta; elegir
 * otra navega a su subruta (Atrás/Adelante del navegador recorren las pestañas). El teclado
 * (flechas, Home y End) lo gestiona el componente compartido.
 *
 * @param {Object} props - Pestaña activa y navegación.
 * @param {number} props.activeIndex - Índice activo derivado de la URL.
 * @param {(index: number) => void} props.onChange - Navega a la pestaña elegida.
 * @returns {import("react").ReactElement} Menú de pestañas.
 */
function ServicesQuotesTabMenu({ activeIndex, onChange }) {
  return (
    <HorizontalTabMenu
      items={TAB_ITEMS}
      activeIndex={activeIndex}
      style="Underlined"
      filled="off"
      interactive
      onChange={onChange}
      className="w-full scroll-px-[4px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Secciones de servicios y cotizaciones"
    />
  );
}

export default ServicesQuotesTabMenu;
