import { useNavigate } from "react-router-dom";

import AvatarGroup from "../../../components/ui/AvatarGroup/AvatarGroup.jsx";
import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import ProjectProgress from "../../../components/ui/ProjectProgress/ProjectProgress.jsx";
import ProjectImage from "../../../components/ui/ProjectImage/ProjectImage.jsx";
import Tooltip from "../../../components/ui/Tooltip/Tooltip.jsx";
import { getProjectPath } from "../../../utils/projectRoutes.js";
import { getProjectRequestStatus } from "../../../utils/projectRequestStatus.js";

function ProjectRow({ project }) {
  const navigate = useNavigate();

  return (
    <article className="grid grid-cols-1 items-center gap-[24px] border-b border-[var(--color-neutral-200)] px-0 py-[16px] min-[768px]:grid-cols-[120px_minmax(0,1fr)] min-[1024px]:grid-cols-[160px_minmax(300px,1fr)_auto]">
      <ProjectImage
        src={project.image}
        alt={project.name}
        className="aspect-[262/150] w-full rounded-[var(--radius-2)] min-[768px]:aspect-[120/69] min-[768px]:w-[120px] min-[1024px]:aspect-[160/91.4286] min-[1024px]:w-[160px]"
        imageClassName="object-cover"
      />

      <div className="flex min-w-0 flex-col gap-[8px] overflow-hidden">
        <div className="flex items-center gap-[8px]">
          <h2 className="min-w-0 truncate text-heading-4 text-[var(--color-text-50)]">
            {project.name}
          </h2>
          {project.assigneeAvatars.length ? (
            <Tooltip
              text={project.assigneeAvatars[0].name}
              tipPosition="Top center"
              portal
            >
              <AvatarGroup
                size="S"
                items={project.assigneeAvatars}
                tabIndex={0}
                aria-label={`Encargado: ${project.assigneeAvatars[0].name}`}
              />
            </Tooltip>
          ) : null}
        </div>

        <ProjectProgress />
      </div>

      <Button
        theme="Primary"
        type="Solid"
        size="M"
        fitContent={false}
        showLeftIcon={false}
        showRightIcon={false}
        className="w-full min-w-[105px] min-[768px]:col-start-2 min-[768px]:w-[123px] min-[768px]:justify-self-end min-[1024px]:col-start-3 min-[1024px]:row-start-1"
        onClick={() => navigate(getProjectPath(project))}
      >
        Ver proyecto
      </Button>
    </article>
  );
}

function ProjectRequestRow({ projectRequest, onReview }) {
  const status = getProjectRequestStatus(projectRequest.status);
  const supportingMessage = projectRequest.correctionReason
    || projectRequest.rejectionReason
    || "Puedes consultar el avance y la decisión de nuestro equipo.";
  const actionLabel = projectRequest.status === "changes_requested"
    ? "Corregir solicitud"
    : projectRequest.status === "rejected"
      ? "Crear nueva"
      : projectRequest.status === "converted"
        ? "Ver proyecto"
        : "Ver solicitud";

  return (
    <article className="grid grid-cols-1 items-center gap-[16px] border-b border-[var(--color-neutral-200)] py-[16px] min-[768px]:grid-cols-[120px_minmax(0,1fr)_auto] min-[1024px]:grid-cols-[160px_minmax(300px,1fr)_auto] min-[1024px]:gap-[24px]">
      <ProjectImage
        alt=""
        className="aspect-[262/150] w-full rounded-[var(--radius-2)] min-[768px]:aspect-[120/69] min-[768px]:w-[120px] min-[1024px]:aspect-[160/91.4286] min-[1024px]:w-[160px]"
      />

      <div className="flex min-w-0 flex-col gap-[8px]">
        <h2 className="truncate text-heading-4 text-[var(--color-text-50)]">
          {projectRequest.projectName}
        </h2>
        <div className="flex min-w-0 flex-col gap-[4px]">
          <span className="text-body-3 text-[var(--color-text-300)]">
            {status.label}
          </span>
          <span className="truncate text-body-4 text-[var(--color-text-100)]">
            {supportingMessage}
          </span>
        </div>
      </div>

      <Button
        theme="Primary"
        type="Solid"
        size="M"
        fitContent
        showLeftIcon={false}
        showRightIcon={false}
        className="w-full min-[768px]:w-auto"
        onClick={() => onReview(projectRequest)}
      >
        {actionLabel}
      </Button>
    </article>
  );
}

function ProjectStatusGroup({ group }) {
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-[4px]">
        <Badge
          label={group.status}
          theme={group.badgeTheme}
          variation="Simple"
          size="S"
        />
      </div>
      <div className="flex flex-col">
        {group.projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}

export {
  ProjectRequestRow,
  ProjectStatusGroup,
};
