import { ArrangeVertical, Clock, DocumentUpload, ExportCurve, Eye, Filter, ShieldTick } from "iconsax-react";

import ActionMenu from "../../../components/ui/ActionMenu/ActionMenu.jsx";
import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import HorizontalScrollViewport from "../../../components/ui/ScrollBar/HorizontalScrollViewport.jsx";
import Tag from "../../../components/ui/Tag/Tag.jsx";
import { getAdminFilesColumns, getAdminFilesTableMinWidth } from "../../../config/adminFilesTable.js";
import { formatStorage } from "../../../utils/fileMetrics.js";
import TableHeaderLabel from "../../admin-services-quotes/components/TableHeaderLabel.jsx";
import { canLinkWarranties, getReplaceAvailability } from "../utils/adminFileReview.js";
import { getAcceptedExtensions } from "../utils/adminFileUpload.js";
import { formatExtension, formatFileDate } from "../utils/adminFilesPresentation.js";
import { describeQuotePdfStatus, getAdminFileItemKey, isQuoteItem } from "../utils/adminQuoteDocuments.js";

const ARIA_SORT = Object.freeze({ asc: "ascending", desc: "descending" });
// `font-medium` explícito: el navegador pone los `th` en negrita y Figma usa Inter Medium 14.
const HEADER_CELL = "px-[24px] py-[16px] font-medium";
const BODY_CELL = "text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)]";
const TYPE_OPTIONS = getAcceptedExtensions().map((id) => ({ id, label: formatExtension(id), type: "Checkbox" }));

/**
 * Encabezado ordenable (Nombre, Peso y Fecha): la celda declara `aria-sort` y el botón alterna el
 * orden real de la API.
 *
 * @param {Object} props - Columna, orden y callbacks.
 * @returns {import("react").ReactElement} Celda de encabezado.
 */
function SortableHeader({ disabled, field, label, onSort, sort, sortIcon }) {
  const direction = sort.field === field ? ARIA_SORT[sort.order] : "none";
  return (
    <th scope="col" aria-sort={direction} className={HEADER_CELL}>
      <TableHeaderLabel sortDirection={direction} sortIcon={sortIcon} disabled={disabled} onSort={() => onSort(field)}>{label}</TableHeaderLabel>
    </th>
  );
}

/**
 * Celda del nombre con su extensión y nombre completo en `title` para consultar un recorte.
 *
 * @param {Object} props - Versión de archivo o PDF de cotización.
 * @returns {import("react").ReactElement} Celda de fila.
 */
function NameCell({ item }) {
  // PDF de cotización no disponible: se informa su estado bajo el nombre (pendiente o el fallo).
  const quoteStatus = isQuoteItem(item) ? describeQuotePdfStatus(item.quote.pdf) : null;
  return (
    <th scope="row" className="truncate px-[24px] py-[12px] text-left font-normal">
      <span className="text-heading-8 block truncate text-[var(--color-text-300)]" title={item.name}>{item.name}</span>
      {quoteStatus?.label ? (
        <span
          className={`text-body-4 block truncate ${item.quote.pdf.status === "error" ? "text-[var(--color-danger-100)]" : "text-[var(--color-text-100)]"}`}
          title={quoteStatus.label}
          data-quote-pdf-status={item.quote.pdf.status}
        >
          {quoteStatus.label}
        </span>
      ) : null}
    </th>
  );
}

/**
 * Abre el filtro múltiple desde el embudo de Tipo. El portal mantiene el menú fuera
 * del contenedor desplazable y los tipos seleccionados se conservan entre consultas.
 *
 * @param {Object} props - Extensiones activas y callback de filtro.
 * @returns {import("react").ReactElement} Encabezado interactivo de Tipo.
 */
