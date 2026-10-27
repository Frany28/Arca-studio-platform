import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import IconContainer from "../../../components/ui/IconContainer.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import ScrollBar from "../../../components/ui/ScrollBar.jsx";
import DocumentFileCard from "../../../components/document-viewer/DocumentFileCard.jsx";
import ProjectDocumentListCard from "../components/ProjectDocumentListCard.jsx";
import ProjectDocumentPreview from "../components/ProjectDocumentPreview.jsx";
import ProjectDocumentsToolbar from "../components/ProjectDocumentsToolbar.jsx";
import { PROJECT_DETAIL_DATA } from "../projectDetailsData.js";
import { getFileDisplayName } from "../../../utils/fileDisplayName.js";

const EMPTY_DOCUMENT_PREVIEW = {
  id: "empty-document-preview",
  name: "Sin información",
  fileType: "PDF",
  emptyState: true,
};

function CloudAddIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
    >
      <path
        d="M3.69352 7.41406C0.573516 7.63406 0.573516 12.1741 3.69352 12.3941H4.97354"
        stroke="#09AE41"
        stroke-width="1.5"
        stroke-miterlimit="10"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M3.72685 7.4131C1.58685 1.45977 10.6135 -0.920228 11.6468 5.3331C14.5335 5.69977 15.7002 9.54644 13.5135 11.4598C12.8468 12.0664 11.9868 12.3998 11.0868 12.3931H11.0268"
        stroke="#09AE41"
        stroke-width="1.5"
        stroke-miterlimit="10"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M11.3332 11.0208C11.3332 11.5142 11.2265 11.9808 11.0265 12.3942C10.9732 12.5142 10.9132 12.6275 10.8465 12.7342C10.2732 13.7008 9.21317 14.3542 7.99984 14.3542C6.7865 14.3542 5.72649 13.7008 5.15316 12.7342C5.08649 12.6275 5.02652 12.5142 4.97319 12.3942C4.77319 11.9808 4.6665 11.5142 4.6665 11.0208C4.6665 9.18083 6.15984 7.6875 7.99984 7.6875C9.83984 7.6875 11.3332 9.18083 11.3332 11.0208Z"
        stroke="#09AE41"
        stroke-width="1.5"
        stroke-miterlimit="10"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M6.96045 11.0205L7.62044 11.6805L9.04045 10.3672"
        stroke="#09AE41"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function TickCircleIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
    >
      <path
        d="M8.00016 14.6673C11.6668 14.6673 14.6668 11.6673 14.6668 8.00065C14.6668 4.33398 11.6668 1.33398 8.00016 1.33398C4.3335 1.33398 1.3335 4.33398 1.3335 8.00065C1.3335 11.6673 4.3335 14.6673 8.00016 14.6673Z"
        stroke="#09AE41"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M5.1665 7.99995L7.05317 9.88661L10.8332 6.11328"
        stroke="#09AE41"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ProgressSection({ icon, children }) {
  return (
    <div className="flex shrink-0 items-center gap-[8px]">
      <IconContainer
        size="S"
        type="Outline"
        icon={icon}
        className="text-[#09AE41]"
      />
      <p className="whitespace-nowrap text-heading-8 text-[var(--color-text-200)]">
        {children}
      </p>
    </div>
  );
}

function getSynchronizationLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin información";
  const minutes = Math.max(Math.floor((Date.now() - date.getTime()) / 60000), 0);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function ProjectDocumentsPanel({
  documents = PROJECT_DETAIL_DATA.documents,
  focusedCommentId = null,
  focusedDocumentId = null,
  lastSynchronizedAt = null,
  projectId,
}) {
  const hasDocuments = documents.length > 0;
  const listViewportRef = useRef(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    () => documents.find((document) => String(document.id) === String(focusedDocumentId))?.id ?? documents[0]?.id,
  );
  const [query, setQuery] = useState("");
  const [sortDirection, setSortDirection] = useState("desc");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [scrollState, setScrollState] = useState({ length: 1, position: 0, height: 480 });

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return [...documents]
      .filter((document) => getFileDisplayName(document.name).toLocaleLowerCase("es").includes(normalizedQuery))
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime();
        const rightTime = new Date(right.createdAt || 0).getTime();
        return sortDirection === "desc" ? rightTime - leftTime : leftTime - rightTime;
      });
  }, [documents, query, sortDirection]);
  const hasVisibleDocuments = visibleDocuments.length > 0;

  useEffect(() => {
    const focusedDocument = documents.find(
      (document) => String(document.id) === String(focusedDocumentId),
    );
    if (focusedDocument) {
      queueMicrotask(() => setSelectedDocumentId(focusedDocument.id));
    }
  }, [documents, focusedDocumentId]);

  const selectedDocument = useMemo(() => {
    if (!hasVisibleDocuments) return null;
    return visibleDocuments.find((document) => document.id === selectedDocumentId) ?? visibleDocuments[0];
  }, [hasVisibleDocuments, selectedDocumentId, visibleDocuments]);

  const syncScrollState = useCallback(() => {
    const element = listViewportRef.current;
    if (!element) return;
    const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
    setScrollState({
      length: element.scrollHeight > 0 ? Math.min(element.clientHeight / element.scrollHeight, 1) : 1,
      position: maxScrollTop > 0 ? element.scrollTop / maxScrollTop : 0,
      height: element.clientHeight,
    });
  }, []);

  const handleScrollBarPositionChange = useCallback((nextPosition) => {
    const element = listViewportRef.current;
    if (!element) return;
    element.scrollTop = Math.max(element.scrollHeight - element.clientHeight, 0) * nextPosition;
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(syncScrollState);
    return () => window.cancelAnimationFrame(frameId);
  }, [visibleDocuments, syncScrollState]);

  useEffect(() => {
    if (!listViewportRef.current || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(listViewportRef.current);
    return () => observer.disconnect();
  }, [syncScrollState]);

  return (
    <section className="flex w-full flex-col gap-[16px]">
      <div className="grid w-full grid-cols-[minmax(0,1fr)_335px] gap-[20px] max-[1024px]:grid-cols-1">
        <div
          className={clsx(
            "flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-3)] shadow-[var(--shadow-e1)]",
            hasDocuments
              ? "bg-[var(--color-neutral-100)]"
              : "bg-[var(--color-neutral-10)]",
          )}
        >
          <DocumentFileCard document={selectedDocument || EMPTY_DOCUMENT_PREVIEW} />

          {hasVisibleDocuments ? (
            <ProjectDocumentPreview
              document={selectedDocument}
              focusedCommentId={focusedCommentId}
              onLoadingChange={setIsPreviewLoading}
              projectId={projectId}
            />
          ) : (
            <div className="flex min-h-[426px] flex-1 items-center justify-center border-t border-[var(--color-neutral-200)] bg-[var(--color-neutral-10)] px-[24px]">
              <EmptyState
                title={hasDocuments ? "No se encontraron documentos" : "Sin documentos"}
                description={hasDocuments ? "Prueba con otro término de búsqueda." : "No hay archivos disponibles. Carga archivos para ver una vista previa aquí."}
                size="S"
                showFeaturedIcon
                showActions
                showSecondaryAction={false}
                primaryActionLabel="Actualizar"
                className="h-auto min-h-[254px]"
              />
            </div>
          )}
        </div>

        <aside className="flex min-h-0 flex-col">
          <ProjectDocumentsToolbar
            disabled={isPreviewLoading || !hasDocuments}
            query={query}
            sortDirection={sortDirection}
            onQueryChange={setQuery}
            onToggleSort={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")}
          />

          {isPreviewLoading ? (
            <Loader preset="documentList" label="Cargando lista de documentos" className="pt-[12px]" />
          ) : hasVisibleDocuments ? (
            <div className="flex flex-col gap-[12px] py-[12px]">
              <p className="text-heading-8 text-[var(--color-text-200)]">
                Selecciona un documento para ver la previsualización
              </p>
              <div className="flex max-h-[480px] min-h-0 items-start">
                <div
                  ref={listViewportRef}
                  className="flex max-h-[480px] min-w-0 flex-1 flex-col gap-[12px] overflow-y-auto pr-[8px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                  onScroll={syncScrollState}
                >
                  {visibleDocuments.map((document) => (
                    <ProjectDocumentListCard
                      key={document.id}
                      document={document}
                      selected={document.id === selectedDocument?.id}
                      onClick={() => setSelectedDocumentId(document.id)}
                    />
                  ))}
                </div>
                <div className="flex shrink-0">
                  <ScrollBar
                    length={scrollState.length}
                    position={scrollState.position}
                    height={scrollState.height}
                    interactive
                    onPositionChange={handleScrollBarPositionChange}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[443px] items-center justify-center px-[16px]">
              <EmptyState
                title={hasDocuments ? "No se encontraron documentos" : "Sin documentos"}
                description={hasDocuments ? "Prueba con otro término de búsqueda." : "Aquí encontrarás todos los documentos importantes sobre este proyecto."}
                size="S"
                showFeaturedIcon
                showActions
                showSecondaryAction={false}
                primaryActionLabel="Actualizar"
                className="h-auto min-h-[254px]"
              />
            </div>
          )}
        </aside>

      </div>

      <div className="flex w-full items-center gap-[24px] max-[760px]:flex-col max-[760px]:items-start">
        <ProgressSection icon={<CloudAddIcon className="size-4" />}>
          {`Última sincronización: ${hasDocuments ? getSynchronizationLabel(lastSynchronizedAt) : "Sin información"}`}
        </ProgressSection>
        <ProgressSection icon={<TickCircleIcon className="size-4" />}>
          {hasDocuments
            ? "Todos los documentos están actualizados"
            : "Sin documentos actualizados"}
        </ProgressSection>
      </div>
    </section>
  );
}
