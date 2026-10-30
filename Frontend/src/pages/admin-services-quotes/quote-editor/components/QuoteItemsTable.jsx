import { CloseCircle } from "iconsax-react";
import { useState } from "react";

import ActionMenu from "../../../../components/ui/ActionMenu/ActionMenu.jsx";
import Badge from "../../../../components/ui/Badge/Badge.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import Checkbox from "../../../../components/ui/Checkbox/Checkbox.jsx";
import DropdownMenu from "../../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import TableScrollViewport from "../../../../components/ui/ScrollBar/TableScrollViewport.jsx";
import ServiceDescriptionHint from "../../service-catalog/components/ServiceDescriptionHint.jsx";
import { formatDecimalMoney } from "../../utils/moneyFormat.js";
import QuoteAmountsSummary from "./QuoteAmountsSummary.jsx";

// Figma 5771:367433: selección 48, Servicio 300, Unidad 200, Cantidad/Tarifa base/Subtotal
// flexibles y Acciones 107. Mínimo de 1102 px como el resto de tablas del módulo.
const ITEMS_COLUMN_WIDTHS = Object.freeze([48, 300, 200, null, null, null, 107]);
const ITEMS_TABLE_MIN_WIDTH = 1102;
// Figma 5771:367432: cabecera de 49 px y filas de 71 px; se ven dos servicios (191 px) y el resto
// se recorre con el ScrollBar vertical.
const ITEMS_HEADER_HEIGHT = 49;
const ITEMS_ROW_HEIGHT = 71;
const ITEMS_VISIBLE_ROWS = 2;
const ITEMS_VIEWPORT_MAX_HEIGHT = ITEMS_HEADER_HEIGHT + ITEMS_ROW_HEIGHT * ITEMS_VISIBLE_ROWS;
const LINE_ACTIONS = Object.freeze([{ icon: CloseCircle, id: "remove", label: "Eliminar", tone: "danger" }]);

/**
 * Campo numérico de una fila (cantidad o tarifa) con su error accesible bajo el control. La
 * tarifa muestra el símbolo de la moneda como prefijo fijo, como el valor «$12» de Figma.
 *
 * @param {Object} props - Valor, presentación y callbacks.
 * @param {string} props.id - Id del campo.
 * @param {string} props.value - Texto escrito.
 * @param {string} props.label - Nombre accesible.
 * @param {string} [props.error] - Error del campo.
 * @param {string} [props.prefix] - Prefijo fijo (símbolo de moneda).
 * @param {boolean} props.disabled - Bloquea el campo.
 * @param {(value: string) => void} props.onChange - Cambia el valor.
 * @returns {import("react").ReactElement} Campo.
 */
function LineNumberField({ disabled, error, id, label, onChange, prefix, value }) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <Input
        id={id}
        type="Default input"
        size="S"
        value={value}
        placeholder="0"
        inputMode="decimal"
        showLabel={false}
        showHint={false}
        showLeftIcon={Boolean(prefix)}
        leftIcon={prefix ? <span className="text-body-3 text-[var(--color-text-300)]">{prefix}</span> : null}
        showRightIcon={false}
        required
        state={error ? "Error" : "Default"}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full max-w-none"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <HintText id={errorId} hintText={error} state="Error" role="alert" className="w-full" /> : null}
    </div>
  );
}

/**
 * Opciones del desplegable de servicio de una fila: el servicio actual (aunque ya esté inactivo,
 * para mostrarlo seleccionado) y los servicios activos que no están en otra fila.
 *
 * @param {Object} line - Concepto de la fila.
 * @param {Array<Object>} services - Servicios activos del tabulador.
 * @param {Set<number>} includedIds - Servicios ya incluidos en la cotización.
 * @returns {Array<{id: number, label: string}>} Opciones del Dropdown menu.
 */
function getLineServiceOptions(line, services, includedIds) {
  const others = services.filter((service) => service.id !== line.serviceId && !includedIds.has(service.id));
  return [{ id: line.serviceId, label: line.serviceName }, ...others.map((service) => ({ id: service.id, label: service.name }))];
}

