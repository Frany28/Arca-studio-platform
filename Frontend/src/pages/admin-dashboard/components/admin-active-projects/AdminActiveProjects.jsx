import { useMemo, useRef, useState } from "react";
import {
  ArrowSwapVertical,
  DocumentForward,
  Edit2,
  Eye,
  Filter,
  FilterRemove,
  GlobalEdit,
  More,
  SearchNormal1,
} from "iconsax-react";

import Avatar from "../../../../components/ui/Avatar/Avatar.jsx";
import AlertToast from "../../../../components/ui/AlertToast/AlertToast.jsx";
import AssigneeMultiSelect from "../../../../components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx";
import Badge from "../../../../components/ui/Badge/Badge.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import Checkbox from "../../../../components/ui/Checkbox/Checkbox.jsx";
import DropdownMenu from "../../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import Loader from "../../../../components/ui/Loader/Loader.jsx";
import ScrollBar from "../../../../components/ui/ScrollBar/ScrollBar.jsx";
import Tag from "../../../../components/ui/Tag/Tag.jsx";
import { isProjectOperationallyReadOnly } from "../../../../utils/projectReadOnly.js";
import { getBulkActionAvailability } from "./utils/adminProjectBulkActions.js";
import { getAdminProjectsPagination } from "./utils/adminProjectPagination.js";
import { getAssignees, getClient, getStatus } from "./utils/adminProjectPresentation.js";
import { useAdminProjectFilters } from "./hooks/useAdminProjectFilters.js";
import { useAdminProjectSelection } from "./hooks/useAdminProjectSelection.js";
import { useAdminProjectsTableScroll } from "./hooks/useAdminProjectsTableScroll.js";
import "./AdminActiveProjects.css";

const BULK_ACTION_FEEDBACK = {
  archive: {
    successTitle: "Proyectos archivados",
    successMessage: "Los proyectos seleccionados fueron archivados.",
    errorTitle: "No se pudieron archivar los proyectos",
  },
  change_visibility: {
    successTitle: "Visibilidad actualizada",
    successMessage: "La visibilidad de los proyectos fue actualizada.",
    errorTitle: "No se pudo cambiar la visibilidad",
  },
  unarchive: {
    successTitle: "Proyectos desarchivados",
    successMessage: "Los proyectos seleccionados fueron desarchivados.",
    errorTitle: "No se pudieron desarchivar los proyectos",
  },
};

function TableHeaderLabel({ children, filter = false }) {
  const Icon = filter ? Filter : ArrowSwapVertical;
  return (
    <span className="flex items-center gap-[8px] whitespace-nowrap">
      <span>{children}</span>
      <Icon size="16" variant="Linear" color="currentColor" aria-hidden="true" />
    </span>
  );
}

/**
 * Compone la tabla administrativa y coordina filtros, página, selección y feedback.
 * Mantiene aquí las mutaciones y snapshots ligados a los callbacks del consumidor;
 * los hooks locales no conocen la API ni los resets entre responsabilidades.
 * @param {Object} props Proyectos, catálogo de responsables, carga y callbacks existentes.
 * @returns {import("react").ReactElement} Tabla y controles con su presentación actual.
 */
