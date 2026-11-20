import { Clock, DocumentDownload, DocumentUpload, Eye, ShieldTick } from "iconsax-react";

import ActionMenu from "../../../components/ui/ActionMenu/ActionMenu.jsx";
import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import HorizontalScrollViewport from "../../../components/ui/ScrollBar/HorizontalScrollViewport.jsx";
import { getAdminFilesColumns, getAdminFilesTableMinWidth } from "../../../config/adminFilesTable.js";
import { formatStorage } from "../../../utils/fileMetrics.js";
import TableHeaderLabel from "../../admin-services-quotes/components/TableHeaderLabel.jsx";
import { canLinkWarranties, getReplaceAvailability } from "../utils/adminFileReview.js";
import { formatExtension, formatFileDate } from "../utils/adminFilesPresentation.js";

const ARIA_SORT = Object.freeze({ asc: "ascending", desc: "descending" });
const HEADER_CELL = "px-[24px] py-[16px]";
const BODY_CELL = "text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)]";

/**
 * Encabezado ordenable (Nombre, Peso y Fecha): la celda declara `aria-sort` y el botón alterna el
 * orden real de la API.
 *
 * @param {Object} props - Columna, orden y callbacks.
 * @returns {import("react").ReactElement} Celda de encabezado.
 */
function SortableHeader({ disabled, field, label, onSort, sort }) {
  const direction = sort.field === field ? ARIA_SORT[sort.order] : "none";
  return (
    <th scope="col" aria-sort={direction} className={HEADER_CELL}>
      <TableHeaderLabel sortDirection={direction} disabled={disabled} onSort={() => onSort(field)}>{label}</TableHeaderLabel>
    </th>
  );
}

/**
 * Celda del nombre: nombre visible completo en `title`; en Rechazados, el motivo bajo el nombre.
 *
 * @param {Object} props - Versión y pestaña.
 * @returns {import("react").ReactElement} Celda de fila.
 */
function NameCell({ item, tab }) {
  const reason = tab === "rejected" ? item.review?.reason : "";
  return (
    <th scope="row" className="truncate px-[24px] py-[12px] text-left font-normal">
      <span className="text-heading-8 block truncate text-[var(--color-text-300)]" title={item.name}>{item.name}</span>
      {reason ? (
        <span className="text-body-4 block truncate text-[var(--color-danger-100)]" title={`Motivo del rechazo: ${reason}`}>
          Motivo: {reason}
        </span>
      ) : null}
    </th>
  );
}

/**
 * Acciones de una fila: «Revisar» (pendientes) o el ojo (consulta) abren el visor; la descarga
 * guarda esa versión; «Más opciones» abre el historial y, en documentos de «Documentos ›
 * Garantías», sus garantías. La acción «Eliminar» de Figma no se ofrece: los archivos se conservan.
 *
 * @param {Object} props - Fila, pestaña, estado y callbacks.
 * @returns {import("react").ReactElement} Acciones.
 */
