import { CloseCircle } from "iconsax-react";
import { useState } from "react";

import ActionMenu from "../../../../components/ui/ActionMenu/ActionMenu.jsx";
import Badge from "../../../../components/ui/Badge/Badge.jsx";
import DropdownMenu from "../../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import HorizontalScrollViewport from "../../../../components/ui/ScrollBar/HorizontalScrollViewport.jsx";
import ServiceDescriptionHint from "../../service-catalog/components/ServiceDescriptionHint.jsx";
import { formatDecimalMoney } from "../../utils/moneyFormat.js";

// Figma 5771:367433: 48 (vacía), Servicio 300, Unidad 200, Cantidad/Tarifa base/Subtotal
// flexibles y Acciones 107. Mínimo de 1102 px como el resto de tablas del módulo.
const ITEMS_COLUMN_WIDTHS = Object.freeze([48, 300, 200, null, null, null, 107]);
const ITEMS_TABLE_MIN_WIDTH = 1102;
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
 * Unidad de un concepto: el Badge de Figma si el servicio tiene una sola unidad y, con varias, un
 * desplegable con las cotizables (las pendientes de validación comercial no se ofrecen y se
 * nombran debajo). El error de la API o de la validación va bajo el control.
 *
 * @param {Object} props - Concepto, error y callback.
 * @param {Object} props.line - Concepto del borrador.
 * @param {string} [props.error] - Error de `items.N.unitOptionPosition`.
 * @param {boolean} props.disabled - Bloquea el desplegable.
 * @param {(position: number) => void} props.onChange - Elige una unidad cotizable.
 * @returns {import("react").ReactElement} Contenido de la celda.
 */
function LineUnitField({ disabled, error, line, onChange }) {
  const choices = line.unitChoices ?? [];
  const errorId = `quote-line-${line.serviceId}-unit-error`;
  if (choices.length <= 1) {
    return (
      <div className="flex min-w-0 flex-col gap-[4px]">
        <div className="flex min-w-0">
          <Badge label={line.unitLabel} theme="Brand 2" variation="Simple" size="S" truncate />
        </div>
        {error ? <HintText id={errorId} hintText={error} state="Error" role="alert" className="w-full" /> : null}
      </div>
    );
  }
  const quotable = choices.filter((choice) => choice.referenceRate !== null);
  const pending = choices.filter((choice) => choice.referenceRate === null);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <DropdownMenu
        portal
        type="Text"
        label={line.unitLabel || "Elige la unidad"}
        supportingText=""
        items={quotable.map((choice) => ({ id: choice.position, label: choice.label }))}
        selectedItemId={line.unitOptionPosition}
        interactive={quotable.length > 0}
        truncateTriggerLabel
        disabled={disabled}
        showContainer
        rowHeightClassName="h-[35px]"
        contentPaddingClassName="px-[4px] py-[8px]"
        className="min-w-0"
        aria-label={`Unidad de ${line.serviceName}${line.unitLabel ? `: ${line.unitLabel}` : ""}`}
        aria-describedby={error ? errorId : undefined}
        onItemSelect={(item) => onChange(item.id)}
      />
      {pending.length ? (
        <p className="text-body-4 m-0 text-[var(--color-text-100)]">
          {`Tarifa pendiente de validación comercial: ${pending.map((choice) => choice.label).join(", ")}`}
        </p>
      ) : null}
      {error ? <HintText id={errorId} hintText={error} state="Error" role="alert" className="w-full" /> : null}
    </div>
  );
}

/**
 * «Servicios incluidos» del formulario (Figma 5771:367425): cada concepto con el desplegable de
 * su servicio (cambiarlo trae la unidad y la tarifa del nuevo), su unidad (elegible si el servicio
 * tiene varias cotizables), cantidad y tarifa aplicada editables, el subtotal calculado al
 * momento y «Eliminar» en el menú de la fila; debajo, el total de la cotización. Los importes
 * mostrados son una vista previa con las reglas del backend, que recalcula los definitivos.
 *
 * @param {Object} props - Conceptos, importes, errores y callbacks.
 * @param {Array<Object>} props.lines - Conceptos del borrador.
 * @param {{lines: Array<{subtotal: string|null}>, total: string|null}} props.preview - Importes calculados.
 * @param {Record<string, string>} props.errors - Errores por ruta (`items.0.quantity`).
 * @param {(key: string, field: "quantity"|"unitRate", value: string) => void} props.onLineChange - Edita un concepto.
 * @param {(key: string) => void} props.onRemove - Quita un concepto.
 * @param {Array<Object>} props.services - Servicios activos del tabulador (opciones del desplegable).
 * @param {(key: string, service: Object) => void} props.onServiceChange - Cambia el servicio de un concepto.
 * @param {(key: string, position: number, index: number) => void} props.onUnitChange - Elige la unidad de un concepto.
 * @param {boolean} props.disabled - Bloquea la edición durante el guardado.
 * @returns {import("react").ReactElement} Sección.
 */
function QuoteItemsTable({ disabled, errors, lines, onLineChange, onRemove, onServiceChange, onUnitChange, preview, services }) {
  const [openHintKey, setOpenHintKey] = useState(null);
  const includedIds = new Set(lines.map((line) => line.serviceId));
  const total = preview.total === null ? "—" : formatDecimalMoney(preview.total, { alwaysShowCents: true });

  return (
    <section className="flex flex-col gap-[16px]" aria-labelledby="quote-items-title">
      <h2 id="quote-items-title" className="text-heading-5 text-[var(--color-text-300)]">Servicios incluidos</h2>

      <div className="w-full overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
        <HorizontalScrollViewport scrollBarLabel="Desplazar servicios incluidos horizontalmente">
          <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: ITEMS_TABLE_MIN_WIDTH }}>
            <caption className="sr-only">Servicios incluidos en la cotización</caption>
            <colgroup>
              {ITEMS_COLUMN_WIDTHS.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}
            </colgroup>
            <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
              <tr className="text-heading-8 h-[49px]">
                <th scope="col" aria-hidden="true" />
                <th scope="col" className="px-[24px] py-[16px]">Servicio</th>
                <th scope="col" className="px-[24px] py-[16px]">Unidad</th>
                <th scope="col" className="px-[24px] py-[16px]">Cantidad</th>
                <th scope="col" className="px-[24px] py-[16px]">Tarifa base</th>
                <th scope="col" className="px-[24px] py-[16px]">Subtotal</th>
                <th scope="col" className="px-[24px] py-[16px] text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const subtotal = preview.lines[index]?.subtotal;
                return (
                  <tr key={line.key} className="h-[71px] bg-[var(--color-neutral-100)] align-middle">
                    <td aria-hidden="true" />
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
                      <LineUnitField
                        line={line}
                        error={errors[`items.${index}.unitOptionPosition`]}
                        disabled={disabled}
                        onChange={(position) => onUnitChange(line.key, position, index)}
                      />
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
        </HorizontalScrollViewport>
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

      <div className="flex flex-wrap items-center justify-between gap-y-[16px]">
        <p className="text-heading-7 text-[var(--color-text-50)]">Total de la cotización</p>
        <p className="text-heading-4 text-[var(--color-text-50)] tabular-nums" aria-live="polite">{total}</p>
      </div>
    </section>
  );
}

export default QuoteItemsTable;
