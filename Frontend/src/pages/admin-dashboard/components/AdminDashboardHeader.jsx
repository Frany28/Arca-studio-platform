import { Clock, ExportCurve } from "iconsax-react";

import Button from "../../../components/ui/Button/Button.jsx";

function AdminDashboardHeader({ onExportReport, onViewHistory }) {
  return (
    <section
      className="mx-auto flex w-full max-w-[1200px] flex-col px-[16px] pb-[16px] sm:px-[24px] lg:px-[48px]"
      aria-labelledby="admin-dashboard-title"
    >
      <div className="flex w-full flex-wrap items-start justify-between gap-y-[16px]">
        <div className="flex min-w-[250px] flex-1 flex-col justify-center gap-[4px]">
          <h1
            id="admin-dashboard-title"
            className="text-heading-3 m-0 text-[var(--color-text-50)] max-sm:text-[40px] max-sm:leading-[48px]"
          >
            Dashboard
          </h1>
          <p className="text-body-1 m-0 text-[var(--color-text-200)]">
            Resumen general de la actividad y operaci&oacute;n de ARCAstudio.
          </p>
        </div>

        <div className="flex min-w-[294px] flex-1 flex-wrap items-center justify-end gap-[12px] max-sm:min-w-0 max-sm:justify-start">
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
