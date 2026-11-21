import clsx from "clsx";
import { Add, ArrowDown2, Edit2, Folder2, SearchNormal1, Trash } from "iconsax-react";
import { useMemo } from "react";

import ActionMenu from "../../../components/ui/ActionMenu/ActionMenu.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import ScrollBar from "../../../components/ui/ScrollBar/ScrollBar.jsx";
import { useVerticalScrollBar } from "../../../hooks/useVerticalScrollBar.js";
import { FOLDER_RULE_MESSAGES, buildFolderTree, formatFolderPath, getFolderCapabilities } from "../utils/adminFilesPresentation.js";

// Figma 3727:683873: superficies de 36 px cada 48 px, margen de 8 px y sangría de 17 px.
const INDENT_PX = 17;
const FOLDER_ACTIONS = Object.freeze([
  { icon: Edit2, id: "rename", label: "Renombrar" },
  { icon: Trash, id: "remove", label: "Retirar carpeta", separated: true, tone: "danger" },
]);

/**
 * Fila del árbol: selecciona el proyecto o la carpeta, despliega sus subcarpetas y, en carpetas
 * personalizadas, ofrece renombrar y retirar. Las predeterminadas no tienen acciones (protegidas).
 *
 * @param {Object} props - Nodo, nivel, estado y callbacks.
 * @returns {import("react").ReactElement} Elemento de lista.
 */
function TreeRow({ actionsDisabled, activeBranch = false, children, depth, expanded, hasChildren, label, menu, onSelect, onToggle, selected }) {
  const highlighted = selected || activeBranch;
  return (
    <li className="flex flex-col gap-[12px]">
      <div
        className={clsx(
          "group mr-[8px] flex h-[36px] items-center gap-[4px] rounded-[var(--radius-2)] pr-[4px] transition-colors duration-150 motion-reduce:transition-none",
          highlighted ? "bg-[var(--color-neutral-200)]" : "hover:bg-[var(--color-neutral-200)]",
        )}
        style={{ marginLeft: 8 + depth * INDENT_PX }}
        data-tree-row
      >
        <button
          type="button"
          className={clsx(
            "flex h-full min-w-0 flex-1 items-center gap-[12px] rounded-[var(--radius-2)] pl-[8px] text-left text-heading-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]",
            highlighted ? "text-[var(--color-text-300)]" : "text-[var(--color-text-200)]",
          )}
          aria-current={selected ? "true" : undefined}
          onClick={onSelect}
        >
          <Folder2 size="20" variant="Linear" color="currentColor" className="shrink-0" aria-hidden="true" />
          <span className="truncate" title={label}>{label}</span>
        </button>
        {menu}
        {hasChildren ? (
          <Button
            theme="Primary"
            type="Ghost"
            size="S"
            showText={false}
            showLeftIcon
            iconLeft={<ArrowDown2 size="20" color="currentColor" className={clsx("transition-transform duration-200", expanded && "rotate-180")} />}
            showRightIcon={false}
            tooltip={false}
            disabled={actionsDisabled}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Ocultar" : "Mostrar"} carpetas de ${label}`}
            onClick={onToggle}
          />
        ) : <span className="size-[32px] shrink-0" aria-hidden="true" />}
      </div>
      {hasChildren && expanded ? <ul className="flex flex-col gap-[12px]">{children}</ul> : null}
    </li>
  );
}

/**
 * Carpetas de un proyecto, recursivas.
 *
 * @param {Object} props - Nodos, nivel, proyecto y estado del árbol.
 * @returns {import("react").ReactElement[]} Filas.
 */
function FolderNodes({ depth, nodes, project, state }) {
  return nodes.map((folder) => {
    const key = `f:${folder.id}`;
    const { canManage } = getFolderCapabilities(folder);
    const selected = state.selection.folderId === folder.id;
    return (
      <TreeRow
        key={folder.id}
        depth={depth}
        label={folder.name}
        selected={selected}
        expanded={state.expanded.has(key)}
        hasChildren={folder.children.length > 0}
        actionsDisabled={state.actionsDisabled}
        onSelect={() => state.onSelect({ folderId: folder.id, projectId: project.id })}
        onToggle={() => state.onToggle(key)}
        menu={canManage ? (
          <ActionMenu
            items={FOLDER_ACTIONS}
            triggerLabel={`Opciones de la carpeta ${folder.name}`}
            menuLabel={`Acciones para ${folder.name}`}
            tooltip="Más opciones"
            menuWidthClassName="w-[200px]"
            disabled={state.actionsDisabled}
            onSelect={(item) => (item.id === "rename" ? state.onRename(project, folder) : state.onRemove(project, folder))}
          />
        ) : null}
      >
        <FolderNodes depth={depth + 1} nodes={folder.children} project={project} state={state} />
      </TreeRow>
    );
  });
}