function RowActions({ actionsDisabled, downloading, item, onDownload, onOpen, onReplace, onWarranties, tab }) {
  const label = `${item.name}, versión ${item.versionNumber}`;
  // Una fila pendiente ya es la versión pendiente del archivo: no admite otra hasta revisarla.
  const replace = tab === "pending" ? null : getReplaceAvailability(item, []);
  const menuItems = [
    { icon: Clock, id: "history", label: "Historial de versiones" },
    ...(replace ? [{ disabled: !replace.allowed, icon: DocumentUpload, id: "replace", label: replace.allowed ? "Reemplazar archivo" : `Reemplazar archivo (${replace.reason})` }] : []),
    ...(canLinkWarranties(item) ? [{ icon: ShieldTick, id: "warranties", label: "Garantías" }] : []),
  ];
  return (
    <div className="flex items-center gap-[4px]">
      {tab === "pending" ? (
        <Button theme="Primary" type="Outline" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={actionsDisabled} aria-label={`Revisar ${label}`} onClick={(event) => onOpen(item, event.currentTarget)}>
          Revisar
        </Button>
      ) : (
        <Button theme="Primary" type="Ghost" size="S" showText={false} showLeftIcon iconLeft={<Eye size="20" color="currentColor" />} showRightIcon={false} disabled={actionsDisabled} tooltip="Ver archivo" aria-label={`Ver ${label}`} onClick={(event) => onOpen(item, event.currentTarget)} />
      )}
      <Button
        theme="Primary"
        type="Ghost"
        size="S"
        showText={false}
        showLeftIcon
        iconLeft={<DocumentDownload size="20" color="currentColor" />}
        showRightIcon={false}
        disabled={actionsDisabled}
        tooltip={downloading ? "Descargando..." : "Descargar versión"}
        aria-label={`Descargar ${label}`}
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
 * Tabla del administrador de archivos (Figma 3727:683873, 3727:683877 y 4273:683806): nombre,
 * versión, proyecto (solo en Pendientes y Rechazados), tipo, peso, fecha, autor y acciones. Cada
 * fila es una versión real de la API; las versiones guardadas se conservan, así que la acción
 * «Eliminar» de Figma no se ofrece. Cada fila abre el visor con su historial (U2), descarga su
 * versión y, si procede, sus garantías; el reemplazo llega en U3. Desplaza en horizontal dentro de su
 * contenedor.
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
 * @param {number|null} props.downloadingVersionId - Versión que se está descargando.
 * @param {boolean} props.actionsDisabled - Bloquea acciones durante una operación.
 * @returns {import("react").ReactElement} Tabla.
 */
function AdminFilesTable({ actionsDisabled, downloadingVersionId, items, onDownload, onOpen, onReplace, onSort, onWarranties, sort, tab }) {
  const options = { showProject: tab !== "approved" };
  const columns = getAdminFilesColumns(options);
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]" data-admin-files-table>
      <HorizontalScrollViewport scrollBarLabel="Desplazar tabla de archivos horizontalmente">
        <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: getAdminFilesTableMinWidth(options) }}>
          <caption className="sr-only">Archivos</caption>
          <colgroup>
            {columns.map((column) => <col key={column.id} style={column.width ? { width: column.width } : undefined} />)}
          </colgroup>
          <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
            <tr className="text-heading-8 h-[49px]">
              <SortableHeader field="name" label="Nombre" sort={sort} disabled={actionsDisabled} onSort={onSort} />
              <th scope="col" className={HEADER_CELL}>Versión</th>
              {options.showProject ? <th scope="col" className={HEADER_CELL}>Proyecto</th> : null}
              {/* Los tipos se eligen en la barra; el icono indica que la columna admite filtro. */}
              <th scope="col" className={HEADER_CELL}><TableHeaderLabel filter>Tipo</TableHeaderLabel></th>
              <SortableHeader field="size" label="Peso" sort={sort} disabled={actionsDisabled} onSort={onSort} />
              <SortableHeader field="date" label="Fecha" sort={sort} disabled={actionsDisabled} onSort={onSort} />
              <th scope="col" className={HEADER_CELL}>Subido por</th>
              <th scope="col" className={HEADER_CELL}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const downloading = downloadingVersionId === item.versionId;
              const uploader = item.uploadedBy?.name || "Sin autor";
              return (
                <tr key={item.versionId} className="h-[68px] border-t border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]" data-version-id={item.versionId}>
                  <NameCell item={item} tab={tab} />
                  <td className={`${BODY_CELL} tabular-nums`}>v{item.versionNumber}</td>
                  {options.showProject ? <td className={BODY_CELL} title={item.project?.name}>{item.project?.name}</td> : null}
                  <td className="px-[24px] py-[16px]">
                    <Badge label={formatExtension(item.extension)} theme="Neutral" size="S" truncate />
                  </td>
                  <td className={`${BODY_CELL} tabular-nums`}>{formatStorage(item.size, { maximumFractionDigits: 1 })}</td>
                  <td className={`${BODY_CELL} tabular-nums`}>
                    <time dateTime={item.createdAt}>{formatFileDate(item.createdAt)}</time>
                  </td>
                  <td className="px-[24px] py-[16px]">
                    <Badge label={uploader} theme="Neutral" size="M" truncate className="max-w-full" />
                  </td>
                  <td className="px-[16px] py-[16px]">
                    <RowActions item={item} tab={tab} downloading={downloading} actionsDisabled={actionsDisabled} onDownload={onDownload} onOpen={onOpen} onReplace={onReplace} onWarranties={onWarranties} />
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

export default AdminFilesTable;
