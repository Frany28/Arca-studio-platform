import { useMemo } from "react";

import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import ServiceCatalogTable from "./components/ServiceCatalogTable.jsx";
import ServiceCatalogToolbar from "./components/ServiceCatalogToolbar.jsx";
import ServiceStatusModal from "./components/ServiceStatusModal.jsx";
import { usePageSelection } from "./hooks/usePageSelection.js";
import { SERVICE_CATALOG_PAGE_SIZE, useServiceCatalogList } from "./hooks/useServiceCatalogList.js";
import { useServiceStatusActions } from "./hooks/useServiceStatusActions.js";
import { buildUnitFilterItems } from "./utils/serviceCatalogPresentation.js";

/**
 * Pestaña «Tabulador de servicios» del módulo (Figma 5790:332031): búsqueda y filtros en la API,
 * tabla con selección de la página visible, descripción en tooltip, activación y desactivación
 * individual y paginación Anterior/Siguiente por cursor. Las filas son los servicios reales del
 * backend; sin servicios se muestra el estado vacío. Alta y edición quedan visibles y
 * deshabilitadas hasta que Figma defina código y tipo, obligatorios en la API.
 *
 * @param {Object} props - Resumen del catálogo leído por la página.
 * @param {{services: Array<Object>, reload: () => void}} props.summary - Colección completa (opciones
 * del filtro por unidad) y su recarga, que actualiza también los indicadores.
 * @returns {import("react").ReactElement} Panel del tabulador.
 */
function ServiceCatalogPanel({ summary }) {
  const list = useServiceCatalogList();
  const { items, loading, error, pagination, search } = list;
  const selection = usePageSelection(items, list.pageKey);
  const status = useServiceStatusActions({
    hasStatusFilter: Boolean(list.selectedStatusId),
    onCatalogChanged: summary.reload,
    reload: list.reload,
    replaceItem: list.replaceItem,
  });
  const unitItems = useMemo(() => buildUnitFilterItems(summary.services), [summary.services]);
  const feedback = status.feedback.value;

  let content;
  if (loading) {
    content = <Loader preset="serviceCatalogTable" count={items.length || SERVICE_CATALOG_PAGE_SIZE} label="Cargando tabulador de servicios" />;
  } else if (error) {
    content = (
      <div className="rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
        <EmptyState
          title="No se pudo cargar el tabulador de servicios"
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
      <ServiceCatalogTable
        items={items}
        selection={selection}
        actionsDisabled={status.submitting}
        onStatusChange={status.request}
      />
    );
  } else if (list.hasFilters || pagination.hasPrevious) {
    content = (
      <EmptyState
        title="No hay coincidencias"
        description={list.hasFilters
          ? "No encontramos servicios con esta búsqueda o estos filtros."
          : "Esta página ya no tiene servicios. Vuelve a la página anterior."}
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
        title="Aún no hay servicios en el tabulador"
        description="Cuando se registren servicios, aquí verás su unidad, su tarifa base y su estado."
        size="M"
        showFeaturedIcon
        showActions={false}
        className="min-h-[320px]"
      />
    );
  }

  return (
    <section className="flex flex-col gap-[24px]" aria-labelledby="service-catalog-heading">
      <h2 id="service-catalog-heading" className="sr-only">Tabulador de servicios</h2>

      <ServiceCatalogToolbar
        query={search.query}
        onQueryChange={search.setQuery}
        unitItems={unitItems}
        selectedUnitItemId={list.selectedUnitItemId}
        onUnitChange={list.setUnitFilter}
        selectedStatusId={list.selectedStatusId}
        onStatusChange={list.setStatusFilter}
        hasFilters={list.hasFilters}
        onClearFilters={list.clearAll}
      />

      {content}

      {!loading && !error && (items.length || pagination.hasPrevious) ? (
        <footer className="flex flex-wrap items-center justify-between gap-[12px]" aria-label="Selección y paginación de servicios">
          <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">
            {selection.selectedCount} de {items.length} seleccionados
          </span>
          <nav className="flex items-center gap-[8px]" aria-label="Paginación de servicios">
            <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasPrevious} className="disabled:!border-[var(--color-neutral-400)] disabled:!text-[var(--color-neutral-400)]" onClick={pagination.previous}>Anterior</Button>
            <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasNext} onClick={pagination.next}>Siguiente pág.</Button>
          </nav>
        </footer>
      ) : null}

      <ServiceStatusModal
        change={status.pending}
        submitting={status.submitting}
        onCancel={status.cancel}
        onConfirm={status.confirm}
      />
      <AlertToast
        trigger={feedback}
        title={feedback?.title || "Tabulador de servicios"}
        description={feedback?.message || ""}
        theme={feedback?.tone === "danger" ? "Danger" : "Success"}
        aria-label={feedback?.tone === "danger" ? "Error en el tabulador de servicios" : "Tabulador de servicios actualizado"}
        onDismiss={status.feedback.dismiss}
      />
    </section>
  );
}

export default ServiceCatalogPanel;
