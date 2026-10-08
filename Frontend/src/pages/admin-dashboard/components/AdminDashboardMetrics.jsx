import clsx from "clsx";
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
import useMobileLayout from "../../../hooks/useMobileLayout.js";
import { formatStorage } from "../../../utils/fileMetrics.js";
import { formatRelativeTime } from "../../../utils/relativeTime.js";

const numberFormatter = new Intl.NumberFormat("es-VE");

/**
 * Presenta una métrica con etiqueta, icono, valor y texto de apoyo.
 * En móvil aplica la escala de Figma 3727:678728: etiqueta de 16 px, contenedor de icono
 * de 40 px y valor h4; la etiqueta de eventos críticos conserva 18 px como en el diseño.
 *
 * @param {Object} props Datos de la métrica y su presentación.
 * @param {boolean} props.isMobileLayout Aplica la escala móvil.
 * @param {boolean} [props.keepLargeLabel=false] Conserva Body/b1 en móvil (eventos críticos).
 * @param {Function} props.renderIcon Recibe el tamaño del icono y devuelve el elemento.
 * @returns {import("react").ReactElement} Métrica individual.
 */
function MetricItem({ badge, badgeTheme = "Success", className = "", isMobileLayout, keepLargeLabel = false, renderIcon, iconType, label, supportingText, value }) {
  return (
    <article className={`flex min-w-0 flex-col items-start gap-[8px] ${className}`}>
      <h2
        className={clsx(
          isMobileLayout && !keepLargeLabel ? "text-body-2" : "text-body-1",
          "m-0 whitespace-nowrap text-[var(--color-text-300)]",
        )}
      >
        {label}
      </h2>
      <div className="flex items-center gap-[12px]">
        <IconContainer
          size={isMobileLayout ? "M" : "L"}
          type={iconType}
          icon={renderIcon(isMobileLayout ? "20" : "24")}
        />
        <strong
          className={clsx(
            isMobileLayout ? "text-heading-4" : "text-heading-3",
            "text-[var(--color-text-50)]",
          )}
        >
          {numberFormatter.format(value || 0)}
        </strong>
      </div>
      <div className="flex min-h-[21px] items-center gap-[8px]">
        {badge ? (
          <Badge
            label={badge}
            theme={badgeTheme}
            variation="Simple"
            size="M"
            // Figma MOBILE: badge de 21 px porque su trazo es interior (no suma altura).
            className="max-[767px]:py-px"
          />
        ) : null}
        <span className="text-body-1 whitespace-nowrap text-[var(--color-text-100)]">
          {supportingText}
        </span>
      </div>
    </article>
  );
}

function AdminDashboardMetrics({ error, loading, metrics, onRetry }) {
  const isMobileLayout = useMobileLayout();

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
      <div className="grid w-full grid-cols-1 gap-x-[24px] max-[767px]:grid-cols-2 max-[767px]:gap-x-[16px] gap-y-[24px] border-y border-[var(--color-neutral-200)] py-[24px] min-[640px]:max-[900px]:grid-cols-2 min-[900px]:grid-cols-5 min-[900px]:gap-x-[16px]">
        <MetricItem
          label="Usuarios activos"
          value={metrics?.activeUsers?.total}
          badge={`+${numberFormatter.format(metrics?.activeUsers?.thisMonth || 0)}`}
          supportingText="este mes"
          iconType="Success"
          isMobileLayout={isMobileLayout}
          renderIcon={(size) => <People size={size} variant="Linear" color="currentColor" />}
        />
        <MetricItem
          label="Proyectos activos"
          value={metrics?.activeProjects?.total}
          badge={`+${numberFormatter.format(metrics?.activeProjects?.thisMonth || 0)}`}
          supportingText="este mes"
          iconType="Accent"
          isMobileLayout={isMobileLayout}
          renderIcon={(size) => <Buildings2 size={size} variant="Linear" color="currentColor" />}
        />
        <MetricItem
          label="Archivos registrados"
          value={metrics?.files?.total}
          badge={formatStorage(metrics?.files?.totalBytes)}
          badgeTheme="Info"
          supportingText="usado"
          iconType="Info"
          // Figma MOBILE oculta esta métrica (capa oculta entre Proyectos y Solicitudes).
          className="max-[767px]:hidden"
          isMobileLayout={isMobileLayout}
          renderIcon={(size) => <Folder2 size={size} variant="Linear" color="currentColor" />}
        />
        <MetricItem
          label="Solicitudes"
          value={metrics?.requests?.total}
          badge={`+${numberFormatter.format(metrics?.requests?.today || 0)}`}
          supportingText="hoy"
          iconType="Warning"
          isMobileLayout={isMobileLayout}
          renderIcon={(size) => <MessageNotif size={size} variant="Linear" color="currentColor" />}
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
          isMobileLayout={isMobileLayout}
          keepLargeLabel
          renderIcon={(size) => <Information size={size} variant="Linear" color="currentColor" />}
        />
      </div>
    </section>
  );
}

export default AdminDashboardMetrics;
