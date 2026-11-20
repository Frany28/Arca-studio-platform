import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import HorizontalTabMenu from "../../../components/ui/HorizontalTabMenu/HorizontalTabMenu.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import TabPanel from "../../../components/ui/TabPanel.jsx";
import { saveBlobAsFile } from "../../../utils/saveBlobAsFile.js";
import CursorPaginationNav from "../../admin-services-quotes/components/CursorPaginationNav.jsx";
import StatusConfirmationModal from "../../admin-services-quotes/components/StatusConfirmationModal.jsx";
import { useAlertFeedback } from "../../admin-services-quotes/hooks/useAlertFeedback.js";
import { useAdminFileFolderActions } from "../hooks/useAdminFileFolderActions.js";
import { ADMIN_FILES_PAGE_SIZE, useAdminFilesItems } from "../hooks/useAdminFilesItems.js";
import { useAdminFilesTree } from "../hooks/useAdminFilesTree.js";
import { ADMIN_FILES_TABS, getItemsEmptyCopy } from "../utils/adminFilesPresentation.js";
import AdminFileFolderDialog from "./AdminFileFolderDialog.jsx";
import AdminFilesTable from "./AdminFilesTable.jsx";
import AdminFilesToolbar from "./AdminFilesToolbar.jsx";
import AdminFilesTree from "./AdminFilesTree.jsx";

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
 * barra, tabla y paginación, más las operaciones de carpetas y la descarga de versiones. Con
 * espacio suficiente árbol y tabla van en dos columnas; si no, el árbol se apila encima.
 *
 * @param {Object} props - Recarga de métricas tras una operación.
 * @param {() => void} props.onMetricsStale - Vuelve a leer las métricas.
 * @returns {import("react").ReactElement} Área de trabajo.
 */
function AdminFilesWorkspace({ onMetricsStale }) {
  const items = useAdminFilesItems();
  const tree = useAdminFilesTree({ enabled: true });
  const feedback = useAlertFeedback();
  const [selection, setSelection] = useState(NO_SCOPE);
  const [expanded, setExpanded] = useState(() => new Set());
  const [downloadingVersionId, setDownloadingVersionId] = useState(null);
  const downloadRequest = useRef(null);
  useEffect(() => () => downloadRequest.current?.abort(), []);

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
  const operationInProgress = folders.removing || Boolean(downloadingVersionId);

  /**
   * Descarga una versión con el nombre que indica el servidor; impide descargas simultáneas y el
   * desmontaje cancela la petición.
   *
   * @param {Object} item - Fila de la tabla.
   * @returns {Promise<void>}
   */
  async function downloadVersion(item) {
    if (downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloadingVersionId(item.versionId);
    try {
      const { blob, fileName } = await api.fileManager.downloadVersion({ fileId: item.fileId, projectId: item.project.id, signal: controller.signal, versionId: item.versionId });
      if (!controller.signal.aborted) saveBlobAsFile(blob, fileName || item.name);
    } catch (error) {
      if (controller.signal.aborted) return;
      feedback.notify("danger", "No se pudo descargar el archivo", error?.message || "Inténtalo de nuevo.", item.name);
    } finally {
      downloadRequest.current = null;
      if (!controller.signal.aborted) setDownloadingVersionId(null);
    }
  }

  const filtered = items.hasFilters || (showTree && Boolean(selection.projectId));
  let content;
  if (items.loading) {
    content = <Loader preset="adminFilesTable" variant={showTree ? undefined : "withProject"} count={items.items.length || ADMIN_FILES_PAGE_SIZE} label="Cargando archivos" />;
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
        downloadingVersionId={downloadingVersionId}
        onSort={items.toggleSort}
        onDownload={downloadVersion}
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
        extensions={items.extensions}
        onExtensionsChange={items.setExtensions}
        hasFilters={items.hasFilters}
        onClearFilters={items.clearFilters}
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
    <div className="flex flex-col gap-[24px] min-[768px]:gap-[48px]">
      <HorizontalTabMenu
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
