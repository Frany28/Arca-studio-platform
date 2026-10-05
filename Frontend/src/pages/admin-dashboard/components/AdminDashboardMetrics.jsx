import {
  Buildings2,
  Folder2,
  Information,
  MessageNotif,
  People,
} from "iconsax-react";

import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import IconContainer from "../../../components/ui/IconContainer/IconContainer.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { formatStorage } from "../../../utils/fileMetrics.js";
import { formatRelativeTime } from "../../../utils/relativeTime.js";

const numberFormatter = new Intl.NumberFormat("es-VE");

function MetricItem({ badge, badgeTheme = "Success", className = "", icon, iconType, label, supportingText, value }) {
  return (
    <article className={`flex min-w-0 flex-col items-start gap-[8px] ${className}`}>
      <h2 className="text-body-1 m-0 whitespace-nowrap text-[var(--color-text-300)]">
        {label}
      </h2>
      <div className="flex items-center gap-[12px]">
        <IconContainer size="L" type={iconType} icon={icon} />
        <strong className="text-heading-3 text-[var(--color-text-50)]">
          {numberFormatter.format(value || 0)}
        </strong>
      </div>
      <div className="flex min-h-[21px] items-center gap-[8px]">
        {badge ? (
          <Badge label={badge} theme={badgeTheme} variation="Simple" size="M" />
        ) : null}
        <span className="text-body-1 whitespace-nowrap text-[var(--color-text-100)]">
          {supportingText}
        </span>
      </div>
    </article>
  );
}

function AdminDashboardMetrics({ error, loading, metrics, onRetry }) {
  if (loading) {
    return (
      <section className="mx-auto w-full max-w-[1200px] px-[16px] sm:px-[24px] lg:px-[48px]">
        <Loader preset="adminMetrics" label="Cargando métricas administrativas" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto w-full max-w-[1200px] px-[16px] sm:px-[24px] lg:px-[48px]">
        <div className="flex flex-wrap items-center justify-between gap-[16px] border-y border-[var(--color-neutral-200)] py-[24px]">
          <p className="text-body-3 text-[var(--color-danger-100)]">{error}</p>
          <Button
            theme="Primary"
            type="Outline"
            size="S"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            onClick={onRetry}
          >
            Reintentar
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="mx-auto w-full max-w-[1200px] px-[16px] sm:px-[24px] lg:px-[48px]"
      aria-label="Resumen de métricas administrativas"
    >
      <div className="grid w-full grid-cols-1 gap-x-[24px] gap-y-[24px] border-y border-[var(--color-neutral-200)] py-[24px] min-[640px]:max-[900px]:grid-cols-2 min-[900px]:grid-cols-5 min-[900px]:gap-x-[16px]">
        <MetricItem
          label="Usuarios activos"
          value={metrics?.activeUsers?.total}
          badge={`+${numberFormatter.format(metrics?.activeUsers?.thisMonth || 0)}`}
          supportingText="este mes"
          iconType="Success"
          icon={<People size="24" variant="Linear" color="currentColor" />}
        />
        <MetricItem
          label="Proyectos activos"
          value={metrics?.activeProjects?.total}
          badge={`+${numberFormatter.format(metrics?.activeProjects?.thisMonth || 0)}`}
          supportingText="este mes"
          iconType="Accent"
          icon={<Buildings2 size="24" variant="Linear" color="currentColor" />}
        />
        <MetricItem
          label="Archivos registrados"
          value={metrics?.files?.total}
          badge={formatStorage(metrics?.files?.totalBytes)}
          badgeTheme="Info"
          supportingText="usado"
          iconType="Info"
          icon={<Folder2 size="24" variant="Linear" color="currentColor" />}
        />
        <MetricItem
          label="Solicitudes"
          value={metrics?.requests?.total}
          badge={`+${numberFormatter.format(metrics?.requests?.today || 0)}`}
          supportingText="hoy"
          iconType="Warning"
          icon={<MessageNotif size="24" variant="Linear" color="currentColor" />}
        />
        <MetricItem
          label="Eventos críticos"
          value={metrics?.criticalEvents?.total}
          supportingText={formatRelativeTime(
            metrics?.criticalEvents?.latestAt,
            undefined,
            "Sin eventos recientes",
          )}
          iconType="Danger"
          icon={<Information size="24" variant="Linear" color="currentColor" />}
        />
      </div>
    </section>
  );
}

export default AdminDashboardMetrics;