/**
 * «Servicios incluidos» del formulario (Figma 5771:367425): cada concepto con el desplegable de
 * su servicio (cambiarlo trae la unidad y la tarifa del nuevo), su unidad, cantidad y tarifa
 * aplicada editables, el subtotal calculado al momento y «Eliminar» en
 * el menú de la fila. Se ven dos servicios con la cabecera fija y el resto se recorre con el
 * ScrollBar vertical. Las casillas seleccionan servicios y, con selección, aparece debajo
 * «Eliminar» para quitarlos juntos (patrón de las acciones masivas del tabulador); debajo, el resumen de importes (total de servicios, IVA referencial y total
 * estimado con IVA). Los importes mostrados son una vista previa con el motor del backend, que
 * recalcula y guarda los definitivos.
 *
 * @param {Object} props - Conceptos, importes, errores y callbacks.
 * @param {Array<Object>} props.lines - Conceptos del borrador.
 * @param {{lines: Array<{subtotal: string|null}>, total: string|null, referenceVatAmount: string|null,
 *   estimatedTotalWithVat: string|null}} props.preview - Importes calculados.
 * @param {{enabled: boolean, rate: string|null}} props.referenceVat - IVA referencial aplicado.
 * @param {Record<string, string>} props.errors - Errores por ruta (`items.0.quantity`).
 * @param {(key: string, field: "quantity"|"unitRate", value: string) => void} props.onLineChange - Edita un concepto.
 * @param {(key: string) => void} props.onRemove - Quita un concepto.
 * @param {(keys: Array<string>) => void} props.onRemoveMany - Quita los conceptos seleccionados.
 * @param {Array<Object>} props.services - Servicios activos del tabulador (opciones del desplegable).
 * @param {(key: string, service: Object) => void} props.onServiceChange - Cambia el servicio de un concepto.
 * @param {boolean} props.disabled - Bloquea la edición durante el guardado.
 * @returns {import("react").ReactElement} Sección.
 */
