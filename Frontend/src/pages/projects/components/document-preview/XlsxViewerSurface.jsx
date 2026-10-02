import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import * as XLSX from "xlsx";

import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import DocumentMarker from "./DocumentMarker.jsx";

function XlsxViewerSurface({ annotations = [], data, focusedId, onPointCreate, onPointSelect, pendingSelection, title }) {
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const tableRef = useRef(null);
  const [cellBoxes, setCellBoxes] = useState({});
  const workbook = useMemo(() => {
    try {
      return data ? XLSX.read(data, { type: "array" }) : null;
    } catch {
      return null;
    }
  }, [data]);

  const safeSheetIndex = Math.min(activeSheetIndex, Math.max((workbook?.SheetNames?.length || 1) - 1, 0));
  const activeSheetName = workbook?.SheetNames?.[safeSheetIndex] || "";
  const tableHtml = activeSheetName
    ? XLSX.utils.sheet_to_html(workbook.Sheets[activeSheetName], { id: "project-document-workbook" })
    : "";

  useEffect(() => {
    const root = tableRef.current;
    if (!root) return;
    const boxes = {};
    [...root.querySelectorAll("tr")].forEach((row, rowIndex) => {
      [...row.querySelectorAll("td")].forEach((cell, columnIndex) => {
        const address = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex });
        cell.dataset.cell = address;
        boxes[address] = { height: cell.offsetHeight, left: cell.offsetLeft, top: cell.offsetTop, width: cell.offsetWidth };
      });
    });
    const frameId = window.requestAnimationFrame(() => setCellBoxes(boxes));
    return () => window.cancelAnimationFrame(frameId);
  }, [activeSheetName, tableHtml]);

  useEffect(() => {
    const comment = annotations.find((item) => String(item.id) === String(focusedId));
    const sheetName = comment?.selection?.sheetName;
    if (!sheetName || !workbook?.SheetNames) return;
    const nextIndex = workbook.SheetNames.indexOf(sheetName);
    if (nextIndex >= 0 && nextIndex !== activeSheetIndex) {
      queueMicrotask(() => setActiveSheetIndex(nextIndex));
    }
  }, [activeSheetIndex, annotations, focusedId, workbook]);

  useEffect(() => {
    const comment = annotations.find((item) => String(item.id) === String(focusedId));
    if (comment?.selection?.kind !== "document-cell-point" || comment.selection.sheetName !== activeSheetName) return;
    const marker = tableRef.current
      ?.querySelector(`[data-document-marker][data-comment-id="${comment.id}"]`);
    (marker || tableRef.current?.querySelector(`[data-cell="${comment.selection.cell}"]`))
      ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [activeSheetName, annotations, cellBoxes, focusedId]);

  if (!workbook?.SheetNames?.length) {
    return (
      <div className="flex size-full items-center justify-center bg-[var(--color-primary-300)] p-[24px]">
        <EmptyState title="No se pudo abrir el libro" description="El archivo Excel está dañado o no contiene hojas visibles."
          size="S" showFeaturedIcon showActions={false} />
      </div>
    );
  }

  return (
    <div className="flex size-full min-w-0 flex-col overflow-hidden bg-[var(--color-neutral-100)]">
      <div
        role="tablist"
        aria-label={`Hojas de ${title}`}
        className="flex shrink-0 gap-[4px] overflow-x-auto border-b border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[8px]"
      >
        {workbook.SheetNames.map((sheetName, index) => (
          <button
            key={sheetName}
            type="button"
            role="tab"
            aria-selected={index === safeSheetIndex}
            className={clsx(
              "shrink-0 rounded-[var(--radius-2)] px-[12px] py-[8px] text-body-4",
              index === safeSheetIndex
                ? "bg-[var(--color-neutral-200)] text-[var(--color-text-300)]"
                : "text-[var(--color-text-100)] hover:bg-[var(--color-neutral-10)]",
            )}
            onClick={() => setActiveSheetIndex(index)}
          >
            {sheetName}
          </button>
        ))}
      </div>
      <div
        ref={tableRef}
        role="region"
        aria-label={`Hoja ${activeSheetName}`}
        className="relative min-h-0 flex-1 overflow-auto p-[12px] [&_table]:relative [&_table]:border-collapse [&_td]:max-w-[360px] [&_td]:break-words [&_td]:border [&_td]:border-[var(--color-neutral-200)] [&_td]:p-[8px] [&_td]:align-top [&_th]:border [&_th]:border-[var(--color-neutral-200)] [&_th]:bg-[var(--color-neutral-10)] [&_th]:p-[8px]"
        onClick={(event) => {
          if (!onPointCreate || event.target.closest("[data-document-marker]")) return;
          const cell = event.target.closest("td[data-cell]");
          if (!cell) return;
          const rect = cell.getBoundingClientRect();
          onPointCreate({ kind: "document-cell-point", sheetName: activeSheetName, cell: cell.dataset.cell,
            normalizedX: (event.clientX - rect.left) / rect.width, normalizedY: (event.clientY - rect.top) / rect.height });
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: tableHtml }} />
        {[...annotations.filter((comment) => comment.selection?.kind === "document-cell-point" && comment.selection.sheetName === activeSheetName),
          ...(pendingSelection?.kind === "document-cell-point" && pendingSelection.sheetName === activeSheetName ? [{ id: "pending", pointNumber: "", selection: pendingSelection }] : [])].map((comment) => {
          const box = cellBoxes[comment.selection.cell];
          if (!box) return null;
          return <DocumentMarker key={comment.id} comment={comment} focused={String(comment.id) === String(focusedId)} onSelect={onPointSelect}
            style={{ left: 12 + box.left + comment.selection.normalizedX * box.width, top: 12 + box.top + comment.selection.normalizedY * box.height }} />;
        })}
      </div>
    </div>
  );
}

export default XlsxViewerSurface;
