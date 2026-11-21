import { CloudConnection, DocumentText, DocumentUpload } from "iconsax-react";

import AdminKpiMetric from "../../../components/AdminKpiMetric.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { formatFileUploadDate, formatStorage } from "../../../utils/fileMetrics.js";

const NUMBER_FORMATTER = new Intl.NumberFormat("es-VE");

/**
 * KPI de la cabecera (Figma 3727:683873): archivos totales, espacio usado y última carga. Con el
 * administrador activado vienen de `GET /admin/files/metrics` (restauraciones contadas una vez);
 * con la activación apagada, del resumen del dashboard (useAdminFilesMetrics). Figma dibuja los
 * divisores por dentro (97 px en escritorio, 227 px en móvil): 1 + 23 px de relleno por lado
 * reproducen esa altura con el borde CSS.
 *
 * @param {Object} props - Estado de useAdminFilesMetrics.
 * @returns {import("react").ReactElement} Fila de métricas.
 */
function AdminFilesMetrics({ error, loading, metrics, reload }) {
  return (
    <div className="flex min-h-[97px] w-full flex-wrap content-center items-center gap-y-[16px] border-y border-[var(--color-neutral-200)] py-[23px]" aria-label="Métricas de archivos">
      {loading ? (
        <Loader preset="adminUserMetrics" label="Cargando métricas de archivos" />
      ) : error ? (
        <EmptyState
          title="No se pudieron cargar las métricas"
          description={error}
          size="S"
          showFeaturedIcon={false}
          showActions
          showSecondaryAction={false}
          primaryActionLabel="Reintentar"
          onPrimaryAction={reload}
          className="min-h-[160px] w-full"
        />
      ) : (
        <>
          <AdminKpiMetric
            label="Archivos totales"
            value={NUMBER_FORMATTER.format(metrics?.totalFiles || 0)}
            iconType="Accent"
            icon={<DocumentText size="24" variant="Linear" color="currentColor" />}
          />
          <AdminKpiMetric
            label="Espacio Usado"
            value={formatStorage(metrics?.usedBytes, { maximumFractionDigits: 2 })}
            iconType="Info"
            icon={<CloudConnection size="24" variant="Linear" color="currentColor" />}
          />
          <AdminKpiMetric
            label="Última carga"
            value={formatFileUploadDate(metrics?.lastUploadAt)}
            iconType="Warning"
            icon={<DocumentUpload size="24" variant="Linear" color="currentColor" />}
          />
        </>
      )}
    </div>
  );
}

export default AdminFilesMetrics;
