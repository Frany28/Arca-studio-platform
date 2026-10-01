import Button from "../../../components/ui/Button/Button.jsx";
import ProjectImage from "../../../components/ui/ProjectImage/ProjectImage.jsx";
import { getProjectRequestStatus } from "../../../utils/projectRequestStatus.js";

export function ProjectRequestRow({ projectRequest, onReview }) {
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
