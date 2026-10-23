import { useMemo, useState } from "react";

import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import ServiceCatalogFooter from "./components/ServiceCatalogFooter.jsx";
import ServiceCatalogTable from "./components/ServiceCatalogTable.jsx";
import ServiceFormDialog from "./components/ServiceFormDialog.jsx";
import ServiceCatalogToolbar from "./components/ServiceCatalogToolbar.jsx";
import ServiceStatusModal from "./components/ServiceStatusModal.jsx";
import { useMeasurementUnitBaseOptions } from "../measurement-units/hooks/useMeasurementUnitBaseOptions.js";
import { useAlertFeedback } from "./hooks/useAlertFeedback.js";
import { usePageSelection } from "./hooks/usePageSelection.js";
import { useServiceBulkStatusActions } from "./hooks/useServiceBulkStatusActions.js";
import { SERVICE_CATALOG_PAGE_SIZE, useServiceCatalogList } from "./hooks/useServiceCatalogList.js";
import { useServiceStatusActions } from "./hooks/useServiceStatusActions.js";
import { useServiceTableOverlays } from "./hooks/useServiceTableOverlays.js";
import { describeMeasurementUnitSuccess } from "../measurement-units/utils/measurementUnitFeedback.js";
import { buildUnitFilterItems } from "./utils/serviceCatalogPresentation.js";

/**
 * Pestaña «Tabulador de servicios» del módulo (Figma 5790:332031): búsqueda y filtros en la API,
 * tabla con selección de la página visible, descripción en tooltip, activación y desactivación
 * individual (menú de la fila) o de los seleccionados (pie, Figma 5790:351653) y paginación
 * Anterior/Siguiente por cursor. Las filas son los servicios reales del
 * backend; sin servicios se muestra el estado vacío. «Añadir servicio» y «Editar» abren el mismo
 * formulario (ServiceFormDialog); guardar recarga el listado y los indicadores.
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
  const feedback = useAlertFeedback();
  const [formRequest, setFormRequest] = useState(null);
  // Catálogo base de solo lectura: se pide al abrir el formulario por primera vez y se conserva.
  const baseUnits = useMeasurementUnitBaseOptions({ enabled: Boolean(formRequest) });
  const status = useServiceStatusActions({
    hasStatusFilter: Boolean(list.selectedStatusId),
    notify: feedback.notify,
    onCatalogChanged: summary.reload,
    reload: list.reload,
    replaceItem: list.replaceItem,
  });
  const bulk = useServiceBulkStatusActions({
    items,
    notify: feedback.notify,
    onCatalogChanged: summary.reload,
    reload: list.reload,
    selection,
  });
  // Un cambio de estado (individual o masivo) bloquea las demás acciones y la selección hasta terminar.
  const statusBusy = status.submitting || bulk.submitting;
  const overlays = useServiceTableOverlays(Boolean(statusBusy || status.pending || bulk.pending || formRequest || loading), list.pageKey);
  const unitItems = useMemo(() => buildUnitFilterItems(summary.services), [summary.services]);
  const alert = feedback.value;

  /**
   * Cierra el formulario tras guardar y actualiza el listado y los indicadores: el alta vuelve a
   * la primera página (su posición la decide el backend) y la edición repite la página actual,
   * porque el servicio puede dejar de cumplir los filtros aplicados.
   *
   * @param {{mode: string, service: Object|null, changed: boolean}} result - Resultado del guardado.
   * @returns {void}
   */
  function handleSaved({ changed, mode, service }) {
    setFormRequest(null);
    const name = service ? `${service.code} · ${service.name}` : "";
    if (mode === "create") {
      list.reloadFromStart();
      summary.reload();
      feedback.notify("success", "Servicio creado", name);
      return;
    }
    if (!changed) {
      feedback.notify("success", "Sin cambios", name);
      return;
    }
    list.reload();
    summary.reload();
    feedback.notify("success", "Servicio actualizado", name);
  }

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
        overlays={overlays}
        actionsDisabled={statusBusy}
        onEdit={(service) => setFormRequest({ mode: "edit", serviceId: service.id })}
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
        onAddService={() => setFormRequest({ mode: "create" })}
      />

      {content}

      {!loading && !error && (items.length || pagination.hasPrevious) ? (
        <ServiceCatalogFooter
          selectedCount={selection.selectedCount}
          total={items.length}
          targets={bulk.targets}
          mixed={bulk.selectionState.isMixed}
          busy={statusBusy}
          onStatusRequest={(isActive) => { overlays.dismiss(); bulk.request(isActive); }}
          pagination={pagination}
        />
      ) : null}

      {formRequest ? (
        <ServiceFormDialog
          key={formRequest.serviceId ?? "create"}
          mode={formRequest.mode}
          baseUnits={baseUnits}
          serviceId={formRequest.serviceId}
          onClose={() => setFormRequest(null)}
          onSaved={handleSaved}
          onUnitCreated={(unit) => {
            // Mismo aviso que el alta desde Unidades: código público y nombre devueltos por la API.
            const result = describeMeasurementUnitSuccess("create", unit);
            feedback.notify(result.tone, result.title, result.message, result.content);
          }}
          onStale={list.reload}
          onNotFound={(message) => {
            setFormRequest(null);
            list.reload();
            feedback.notify("danger", "No se pudo guardar", message);
          }}
        />
      ) : null}
      <ServiceStatusModal
        change={status.pending ?? bulk.pending}
        submitting={statusBusy}
        onCancel={status.pending ? status.cancel : bulk.cancel}
        onConfirm={status.pending ? status.confirm : bulk.confirm}
      />
      <AlertToast
        trigger={alert}
        title={alert?.title || "Tabulador de servicios"}
        content={alert?.content}
        description={alert?.message || ""}
        theme={alert?.tone === "danger" ? "Danger" : "Success"}
        aria-label={alert?.tone === "danger" ? "Error en el tabulador de servicios" : "Tabulador de servicios actualizado"}
        onDismiss={feedback.dismiss}
      />
    </section>
  );
}

export default ServiceCatalogPanel;
