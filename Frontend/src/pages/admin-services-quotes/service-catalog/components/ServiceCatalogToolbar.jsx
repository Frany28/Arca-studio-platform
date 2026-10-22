import { Add, FilterRemove, SearchNormal1 } from "iconsax-react";

import AdminTableToolbar from "../../../../components/admin-table/AdminTableToolbar.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import DropdownMenu from "../../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import { SERVICE_STATUS_FILTER_ITEMS } from "../utils/serviceCatalogPresentation.js";

// Lista de opciones de los filtros, igual que en las tablas de usuarios y proyectos.
const FILTER_MENU_PROPS = {
  className: "w-full",
  contentClassName: "max-h-[168px] max-w-full overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--color-neutral-400)_transparent] [scrollbar-width:thin]",
  contentPaddingClassName: "px-[4px] py-[8px]",
  rowHeightClassName: "h-[35px]",
  truncateTriggerLabel: true,
  type: "Text",
};

/**
 * Barra del tabulador (Figma 5790:332032): búsqueda en la API, filtros por unidad y estado,
 * «Quitar filtros» y «Añadir servicio». En escritorio ocupa una fila (320 px, 513 px y el
 * botón); con menos ancho el botón pasa a la fila siguiente y en móvil ocupa todo el ancho.
 * «Añadir servicio» abre el formulario de alta.
 *
 * @param {Object} props - Estado de la consulta y callbacks.
 * @param {string} props.query - Texto escrito en la búsqueda.
 * @param {(value: string) => void} props.onQueryChange - Cambia la búsqueda.
 * @param {Array<{id: string, label: string}>} props.unitItems - Opciones del filtro por unidad.
 * @param {string|null} props.selectedUnitItemId - Opción de unidad aplicada.
 * @param {(item: Object) => void} props.onUnitChange - Aplica una opción de unidad.
 * @param {string|null} props.selectedStatusId - Estado aplicado.
 * @param {(status: string) => void} props.onStatusChange - Aplica un estado.
 * @param {boolean} props.hasFilters - Hay búsqueda o filtros que quitar.
 * @param {() => void} props.onClearFilters - Restaura la consulta inicial.
 * @param {() => void} props.onAddService - Abre el formulario «Nuevo servicio».
 * @returns {import("react").ReactElement} Barra de herramientas.
 */
function ServiceCatalogToolbar({
  hasFilters, onAddService, onClearFilters, onQueryChange, onStatusChange, onUnitChange, query,
  selectedStatusId, selectedUnitItemId, unitItems,
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-[62px] gap-y-[12px]">
      <div className="min-w-[min(100%,845px)] flex-1">
        <AdminTableToolbar
          search={(
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
              leftIcon={<SearchNormal1 size="20" color="currentColor" />}
              className="w-full"
              aria-label="Buscar servicios por nombre o código"
              onChange={(event) => onQueryChange(event.target.value)}
            />
          )}
          clearFiltersAction={(
            <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon iconLeft={<FilterRemove size="20" color="currentColor" />} showRightIcon={false} disabled={!hasFilters} className="w-full" onClick={onClearFilters}>
              Quitar filtros
            </Button>
          )}
        >
          <DropdownMenu
            {...FILTER_MENU_PROPS}
            label="Filtrar por unidad"
            items={unitItems}
            selectedItemId={selectedUnitItemId}
            interactive={unitItems.length > 0}
            onItemSelect={onUnitChange}
            aria-label="Filtrar servicios por unidad"
          />
          <DropdownMenu
            {...FILTER_MENU_PROPS}
            label="Filtrar por estado"
            items={SERVICE_STATUS_FILTER_ITEMS}
            selectedItemId={selectedStatusId}
            onItemSelect={(item) => onStatusChange(item.id)}
            aria-label="Filtrar servicios por estado"
          />
        </AdminTableToolbar>
      </div>
      <span className="inline-flex max-[767px]:w-full" data-service-add-action>
        <Button
          theme="Primary"
          type="Solid"
          size="M"
          fitContent
          showLeftIcon
          iconLeft={<Add size="20" color="currentColor" />}
          showRightIcon={false}
          className="max-[767px]:!w-full"
          onClick={onAddService}
        >
          Añadir servicio
        </Button>
      </span>
    </div>
  );
}

export default ServiceCatalogToolbar;