/**
 * Resultados de «Buscar carpeta...»: cada carpeta con su ruta legible (proyecto › carpetas).
 *
 * @param {Object} props - Resultados y selección.
 * @returns {import("react").ReactElement} Sección de resultados.
 */
function FolderSearchResults({ onSelect, results, selection }) {
  let body;
  if (results.loading) body = <p className="text-body-3 m-0 px-[8px] text-[var(--color-text-100)]" role="status">Buscando carpetas...</p>;
  else if (results.error) body = <p className="text-body-3 m-0 px-[8px] text-[var(--color-danger-100)]" role="alert">{results.error}</p>;
  else if (!results.folders.length) body = <p className="text-body-3 m-0 px-[8px] text-[var(--color-text-100)]">Ninguna carpeta coincide.</p>;
  else {
    body = (
      <ul className="flex flex-col gap-[4px]">
        {results.folders.map((folder) => {
          const path = formatFolderPath(folder);
          const selected = selection.folderId === folder.id;
          return (
            <li key={folder.id}>
              <button
                type="button"
                className={clsx(
                  "flex w-full flex-col gap-[2px] rounded-[var(--radius-2)] px-[8px] py-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]",
                  selected ? "bg-[var(--color-neutral-300)]" : "hover:bg-[var(--color-neutral-200)]",
                )}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(folder)}
              >
                <span className="flex min-w-0 items-center gap-[12px] text-heading-8 text-[var(--color-text-300)]">
                  <Folder2 size="20" variant="Linear" color="currentColor" className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{folder.name}</span>
                </span>
                <span className="text-body-4 truncate pl-[32px] text-[var(--color-text-100)]" title={path}>{path}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <section className="flex flex-col gap-[8px] border-b border-[var(--color-neutral-200)] pb-[16px]" aria-label="Carpetas encontradas">
      <h3 className="text-heading-8 m-0 px-[8px] text-[var(--color-text-100)]">Carpetas</h3>
      {body}
    </section>
  );
}

/**
 * Columna «Proyectos» de la pestaña Aprobados (Figma 3727:683873): búsqueda de carpetas, «+» para
 * crear una subcarpeta en la carpeta seleccionada y el árbol de proyectos con sus carpetas
 * anidadas. Seleccionar un proyecto o una carpeta acota la tabla; volver a pulsar el proyecto
 * seleccionado quita el ámbito. Apilado sobre la tabla (contenedor < 800 px), el árbol muestra
 * cuatro filas como Figma móvil 3727:683883 (184 px) y desplaza el resto con su ScrollBar.
 *
 * @param {Object} props - Árbol (useAdminFilesTree), selección, carpetas expandidas y callbacks.
 * @returns {import("react").ReactElement} Columna del árbol.
 */
function AdminFilesTree({ actionsDisabled, expanded, onCreateFolder, onRemoveFolder, onRenameFolder, onSelect, onSelectSearchResult, onToggle, selection, tree }) {
  const { viewportRef, scrollState, hasOverflow, syncScrollState, handlePositionChange } = useVerticalScrollBar();
  const project = tree.projects.find((candidate) => candidate.id === selection.projectId) || null;
  const selectedFolder = project?.folders.find((folder) => folder.id === selection.folderId) || null;
  // Con un proyecto seleccionado sin carpeta, la creación sería en la raíz: pendiente de decisión (D7).
  const capabilities = project && !selectedFolder
    ? { canCreateChild: false, canManage: false, createReason: FOLDER_RULE_MESSAGES.rootUndecided }
    : getFolderCapabilities(selectedFolder);
  const projectNodes = useMemo(
    () => tree.projects.map((candidate) => ({ project: candidate, roots: buildFolderTree(candidate.folders) })),
    [tree.projects],
  );
  const state = { actionsDisabled, expanded, onRemove: onRemoveFolder, onRename: onRenameFolder, onSelect, onToggle, selection };

  let content;
  if (tree.loading) {
    content = <Loader preset="adminFilesTree" count={8} label="Cargando proyectos" />;
  } else if (tree.error && !tree.projects.length) {
    content = (
      <EmptyState
        title="No se pudo cargar el árbol"
        description={tree.error}
        size="S"
        showFeaturedIcon={false}
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Reintentar"
        onPrimaryAction={tree.reload}
      />
    );
  } else if (!tree.projects.length) {
    content = (
      <p className="text-body-3 m-0 px-[8px] text-[var(--color-text-100)]">
        {tree.search.applied ? "Ningún proyecto coincide con la búsqueda." : "Aún no hay proyectos con carpetas."}
      </p>
    );
  } else {
    content = (
      <ul className="flex flex-col gap-[12px] pt-[4px]" aria-label="Proyectos y carpetas">
        {projectNodes.map(({ project: node, roots }) => {
          const key = `p:${node.id}`;
          const selected = selection.projectId === node.id && !selection.folderId;
          return (
            <TreeRow
              key={node.id}
              depth={0}
              label={node.name}
              selected={selected}
              activeBranch={selection.projectId === node.id}
              expanded={expanded.has(key)}
              hasChildren={roots.length > 0}
              actionsDisabled={actionsDisabled}
              onSelect={() => onSelect(selected ? { folderId: null, projectId: null } : { folderId: null, projectId: node.id })}
              onToggle={() => onToggle(key)}
            >
              <FolderNodes depth={1} nodes={roots} project={node} state={state} />
            </TreeRow>
          );
        })}
      </ul>
    );
  }

  return (
    <aside className="flex min-w-0 flex-col gap-[24px]" aria-labelledby="admin-files-tree-title">
      <div className="flex items-center gap-[8px]">
        <h2 id="admin-files-tree-title" className="text-heading-7 m-0 mr-auto shrink-0 pr-[8px] text-[var(--color-text-200)]">Proyectos</h2>
        <div className="min-w-0 flex-1 basis-[182px]">
          <Input
            type="Default input"
            size="M"
            value={tree.search.query}
            placeholder="Buscar carpeta..."
            showLabel={false}
            showHint={false}
            showLeftIcon
            showRightIcon={false}
            required={false}
            leftIcon={<SearchNormal1 size="20" color="currentColor" />}
            className="w-full max-w-none"
            aria-label="Buscar carpetas y proyectos"
            onChange={(event) => tree.search.setQuery(event.target.value)}
          />
        </div>
        <Button
          theme="Primary"
          type="Solid"
          size="M"
          showText={false}
          showLeftIcon
          iconLeft={<Add size="20" color="currentColor" />}
          showRightIcon={false}
          disabled={actionsDisabled || !capabilities.canCreateChild}
          tooltip={capabilities.canCreateChild ? `Nueva carpeta en ${selectedFolder.name}` : capabilities.createReason}
          aria-label={capabilities.canCreateChild ? `Nueva carpeta en ${selectedFolder.name}` : `Nueva carpeta. ${capabilities.createReason}`}
          onClick={() => onCreateFolder(project, selectedFolder)}
        />
      </div>

      <div className="relative min-h-0">
        <div
          ref={viewportRef}
          className="max-h-[184px] overflow-y-auto overscroll-contain pr-[16px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden @min-[800px]:max-h-[720px]"
          onScroll={syncScrollState}
          data-admin-files-tree-viewport
        >
          <div className="flex min-w-0 flex-col gap-[16px]">
            {tree.search.applied ? <FolderSearchResults results={tree.folderResults} selection={selection} onSelect={onSelectSearchResult} /> : null}
            {content}
            {tree.error && tree.projects.length ? <p className="text-body-3 m-0 px-[8px] text-[var(--color-danger-100)]" role="alert">{tree.error}</p> : null}
            {tree.hasMore && !tree.loading ? (
              <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={tree.loadingMore} className="self-start" onClick={tree.loadMore}>
                {tree.loadingMore ? "Cargando proyectos..." : "Cargar más proyectos"}
              </Button>
            ) : null}
          </div>
        </div>
        {hasOverflow ? (
          <ScrollBar
            height={scrollState.height}
            length={scrollState.length}
            position={scrollState.position}
            interactive
            onPositionChange={handlePositionChange}
            aria-label="Desplazamiento de proyectos y carpetas"
            className="absolute right-0 top-0"
            trackContainerClassName="bg-transparent"
          />
        ) : null}
      </div>
    </aside>
  );
}

export default AdminFilesTree;
