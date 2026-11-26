import { useEffect, useRef, useState } from "react";

import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import HorizontalTabMenu from "../../../components/ui/HorizontalTabMenu/HorizontalTabMenu.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import TabPanel from "../../../components/ui/TabPanel.jsx";
import CursorPaginationNav from "../../admin-services-quotes/components/CursorPaginationNav.jsx";
import StatusConfirmationModal from "../../admin-services-quotes/components/StatusConfirmationModal.jsx";
import { useAlertFeedback } from "../../admin-services-quotes/hooks/useAlertFeedback.js";
import { useAdminFileFolderActions } from "../hooks/useAdminFileFolderActions.js";
import { useAdminFileVersionDownload } from "../hooks/useAdminFileVersionDownload.js";
import { useAdminQuotePdfDownload } from "../hooks/useAdminQuotePdfDownload.js";
import { ADMIN_FILES_PAGE_SIZE, useAdminFilesItems } from "../hooks/useAdminFilesItems.js";
import { useAdminFilesTree } from "../hooks/useAdminFilesTree.js";
import { describeReviewResult } from "../utils/adminFileReview.js";
import { describeUploadResult } from "../utils/adminFileUpload.js";
import { ADMIN_FILES_TABS, getItemsEmptyCopy, getUploadDisabledReason } from "../utils/adminFilesPresentation.js";
import { isQuoteItem } from "../utils/adminQuoteDocuments.js";
import AdminFileFolderDialog from "./AdminFileFolderDialog.jsx";
import AdminFileUploadDialog from "./AdminFileUploadDialog.jsx";
import AdminFileViewerDialog from "./AdminFileViewerDialog.jsx";
import AdminFileWarrantyDialog from "./AdminFileWarrantyDialog.jsx";
import AdminFilesTable from "./AdminFilesTable.jsx";
import AdminFilesToolbar from "./AdminFilesToolbar.jsx";
import AdminFilesTree from "./AdminFilesTree.jsx";
import AdminQuotePdfViewerDialog from "./AdminQuotePdfViewerDialog.jsx";

const NO_SCOPE = Object.freeze({ folderId: null, projectId: null });
const TAB_LABELS = ADMIN_FILES_TABS.map((tab) => tab.label);
// Figma 3727:683877: Anterior 75 × 41 px y Siguiente pág. 114 × 41 px.
const FOOTER_BUTTON_GEOMETRY = { next: { height: 41, width: 114 }, previous: { height: 41, width: 75 } };

/**
 * Textos de la confirmación «Retirar carpeta» (StatusConfirmationModal, variante Danger).
 *
 * @param {{folder: Object, project: Object}|null} removal - Carpeta pendiente.
 * @returns {Object} Textos del diálogo.
 */
function describeRemoval(removal) {
  return {
    actionLabel: "Retirar carpeta",
    activating: false,
    description: "Solo se retiran carpetas personalizadas vacías. Los archivos guardados y sus versiones nunca se eliminan.",
    detail: removal ? `${removal.project.name} › ${removal.folder.name}` : "",
    title: "¿Retirar esta carpeta?",
  };
}

/**
 * Área de trabajo del administrador (Figma 3727:683873): pestañas, árbol (solo en Aprobados),
 * barra, tabla y paginación, más las operaciones de carpetas, la descarga de versiones (U1) y el
 * visor con revisión, historial, restauración y garantías (U2), y «+ Nuevo» y «Reemplazar archivo»
 * (U3). Los PDF de cotizaciones del proyecto se abren en su propio visor con el historial comercial. Tras cada operación confirmada se
 * recargan la tabla y las métricas; el historial lo recarga el propio visor. Con espacio suficiente
 * árbol y tabla van en dos columnas; si no, el árbol se apila encima.
 *
 * @param {Object} props - Recarga de métricas tras una operación.
 * @param {() => void} props.onMetricsStale - Vuelve a leer las métricas.
 * @returns {import("react").ReactElement} Área de trabajo.
 */
