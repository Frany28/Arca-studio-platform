import clsx from "clsx";
import { ArrowRight2, Eye } from "iconsax-react";

import AssigneeMultiSelect from "../../../components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Label from "../../../components/ui/Label/Label.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import Tag from "../../../components/ui/Tag/Tag.jsx";
import useMobileLayout from "../../../hooks/useMobileLayout.js";
import { getProjectTypeDisplay } from "../../../utils/projectTypeDisplay.js";
import { getAdminDashboardPresentation } from "../utils/adminDashboardMobilePresentation.js";

const activityTimeFormatter = new Intl.DateTimeFormat("es-VE", {
  hour: "2-digit",
  hour12: true,
  minute: "2-digit",
});

function formatActivityTime(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "--:--"
    : activityTimeFormatter
        .format(date)
        .toUpperCase()
        .replace(/\s*([AP])\.\s*M\.$/, " $1M");
}

function ActivityTime({ value }) {
  return (
    <span className="text-body-4 inline-flex h-[34px] w-[73px] shrink-0 items-center justify-center rounded-[var(--radius-full)] border border-[var(--color-text-300)] bg-[var(--color-neutral-100)] text-[var(--color-text-300)] shadow-[0_0_0_var(--stroke-2)_var(--color-primary-10)]">
      {formatActivityTime(value)}
    </span>
  );
}

/**
 * Fila de actividad reciente. Sigue la estructura de Figma: hora y textos con ancho mínimo
 * de 250 px y la etiqueta del proyecto en el mismo grupo flexible, de modo que en móvil la
 * etiqueta pasa a la segunda línea y la acción queda arriba a la derecha. Desde 768 px el
 * grupo no se envuelve y conserva la fila única existente.
 *
 * @param {Object} props Actividad, posición, callback y escala de presentación.
 * @returns {import("react").ReactElement} Fila de actividad.
 */
