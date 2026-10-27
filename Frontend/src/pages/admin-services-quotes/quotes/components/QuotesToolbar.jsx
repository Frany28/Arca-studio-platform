import { Add, FilterRemove, SearchNormal1 } from "iconsax-react";

import Button from "../../../../components/ui/Button/Button.jsx";
import DateRangeField from "../../../../components/ui/DateRangePicker/DateRangeField.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";

/**
 * Barra del listado de cotizaciones (Figma 5771:488498): búsqueda en la API (320 px), intervalo
 * de fechas con «Quitar filtros» (461 px) y «Nueva cotización» a la derecha. Con menos ancho los
 * grupos pasan a filas sucesivas; en móvil (Figma 5790:343717) cada control ocupa todo el ancho y
 * «Quitar filtros», que Figma deja recortado, se mantiene accesible junto al intervalo.
 *
 * @param {Object} props - Estado de la consulta y callbacks.
 * @param {string} props.query - Texto escrito en la búsqueda.
 * @param {(value: string) => void} props.onQueryChange - Cambia la búsqueda.
 * @param {{from: string|null, to: string|null}} props.dateRange - Intervalo aplicado.
 * @param {(range: {from: string, to: string}) => void} props.onDateRangeChange - Aplica un intervalo.
 * @param {boolean} props.hasFilters - Hay búsqueda o intervalo que quitar.
 * @param {() => void} props.onClearFilters - Restaura la consulta inicial.
 * @param {() => void} props.onCreateQuote - Abre «Nueva cotización».
 * @returns {import("react").ReactElement} Barra de herramientas.
 */
function QuotesToolbar({ dateRange, hasFilters, onClearFilters, onCreateQuote, onDateRangeChange, onQueryChange, query }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-[24px] gap-y-[12px]" data-quotes-toolbar>
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
          leftIcon={<SearchNormal1 size="20" color="currentColor" />}
          className="w-full"
          aria-label="Buscar cotizaciones por número, cliente o proyecto"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="flex w-[461px] max-w-full items-center gap-[12px] max-[767px]:w-full max-[400px]:flex-wrap">
        <DateRangeField
          className="min-w-[250px] max-w-[320px] flex-1 max-[767px]:max-w-none max-[400px]:min-w-0 max-[400px]:basis-full"
          value={dateRange}
          aria-label="Filtrar cotizaciones por fecha"
          onChange={onDateRangeChange}
        />
        <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon iconLeft={<FilterRemove size="20" color="currentColor" />} showRightIcon={false} disabled={!hasFilters} className="shrink-0" onClick={onClearFilters}>
          Quitar filtros
        </Button>
      </div>
      <span className="inline-flex max-[767px]:w-full">
        <Button
          theme="Primary"
          type="Solid"
          size="M"
          fitContent
          showLeftIcon
          iconLeft={<Add size="20" color="currentColor" />}
          showRightIcon={false}
          className="max-[767px]:!w-full"
          onClick={onCreateQuote}
        >
          Nueva cotización
        </Button>
      </span>
    </div>
  );
}

export default QuotesToolbar;
