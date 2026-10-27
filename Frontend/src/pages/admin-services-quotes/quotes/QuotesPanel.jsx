import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../../api/http.js";
import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { QUOTES_PAGE_SIZE } from "../../../config/quotesTable.js";
import { saveBlobAsFile } from "../../../utils/saveBlobAsFile.js";
import { useAlertFeedback } from "../hooks/useAlertFeedback.js";
import { usePageSelection } from "../hooks/usePageSelection.js";
import { getQuoteEditorPath, getQuoteCreatePath } from "../utils/servicesQuotesTabs.js";
import QuotePdfViewerModal from "./components/QuotePdfViewerModal.jsx";
import QuotesFooter from "./components/QuotesFooter.jsx";
import QuotesTable from "./components/QuotesTable.jsx";
import QuotesToolbar from "./components/QuotesToolbar.jsx";
import { getBrowserTimeZone } from "./hooks/useQuotePdfDocument.js";
import { useQuotesList } from "./hooks/useQuotesList.js";

/**
 * Pestaña «Cotizaciones» del módulo (Figma 5771:488497): búsqueda y filtro por fecha en la API,
 * orden por N° o Total, selección de la página visible, visor del PDF, edición, descarga y
 * paginación por cursor. Las filas son las cotizaciones reales de PostgreSQL; sin cotizaciones se
 * muestra el estado vacío con la acción de crear la primera.
 *
 * @param {Object} props - Aviso pendiente de un guardado.
 * @param {Object|null} [props.notice] - Aviso del formulario tras un guardado confirmado por la API.
 * @param {() => void} [props.onNoticeDismiss] - Retira ese aviso.
 * @returns {import("react").ReactElement} Panel del listado.
 */
function QuotesPanel({ notice = null, onNoticeDismiss }) {
  const navigate = useNavigate();
  const list = useQuotesList();
  const { error, items, loading, pagination, search } = list;
  const selection = usePageSelection(items, list.pageKey);
  const feedback = useAlertFeedback();
  const [viewer, setViewer] = useState({ quote: null, trigger: null });
  const [downloadingId, setDownloadingId] = useState(null);
  // Un aviso propio del listado (p. ej. una descarga fallida) prevalece sobre el del guardado.
  const alert = feedback.value ?? notice;

  /**
   * Descarga el PDF de una cotización con el nombre `COT-001.pdf`. Una descarga en curso
   * bloquea las demás acciones de la tabla para no generar el documento dos veces.
   *
   * @param {Object} quote - Fila del listado.
   * @returns {Promise<void>}
   */
  async function downloadQuote(quote) {
    if (downloadingId) return;
    setDownloadingId(quote.id);
    try {
      const blob = await api.quotes.getQuotePdf({ quoteId: quote.id, timeZone: getBrowserTimeZone() });
      saveBlobAsFile(blob, `${quote.code}.pdf`);
    } catch (downloadError) {
      feedback.notify("danger", "No se pudo descargar la cotización", downloadError?.message || "Inténtalo de nuevo.", quote.code);
    } finally {
      setDownloadingId(null);
    }
  }

  let content;
  if (loading) {
    content = <Loader preset="quotesTable" count={items.length || QUOTES_PAGE_SIZE} label="Cargando cotizaciones" />;
  } else if (error) {
    content = (
      <div className="rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
        <EmptyState
          title="No se pudieron cargar las cotizaciones"
          description={error}
          size="S"
          showFeaturedIcon={false}
          showActions
          showSecondaryAction={false}
          primaryActionLabel="Reintentar"
          onPrimaryAction={list.reload}
        />
      </div>
    );
  } else if (items.length) {
    content = (
      <QuotesTable
        items={items}
        selection={selection}
        sort={list.sort}
        actionsDisabled={Boolean(downloadingId)}
        onSort={list.toggleSort}
        onView={(quote, trigger) => setViewer({ quote, trigger })}
        onEdit={(quote) => navigate(getQuoteEditorPath(quote.id))}
        onDownload={downloadQuote}
      />
    );
  } else if (list.hasFilters || pagination.hasPrevious) {
    content = (
      <EmptyState
        title="No hay coincidencias"
        description={list.hasFilters
          ? "No encontramos cotizaciones con esta búsqueda o este intervalo de fechas."
          : "Esta página ya no tiene cotizaciones. Vuelve a la página anterior."}
        size="S"
        showFeaturedIcon={false}
        showActions={list.hasFilters}
        showSecondaryAction={false}
        primaryActionLabel="Quitar filtros"
        onPrimaryAction={list.clearAll}
        className="min-h-[240px]"
      />
    );
  } else {
    content = (
      <EmptyState
        title="Aún no hay cotizaciones"
        description="Crea una cotización a partir del tabulador de servicios para verla aquí."
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Nueva cotización"
        onPrimaryAction={() => navigate(getQuoteCreatePath())}
        className="min-h-[320px]"
      />
    );
  }

  return (
    <section className="flex flex-col gap-[24px]" aria-labelledby="quotes-heading">
      <h2 id="quotes-heading" className="sr-only">Cotizaciones</h2>

      <QuotesToolbar
        query={search.query}
        onQueryChange={search.setQuery}
        dateRange={list.dateRange}
        onDateRangeChange={list.setDateRange}
        hasFilters={list.hasFilters}
        onClearFilters={list.clearAll}
        onCreateQuote={() => navigate(getQuoteCreatePath())}
      />

      {content}

      {!loading && !error && (items.length || pagination.hasPrevious) ? (
        <QuotesFooter selectedCount={selection.selectedCount} total={items.length} pagination={pagination} />
      ) : null}

      <QuotePdfViewerModal
        quote={viewer.quote}
        returnFocusTo={viewer.trigger}
        onClose={() => setViewer({ quote: null, trigger: null })}
        onEdit={(quote) => navigate(getQuoteEditorPath(quote.id))}
      />
      <AlertToast
        trigger={alert}
        title={alert?.title || "Cotizaciones"}
        content={alert?.content}
        description={alert?.message || ""}
        theme={alert?.tone === "danger" ? "Danger" : "Success"}
        aria-label={alert?.tone === "danger" ? "Error en cotizaciones" : "Cotizaciones actualizadas"}
        onDismiss={feedback.value ? feedback.dismiss : onNoticeDismiss}
      />
    </section>
  );
}

export default QuotesPanel;