function RejectedTypeHeader({ extensions, onChange }) {
  const options = TYPE_OPTIONS.map((option) => ({
    ...option, checked: extensions.includes(option.id) ? "Yes" : "No",
  }));
  const filterLabel = extensions.length ? `Filtrar archivos por tipo (${extensions.length} seleccionados)` : "Filtrar archivos por tipo";
  return (
    <th scope="col" className="p-0 font-medium">
      <DropdownMenu
        type="Text"
        label="Tipo"
        aria-label={filterLabel}
        triggerIcon={<Filter size="16" variant={extensions.length ? "Bold" : "Linear"} color="currentColor" aria-hidden="true" />}
        triggerClassName="[&>div]:flex-none [&_p]:!text-inherit focus-visible:!ring-inset"
        triggerWrapperClassName="!border-transparent"
        triggerHeightClassName="h-[47px]"
        triggerPaddingXClassName="pl-[23px] pr-[8px]"
        portal
        focusItemsOnOpen
        interactive
        multiple
        items={options}
        maxVisibleItems={4}
        itemHeight={35}
        rowHeightClassName="h-[35px]"
        onItemsChange={(next) => onChange(next.filter((option) => option.checked === "Yes").map((option) => option.id))}
      />
    </th>
  );
}

/**
 * Pendientes abre el visor con «Revisar» y Rechazados con el ojo. Aprobados también ofrece
 * descargar y «Más opciones» para consultar el historial, reemplazar o gestionar garantías.
 *
 * @param {Object} props - Fila, pestaña, estado y callbacks.
 * @returns {import("react").ReactElement} Acciones.
 */
