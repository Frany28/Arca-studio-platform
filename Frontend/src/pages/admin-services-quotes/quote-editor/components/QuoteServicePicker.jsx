import { SearchNormal1 } from "iconsax-react";
import { useMemo, useState } from "react";

import Badge from "../../../../components/ui/Badge/Badge.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import Checkbox from "../../../../components/ui/Checkbox/Checkbox.jsx";
import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import Loader from "../../../../components/ui/Loader/Loader.jsx";
import HorizontalScrollViewport from "../../../../components/ui/ScrollBar/HorizontalScrollViewport.jsx";
import { normalizeTagSearchText } from "../../../../components/ui/Input/tags/tagUtils.js";
import CursorPaginationNav from "../../components/CursorPaginationNav.jsx";
import ServiceDescriptionHint from "../../service-catalog/components/ServiceDescriptionHint.jsx";
import { formatReferenceRate, getServiceDescription } from "../../service-catalog/utils/serviceCatalogPresentation.js";
import { formatServicePickerCount } from "../utils/servicePickerCount.js";
import { getServicePickerPage } from "../utils/servicePickerPagination.js";

// Figma 5771:463261: selección 48, Servicio 350 y Unidad/Tarifa flexibles (mínimo 150).
const PICKER_TABLE_MIN_WIDTH = 48 + 350 + 150 + 150;

/**
 * Indica si un servicio coincide con la búsqueda por nombre o código, sin distinguir acentos ni
 * mayúsculas (misma normalización que las sugerencias del Input).
 *
 * @param {Object} service - Servicio del tabulador.
 * @param {string} query - Texto buscado.
 * @returns {boolean} true si coincide.
 */
function matchesService(service, query) {
  const needle = normalizeTagSearchText(query);
  return !needle || normalizeTagSearchText(`${service.name} ${service.code}`).includes(needle);
}

/**
 * «Seleccionar servicios» del formulario (Figma 5771:463257): busca en los servicios activos del
 * tabulador, marca varios y los añade a «Servicios incluidos». Muestra diez por página, como las
 * demás tablas del módulo (paginación local: la lista completa ya está en memoria); buscar vuelve a
 * la primera página y la selección se conserva al cambiar de página. Los ya incluidos aparecen
 * marcados y bloqueados, porque cada servicio va una sola vez por cotización. Cada servicio tiene
 * una sola unidad. «Cancelar» limpia la selección sin añadir nada.
 *
 * @param {Object} props - Catálogo, estado y callbacks.
 * @param {Array<Object>} props.services - Servicios activos del tabulador.
 * @param {boolean} props.loading - El catálogo aún se está leyendo.
 * @param {string} props.error - Error al leer el catálogo.
 * @param {() => void} props.onRetry - Repite la lectura del catálogo.
 * @param {Set<number>} props.includedIds - Servicios ya incluidos en la cotización.
 * @param {(services: Array<Object>) => void} props.onAdd - Añade los servicios elegidos.
 * @param {boolean} props.disabled - Bloquea el selector durante el guardado.
 * @returns {import("react").ReactElement} Sección.
 */
