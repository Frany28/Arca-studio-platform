import { Edit2, MinusCirlce, TickCircle } from "iconsax-react";

import ActionMenu from "../../../../components/ui/ActionMenu/ActionMenu.jsx";
import HorizontalScrollViewport from "../../../../components/ui/ScrollBar/HorizontalScrollViewport.jsx";
import Badge from "../../../../components/ui/Badge/Badge.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import { MEASUREMENT_UNIT_COLUMN_WIDTHS, MEASUREMENT_UNIT_TABLE_MIN_WIDTH } from "../../../../config/measurementUnitTable.js";
import TableHeaderLabel from "../../components/TableHeaderLabel.jsx";
import { getActiveStatusBadge } from "../../utils/activeStatusBadge.js";
import { getInUseReason } from "../utils/measurementUnitPresentation.js";

/**
 * Acciones del menú «Más opciones» según el estado actual: desactivar una activa (bloqueado si
 * está en uso) o activar una inactiva.
 *
 * @param {Object} denomination - Fila de la tabla.
 * @returns {Array<Object>} Elementos de ActionMenu.
 */
function getStatusActions(denomination) {
  if (!denomination.isActive) return [{ id: "activate", label: "Activar", icon: TickCircle }];
  return [{ id: "deactivate", label: "Desactivar", icon: MinusCirlce, disabled: Boolean(getInUseReason(denomination)) }];
}

/**
 * Tabla administrativa de unidades de medida (Figma 5771:487550, sin selección de filas):
 * código público, etiqueta compuesta por la API, estado y acciones individuales. Solo presenta
 * filas reales; «Estado» usa el mismo Badge que el tabulador de servicios (texto además del
 * color) y sigue `isActive` de la API. Desplaza horizontalmente dentro de su propio contenedor.
 *
 * @param {Object} props - Filas y callbacks.
 * @param {Array<Object>} props.items - Denominaciones de la página visible.
 * @param {boolean} props.actionsDisabled - Bloquea acciones mientras hay una mutación en curso.
 * @param {(item: Object) => void} props.onEdit - Abre la edición.
 * @param {(item: Object, isActive: boolean) => void} props.onStatusChange - Solicita un cambio de estado.
 * @returns {import("react").ReactElement} Tabla.
 */
function MeasurementUnitsTable({ actionsDisabled, items, onEdit, onStatusChange }) {
  return (
    <div className="w-full shrink-0 overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
      <HorizontalScrollViewport scrollBarLabel="Desplazar tabla de unidades horizontalmente">
        {/* Anchos y mínimo compartidos con el skeleton (config/measurementUnitTable.js); sin columna de selección, «Unidad» absorbe el ancho libre. */}
        <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: MEASUREMENT_UNIT_TABLE_MIN_WIDTH }}>
          <caption className="sr-only">Unidades de medida</caption>
          <colgroup>
            {MEASUREMENT_UNIT_COLUMN_WIDTHS.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}
          </colgroup>
          <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
            <tr className="text-heading-8 h-[49px]">
              <th scope="col" className="px-[24px] py-[16px]"><TableHeaderLabel>N°</TableHeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px]"><TableHeaderLabel filter>Unidad</TableHeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px]"><TableHeaderLabel filter>Estado</TableHeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px] text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const inUseReason = getInUseReason(item);
              const status = getActiveStatusBadge(item);
              return (
                <tr key={item.id} className="h-[68px] bg-[var(--color-neutral-100)]">
                  <th scope="row" className="text-heading-8 truncate px-[24px] py-[16px] font-medium text-[var(--color-text-300)]">{item.publicCode}</th>
                  <td className="px-[24px] py-[16px]">
                    <div className="flex min-w-0">
                      <Badge label={item.label} theme="Brand 2" variation="Simple" size="S" truncate />
                    </div>
                  </td>
                  <td className="px-[24px] py-[16px]">
                    <Badge label={status.label} theme={status.theme} variation="Simple" size="S" />
                  </td>
                  <td className="px-[24px] py-[16px]">
                    <div className="flex items-center justify-end gap-[8px]">
                      <Button
                        theme="Primary"
                        type="Ghost"
                        size="S"
                        showText={false}
                        showLeftIcon
                        iconLeft={<Edit2 size="20" color="currentColor" />}
                        showRightIcon={false}
                        disabled={actionsDisabled || Boolean(inUseReason)}
                        tooltip={inUseReason ? `${inUseReason}: no se puede editar` : "Editar unidad"}
                        aria-label={`Editar ${item.publicCode} ${item.label}${inUseReason ? ` (${inUseReason})` : ""}`}
                        onClick={() => onEdit(item)}
                      />
                      <ActionMenu
                        items={getStatusActions(item)}
                        triggerLabel={`Más opciones para ${item.publicCode}`}
                        menuLabel={`Acciones para ${item.publicCode}`}
                        tooltip="Más opciones"
                        menuWidthClassName="w-[183px]"
                        disabled={actionsDisabled}
                        onSelect={(action) => onStatusChange(item, action.id === "activate")}
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

export default MeasurementUnitsTable;
