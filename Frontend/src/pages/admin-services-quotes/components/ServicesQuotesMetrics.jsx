import { ClipboardTick, CloseSquare, TaskSquare, TickSquare } from "iconsax-react";

import AdminKpiMetric from "../../../components/AdminKpiMetric.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";

const NUMBER_FORMATTER = new Intl.NumberFormat("es-VE");

/**
 * Valor de un indicador sin dato real: guion visible y texto accesible explícito, para no
 * comunicar la ausencia solo con un símbolo.
 *
 * @param {Object} props - Motivo leído por lectores de pantalla.
 * @param {string} props.reason - Explicación accesible.
 * @returns {import("react").ReactElement} Valor no disponible.
 */
function UnavailableValue({ reason }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{reason}</span>
    </>
  );
}

/**
 * Indicadores del encabezado del módulo (Figma 5790:339391): servicios totales, activos e
 * inactivos derivados del catálogo real, y cotizaciones totales leídas de la API. Los resúmenes
 * los lee la página (useServiceCatalogSummary y useQuoteSummary) para que el tabulador y las
 * cotizaciones puedan recargarlos tras un cambio. Sin dato real se muestra «no disponible».
 *
 * @param {Object} props - Resúmenes del módulo.
 * @param {{metrics: Object|null, loading: boolean, error: string}} props.summary - Indicadores del catálogo.
 * @param {{total: number|null, loading: boolean, error: string}} props.quoteSummary - Total de cotizaciones.
 * @returns {import("react").ReactElement} Fila de indicadores o su skeleton.
 */
function ServicesQuotesMetrics({ quoteSummary, summary }) {
  const { error, loading, metrics } = summary;

  if (loading || quoteSummary.loading) return <Loader preset="adminUserMetrics" label="Cargando indicadores de servicios" />;

  const serviceValue = (value) => (metrics
    ? NUMBER_FORMATTER.format(value)
    : <UnavailableValue reason={error || "No disponible"} />);
  const quoteValue = quoteSummary.total === null
    ? <UnavailableValue reason={quoteSummary.error || "No disponible"} />
    : NUMBER_FORMATTER.format(quoteSummary.total);

  return (
    <div className="flex w-full flex-wrap content-center items-center gap-y-[16px] border-y border-[var(--color-neutral-200)] py-[24px]" aria-label="Indicadores de servicios y cotizaciones">
      <AdminKpiMetric label="Servicios totales" value={serviceValue(metrics?.total)} iconType="Accent" icon={<TaskSquare size="24" color="currentColor" />} />
      <AdminKpiMetric label="Servicios activos" value={serviceValue(metrics?.active)} iconType="Success" icon={<TickSquare size="24" color="currentColor" />} />
      <AdminKpiMetric label="Servicios Inactivos" value={serviceValue(metrics?.inactive)} iconType="Disabled" icon={<CloseSquare size="24" color="currentColor" />} />
      <AdminKpiMetric label="Cotizaciones totales" value={quoteValue} iconType="Accent" icon={<ClipboardTick size="24" color="currentColor" />} />
    </div>
  );
}

export default ServicesQuotesMetrics;
