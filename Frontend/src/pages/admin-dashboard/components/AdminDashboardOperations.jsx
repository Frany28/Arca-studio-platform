import clsx from "clsx";
import { ArrowRight2, Eye, Warning2 } from "iconsax-react";

import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import IconContainer from "../../../components/ui/IconContainer/IconContainer.jsx";
import Label from "../../../components/ui/Label/Label.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import ProgressBarLabel from "../../../components/ui/ProgressBarLabel/ProgressBarLabel.jsx";
import Tag from "../../../components/ui/Tag/Tag.jsx";
import useMobileLayout from "../../../hooks/useMobileLayout.js";
import { formatProjectDeliveryDate } from "../../../utils/projectDeliveryDate.js";
import { getAdminDashboardPresentation } from "../utils/adminDashboardMobilePresentation.js";

// Presentación temporal: estos eventos no están conectados a una fuente real todavía.
const PRESENTATION_EVENTS = [
  { id: "backup", title: "Error de respaldo automático", time: "Hace 5 min", category: "Sistema" },
  { id: "suspended-user", title: "Usuario suspendido", time: "Hace 1 día", category: "Seguridad" },
  { id: "password-reset", title: "Reestablecimiento de contraseña", time: "Hace 3 días", category: "Seguridad" },
];

/**
 * Fila de evento crítico. En móvil (Figma 3727:678728) la etiqueta y la acción pasan a una
 * segunda línea sin separación vertical, con la acción alineada a la derecha, y la lista
 * no añade espacio antes de la primera fila ni después de la última.
 *
 * @param {Object} props Evento, posición y escala de presentación.
 * @returns {import("react").ReactElement} Fila del evento.
 */
function EventRow({ event, isLast, presentation }) {
  return (
    <div
      className={clsx(
        "flex w-full flex-wrap items-center gap-x-[16px] gap-y-[8px] py-[8px] max-[767px]:gap-y-0 max-[767px]:first:pt-0 max-[767px]:last:pb-0",
        !isLast && "border-b border-[var(--color-neutral-200)]",
      )}
    >
      <div className="flex min-w-[250px] flex-1 items-center gap-[12px]">
        <IconContainer
          size="S"
          type="Danger"
          icon={<Warning2 size="16" variant="Linear" color="currentColor" />}
        />
        <div className="flex min-w-0 flex-col items-start gap-[4px]">
          <p className="text-body-3 truncate text-[var(--color-text-300)]">
            {event.title}
          </p>
          <p className="text-body-4 text-[var(--color-text-100)]">{event.time}</p>
        </div>
      </div>
      <Tag
        label={event.category}
        size={presentation.tagSize}
        className={presentation.tagClassName}
        avatar={false}
        checkbox={false}
        closeIcon={false}
        count={false}
      />
      <Button
        theme="Primary"
        type="Ghost"
        size={presentation.iconButtonSize}
        showText={false}
        showLeftIcon
        showRightIcon={false}
        iconLeft={<Eye size="20" variant="Linear" color="currentColor" />}
        className="max-[767px]:ml-auto"
        aria-label={`Ver ${event.title} (próximamente)`}
        aria-disabled="true"
      />
    </div>
  );
}

/**
 * Fila de próxima entrega con progreso y acceso al proyecto.
 *
 * @param {Object} props Proyecto, callback de selección y escala de presentación.
 * @returns {import("react").ReactElement} Fila de entrega.
 */
function DeliveryRow({ project, onSelect, presentation }) {
  const progress = Math.min(Math.max(Number(project.progress) || 0, 0), 100);

  return (
    <div className="flex w-full items-start gap-[8px]">
      <ProgressBarLabel
        className="min-w-0 flex-1"
        title={project.title || project.name || "Proyecto"}
        sublabel={formatProjectDeliveryDate(project.endDate)}
        value={progress}
        max={100}
        position="top"
        showTitle
        showSublabel
        animated
      />
      <Button
        theme="Primary"
        type="Ghost"
        size={presentation.iconButtonSize}
        showText={false}
        showLeftIcon
        showRightIcon={false}
        iconLeft={<ArrowRight2 size="20" variant="Linear" color="currentColor" />}
        aria-label={`Ver proyecto ${project.title || project.name || "Proyecto"}`}
        onClick={() => onSelect?.(project)}
      />
    </div>
  );
}

function AdminDashboardOperations({ deliveries, deliveriesError, deliveriesLoading, events = PRESENTATION_EVENTS, onProjectSelect, onViewProjects }) {
  const presentation = getAdminDashboardPresentation(useMobileLayout());

  return (
    <section className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-[24px] px-[16px] pb-[24px] pt-[48px] sm:px-[24px] lg:grid-cols-2 lg:px-[48px]">
      <div className="flex min-w-[300px] flex-col gap-[16px] overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-10)] p-[16px] max-sm:min-w-0">
        <Label label="Eventos críticos" required={false} information={false} />
        {events.length ? (
          <div className="flex w-full flex-col">
            {events.map((event, index) => (
              <EventRow
                key={event.id}
                event={event}
                isLast={index === events.length - 1}
                presentation={presentation}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No hay eventos críticos"
            description="Los eventos de seguridad y sistema aparecerán aquí."
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
            Ver historial
          </Button>
        </div>
      </div>

      <div className="flex min-w-[300px] flex-col gap-[16px] overflow-hidden py-[16px] max-sm:min-w-0 max-[767px]:pb-0">
        <Label label="Próximas entregas" required={false} information={false} />
        {deliveriesLoading ? (
          <Loader preset="deliveryList" label="Cargando próximas entregas" />
        ) : deliveriesError ? (
          <EmptyState
            title="No se pudieron cargar las entregas"
            description={deliveriesError}
            size="S"
            showFeaturedIcon={false}
            showActions={false}
          />
        ) : deliveries.length ? (
          <div className="flex w-full flex-col gap-[16px]">
            {deliveries.map((project) => (
              <DeliveryRow
                key={project.id}
                project={project}
                onSelect={onProjectSelect}
                presentation={presentation}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No hay entregas próximas"
            description="Los proyectos con fechas de entrega aparecerán aquí."
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
            onClick={onViewProjects}
          >
            Ver proyectos
          </Button>
        </div>
      </div>
    </section>
  );
}

export default AdminDashboardOperations;