function AdminActiveProjects({
  assignees: employeeOptions = [],
  assigneesLoading = false,
  error,
  loading,
  onOpenProject,
  onBulkAction,
  onProjectAssigneesChange,
  onRetry,
  projects,
}) {
  const {
    query, setQuery, setStatusFilterIds, setPersonFilterIds,
    personnelFilterItems, statusFilterItems, filteredProjects, hasFilters,
  } = useAdminProjectFilters(projects);
  const [pageIndex, setPageIndex] = useState(0);
  const [bulkActionPending, setBulkActionPending] = useState("");
  const [bulkActionFeedback, setBulkActionFeedback] = useState(null);
  const [assigneeRemovalFeedback, setAssigneeRemovalFeedback] = useState(null);
  // State controla la UI; estas refs bloquean repeticiones antes del siguiente render.
  const assigneeUndoPendingRef = useRef(false);
  const bulkActionPendingRef = useRef(false);
  const assigneeFeedbackProject = assigneeRemovalFeedback
    ? projects.find(
        (project) => String(project.id) === String(assigneeRemovalFeedback.project.id),
      )
    : null;
  const assigneeUndoUnavailable = Boolean(
    assigneeRemovalFeedback
      && isProjectOperationallyReadOnly(assigneeFeedbackProject),
  );

  const personnelFilterLabel = "Filtrar por personal";

  const pagination = useMemo(
    () => getAdminProjectsPagination(filteredProjects, pageIndex),
    [filteredProjects, pageIndex],
  );
  const visibleProjects = pagination.pageProjects;

  const selection = useAdminProjectSelection(visibleProjects);
  const {
    selectedProjectIds, setSelectedProjectIds, selectedVisibleProjects,
    selectedVisibleCount, headerChecked,
  } = selection;
  const {
    canArchive,
    canChangeVisibility,
    canUnarchive,
  } = getBulkActionAvailability(selectedVisibleProjects);
  const {
    tableViewportRef, tableFooterRef, scrollToTableEndAfterPreviousRef,
    tableScrollState, syncTableScrollState, handleTableScrollPositionChange,
  } = useAdminProjectsTableScroll({
    error, loading, visibleProjectCount: visibleProjects.length, pageIndex: pagination.pageIndex,
  });

  /**
   * Restablece todos los filtros junto con página, selección y feedback de acciones.
   * @returns {void}
   */
  const clearFilters = () => {
    setQuery("");
    setStatusFilterIds([]);
    setPersonFilterIds([]);
    setPageIndex(0);
    setSelectedProjectIds(new Set());
    setBulkActionFeedback(null);
  };

  /**
   * Aplica la búsqueda conservando el reset coordinado aunque solo contenga espacios.
   * @param {import("react").ChangeEvent<HTMLInputElement>} event Cambio del input compartido.
   * @returns {void}
   */
  const handleQueryChange = (event) => {
    setQuery(event.target.value);
    setPageIndex(0);
    setSelectedProjectIds(new Set());
    setBulkActionFeedback(null);
  };

  /**
   * Recoge los IDs de personal marcados y reinicia la vista afectada por el filtro.
   * @param {Object[]} nextItems Opciones controladas del menú múltiple, checked Yes/No.
   * @returns {void}
   */
  const handlePersonFilterItemsChange = (nextItems) => {
    setPersonFilterIds(
      nextItems
        .filter((item) => item.checked === "Yes")
        .map((item) => String(item.id)),
    );
    setPageIndex(0);
    setSelectedProjectIds(new Set());
    setBulkActionFeedback(null);
  };

  /**
   * Recoge los estados marcados y reinicia página, selección y feedback conjuntamente.
   * @param {Object[]} nextItems Opciones controladas del menú múltiple, checked Yes/No.
   * @returns {void}
   */
  const handleStatusFilterItemsChange = (nextItems) => {
    setStatusFilterIds(
      nextItems
        .filter((item) => item.checked === "Yes")
        .map((item) => String(item.id)),
    );
    setPageIndex(0);
    setSelectedProjectIds(new Set());
    setBulkActionFeedback(null);
  };

  /**
   * Solicita la página anterior y marca el desplazamiento del footer tras el nuevo layout.
   * Durante una acción masiva conserva página y selección para no cambiar el contexto.
   * @returns {void}
   */
  const goToPreviousPage = () => {
    if (!pagination.canGoPrevious || bulkActionPending) return;
    scrollToTableEndAfterPreviousRef.current = true;
    setPageIndex(pagination.pageIndex - 1);
    setSelectedProjectIds(new Set());
    setBulkActionFeedback(null);
  };

  /**
   * Avanza desde el índice efectivo, limpiando selección y feedback sin desplazar el footer.
   * @returns {void}
   */
  const goToNextPage = () => {
    if (!pagination.canGoNext || bulkActionPending) return;
    setPageIndex(pagination.pageIndex + 1);
    setSelectedProjectIds(new Set());
    setBulkActionFeedback(null);
  };

  const toggleAllVisible = () => {
    setBulkActionFeedback(null);
    selection.toggleAllVisible();
  };

  const toggleProject = (projectId) => {
    setBulkActionFeedback(null);
    selection.toggleProject(projectId);
  };

  /**
   * Ejecuta una acción permitida sobre el snapshot de objetos seleccionados visibles.
   * La ref protege inmediatamente; pending controla botones. Solo el éxito limpia selección,
   * y el rechazo conserva el mensaje original y permite reintentar con la selección actual.
   * @param {"archive"|"change_visibility"|"unarchive"} action Acción del contrato existente.
   * @returns {Promise<void>} Finalización del callback, con errores mostrados en el feedback.
   */
  const handleBulkAction = async (action) => {
    const actionIsAllowed = {
      archive: canArchive,
      change_visibility: canChangeVisibility,
      unarchive: canUnarchive,
    }[action];

    if (!actionIsAllowed || bulkActionPendingRef.current || !onBulkAction) return;

    bulkActionPendingRef.current = true;
    setBulkActionPending(action);
    setBulkActionFeedback(null);

    try {
      await onBulkAction({ action, projects: selectedVisibleProjects });
      const feedback = BULK_ACTION_FEEDBACK[action];
      setSelectedProjectIds(new Set());
      setBulkActionFeedback({
        id: Date.now(),
        message: feedback.successMessage,
        title: feedback.successTitle,
        type: "success",
      });
    } catch (actionError) {
      const feedback = BULK_ACTION_FEEDBACK[action];
      setBulkActionFeedback({
        id: Date.now(),
        message: actionError?.message || "No se pudieron actualizar los proyectos.",
        title: feedback.errorTitle,
        type: "error",
      });
    } finally {
      bulkActionPendingRef.current = false;
      setBulkActionPending("");
    }
  };

  /**
   * Restaura el proyecto y la lista originales capturados al confirmar una baja.
   * Comprueba el estado actual del proyecto y bloquea duplicados mediante una ref inmediata.
   * Conserva el cierre del aviso al finalizar y el canal compartido de errores del consumidor.
   * @returns {Promise<void>} Finalización de la restauración, con error visible si falla.
   */
  const handleUndoAssigneeRemoval = async () => {
    if (assigneeUndoPendingRef.current || assigneeUndoUnavailable) return;

    assigneeUndoPendingRef.current = true;
    try {
      await onProjectAssigneesChange?.(
        assigneeRemovalFeedback.project,
        assigneeRemovalFeedback.previousAssignees,
      );
    } catch (undoError) {
      setBulkActionFeedback({
        id: Date.now(),
        type: "error",
        title: "No se pudo restaurar al encargado",
        message: undoError?.message
          || "Inténtalo nuevamente desde la asignación del proyecto.",
      });
    } finally {
      assigneeUndoPendingRef.current = false;
      setAssigneeRemovalFeedback(null);
    }
  };

  return (
    <section
      className="admin-active-projects mx-auto flex w-full max-w-[1200px] flex-col gap-[16px] px-[16px] pb-[48px] pt-[24px] sm:px-[24px] lg:px-[48px]"
      aria-labelledby="admin-active-projects-title"
    >
      <h2 id="admin-active-projects-title" className="text-body-3 text-[var(--color-text-300)]">
        Proyectos
      </h2>

      <div className="admin-active-projects__toolbar">
        <Input
          type="Default input"
          size="M"
          value={query}
          placeholder="Buscar..."
          showLabel={false}
          showHint={false}
          showLeftIcon
          showRightIcon={false}
          leftIcon={<SearchNormal1 size="20" color="currentColor" />}
          className="w-full"
          aria-label="Buscar proyectos"
          required={false}
          onChange={handleQueryChange}
        />
        <div className="admin-active-projects__filters w-full">
          <DropdownMenu
            type="Text"
            label={personnelFilterLabel}
            items={personnelFilterItems}
            multiple
            onItemsChange={handlePersonFilterItemsChange}
            className="w-full"
            contentClassName="admin-active-projects__filter-menu"
            rowHeightClassName="h-[35px]"
            triggerWrapperClassName="h-[39px]"
            triggerHeightClassName="h-[37px]"
            triggerPaddingXClassName="px-[16px]"
            aria-label="Filtrar proyectos por personal"
          />
          <DropdownMenu
            type="Text"
            label="Filtrar por status"
            items={statusFilterItems}
            multiple
            onItemsChange={handleStatusFilterItemsChange}
            className="w-full"
            contentClassName="admin-active-projects__filter-menu"
            rowHeightClassName="h-[35px]"
            triggerWrapperClassName="h-[39px]"
            triggerHeightClassName="h-[37px]"
            triggerPaddingXClassName="px-[16px]"
            aria-label="Filtrar proyectos por status"
          />
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon
            iconLeft={<FilterRemove size="20" color="currentColor" />}
            showRightIcon={false}
            disabled={!hasFilters}
            className="admin-active-projects__clear-filters w-full"
            onClick={clearFilters}
          >
            Quitar filtros
          </Button>
        </div>
      </div>

      {loading ? (
        <Loader preset="adminProjectTable" label="Cargando proyectos" />
      ) : error ? (
        <div className="w-full rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]">
          <EmptyState
            title="No se pudieron cargar los proyectos"
            description={error}
            size="S"
            showFeaturedIcon={false}
            showActions
            showSecondaryAction={false}
            primaryActionLabel="Reintentar"
            onPrimaryAction={onRetry}
          />
        </div>
      ) : (
        <>
          {filteredProjects.length ? (
            <div className="w-full overflow-hidden rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
            <div
              ref={tableViewportRef}
              className="w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              onScroll={syncTableScrollState}
            >
              <table className="w-full min-w-[1093px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[48px]" />
              <col className="w-[155px]" />
              <col className="w-[184px]" />
              <col className="w-[300px]" />
              <col className="w-[117px]" />
              <col className="w-[117px]" />
              <col className="w-[172px]" />
            </colgroup>
            <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
              <tr className="h-[49px] text-body-4">
                <th className="p-[16px]">
                  <Checkbox size="S" checked={headerChecked} interactive aria-label="Seleccionar todos los proyectos visibles" onCheckedChange={toggleAllVisible} />
                </th>
                <th className="px-[24px] py-[16px]"><TableHeaderLabel>Proyecto</TableHeaderLabel></th>
                <th className="px-[24px] py-[16px]"><TableHeaderLabel>Cliente</TableHeaderLabel></th>
                <th className="px-[24px] py-[16px]"><TableHeaderLabel filter>Personal responsable</TableHeaderLabel></th>
                <th className="px-[24px] py-[16px]"><TableHeaderLabel filter>Status</TableHeaderLabel></th>
                <th className="px-[24px] py-[16px]"><TableHeaderLabel>Progreso</TableHeaderLabel></th>
                <th className="px-[24px] py-[16px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((project) => {
                const client = getClient(project);
                const status = getStatus(project);
                const assignees = getAssignees(project);
                const progress = Math.min(100, Math.max(0, Number(project.progress) || 0));
                const projectName = project.title || project.name || "Proyecto";
                const isSelected = selectedProjectIds.has(String(project.id));
                const assignmentDisabled = isProjectOperationallyReadOnly(project);

                return (
                  <tr
                    key={project.id}
                    className={`h-[68px] transition-colors duration-150 ${
                      isSelected
                        ? "bg-[var(--color-neutral-300)]"
                        : "bg-[var(--color-neutral-100)]"
                    }`}
                    data-selected={isSelected ? "true" : undefined}
                  >
                    <td className="p-[16px]">
                      <Checkbox size="S" checked={isSelected ? "Yes" : "No"} interactive aria-label={`Seleccionar ${projectName}`} onCheckedChange={() => toggleProject(project.id)} />
                    </td>
                    <td className="px-[24px] py-[16px]">
                      <Tag
                        label={projectName}
                        title={projectName}
                        size="M"
                        avatar={false}
                        checkbox={false}
                        closeIcon={false}
                        count={false}
                        className="w-full max-w-[107px]"
                      />
                    </td>
                    <td className="px-[24px] py-[16px]">
                      <div className="flex min-w-0 items-center gap-[8px]">
                        <Avatar size="S" name={client.name} {...client.avatar} />
                        <span className="text-body-4 min-w-0 truncate text-[var(--color-text-300)]">{client.name}</span>
                      </div>
                    </td>
                    <td className="px-[24px] py-[16px]">
                      <AssigneeMultiSelect
                        value={assignees}
                        options={employeeOptions}
                        loading={assigneesLoading}
                        disabled={assignmentDisabled}
                        className="w-[252px]"
                        aria-label={assignmentDisabled
                          ? `Responsables de ${projectName}. Proyecto cerrado, asignación deshabilitada`
                          : `Responsables de ${projectName}`}
                        confirmRemoval
                        onChange={(nextAssignees) => onProjectAssigneesChange?.(project, nextAssignees)}
                        onRemovalSuccess={(removedAssignees) => {
                          setAssigneeRemovalFeedback({
                            id: Date.now(),
                            names: removedAssignees
                              .map((assignee) => assignee.name)
                              .filter(Boolean),
                            project,
                            projectName,
                            previousAssignees: assignees,
                          });
                        }}
                      />
                    </td>
                    <td className="px-[24px] py-[16px]"><Badge label={status.label} theme={status.theme} variation="Simple" size="S" /></td>
                    <td className="px-[24px] py-[16px]"><Badge label={`${progress}%`} theme="Neutral" variation="Simple" size="S" /></td>
                    <td className="px-[24px] py-[16px]">
                      <div className="flex items-center gap-[8px]">
                        <Button theme="Primary" type="Ghost" size="S" showText={false} showLeftIcon iconLeft={<Eye size="20" color="currentColor" />} showRightIcon={false} tooltip="Ver proyecto" aria-label={`Ver ${projectName}`} onClick={() => onOpenProject(project)} />
                        <Button theme="Primary" type="Ghost" size="S" showText={false} showLeftIcon iconLeft={<Edit2 size="20" color="currentColor" />} showRightIcon={false} tooltip="Editar proyecto" aria-label={`Editar ${projectName}`} disabled={!project.editable} onClick={() => onOpenProject(project)} />
                        <Button theme="Primary" type="Ghost" size="S" showText={false} showLeftIcon iconLeft={<More size="20" color="currentColor" />} showRightIcon={false} tooltip="Más opciones" aria-label={`Más opciones de ${projectName}`} aria-disabled="true" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
              </table>
            </div>
            {tableScrollState.length < 0.999 && tableScrollState.width > 0 ? (
              <ScrollBar
                orientation="horizontal"
                width={tableScrollState.width}
                length={tableScrollState.length}
                position={tableScrollState.position}
                interactive
                onPositionChange={handleTableScrollPositionChange}
                aria-label="Desplazar tabla de proyectos horizontalmente"
                className="block max-w-full"
              />
            ) : null}
            </div>
          ) : hasFilters ? (
            <div className="w-full rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]">
              <EmptyState
                title="No hay coincidencias"
                description="No existen proyectos que coincidan con los filtros seleccionados."
                size="S"
                showFeaturedIcon={false}
                showActions={false}
                aria-label="Sin resultados para los filtros seleccionados"
              />
            </div>
          ) : (
            <EmptyState
              title="No hay proyectos"
              description="Los proyectos aparecerán aquí cuando estén disponibles."
              size="S"
              showFeaturedIcon
              showActions={false}
            />
          )}

          <footer
            ref={tableFooterRef}
            className="flex min-h-[42px] w-full flex-wrap items-center justify-between gap-x-[12px] gap-y-[12px]"
            aria-label="SelecciÃ³n y paginaciÃ³n de proyectos"
            data-selection-footer="true"
          >
            <span
              className="text-heading-8 shrink-0 text-[var(--color-text-300)]"
              aria-live="polite"
            >
              {selectedVisibleCount} de {visibleProjects.length} seleccionados
            </span>

            {selectedVisibleCount > 0 ? (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button
                  theme="Primary"
                  type="Ghost"
                  size="M"
                  fitContent
                  showLeftIcon
                  iconLeft={<GlobalEdit size="20" color="currentColor" />}
                  showRightIcon={false}
                  disabled={!canChangeVisibility || Boolean(bulkActionPending) || !onBulkAction}
                  aria-busy={bulkActionPending === "change_visibility"}
                  onClick={() => handleBulkAction("change_visibility")}
                >
                  Cambiar visibilidad
                </Button>
                <Button
                  theme="Primary"
                  type="Ghost"
                  size="M"
                  fitContent
                  showLeftIcon
                  iconLeft={<DocumentForward size="20" color="currentColor" />}
                  showRightIcon={false}
                  disabled={!canArchive || Boolean(bulkActionPending) || !onBulkAction}
                  aria-busy={bulkActionPending === "archive"}
                  onClick={() => handleBulkAction("archive")}
                >
                  Archivar
                </Button>
                    <Button
                      theme="Primary"
                      type="Ghost"
                      size="M"
                      fitContent
                      showLeftIcon
                      iconLeft={<DocumentForward size="20" color="currentColor" />}
                      showRightIcon={false}
                      disabled={!canUnarchive || Boolean(bulkActionPending) || !onBulkAction}
                  aria-busy={bulkActionPending === "unarchive"}
                  onClick={() => handleBulkAction("unarchive")}
                >
                  Desarchivar
                </Button>
              </div>
              ) : null}

              <div className="flex items-center gap-[8px]">
                <Button
                  theme="Primary"
                  type="Outline"
                  size="M"
                  fitContent
                  showLeftIcon={false}
                  showRightIcon={false}
                  disabled={!pagination.canGoPrevious || Boolean(bulkActionPending)}
                  aria-label="Ir a la pÃ¡gina anterior de proyectos"
                  onClick={goToPreviousPage}
                >
                  Anterior
                </Button>
                <Button
                  theme="Primary"
                  type="Solid"
                  size="M"
                  fitContent
                  showLeftIcon={false}
                  showRightIcon={false}
                  disabled={!pagination.canGoNext || Boolean(bulkActionPending)}
                  aria-label="Ir a la pÃ¡gina siguiente de proyectos"
                  onClick={goToNextPage}
                >
                  Siguiente pág.
                </Button>
              </div>
            </footer>

          {bulkActionFeedback ? (
            <AlertToast
              trigger={bulkActionFeedback?.id}
              theme={bulkActionFeedback.type === "error" ? "Danger" : "Success"}
              title={bulkActionFeedback.title}
              description={bulkActionFeedback.message}
              onDismiss={() => setBulkActionFeedback(null)}
              aria-label={bulkActionFeedback.title}
            />
          ) : null}
          {assigneeRemovalFeedback ? (
            <AlertToast
              trigger={assigneeRemovalFeedback.id}
              theme="Success"
              title={assigneeRemovalFeedback.names.length === 1
                ? "Encargado retirado"
                : "Encargados retirados"}
              description={`Se retiró a ${assigneeRemovalFeedback.names.join(", ") || "el encargado"} de ${assigneeRemovalFeedback.projectName}. Ya no ${assigneeRemovalFeedback.names.length === 1 ? "tendrá" : "tendrán"} acceso a su información ni funciones.`}
              showActions
              secondaryActionLabel="Cerrar"
              primaryActionLabel="Deshacer"
              primaryActionDisabled={assigneeUndoUnavailable}
              onPrimaryAction={handleUndoAssigneeRemoval}
              onDismiss={() => setAssigneeRemovalFeedback(null)}
              aria-label="El encargado fue retirado correctamente"
            />
          ) : null}
        </>
      )}
    </section>
  );
}

export default AdminActiveProjects;
