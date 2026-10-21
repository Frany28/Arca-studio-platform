import { ClipboardTick, CloseSquare, TaskSquare, TickSquare } from "iconsax-react";

import AdminKpiMetric from "../../../components/AdminKpiMetric.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { useServiceCatalogMetrics } from "../hooks/useServiceCatalogMetrics.js";

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
 * inactivos derivados del catálogo real, y cotizaciones totales, que no tienen fuente de datos
 * hasta implementar ese módulo y se muestran como no disponibles.
 *
 * @returns {import("react").ReactElement} Fila de indicadores o su skeleton.
 */
function ServicesQuotesMetrics() {
  const { error, loading, metrics } = useServiceCatalogMetrics();

  if (loading) return <Loader preset="adminUserMetrics" label="Cargando indicadores de servicios" />;

  const serviceValue = (value) => (metrics
    ? NUMBER_FORMATTER.format(value)
    : <UnavailableValue reason={error || "No disponible"} />);

  return (
    <div className="flex w-full flex-wrap content-center items-center gap-y-[16px] border-y border-[var(--color-neutral-200)] py-[24px]" aria-label="Indicadores de servicios y cotizaciones">
      <AdminKpiMetric label="Servicios totales" value={serviceValue(metrics?.total)} iconType="Accent" icon={<TaskSquare size="24" color="currentColor" />} />
      <AdminKpiMetric label="Servicios activos" value={serviceValue(metrics?.active)} iconType="Success" icon={<TickSquare size="24" color="currentColor" />} />
      <AdminKpiMetric label="Servicios Inactivos" value={serviceValue(metrics?.inactive)} iconType="Disabled" icon={<CloseSquare size="24" color="currentColor" />} />
      <AdminKpiMetric label="Cotizaciones totales" value={<UnavailableValue reason="No disponible: el módulo de cotizaciones está en desarrollo." />} iconType="Accent" icon={<ClipboardTick size="24" color="currentColor" />} />
    </div>
  );
}

export default ServicesQuotesMetrics;
