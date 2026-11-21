import { Add, FilterRemove, SearchNormal1 } from "iconsax-react";
import { useMemo } from "react";

import Button from "../../../components/ui/Button/Button.jsx";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import { ADMIN_FILES_TYPE_OPTIONS } from "../utils/adminFilesPresentation.js";

/**
 * Barra de la tabla (Figma 3727:683873): búsqueda de archivos en la API («Buscar...»), filtro de
 * varios tipos (el embudo de la columna Tipo) y «Quitar filtros» en una sola fila, como la búsqueda
 * de Figma; con poco ancho los controles pasan a filas sucesivas y en móvil ocupan todo el ancho.
 * «+ Nuevo» (U3) va a la derecha y sube a la carpeta seleccionada en el árbol; sin una carpeta
 * válida se muestra deshabilitado con su motivo. Fuera de Aprobados (sin árbol) no se muestra.
 * Como en Figma, la fila mide lo que el buscador (40 px) y los botones de 44 px sobresalen 2 px por
 * cada lado (-my-[2px]), de modo que la tabla empieza 64 px bajo la barra; las filas sucesivas se
 * separan 16 px, como la variante móvil.
 *
 * @param {Object} props - Estado de la consulta y callbacks.
 * @param {string} props.query - Texto escrito en la búsqueda.
 * @param {(value: string) => void} props.onQueryChange - Cambia la búsqueda.
 * @param {string[]} props.extensions - Tipos aplicados.
 * @param {(ids: string[]) => void} props.onExtensionsChange - Aplica los tipos marcados.
 * @param {boolean} props.hasFilters - Hay búsqueda o tipos que quitar.
 * @param {() => void} props.onClearFilters - Quita búsqueda y tipos.
 * @param {{ disabledReason: string, onClick: () => void }|null} [props.newAction] - «+ Nuevo» o null para ocultarlo.
 * @returns {import("react").ReactElement} Barra de herramientas.
 */
function AdminFilesToolbar({ extensions, hasFilters, newAction = null, onClearFilters, onExtensionsChange, onQueryChange, query }) {
  const typeItems = useMemo(() => ADMIN_FILES_TYPE_OPTIONS.map((option) => ({
    ...option,
    checked: extensions.includes(option.id) ? "Yes" : "No",
    type: "Checkbox",
  })), [extensions]);

  return (
    <div className="-my-[2px] flex flex-wrap items-center gap-x-[12px] gap-y-[16px]" data-admin-files-toolbar>
      <div className="min-w-[200px] max-w-[320px] flex-1 max-[767px]:max-w-none max-[767px]:basis-full">
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
          className="w-full max-[767px]:max-w-none"
          aria-label="Buscar archivos por nombre"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="w-[180px] max-[400px]:min-w-0 max-[400px]:flex-1">
        <DropdownMenu
          type="Text"
          label={extensions.length ? `Tipo (${extensions.length})` : "Filtrar por tipo"}
          items={typeItems}
          multiple
          onItemsChange={(items) => onExtensionsChange(items.filter((item) => item.checked === "Yes").map((item) => String(item.id)))}
          className="w-full"
          contentClassName="max-h-[168px] max-w-full overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--color-neutral-400)_transparent] [scrollbar-width:thin]"
          contentPaddingClassName="px-[4px] py-[8px]"
          rowHeightClassName="h-[35px]"
          aria-label="Filtrar archivos por tipo"
          />
      </div>
      <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon iconLeft={<FilterRemove size="20" color="currentColor" />} showRightIcon={false} disabled={!hasFilters} className="shrink-0" onClick={onClearFilters}>
        Quitar filtros
      </Button>
      {newAction ? (
        <span className="ml-auto inline-flex max-[767px]:ml-0 max-[767px]:w-full">
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon
            iconLeft={<Add size="20" color="currentColor" />}
            showRightIcon={false}
            disabled={Boolean(newAction.disabledReason)}
            tooltip={newAction.disabledReason || "Subir archivos a la carpeta seleccionada"}
            aria-label={newAction.disabledReason ? `Nuevo archivo. ${newAction.disabledReason}` : "Nuevo archivo"}
            className="max-[767px]:!w-full"
            onClick={newAction.onClick}
          >
            Nuevo
          </Button>
        </span>
      ) : null}
    </div>
  );
}

export default AdminFilesToolbar;
