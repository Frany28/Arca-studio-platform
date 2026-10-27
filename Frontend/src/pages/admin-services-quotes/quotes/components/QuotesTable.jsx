import { DocumentDownload, Edit2, Eye } from "iconsax-react";

import ActionMenu from "../../../../components/ui/ActionMenu/ActionMenu.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import Checkbox from "../../../../components/ui/Checkbox/Checkbox.jsx";
import HorizontalScrollViewport from "../../../../components/ui/ScrollBar/HorizontalScrollViewport.jsx";
import { QUOTES_TABLE_COLUMN_WIDTHS, QUOTES_TABLE_MIN_WIDTH } from "../../../../config/quotesTable.js";
import TableHeaderLabel from "../../components/TableHeaderLabel.jsx";
import { formatDecimalMoney } from "../../utils/moneyFormat.js";
import { QUOTE_SORT_FIELDS, formatQuoteDate, getColumnSortDirection } from "../utils/quoteListPresentation.js";

// «Más opciones» (Figma 5790:340571): el diseño no detalla su contenido; ofrece la descarga del PDF.
const ROW_ACTIONS = Object.freeze([{ icon: DocumentDownload, id: "download", label: "Descargar PDF" }]);

/**
 * Encabezado ordenable (N° y Total): la celda declara `aria-sort` y el botón alterna el orden real.
 *
 * @param {Object} props - Columna, orden y callbacks.
 * @param {string} props.field - Campo de orden de la columna.
 * @param {string} props.label - Texto del encabezado.
 * @param {{sort: string, direction: string}} props.sort - Orden aplicado.
 * @param {(field: string) => void} props.onSort - Alterna el orden.
 * @param {boolean} props.disabled - Bloquea el cambio de orden.
 * @returns {import("react").ReactElement} Celda de encabezado.
 */
function SortableHeader({ disabled, field, label, onSort, sort }) {
  const direction = getColumnSortDirection(sort, field);
  return (
    <th scope="col" aria-sort={direction} className="px-[24px] py-[16px]">
      <TableHeaderLabel sortDirection={direction} disabled={disabled} onSort={() => onSort(field)}>{label}</TableHeaderLabel>
    </th>
  );
}

/**
 * Tabla del listado de cotizaciones (Figma 5771:488505): selección, N°, cliente, proyecto, fecha,
 * total y acciones (ver PDF, editar y más opciones). Presenta solo cotizaciones reales de la API y
 * desplaza horizontalmente dentro de su propio contenedor; la página nunca desborda.
 *
 * @param {Object} props - Filas, selección, orden y callbacks.
 * @param {Array<Object>} props.items - Cotizaciones de la página visible.
 * @param {Object} props.selection - Estado de usePageSelection.
 * @param {{sort: string, direction: string}} props.sort - Orden aplicado.
 * @param {(field: string) => void} props.onSort - Alterna el orden de N° o Total.
 * @param {(quote: Object, trigger: HTMLElement) => void} props.onView - Abre el visor del PDF.
 * @param {(quote: Object) => void} props.onEdit - Abre la edición.
 * @param {(quote: Object) => void} props.onDownload - Descarga el PDF.
 * @param {boolean} props.actionsDisabled - Bloquea acciones mientras hay una operación en curso.
 * @returns {import("react").ReactElement} Tabla.
 */
function QuotesTable({ actionsDisabled, items, onDownload, onEdit, onSort, onView, selection, sort }) {
  return (
    <div className="w-full shrink-0 overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
      <HorizontalScrollViewport scrollBarLabel="Desplazar tabla de cotizaciones horizontalmente">
        <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: QUOTES_TABLE_MIN_WIDTH }}>
          <caption className="sr-only">Cotizaciones</caption>
          <colgroup>
            {QUOTES_TABLE_COLUMN_WIDTHS.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}
          </colgroup>
          <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
            <tr className="text-heading-8 h-[49px]">
              <th scope="col" className="p-[16px]">
                <Checkbox size="S" checked={selection.headerChecked} interactive={items.length > 0 && !actionsDisabled} aria-label="Seleccionar todas las cotizaciones visibles" onCheckedChange={selection.toggleAll} />
              </th>
              <SortableHeader field={QUOTE_SORT_FIELDS.CODE} label="N°" sort={sort} disabled={actionsDisabled} onSort={onSort} />
              <th scope="col" className="px-[24px] py-[16px]">Cliente</th>
              <th scope="col" className="px-[24px] py-[16px]">Proyecto</th>
              {/* El intervalo de fechas se elige en la barra; el icono indica que la columna admite filtro. */}
              <th scope="col" className="px-[24px] py-[16px]"><TableHeaderLabel filter>Fecha</TableHeaderLabel></th>
              <SortableHeader field={QUOTE_SORT_FIELDS.TOTAL} label="Total" sort={sort} disabled={actionsDisabled} onSort={onSort} />
              <th scope="col" className="px-[24px] py-[16px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((quote) => {
              const selected = selection.isSelected(quote.id);
              const total = formatDecimalMoney(quote.servicesTotal, { alwaysShowCents: true, currency: quote.currency });
              return (
                <tr
                  key={quote.id}
                  className={`h-[68px] transition-colors duration-150 ${selected ? "bg-[var(--color-neutral-300)]" : "bg-[var(--color-neutral-100)]"}`}
                  data-selected={selected ? "true" : undefined}
                >
                  <td className="p-[16px]">
                    <Checkbox size="S" checked={selected ? "Yes" : "No"} interactive={!actionsDisabled} aria-label={`Seleccionar ${quote.code}`} onCheckedChange={() => selection.toggle(quote.id)} />
                  </td>
                  <th scope="row" className="text-heading-8 truncate px-[24px] py-[16px] font-medium text-[var(--color-text-300)]">{quote.code}</th>
                  <td className="text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)]" title={quote.client.name}>{quote.client.name}</td>
                  <td className="text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)]" title={quote.project.name}>{quote.project.name}</td>
                  <td className="text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)] tabular-nums">
                    <time dateTime={quote.createdAt}>{formatQuoteDate(quote.createdAt)}</time>
                  </td>
                  <td className="text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)] tabular-nums" title={total}>{total}</td>
                  <td className="px-[24px] py-[16px]">
                    <div className="flex items-center gap-[8px]">
                      <Button
                        theme="Primary"
                        type="Ghost"
                        size="S"
                        showText={false}
                        showLeftIcon
                        iconLeft={<Eye size="20" color="currentColor" />}
                        showRightIcon={false}
                        disabled={actionsDisabled}
                        tooltip="Ver cotización"
                        aria-label={`Ver ${quote.code}`}
                        onClick={(event) => onView(quote, event.currentTarget)}
                      />
                      <Button
                        theme="Primary"
                        type="Ghost"
                        size="S"
                        showText={false}
                        showLeftIcon
                        iconLeft={<Edit2 size="20" color="currentColor" />}
                        showRightIcon={false}
                        disabled={actionsDisabled}
                        tooltip="Editar cotización"
                        aria-label={`Editar ${quote.code}`}
                        onClick={() => onEdit(quote)}
                      />
                      <ActionMenu
                        items={ROW_ACTIONS}
                        triggerLabel={`Más opciones para ${quote.code}`}
                        menuLabel={`Acciones para ${quote.code}`}
                        tooltip="Más opciones"
                        menuWidthClassName="w-[183px]"
                        disabled={actionsDisabled}
                        onSelect={() => onDownload(quote)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </HorizontalScrollViewport>
    </div>
  );
}

export default QuotesTable;