function QuoteServicePicker({ disabled, error, includedIds, loading, onAdd, onRetry, services }) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [openHintId, setOpenHintId] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const visible = useMemo(() => services.filter((service) => matchesService(service, query)), [query, services]);
  // La página se ajusta sola si la lista se reduce; «Seleccionar todos» actúa sobre la página visible.
  const page = getServicePickerPage({ items: visible, pageIndex });
  const selectable = page.items.filter((service) => !includedIds.has(service.id));
  // Solo cuentan los servicios seleccionables presentes: un servicio ya añadido deja de contar.
  const selected = services.filter((service) => selectedIds.has(service.id) && !includedIds.has(service.id));
  // Incluidos del listado (un servicio cotizado que ya está inactivo no figura en él).
  const includedCount = services.filter((service) => includedIds.has(service.id)).length;
  const allSelected = selectable.length > 0 && selectable.every((service) => selectedIds.has(service.id));
  const someSelected = selectable.some((service) => selectedIds.has(service.id));

  /**
   * Marca o desmarca un servicio seleccionable.
   *
   * @param {number} serviceId - Servicio.
   * @returns {void}
   */
  function toggle(serviceId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  /**
   * Marca todos los servicios seleccionables de la página visible o, si ya lo estaban, los desmarca.
   *
   * @returns {void}
   */
  function toggleAll() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const service of selectable) {
        if (allSelected) next.delete(service.id);
        else next.add(service.id);
      }
      return next;
    });
  }

  let body;
  if (loading) {
    // El Loader ya anuncia la carga (role="status"); comparte la geometría de la tabla real.
    body = <Loader preset="quoteServicePicker" label="Cargando servicios del tabulador" className="gap-0" />;
  } else if (error) {
    body = (
      <EmptyState title="No se pudo cargar el tabulador" description={error} size="S" showFeaturedIcon={false} showActions showSecondaryAction={false} primaryActionLabel="Reintentar" onPrimaryAction={onRetry} />
    );
  } else if (!services.length) {
    body = <EmptyState title="No hay servicios activos" description="Activa o añade servicios en el tabulador para cotizarlos." size="S" showFeaturedIcon={false} showActions={false} />;
  } else if (!visible.length) {
    body = <EmptyState title="No hay coincidencias" description="No encontramos servicios activos con esta búsqueda." size="S" showFeaturedIcon={false} showActions={false} />;
  } else {
    body = (
      <HorizontalScrollViewport scrollBarLabel="Desplazar servicios disponibles horizontalmente">
        <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: PICKER_TABLE_MIN_WIDTH }}>
          <caption className="sr-only">Servicios activos del tabulador</caption>
          <colgroup>
            <col style={{ width: 48 }} />
            <col style={{ width: 350 }} />
            <col />
            <col />
          </colgroup>
          <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
            <tr className="text-heading-8 h-[49px]">
              <th scope="col" className="p-[16px]">
                <Checkbox size="S" checked={allSelected ? "Yes" : someSelected ? "Indeterminate" : "No"} interactive={selectable.length > 0 && !disabled} aria-label="Seleccionar todos los servicios visibles" onCheckedChange={toggleAll} />
              </th>
              <th scope="col" className="px-[24px] py-[16px]">Servicio</th>
              <th scope="col" className="px-[24px] py-[16px]">Unidad</th>
              <th scope="col" className="px-[24px] py-[16px] text-right">Tarifa base</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((service) => {
              const included = includedIds.has(service.id);
              const checked = included || selectedIds.has(service.id);
              const description = getServiceDescription(service);
              return (
                <tr key={service.id} className={`h-[50px] transition-colors duration-150 ${checked ? "bg-[var(--color-neutral-300)]" : "bg-[var(--color-neutral-100)]"}`} data-selected={checked ? "true" : undefined}>
                  <td className="px-[16px]">
                    <Checkbox
                      size="S"
                      checked={checked ? "Yes" : "No"}
                      interactive={!included && !disabled}
                      aria-label={included ? `${service.name} ya está incluido` : `Seleccionar ${service.name}`}
                      onCheckedChange={() => toggle(service.id)}
                    />
                  </td>
                  <td className="px-[24px]">
                    <div className="flex min-w-0 items-center gap-[2px]">
                      <span className="text-heading-8 truncate text-[var(--color-text-300)]" title={service.name}>{service.name}</span>
                      {description ? (
                        <ServiceDescriptionHint
                          serviceName={service.name}
                          description={description}
                          open={openHintId === service.id}
                          onOpenChange={(open) => setOpenHintId(open ? service.id : null)}
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-[24px]">
                    <div className="flex min-w-0">
                      <Badge label={service.unitLabel} theme="Brand 2" variation="Simple" size="S" truncate />
                    </div>
                  </td>
                  <td className="text-heading-8 truncate px-[24px] text-right text-[var(--color-text-300)] tabular-nums">{formatReferenceRate(service.referenceRate, service.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </HorizontalScrollViewport>
    );
  }

  return (
    <section className="flex flex-col gap-[24px]" aria-labelledby="quote-service-picker-title">
      <div className="flex flex-wrap items-center justify-between gap-y-[12px]">
        <h2 id="quote-service-picker-title" className="text-heading-5 text-[var(--color-text-300)]">Seleccionar servicios</h2>
        <div className="w-[320px] max-[767px]:w-full">
          <Input
            type="Default input"
            size="M"
            value={query}
            placeholder="Buscar..."
            showLabel={false}
            showHint={false}
            showLeftIcon
            showRightIcon={false}
            required={false}
            disabled={disabled}
            leftIcon={<SearchNormal1 size="20" color="currentColor" />}
            className="w-full"
            aria-label="Buscar servicios por nombre o código"
            onChange={(event) => {
              setQuery(event.target.value);
              setPageIndex(0);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-[16px]">
        <div className="w-full overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
          {body}
        </div>
        {!loading && !error && visible.length ? (
          <CursorPaginationNav
            ariaLabel="Paginación de servicios disponibles"
            className="self-end"
            pagination={{
              hasNext: page.hasNext && !disabled,
              hasPrevious: page.hasPrevious && !disabled,
              next: () => setPageIndex(page.pageIndex + 1),
              previous: () => setPageIndex(page.pageIndex - 1),
            }}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-y-[16px]">
        <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">
          {formatServicePickerCount({ available: services.length - includedCount, included: includedCount, selected: selected.length })}
        </span>
        <div className="flex min-w-[257px] items-center gap-[8px] max-[767px]:w-full">
          <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={disabled || !selected.length} onClick={() => setSelectedIds(new Set())}>
            Cancelar
          </Button>
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            disabled={disabled || !selected.length}
            className="max-[767px]:flex-1"
            onClick={() => {
              onAdd(selected);
              setSelectedIds(new Set());
            }}
          >
            Agregar seleccionados
          </Button>
        </div>
      </div>
    </section>
  );
}

export default QuoteServicePicker;
