import clsx from "clsx";
import { Clock, ExportCurve } from "iconsax-react";

import Button from "../../../components/ui/Button/Button.jsx";
import useMobileLayout from "../../../hooks/useMobileLayout.js";

// Figma MOBILE (3727:678728): título h4 y acciones de igual ancho en una fila completa.
const MOBILE_HEADER_ACTION_CLASS_NAME = "max-[767px]:flex-1";

/**
 * Encabezado del dashboard administrativo con título, descripción y acciones globales.
 * En móvil reduce el título a 24 px y distribuye ambas acciones a todo el ancho.
 *
 * @param {Object} props Acciones del encabezado.
 * @param {Function} [props.onExportReport] Exporta el reporte administrativo.
 * @param {Function} [props.onViewHistory] Abre el historial.
 * @returns {import("react").ReactElement} Sección de encabezado.
 */
function AdminDashboardHeader({ onExportReport, onViewHistory }) {
  const isMobileLayout = useMobileLayout();

  return (
    <section
      className="mx-auto flex w-full max-w-[1200px] flex-col px-[16px] pb-[16px] sm:px-[24px] lg:px-[48px]"
      aria-labelledby="admin-dashboard-title"
    >
      <div className="flex w-full flex-wrap items-start justify-between gap-y-[16px]">
        <div className="flex min-w-[250px] flex-1 flex-col justify-center gap-[4px]">
          <h1
            id="admin-dashboard-title"
            className={clsx(
              isMobileLayout ? "text-heading-4" : "text-heading-3",
              "m-0 text-[var(--color-text-50)]",
            )}
          >
            Dashboard
          </h1>
          <p className="text-body-1 m-0 text-[var(--color-text-200)]">
            Resumen general de la actividad y operaci&oacute;n de ARCAstudio.
          </p>
        </div>

        <div className="flex min-w-[294px] flex-1 flex-wrap items-center justify-end gap-[12px] max-[767px]:min-w-0 max-[767px]:basis-full max-[767px]:flex-nowrap">
          <Button
            theme="Primary"
            type="Outline"
            size="M"
            fitContent
            showLeftIcon
            showRightIcon={false}
            iconLeft={
              <ExportCurve size="20" variant="Linear" color="currentColor" />
            }
            className={MOBILE_HEADER_ACTION_CLASS_NAME}
            onClick={onExportReport}
          >
            Exportar reporte
          </Button>
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon
            showRightIcon={false}
            iconLeft={<Clock size="20" variant="Linear" color="currentColor" />}
            className={MOBILE_HEADER_ACTION_CLASS_NAME}
            onClick={onViewHistory}
          >
            Ver historial
          </Button>
        </div>
      </div>
    </section>
  );
}

export default AdminDashboardHeader;