function AdminFilesWorkspace({ onMetricsStale }) {
  const items = useAdminFilesItems();
  const tree = useAdminFilesTree({ enabled: true });
  const feedback = useAlertFeedback();
  const tabsRef = useRef(null);
  const focusTabAfterReview = useRef(false);
  const [selection, setSelection] = useState(NO_SCOPE);
  const [expanded, setExpanded] = useState(() => new Set());
  const [viewer, setViewer] = useState(null);
  const [warrantyItem, setWarrantyItem] = useState(null);
  const [uploadDialog, setUploadDialog] = useState(null);
  useEffect(() => {
    // El visor ya ejecutó su limpieza de foco y la fila revisada puede haber desaparecido.
    if (viewer || !focusTabAfterReview.current) return;
    focusTabAfterReview.current = false;
    tabsRef.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }, [viewer]);
  const downloads = useAdminFileVersionDownload({
    onError: (message, name) => feedback.notify("danger", "No se pudo descargar el archivo", message, name),
  });
  // PDF de cotizaciones del proyecto (carpeta «Documentos»): se descargan por la API de Cotizaciones.
  const quoteDownloads = useAdminQuotePdfDownload({
    onError: (message, name) => feedback.notify("danger", "No se pudo descargar el archivo", message, name),
  });

  const tabIndex = Math.max(ADMIN_FILES_TABS.findIndex((tab) => tab.id === items.tab), 0);
  const tab = ADMIN_FILES_TABS[tabIndex].id;
  const showTree = tab === "approved";

  /**
   * Cambia el ámbito de la tabla y despliega la ruta de la carpeta elegida.
   *
   * @param {{projectId: number|null, folderId: number|null}} scope - Selección.
   * @param {number[]} [openFolderIds] - Carpetas que deben quedar desplegadas.
   * @returns {void}
   */
  function selectScope(scope, openFolderIds = []) {
    setSelection(scope);
    items.applyView(tab, scope);
    if (scope.projectId) {
      setExpanded((current) => new Set([...current, `p:${scope.projectId}`, ...openFolderIds.map((id) => `f:${id}`)]));
    }
  }

  const folders = useAdminFileFolderActions({
    feedback,
    onFolderCreated: (folder, projectId) => {
      setExpanded((current) => new Set([...current, `p:${projectId}`, ...(folder.parentId ? [`f:${folder.parentId}`] : [])]));
    },
    onFolderRemoved: (folderId, projectId) => {
      if (selection.folderId === folderId) selectScope({ folderId: null, projectId });
      onMetricsStale();
    },
    onFoldersChange: tree.replaceProjectFolders,
  });
  const operationInProgress = folders.removing || Boolean(downloads.downloadingVersionId) || Boolean(quoteDownloads.downloadingKey);

  // Destino de «+ Nuevo»: la carpeta seleccionada en el árbol (con su número de archivos).
  const selectedProject = tree.projects.find((project) => project.id === selection.projectId) || null;
  const selectedFolder = selectedProject?.folders.find((folder) => folder.id === selection.folderId) || null;
  const newAction = showTree ? {
    disabledReason: getUploadDisabledReason(selectedProject, selectedFolder),
    onClick: () => setUploadDialog({ mode: "upload", target: { folder: selectedFolder, project: selectedProject } }),
  } : null;

  /**
   * Carga confirmada (o reconciliada con lo guardado): recarga tabla, métricas y, si es un archivo
   * nuevo, el árbol (sus contadores); avisa de que queda pendiente de revisión.
   *
   * @param {"upload"|"replace"} kind - Operación.
   * @param {Object} result - Respuesta de la API.
   * @param {{ file: File }} meta - Archivo subido.
   * @returns {void}
   */
  function handleUploaded(kind, result, meta) {
    refreshAfterOperation();
    if (kind === "upload") tree.reload();
    const target = uploadDialog?.target;
    const texts = describeUploadResult(kind, kind === "upload"
      ? { location: meta.destination || `${target?.project.name}${target?.folder ? ` › ${target.folder.name}` : " (raíz del proyecto)"}`, name: result?.file?.title || meta.file.name }
      : { name: uploadDialog?.file?.name || meta.file.name, versionNumber: result?.version?.versionNumber });
    feedback.notify("success", texts.title, texts.description, meta.file.name);
  }

  /**
   * Recarga la tabla y las métricas tras una operación confirmada o un conflicto de vista obsoleta.
   *
   * @returns {void}
   */
  function refreshAfterOperation() {
    items.reload();
    onMetricsStale();
  }

  /**
   * Cierra el visor tras la revisión confirmada y devuelve el foco a la pestaña activa:
   * la fila que abrió el visor puede salir de la lista cuando cambia de estado.
   *
   * @param {"approve"|"reject"} action - Revisión confirmada por la API.
   * @returns {void}
   */
  function handleReviewed(action) {
    focusTabAfterReview.current = true;
    setViewer(null);
    refreshAfterOperation();
    const { title, description } = describeReviewResult(action);
    feedback.notify("success", title, description);
  }

  const filtered = items.hasFilters || (showTree && Boolean(selection.projectId));
  let content;
  if (items.loading) {
    content = <Loader preset="adminFilesTable" variant={showTree ? undefined : tab === "pending" ? "review" : "withProject"} count={items.items.length || ADMIN_FILES_PAGE_SIZE} label="Cargando archivos" />;
  } else if (items.error) {
    content = (
      <div className="rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
        <EmptyState title="No se pudieron cargar los archivos" description={items.error} size="S" showFeaturedIcon={false} showActions showSecondaryAction={false} primaryActionLabel="Reintentar" onPrimaryAction={items.reload} />
      </div>
    );
  } else if (items.items.length) {
    content = (
      <AdminFilesTable
        items={items.items}
        tab={tab}
        sort={items.sort}
        actionsDisabled={operationInProgress || items.loading}
        downloadingVersionId={downloads.downloadingVersionId}
        downloadingQuoteKey={quoteDownloads.downloadingKey}
        onSort={items.toggleSort}
        onDownload={(item) => (isQuoteItem(item)
          ? quoteDownloads.download({ name: item.name, quoteId: item.quote.id, versionNumber: item.versionNumber })
          : downloads.download({ fileId: item.fileId, name: item.name, projectId: item.project.id, versionId: item.versionId }))}
        onOpen={(item, trigger) => setViewer({ item, trigger })}
        onWarranties={setWarrantyItem}
        onReplace={(item) => setUploadDialog({ file: { fileId: item.fileId, folderSystemKey: item.folder?.section === "cover" ? "cover" : null, name: item.name, projectId: item.project.id }, mode: "replace" })}
      />
    );
  } else {
    const copy = items.pagination.hasPrevious
      ? { description: "Esta página ya no tiene archivos. Vuelve a la página anterior.", title: "No hay más archivos" }
      : getItemsEmptyCopy(tab, filtered);
    content = (
      <div className="rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
        <EmptyState
          title={copy.title}
          description={copy.description}
          size="S"
          showFeaturedIcon={false}
          showActions={items.hasFilters}
          showSecondaryAction={false}
          primaryActionLabel="Quitar filtros"
          onPrimaryAction={items.clearFilters}
          className="min-h-[240px]"
        />
      </div>
    );
  }

  const tablePanel = (
    <div className="flex min-w-0 flex-col gap-[24px]">
      <h2 className="sr-only">{ADMIN_FILES_TABS[tabIndex].label}</h2>
      <AdminFilesToolbar
        query={items.search.query}
        onQueryChange={items.search.setQuery}
        newAction={newAction}
      />
      <div aria-busy={items.loading || undefined}>{content}</div>
      {!items.loading && !items.error && (items.items.length || items.pagination.hasPrevious) ? (
        <footer className="flex flex-wrap items-center justify-between gap-x-[24px] gap-y-[12px]" aria-label="Paginación de archivos">
          <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">
            {items.items.length} {items.items.length === 1 ? "archivo" : "archivos"} en esta página
          </span>
          <CursorPaginationNav ariaLabel="Páginas de archivos" buttonGeometry={FOOTER_BUTTON_GEOMETRY} pagination={items.pagination} />
        </footer>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-[48px]">
      <HorizontalTabMenu
        ref={tabsRef}
        items={TAB_LABELS}
        activeIndex={tabIndex}
        style="Underlined"
        filled="off"
        interactive
        onChange={(index) => items.applyView(ADMIN_FILES_TABS[index].id, selection)}
        className="w-full scroll-px-[4px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Estado de revisión de los archivos"
      />

      <TabPanel transitionKey={tab} className="@container">
        {showTree ? (
          <div className="grid grid-cols-1 gap-[24px] @min-[800px]:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]" data-admin-files-layout>
            <AdminFilesTree
              tree={tree}
              selection={selection}
              expanded={expanded}
              actionsDisabled={operationInProgress}
              onSelect={(scope) => selectScope(scope)}
              onSelectSearchResult={(folder) => selectScope({ folderId: folder.id, projectId: folder.project.id }, (folder.path || []).map((segment) => segment.id))}
              onToggle={(key) => setExpanded((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })}
              onCreateFolder={folders.openCreate}
              onRenameFolder={folders.openRename}
              onRemoveFolder={folders.requestRemoval}
            />
            {tablePanel}
          </div>
        ) : tablePanel}
      </TabPanel>

      {folders.dialog ? <AdminFileFolderDialog key={`${folders.dialog.mode}-${folders.dialog.folder?.id ?? folders.dialog.parent?.id}`} dialog={folders.dialog} onClose={folders.closeDialog} onSubmit={folders.submitDialog} /> : null}
      {viewer && isQuoteItem(viewer.item) ? (
        <AdminQuotePdfViewerDialog
          key={`quote:${viewer.item.versionId}`}
          item={viewer.item}
          returnFocusTo={viewer.trigger}
          downloads={quoteDownloads}
          feedback={feedback}
          onChanged={refreshAfterOperation}
          onClose={() => setViewer(null)}
        />
      ) : null}
      {viewer && !isQuoteItem(viewer.item) ? (
        <AdminFileViewerDialog
          key={viewer.item.versionId}
          item={viewer.item}
          returnFocusTo={viewer.trigger}
          downloads={downloads}
          feedback={feedback}
          onChanged={refreshAfterOperation}
          onClose={() => setViewer(null)}
          onReviewed={handleReviewed}
        />
      ) : null}
      {uploadDialog ? (
        <AdminFileUploadDialog
          mode={uploadDialog.mode}
          target={uploadDialog.target}
          file={uploadDialog.file}
          onUploaded={(result, meta) => handleUploaded(uploadDialog.mode, result, meta)}
          onClose={() => setUploadDialog(null)}
        />
      ) : null}
      {warrantyItem ? (
        <AdminFileWarrantyDialog
          file={{ fileId: warrantyItem.fileId, name: warrantyItem.name, projectId: warrantyItem.project.id }}
          onClose={() => setWarrantyItem(null)}
        />
      ) : null}
      <StatusConfirmationModal
        change={folders.removal}
        submitting={folders.removing}
        describe={describeRemoval}
        dialogAttribute="data-admin-file-folder-removal"
        iconAttribute="data-admin-file-folder-removal-icon"
        onCancel={folders.cancelRemoval}
        onConfirm={folders.confirmRemoval}
      />
      <AlertToast
        trigger={feedback.value}
        title={feedback.value?.title || "Gestión de archivos"}
        content={feedback.value?.content}
        description={feedback.value?.message || ""}
        theme={feedback.value?.tone === "danger" ? "Danger" : "Success"}
        aria-label={feedback.value?.tone === "danger" ? "Error en la gestión de archivos" : "Gestión de archivos actualizada"}
        onDismiss={feedback.dismiss}
      />
    </div>
  );
}

export default AdminFilesWorkspace;
