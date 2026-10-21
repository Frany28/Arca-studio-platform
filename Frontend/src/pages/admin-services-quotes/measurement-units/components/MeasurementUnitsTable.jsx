import { ArrowSwapVertical, Edit2, Filter, MinusCirlce, TickCircle } from "iconsax-react";

import ActionMenu from "../../../../components/ui/ActionMenu/ActionMenu.jsx";
import Badge from "../../../../components/ui/Badge/Badge.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import { getInUseReason } from "../utils/measurementUnitPresentation.js";

/**
 * Encabezado de columna con el icono decorativo de Figma (orden o filtro), como en la tabla
 * de usuarios; el orden real lo define el backend.
 *
 * @param {Object} props - Texto e icono.
 * @param {import("react").ReactNode} props.children - Texto del encabezado.
 * @param {boolean} [props.filter=false] - Usa el icono de filtro en lugar del de orden.
 * @returns {import("react").ReactElement} Contenido del encabezado.
 */
function HeaderLabel({ children, filter = false }) {
  const Icon = filter ? Filter : ArrowSwapVertical;
  return (
    <span className="flex items-center gap-[8px] whitespace-nowrap">
      {children}
      <Icon size="16" variant="Linear" color="currentColor" aria-hidden="true" />
    </span>
  );
}

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
 * código público, etiqueta compuesta por la API y acciones individuales. Solo presenta filas
 * reales; las inactivas lo indican con texto además del color. Desplaza horizontalmente dentro
 * de su propio contenedor.
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
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[512px] table-fixed border-collapse text-left">
          <caption className="sr-only">Unidades de medida</caption>
          {/* Sin columna de selección: «Unidad» absorbe el ancho libre; N° y Acciones conservan el suyo. */}
          <colgroup><col className="w-[154px]" /><col /><col className="w-[128px]" /></colgroup>
          <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
            <tr className="text-heading-8 h-[49px]">
              <th scope="col" className="px-[24px] py-[16px]"><HeaderLabel>N°</HeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px]"><HeaderLabel filter>Unidad</HeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px] text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const inUseReason = getInUseReason(item);
              return (
                <tr key={item.id} className="h-[68px] bg-[var(--color-neutral-100)]">
                  <th scope="row" className="text-heading-8 truncate px-[24px] py-[16px] font-medium text-[var(--color-text-300)]">{item.publicCode}</th>
                  <td className="px-[24px] py-[16px]">
                    <div className="flex min-w-0 items-center gap-[8px]">
                      <Badge label={item.label} theme="Brand 2" variation="Simple" size="S" truncate />
                      {!item.isActive ? <Badge label="Inactiva" theme="Disabled" variation="Simple" size="S" className="shrink-0" /> : null}
                    </div>
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
                        title={inUseReason || undefined}
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
      </div>
    </div>
  );
}

export default MeasurementUnitsTable;