function QuoteItemsTable({ disabled, errors, lines, onLineChange, onRemove, onRemoveMany, onServiceChange, preview, referenceVat, services }) {
  const [openHintKey, setOpenHintKey] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const includedIds = new Set(lines.map((line) => line.serviceId));
  // Solo cuentan las filas presentes: un concepto quitado deja de estar seleccionado.
  const selected = lines.filter((line) => selectedKeys.has(line.key));
  const allSelected = lines.length > 0 && selected.length === lines.length;

  /**
   * Marca o desmarca un concepto.
   *
   * @param {string} key - Concepto.
   * @returns {void}
   */
  function toggle(key) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-[16px]" aria-labelledby="quote-items-title">
      <h2 id="quote-items-title" className="text-heading-5 text-[var(--color-text-300)]">Servicios incluidos</h2>

      <div className="w-full overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
        <TableScrollViewport
          headerHeight={ITEMS_HEADER_HEIGHT}
          maxHeight={ITEMS_VIEWPORT_MAX_HEIGHT}
          disabled={disabled}
          verticalLabel="Desplazar servicios incluidos verticalmente"
          horizontalLabel="Desplazar servicios incluidos horizontalmente"
          data-quote-items-viewport
        >
          <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: ITEMS_TABLE_MIN_WIDTH }}>
            <caption className="sr-only">Servicios incluidos en la cotización</caption>
            <colgroup>
              {ITEMS_COLUMN_WIDTHS.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
              <tr className="text-heading-8 h-[49px]">
                <th scope="col" className="p-[16px]">
                  <Checkbox
                    size="S"
                    checked={allSelected ? "Yes" : selected.length ? "Indeterminate" : "No"}
                    interactive={lines.length > 0 && !disabled}
                    aria-label="Seleccionar todos los servicios incluidos"
                    onCheckedChange={() => setSelectedKeys(allSelected ? new Set() : new Set(lines.map((line) => line.key)))}
                  />
                </th>
                <th scope="col" className="px-[24px] py-[16px]">Servicio</th>
                <th scope="col" className="px-[24px] py-[16px]">Unidad</th>
                <th scope="col" className="px-[24px] py-[16px]">Cantidad</th>
                <th scope="col" className="px-[24px] py-[16px]">Tarifa base</th>
                <th scope="col" className="px-[24px] py-[16px]">Subtotal</th>
                <th scope="col" className="px-[24px] py-[16px] text-right">Acciones</th>
              </tr>
            </thead>
            {/* isolate: el z-index interno del Checkbox no sale del cuerpo ni tapa la cabecera fija. */}
            <tbody className="isolate">
              {lines.map((line, index) => {
                const subtotal = preview.lines[index]?.subtotal;
                const checked = selectedKeys.has(line.key);
                return (
                  <tr
                    key={line.key}
                    className={`h-[71px] align-middle transition-colors duration-150 ${checked ? "bg-[var(--color-neutral-300)]" : "bg-[var(--color-neutral-100)]"}`}
                    data-selected={checked ? "true" : undefined}
                  >
                    <td className="px-[16px]">
                      <Checkbox
                        size="S"
                        checked={checked ? "Yes" : "No"}
                        interactive={!disabled}
                        aria-label={`Seleccionar ${line.serviceName}`}
                        onCheckedChange={() => toggle(line.key)}
                      />
                    </td>
                    <th scope="row" className="px-[24px] py-[16px] text-left font-normal">
                      <div className="flex min-w-0 items-center gap-[2px]">
                        {/* En portal: la tabla desplaza en horizontal y recortaría el menú. */}
                        <DropdownMenu
                          portal
                          type="Text"
                          label={line.serviceName}
                          supportingText=""
                          items={getLineServiceOptions(line, services, includedIds)}
                          selectedItemId={line.serviceId}
                          interactive
                          truncateTriggerLabel
                          disabled={disabled}
                          showContainer
                          rowHeightClassName="h-[35px]"
                          itemHeight={35}
                          maxVisibleItems={3}
                          truncateItemLabels
                          contentPaddingClassName="px-[4px] py-[8px]"
                          className="min-w-0 flex-1"
                          aria-label={`Servicio de la fila: ${line.serviceName}`}
                          onItemSelect={(item) => {
                            const service = services.find((candidate) => candidate.id === item.id);
                            if (service && item.id !== line.serviceId) onServiceChange(line.key, service);
                          }}
                        />
                        {line.serviceDescription ? (
                          <ServiceDescriptionHint
                            serviceName={line.serviceName}
                            description={line.serviceDescription}
                            open={openHintKey === line.key}
                            onOpenChange={(open) => setOpenHintKey(open ? line.key : null)}
                          />
                        ) : null}
                      </div>
                      {line.serviceIsActive === false ? (
                        <p className="text-body-4 text-[var(--color-text-100)]">Servicio inactivo: se conserva la versión cotizada.</p>
                      ) : null}
                    </th>
                    <td className="px-[24px] py-[16px]">
                      <div className="flex min-w-0">
                        <Badge label={line.unitLabel} theme="Brand 2" variation="Simple" size="S" truncate />
                      </div>
                    </td>
                    <td className="px-[24px] py-[16px]">
                      <LineNumberField
                        id={`quote-line-${line.serviceId}-quantity`}
                        label={`Cantidad de ${line.serviceName}`}
                        value={line.quantity}
                        error={errors[`items.${index}.quantity`]}
                        disabled={disabled}
                        onChange={(value) => onLineChange(line.key, "quantity", value)}
                      />
                    </td>
                    <td className="px-[24px] py-[16px]">
                      <LineNumberField
                        id={`quote-line-${line.serviceId}-rate`}
                        label={`Tarifa base de ${line.serviceName} en USD`}
                        prefix="$"
                        value={line.unitRate}
                        error={errors[`items.${index}.unitRate`] || errors[`items.${index}.serviceId`]}
                        disabled={disabled}
                        onChange={(value) => onLineChange(line.key, "unitRate", value)}
                      />
                    </td>
                    <td className="text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)] tabular-nums">
                      {subtotal ? formatDecimalMoney(subtotal, { alwaysShowCents: true }) : "—"}
                    </td>
                    <td className="px-[24px] py-[16px]">
                      <div className="flex justify-end">
                        <ActionMenu
                          items={LINE_ACTIONS}
                          triggerLabel={`Más opciones para ${line.serviceName}`}
                          menuLabel={`Acciones para ${line.serviceName}`}
                          tooltip="Más opciones"
                          menuWidthClassName="w-[160px]"
                          disabled={disabled}
                          onSelect={() => onRemove(line.key)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScrollViewport>
        {lines.length === 0 ? (
          <EmptyState
            title="No se han agregado servicios"
            description="Añade algún servicio para comenzar a detallar la cotización."
            size="S"
            showFeaturedIcon
            showActions={false}
            className="min-h-[245px]"
          />
        ) : null}
      </div>
      {errors.items ? <HintText hintText={errors.items} state="Error" role="alert" className="w-full" /> : null}
      {selected.length ? (
        <div className="flex flex-wrap items-center gap-x-[24px] gap-y-[12px]" data-quote-items-bulk-actions>
          <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">
            {selected.length} de {lines.length} seleccionados
          </span>
          <Button
            theme="Primary"
            type="Ghost"
            size="M"
            fitContent
            showLeftIcon
            iconLeft={<CloseCircle size="20" color="currentColor" />}
            showRightIcon={false}
            disabled={disabled}
            aria-label={`Eliminar ${selected.length} ${selected.length === 1 ? "servicio seleccionado" : "servicios seleccionados"}`}
            onClick={() => {
              onRemoveMany(selected.map((line) => line.key));
              setSelectedKeys(new Set());
            }}
          >
            Eliminar
          </Button>
        </div>
      ) : null}

      <QuoteAmountsSummary preview={preview} referenceVat={referenceVat} />
    </section>
  );
}

export default QuoteItemsTable;
