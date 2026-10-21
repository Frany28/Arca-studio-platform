import { useState } from "react";
import { Add, SearchNormal1 } from "iconsax-react";

import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import MeasurementUnitFormModal from "./components/MeasurementUnitFormModal.jsx";
import MeasurementUnitStatusModal from "./components/MeasurementUnitStatusModal.jsx";
import MeasurementUnitsTable from "./components/MeasurementUnitsTable.jsx";
import { useMeasurementUnitActions } from "./hooks/useMeasurementUnitActions.js";
import { useMeasurementUnitBaseOptions } from "./hooks/useMeasurementUnitBaseOptions.js";
import { useMeasurementUnitDenominations } from "./hooks/useMeasurementUnitDenominations.js";

const EMPTY_SELECTION = new Set();
// Filas aproximadas del skeleton antes de conocer la página (Figma muestra cinco).
const SKELETON_ROWS = 5;

/**
 * Pestaña «Unidades» del módulo Servicios y cotizaciones (Figma 5771:487550 y 5790:359521):
 * búsqueda en la API, tabla con selección, alta, edición, activación y desactivación, y
 * paginación Anterior/Siguiente por cursor. La selección pertenece a la página visible y se
 * reinicia al cambiar de página, de búsqueda o al recargar (derivada de `pageKey`).
 *
 * @returns {import("react").ReactElement} Panel de unidades de medida.
 */
function MeasurementUnitsPanel() {
  const list = useMeasurementUnitDenominations();
  const actions = useMeasurementUnitActions({
    reload: list.reload,
    reloadFromStart: list.reloadFromStart,
    replaceItem: list.replaceItem,
  });
  const baseUnits = useMeasurementUnitBaseOptions({ enabled: actions.form.value?.mode === "create" });
  const [selection, setSelection] = useState({ key: list.pageKey, ids: EMPTY_SELECTION });
  const selectedIds = selection.key === list.pageKey ? selection.ids : EMPTY_SELECTION;
  const { items, loading, error, pagination, search } = list;
  const selectedCount = items.reduce((count, item) => count + (selectedIds.has(String(item.id)) ? 1 : 0), 0);
  const actionsDisabled = actions.status.submitting;
  const feedback = actions.feedback.value;

  /**
   * Alterna una fila de la página visible.
   *
   * @param {number} id - Denominación.
   * @returns {void}
   */
  function toggleRow(id) {
    const next = new Set(selectedIds);
    const key = String(id);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelection({ key: list.pageKey, ids: next });
  }

  /**
   * Selecciona toda la página visible o la deselecciona si ya lo estaba.
   *
   * @returns {void}
   */
  function toggleAll() {
    const allSelected = items.length > 0 && selectedCount === items.length;
    setSelection({ key: list.pageKey, ids: allSelected ? new Set() : new Set(items.map((item) => String(item.id))) });
  }

  let content;
  if (loading) {
    content = <Loader preset="measurementUnitTable" count={items.length || SKELETON_ROWS} label="Cargando unidades de medida" />;
  } else if (error) {
    content = (
      <div className="rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
        <EmptyState
          title="No se pudieron cargar las unidades de medida"
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
      <MeasurementUnitsTable
        items={items}
        selectedIds={selectedIds}
        actionsDisabled={actionsDisabled}
        onToggle={toggleRow}
        onToggleAll={toggleAll}
        onEdit={actions.form.openEdit}
        onStatusChange={actions.status.request}
      />
    );
  } else if (search.applied || pagination.hasPrevious) {
    content = (
      <EmptyState
        title="No hay coincidencias"
        description={search.applied
          ? `No encontramos unidades para «${search.applied}». Prueba con otro código, abreviatura o texto.`
          : "Esta página ya no tiene unidades. Vuelve a la página anterior."}
        size="S"
        showFeaturedIcon={false}
        showActions={Boolean(search.applied)}
        showSecondaryAction={false}
        primaryActionLabel="Limpiar búsqueda"
        onPrimaryAction={search.clear}
        className="min-h-[240px]"
      />
    );
  } else {
    content = (
      <EmptyState
        title="Aún no hay unidades de medida"
        description="Crea la primera combinando una abreviatura y una denominación, por ejemplo «m² de construcción»."
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Añadir unidad"
        onPrimaryAction={actions.form.openCreate}
        className="min-h-[320px]"
      />
    );
  }

  return (
    <section className="flex flex-col gap-[24px]" aria-labelledby="measurement-units-heading">
      <h2 id="measurement-units-heading" className="sr-only">Unidades de medida</h2>

      <div className="flex flex-wrap items-center justify-between gap-[12px] max-[767px]:flex-col max-[767px]:items-stretch">
        <Input
          type="Default input"
          size="M"
          value={search.query}
          placeholder="Buscar..."
          showLabel={false}
          showHint={false}
          showLeftIcon
          showRightIcon={false}
          required={false}
          leftIcon={<SearchNormal1 size="20" color="currentColor" />}
          className="w-full max-w-[320px] max-[767px]:max-w-none"
          aria-label="Buscar unidades por código, abreviatura o texto"
          onChange={(event) => search.setQuery(event.target.value)}
        />
        <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon iconLeft={<Add size="20" color="currentColor" />} showRightIcon={false} className="max-[767px]:!w-full" onClick={actions.form.openCreate}>
          Añadir unidad
        </Button>
      </div>

      {content}

      {!loading && !error && (items.length || pagination.hasPrevious) ? (
        <footer className="flex flex-wrap items-center justify-between gap-[12px]" aria-label="Selección y paginación de unidades">
          <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">{selectedCount} de {items.length} seleccionados</span>
          <nav className="flex items-center gap-[8px]" aria-label="Paginación de unidades">
            <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasPrevious} className="disabled:!border-[var(--color-neutral-400)] disabled:!text-[var(--color-neutral-400)]" onClick={pagination.previous}>Anterior</Button>
            <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasNext} onClick={pagination.next}>Siguiente pág.</Button>
          </nav>
        </footer>
      ) : null}

      {actions.form.value ? (
        <MeasurementUnitFormModal
          key={actions.form.value.denomination?.id ?? "create"}
          mode={actions.form.value.mode}
          denomination={actions.form.value.denomination}
          baseUnits={baseUnits}
          onClose={actions.form.close}
          onSubmit={actions.form.submit}
        />
      ) : null}
      <MeasurementUnitStatusModal
        change={actions.status.pending}
        submitting={actions.status.submitting}
        onCancel={actions.status.cancel}
        onConfirm={actions.status.confirm}
      />
      <AlertToast
        trigger={feedback}
        title={feedback?.title || "Unidad de medida"}
        description={feedback?.message || ""}
        theme={feedback?.tone === "danger" ? "Danger" : "Success"}
        aria-label={feedback?.tone === "danger" ? "Error en unidades de medida" : "Unidades de medida actualizadas"}
        onDismiss={actions.feedback.dismiss}
      />
    </section>
  );
}

export default MeasurementUnitsPanel;