function ActivityRow({ activity, isLast, onSelect, presentation }) {
  return (
    <div
      className={clsx(
        "flex min-h-9 w-full items-start gap-[16px] min-[768px]:items-center min-[768px]:gap-[12px]",
        !isLast && "border-b border-[var(--color-neutral-200)] pb-[16px]",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[16px] min-[768px]:flex-nowrap min-[768px]:gap-[12px]">
        <div className="flex min-w-[250px] flex-1 items-center gap-[12px] min-[768px]:min-w-0">
          <ActivityTime value={activity.createdAt} />
          <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <span className="text-body-3 truncate text-[var(--color-text-300)]">
              {activity.title}
            </span>
            <span className="text-body-4 truncate text-[var(--color-text-100)]">
              Por {activity.userName}
            </span>
          </span>
        </div>
        <Tag
          label={activity.projectName}
          size={presentation.tagSize}
          avatar={false}
          checkbox={false}
          closeIcon={false}
          count={false}
          className={clsx("max-w-full min-[768px]:max-w-[132px]", presentation.tagClassName)}
        />
      </div>
      <Button
        theme="Primary"
        type="Ghost"
        size="S"
        showText={false}
        showLeftIcon
        showRightIcon={false}
        iconLeft={<ArrowRight2 size="20" variant="Linear" color="currentColor" />}
        aria-label={`Ver actividad de ${activity.projectName}`}
        onClick={() => onSelect?.(activity)}
      />
    </div>
  );
}

/**
 * Fila de solicitud nueva con asignación de responsables y acceso al detalle.
 * En móvil (Figma 3727:678728) el selector y la acción ocupan una segunda línea completa,
 * separada 10 px del título, y la última fila conserva su línea inferior. Desde 768 px el
 * grupo usa display: contents y la fila mantiene su distribución existente.
 *
 * @param {Object} props Solicitud, responsables disponibles, posición y callbacks.
 * @returns {import("react").ReactElement} Fila de solicitud.
 */
function RequestRow({
  assignees,
  assigneesLoading,
  isLast,
  onAssigneesChange,
  onOpenRequest,
  request,
}) {
  return (
    <div
      className={clsx(
        "flex min-h-9 w-full flex-wrap items-center gap-[12px] max-[767px]:justify-between max-[767px]:gap-x-0 max-[767px]:gap-y-[10px]",
        isLast
          ? "max-[767px]:border-b max-[767px]:border-[var(--color-neutral-200)] max-[767px]:pb-[16px]"
          : "border-b border-[var(--color-neutral-200)] pb-[16px]",
      )}
    >
      {/* En móvil el título usa su ancho natural para que el selector pase a otra línea. */}
      <span className="flex min-w-0 flex-1 flex-col gap-[4px] max-[767px]:flex-initial">
        <span className="text-body-3 truncate text-[var(--color-text-300)]">
          {request.projectName}
        </span>
        <span className="text-body-4 truncate text-[var(--color-text-100)]">
          {getProjectTypeDisplay(request.projectType)}
        </span>
      </span>
      <div className="flex basis-full items-center gap-[8px] min-[768px]:contents">
        <AssigneeMultiSelect
          value={request.assignees || []}
          options={assignees}
          placeholder="Asignar responsables..."
          loading={assigneesLoading}
          className="w-full max-w-[252px] max-[767px]:max-w-none max-[767px]:flex-1"
          aria-label={`Responsables de ${request.projectName}`}
          onChange={(nextAssignees) => onAssigneesChange?.(request, nextAssignees)}
        />
        <Button
          theme="Primary"
          type="Ghost"
          size="S"
          showText={false}
          showLeftIcon
          showRightIcon={false}
          iconLeft={<Eye size="20" variant="Linear" color="currentColor" />}
          aria-label={`Ver solicitud ${request.projectName}`}
          onClick={() => onOpenRequest?.(request)}
        />
      </div>
    </div>
  );
}

function AdminDashboardOverview({
  assignees = [],
  assigneesLoading = false,
  error,
  loading,
  newRequests = [],
  onActivitySelect,
  onRequestAssigneesChange,
  onRequestOpen,
  onRetry,
  recentActivity = [],
}) {
  const presentation = getAdminDashboardPresentation(useMobileLayout());

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-[1200px] px-[16px] pb-[24px] sm:px-[24px] lg:px-[48px]">
        <Loader preset="adminOverview" label="Cargando actividad y solicitudes" />
      </section>
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-[24px] px-[16px] pb-[24px] sm:px-[24px] lg:grid-cols-2 lg:px-[48px]">
      <div className="flex min-w-0 flex-col gap-[16px] overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-10)] p-[16px]">
        <Label label="Actividad reciente" required={false} information={false} />
        {error ? (
          <EmptyState
            title="No se pudo cargar la actividad"
            description={error}
            size="S"
            showFeaturedIcon={false}
            showActions
            showSecondaryAction={false}
            primaryActionLabel="Reintentar"
            onPrimaryAction={onRetry}
          />
        ) : recentActivity.length ? (
          <div className="flex w-full flex-col gap-[16px]">
            {recentActivity.map((activity, index) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                isLast={index === recentActivity.length - 1}
                onSelect={onActivitySelect}
                presentation={presentation}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No hay actividad reciente"
            description="Los cambios de estado y archivos nuevos aparecerán aquí."
            size="S"
            showFeaturedIcon
            showActions={false}
          />
        )}
        <div className="flex w-full justify-end">
          <Button
            theme="Primary"
            type="Ghost"
            size={presentation.textButtonSize}
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            className={presentation.textButtonClassName}
            aria-disabled="true"
          >
            Ver todos
          </Button>
        </div>
      </div>

      <div
        className="flex min-w-0 flex-col gap-[16px] py-[16px] max-[767px]:pb-0"
        data-admin-new-requests="true"
      >
        <Label label="Nuevas Solicitudes" required={false} information={false} />
        {error ? (
          <EmptyState
            title="No se pudieron cargar las solicitudes"
            description={error}
            size="S"
            showFeaturedIcon={false}
            showActions={false}
          />
        ) : newRequests.length ? (
          <div className="flex w-full flex-col gap-[16px]">
            {newRequests.map((request, index) => (
              <RequestRow
                key={request.id}
                request={request}
                isLast={index === newRequests.length - 1}
                assignees={assignees}
                assigneesLoading={assigneesLoading}
                onAssigneesChange={onRequestAssigneesChange}
                onOpenRequest={onRequestOpen}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No hay solicitudes nuevas"
            description="Las solicitudes pendientes aparecerán aquí."
            size="S"
            showFeaturedIcon
            showActions={false}
          />
        )}
      </div>
    </section>
  );
}

export default AdminDashboardOverview;
