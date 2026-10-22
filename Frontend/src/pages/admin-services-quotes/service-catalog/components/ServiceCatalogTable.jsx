import { Edit2, MinusCirlce, TickCircle } from "iconsax-react";

import ActionMenu from "../../../../components/ui/ActionMenu/ActionMenu.jsx";
import Badge from "../../../../components/ui/Badge/Badge.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import Checkbox from "../../../../components/ui/Checkbox/Checkbox.jsx";
import TableHeaderLabel from "../../components/TableHeaderLabel.jsx";
import {
  formatReferenceRate,
  getServiceDescription,
  getServiceStatusBadge,
} from "../utils/serviceCatalogPresentation.js";
import ServiceDescriptionHint from "./ServiceDescriptionHint.jsx";

// Motivo visible mientras el formulario de servicios no tenga código ni tipo en Figma.
export const SERVICE_FORM_PENDING_REASON = "Edición disponible cuando el formulario de servicios esté definido";

/**
 * Acciones del menú «Más opciones» según el estado actual (Figma 5790:332135).
 *
 * @param {Object} service - Fila de la tabla.
 * @returns {Array<Object>} Elementos de ActionMenu.
 */
function getStatusActions(service) {
  return service.isActive
    ? [{ id: "deactivate", label: "Desactivar", icon: MinusCirlce }]
    : [{ id: "activate", label: "Activar", icon: TickCircle }];
}

/**
 * Tabla del tabulador de servicios (Figma 5790:332039): selección, código, servicio con su
 * descripción en tooltip, etiqueta de unidad, tarifa base, estado y acciones. Presenta solo
 * filas reales de la API y desplaza horizontalmente dentro de su propio contenedor.
 *
 * @param {Object} props - Filas, selección y callbacks.
 * @param {Array<Object>} props.items - Servicios de la página visible.
 * @param {Object} props.selection - Estado de usePageSelection.
 * @param {boolean} props.actionsDisabled - Bloquea las acciones mientras hay un cambio en curso.
 * @param {(service: Object, isActive: boolean) => void} props.onStatusChange - Solicita un cambio de estado.
 * @returns {import("react").ReactElement} Tabla.
 */
function ServiceCatalogTable({ actionsDisabled, items, onStatusChange, selection }) {
  return (
    <div className="w-full shrink-0 overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[1104px] table-fixed border-collapse text-left">
          <caption className="sr-only">Tabulador de servicios</caption>
          <colgroup>
            <col className="w-[48px]" /><col className="w-[154px]" /><col className="w-[290px]" /><col className="w-[190px]" />
            <col className="w-[140px]" /><col /><col className="w-[128px]" />
          </colgroup>
          <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
            <tr className="text-heading-8 h-[49px]">
              <th scope="col" className="p-[16px]">
                <Checkbox size="S" checked={selection.headerChecked} interactive={items.length > 0} aria-label="Seleccionar todos los servicios visibles" onCheckedChange={selection.toggleAll} />
              </th>
              <th scope="col" className="px-[24px] py-[16px]"><TableHeaderLabel>N°</TableHeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px]">Servicio</th>
              <th scope="col" className="px-[24px] py-[16px]"><TableHeaderLabel filter>Unidad</TableHeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px]"><span className="flex justify-end"><TableHeaderLabel>Tarifa base</TableHeaderLabel></span></th>
              <th scope="col" className="px-[24px] py-[16px]"><TableHeaderLabel filter>Estado</TableHeaderLabel></th>
              <th scope="col" className="px-[24px] py-[16px] text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((service) => {
              const selected = selection.isSelected(service.id);
              const description = getServiceDescription(service);
              const status = getServiceStatusBadge(service);
              return (
                <tr
                  key={service.id}
                  className={`h-[68px] transition-colors duration-150 ${selected ? "bg-[var(--color-neutral-300)]" : "bg-[var(--color-neutral-100)]"}`}
                  data-selected={selected ? "true" : undefined}
                >
                  <td className="p-[16px]">
                    <Checkbox size="S" checked={selected ? "Yes" : "No"} aria-label={`Seleccionar ${service.code} ${service.name}`} onCheckedChange={() => selection.toggle(service.id)} />
                  </td>
                  <th scope="row" className="text-heading-8 truncate px-[24px] py-[16px] font-medium text-[var(--color-text-300)]">{service.code}</th>
                  <td className="px-[24px] py-[16px]">
                    <div className="flex min-w-0 items-center gap-[2px]">
                      <span className="text-heading-8 truncate text-[var(--color-text-300)]" title={service.name}>{service.name}</span>
                      {description ? <ServiceDescriptionHint serviceName={service.name} description={description} /> : null}
                    </div>
                  </td>
                  <td className="px-[24px] py-[16px]">
                    <div className="flex min-w-0">
                      <Badge label={service.unitLabel} theme="Brand 2" variation="Simple" size="S" truncate />
                    </div>
                  </td>
                  <td className="text-heading-8 px-[24px] py-[16px] text-right text-[var(--color-text-300)] tabular-nums">
                    {formatReferenceRate(service.referenceRate, service.currency)}
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
                        disabled
                        tooltip={SERVICE_FORM_PENDING_REASON}
                        aria-label={`Editar ${service.code} ${service.name} (${SERVICE_FORM_PENDING_REASON.toLocaleLowerCase("es")})`}
                      />
                      <ActionMenu
                        items={getStatusActions(service)}
                        triggerLabel={`Más opciones para ${service.code}`}
                        menuLabel={`Acciones para ${service.code}`}
                        tooltip="Más opciones"
                        menuWidthClassName="w-[183px]"
                        disabled={actionsDisabled}
                        onSelect={(action) => onStatusChange(service, action.id === "activate")}
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

export default ServiceCatalogTable;