function RowActions({ actionsDisabled, downloading, item, onDownload, onOpen, onReplace, onWarranties, tab }) {
  const label = `${item.name}, versión ${item.versionNumber}`;
  const openButton = (
    <Button theme="Primary" type="Ghost" size="S" showText={false} showLeftIcon iconLeft={<Eye size="20" variant="Linear" color="currentColor" />} showRightIcon={false} disabled={actionsDisabled} tooltip="Ver archivo" aria-label={`Ver ${label}`} onClick={(event) => onOpen(item, event.currentTarget)} />
  );
  // Rechazados (3727:683752): el visor contiene el motivo, historial y descarga autorizada.
  if (tab === "rejected") return openButton;
  // Los PDF de cotizaciones se ven y descargan (si están disponibles) y muestran su historial
  // comercial; no se reemplazan ni vinculan a garantías: se modifican desde Cotizaciones.
  const quote = isQuoteItem(item);
  const quoteStatus = quote ? describeQuotePdfStatus(item.quote.pdf) : null;
  // Una fila pendiente ya es la versión pendiente del archivo: no admite otra hasta revisarla.
  const replace = tab === "pending" || quote ? null : getReplaceAvailability(item, []);
  const menuItems = [
    { icon: Clock, id: "history", label: "Historial de versiones" },
    ...(replace ? [{ disabled: !replace.allowed, icon: DocumentUpload, id: "replace", label: replace.allowed ? "Reemplazar archivo" : `Reemplazar archivo (${replace.reason})` }] : []),
    ...(!quote && canLinkWarranties(item) ? [{ icon: ShieldTick, id: "warranties", label: "Garantías" }] : []),
  ];
  const downloadUnavailable = Boolean(quoteStatus && !quoteStatus.available);
  // Pendientes (Figma 3727:683264): solo «Revisar». Descargar y el historial están en el visor.
  if (tab === "pending") {
    return (
      <Button theme="Primary" type="Outline" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={actionsDisabled} aria-label={`Revisar ${label}`} onClick={(event) => onOpen(item, event.currentTarget)}>
        Revisar
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-[4px]">
      {openButton}
      <Button
        theme="Primary"
        type="Ghost"
        size="S"
        showText={false}
        showLeftIcon
        iconLeft={<ExportCurve size="20" color="currentColor" />}
        showRightIcon={false}
        disabled={actionsDisabled || downloadUnavailable}
        tooltip={downloading ? "Descargando..." : downloadUnavailable ? quoteStatus.label : "Descargar versión"}
        aria-label={downloadUnavailable ? `Descargar ${label}. ${quoteStatus.label}` : `Descargar ${label}`}
        aria-busy={downloading || undefined}
        onClick={() => onDownload(item)}
      />
      <ActionMenu
        items={menuItems}
        triggerLabel={`Más opciones para ${label}`}
        menuLabel={`Acciones para ${label}`}
        tooltip="Más opciones"
        menuWidthClassName="w-[230px]"
        disabled={actionsDisabled}
        onSelect={(action) => {
          if (action.id === "warranties") onWarranties(item);
          else if (action.id === "replace") onReplace(item);
          else onOpen(item, null);
        }}
      />
    </div>
  );
}

/**
 * Tabla del administrador de archivos (Figma 3727:683873, 3727:683877 y 3727:683752): nombre,
 * versión, proyecto (solo en Pendientes y Rechazados), tipo, peso, fecha, autor y acciones. Cada
 * fila es una versión real de la API (o el PDF vigente de una cotización del proyecto, en «Documentos»); las versiones guardadas se conservan, así que la acción
 * «Eliminar» de Figma no se ofrece. Cada fila abre el visor con su historial (U2), descarga su
 * versión y, si procede, sus garantías; el reemplazo llega en U3. Desplaza en horizontal dentro de su
 * contenedor. Como en Figma, las filas de 68 px no llevan divisores entre sí.
 *
 * @param {Object} props - Filas, pestaña, orden y callbacks.
 * @param {Array<Object>} props.items - Versiones de la página visible.
 * @param {"approved"|"pending"|"rejected"} props.tab - Pestaña.
 * @param {{field: string, order: string}} props.sort - Orden aplicado.
 * @param {(field: string) => void} props.onSort - Alterna el orden.
 * @param {(item: Object) => void} props.onDownload - Descarga la versión.
 * @param {(item: Object, trigger: HTMLElement|null) => void} props.onOpen - Abre el visor de la versión.
 * @param {(item: Object) => void} props.onWarranties - Abre las garantías del documento.
 * @param {(item: Object) => void} props.onReplace - Abre «Reemplazar archivo».
 * @param {number|null} props.downloadingVersionId - Versión de archivo que se está descargando.
 * @param {string|null} [props.downloadingQuoteKey] - PDF de cotización que se está descargando («quoteId:versión»).
 * @param {boolean} props.actionsDisabled - Bloquea acciones durante una operación.
 * @param {string[]} [props.extensions] - Tipos activos en Rechazados.
 * @param {(ids: string[]) => void} [props.onExtensionsChange] - Actualiza el filtro de tipo.
 * @param {import("react").ReactNode} [props.bodyFallback] - Estado de carga, error o vacío bajo el encabezado.
 * @returns {import("react").ReactElement} Tabla.
 */
function AdminFilesTable({ actionsDisabled, bodyFallback, downloadingQuoteKey = null, downloadingVersionId, extensions = [], items, onDownload, onExtensionsChange, onOpen, onReplace, onSort, onWarranties, sort, tab }) {
  const rejected = tab === "rejected";
  const options = { review: tab === "pending", rejected, showProject: tab !== "approved" };
  const stickyActions = tab !== "approved" ? "sticky right-0 z-[1]" : "";
  const rejectedFrame = "relative isolate after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:rounded-[inherit] after:border after:border-[var(--color-neutral-200)] [&>[data-horizontal-scroll-viewport]]:scroll-pr-[124px]";
  const columns = getAdminFilesColumns(options);
  return (
    <div className={`w-full min-w-0 overflow-hidden rounded-[var(--radius-3)] bg-[var(--color-neutral-100)] ${rejected ? rejectedFrame : "border border-[var(--color-neutral-200)]"}`} data-admin-files-table>
      <HorizontalScrollViewport scrollBarLabel="Desplazar tabla de archivos horizontalmente">
        <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: getAdminFilesTableMinWidth(options) }}>
          <caption className="sr-only">Archivos</caption>
          <colgroup>
            {columns.map((column) => <col key={column.id} style={column.width ? { width: column.width } : undefined} />)}
          </colgroup>
          <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
            <tr className="text-heading-8 h-[49px]">
              <SortableHeader field="name" label="Nombre" sort={sort} sortIcon={rejected ? null : undefined} disabled={actionsDisabled} onSort={onSort} />
              <th scope="col" className={`${HEADER_CELL} ${rejected ? "text-center" : ""}`}>Versión</th>
              {options.showProject ? <th scope="col" className={HEADER_CELL}>Proyecto</th> : null}
              {rejected ? <RejectedTypeHeader extensions={extensions} onChange={onExtensionsChange} /> : <th scope="col" className={HEADER_CELL}><TableHeaderLabel filter>Tipo</TableHeaderLabel></th>}
              <SortableHeader field="size" label="Peso" sort={sort} sortIcon={rejected ? ArrangeVertical : undefined} disabled={actionsDisabled} onSort={onSort} />
              <SortableHeader field="date" label="Fecha" sort={sort} sortIcon={rejected ? ArrangeVertical : undefined} disabled={actionsDisabled} onSort={onSort} />
              <th scope="col" className={HEADER_CELL}>Subido por</th>
              <th scope="col" className={`${HEADER_CELL} ${stickyActions} ${stickyActions ? "bg-[var(--color-neutral-200)]" : ""}`}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const downloading = isQuoteItem(item)
                ? downloadingQuoteKey === `${item.quote.id}:${item.versionNumber}`
                : downloadingVersionId === item.versionId;
              const uploader = item.uploadedBy?.name || "Sin autor";
              return (
                <tr key={getAdminFileItemKey(item)} className={`${tab === "pending" ? "h-[65px]" : "h-[68px]"} bg-[var(--color-neutral-100)]`} data-version-id={item.versionId} data-item-source={item.source || "file"}>
                  <NameCell item={item} />
                  <td className={`${BODY_CELL} tabular-nums ${rejected ? "text-center" : ""}`}>v{item.versionNumber}</td>
                  {options.showProject ? <td className={`${BODY_CELL} ${rejected ? "!pr-0" : ""}`} title={item.project?.name}>{item.project?.name}</td> : null}
                  <td className="px-[24px] py-[16px]">
                    <Badge label={formatExtension(item.extension)} theme="Neutral" size="S" truncate />
                  </td>
                  <td className={`${BODY_CELL} tabular-nums`}>
                    {/* Un PDF de cotización no disponible no tiene tamaño: no hay archivo que pesar. */}
                    {isQuoteItem(item) && item.size === null ? "—" : formatStorage(item.size, { maximumFractionDigits: 1 })}
                  </td>
                  <td className={`${BODY_CELL} tabular-nums ${rejected ? "!pr-[8px]" : ""}`}>
                    <time dateTime={item.createdAt}>{formatFileDate(item.createdAt)}</time>
                  </td>
                  <td className={`px-[24px] py-[16px] ${rejected ? "!pr-[8px]" : ""}`}>
                    {rejected ? (
                      <Tag label={uploader} title={uploader} size="L" avatar={false} count={false} closeIcon={false} className="!h-[25px] !p-[4px] [&>span]:!text-[var(--color-text-300)]" />
                    ) : <Badge label={uploader} theme="Neutral" size="M" truncate className="max-w-full" />}
                  </td>
                  <td className={`${rejected ? "px-[24px]" : "px-[16px]"} py-[16px] ${stickyActions} ${stickyActions ? "bg-[var(--color-neutral-100)]" : ""}`}>
                    <RowActions item={item} tab={tab} downloading={downloading} actionsDisabled={actionsDisabled} onDownload={onDownload} onOpen={onOpen} onReplace={onReplace} onWarranties={onWarranties} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </HorizontalScrollViewport>
      {bodyFallback}
    </div>
  );
}

export default AdminFilesTable;
