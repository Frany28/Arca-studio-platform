import { useEffect, useRef, useState } from "react";
import { renderAsync as renderDocx } from "docx-preview";

import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import DocumentMarker from "./DocumentMarker.jsx";

function DocxViewerSurface({ annotations = [], data, focusedId, onPointCreate, onPointSelect, pendingSelection, title }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");
  const [sectionBoxes, setSectionBoxes] = useState([]);

  useEffect(() => {
    if (!data || !containerRef.current) return undefined;

    let cancelled = false;
    containerRef.current.replaceChildren();
    queueMicrotask(() => {
      if (!cancelled) setError("");
    });

    renderDocx(data, containerRef.current, undefined, {
      breakPages: true,
      className: "arca-docx",
      ignoreFonts: false,
      inWrapper: true,
      renderFooters: true,
      renderHeaders: true,
    }).then(() => {
      if (cancelled) return;
      const sections = [...containerRef.current.querySelectorAll(".arca-docx")];
      setSectionBoxes(sections.map((section, sectionIndex) => ({
        height: section.offsetHeight,
        left: section.offsetLeft,
        sectionIndex,
        top: section.offsetTop,
        width: section.offsetWidth,
      })));
    }).catch(() => {
      if (!cancelled) setError("No se pudo interpretar el documento Word.");
    });

    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    const comment = annotations.find((item) => String(item.id) === String(focusedId));
    if (comment?.selection?.kind !== "document-section-point") return;
    const marker = containerRef.current?.parentElement
      ?.querySelector(`[data-document-marker][data-comment-id="${comment.id}"]`);
    (marker || containerRef.current?.querySelectorAll(".arca-docx")?.[comment.selection.sectionIndex])
      ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [annotations, focusedId, sectionBoxes]);

  if (error) {
    return (
      <div className="flex size-full items-center justify-center bg-[var(--color-primary-300)] p-[24px]">
        <EmptyState
          title="No se pudo abrir el documento"
          description={error}
          size="S"
          showFeaturedIcon
          showActions={false}
        />
      </div>
    );
  }

  return (
    <div
      role="document"
      aria-label={`Vista de ${title}`}
      className="size-full overflow-auto bg-[var(--color-neutral-200)] p-[16px] text-[var(--color-text-300)] max-[520px]:p-[8px]"
    >
      <div
        className="relative min-h-full [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0 [&_.docx]:!mb-[16px] [&_.docx]:!max-w-full [&_.docx]:shadow-[var(--shadow-e1)]"
        onClick={(event) => {
          if (!onPointCreate || event.target.closest("[data-document-marker]")) return;
          const section = event.target.closest(".arca-docx");
          if (!section) return;
          const sections = [...containerRef.current.querySelectorAll(".arca-docx")];
          const sectionIndex = sections.indexOf(section);
          const rect = section.getBoundingClientRect();
          onPointCreate({
            kind: "document-section-point",
            normalizedX: (event.clientX - rect.left) / rect.width,
            normalizedY: (event.clientY - rect.top) / rect.height,
            sectionIndex,
            sectionCount: sections.length,
          });
        }}
      >
        <div ref={containerRef} />
        {[...annotations.filter((comment) => comment.selection?.kind === "document-section-point"),
          ...(pendingSelection?.kind === "document-section-point" ? [{ id: "pending", pointNumber: "", selection: pendingSelection }] : [])].map((comment) => {
          const box = sectionBoxes[comment.selection.sectionIndex];
          if (!box) return null;
          return <DocumentMarker key={comment.id} comment={comment} focused={String(comment.id) === String(focusedId)} onSelect={onPointSelect}
            style={{ left: box.left + comment.selection.normalizedX * box.width, top: box.top + comment.selection.normalizedY * box.height }} />;
        })}
      </div>
    </div>
  );
}

export default DocxViewerSurface;
