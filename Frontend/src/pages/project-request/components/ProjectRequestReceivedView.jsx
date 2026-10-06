import Button from "../../../components/ui/Button/Button.jsx";
import ProgressBarLabel from "../../../components/ui/ProgressBarLabel/ProgressBarLabel.jsx";
import ProgressStepBase from "../../../components/ui/ProgressStepBase/ProgressStepBase.jsx";
import { getCompatibilityLevelLabel } from "../../../utils/projectRequestCompatibility.js";

const REQUEST_STATUS_STEPS = [
  {
    id: "submitted",
    title: "Solicitud enviada",
    subtext: "Completado",
    state: "Completed",
  },
  {
    id: "preliminary-evaluation",
    title: "Evaluación preliminar",
    subtext: "Completado",
    state: "Completed",
  },
  {
    id: "review",
    title: "Revisión",
    subtext: "Pendiente",
    state: "Active",
  },
  {
    id: "first-contact",
    title: "Primer contacto",
    subtext: "Pendiente",
    state: "Incomplete",
  },
  {
    id: "initial-proposal",
    title: "Propuesta inicial",
    subtext: "Pendiente",
    state: "Incomplete",
  },
];

function SectionDivider() {
  return (
    <div
      aria-hidden="true"
      className="h-px w-full bg-[var(--color-neutral-200)]"
    />
  );
}

function AnimatedRequestStep({ animationDelay, state, subtext, title }) {
  const lineColorClassName = state === "Completed"
    ? "bg-[var(--color-accent-300)]"
    : state === "Active"
      ? "bg-[var(--color-text-300)]"
      : "bg-[var(--color-neutral-200)]";

  return (
    <div className="relative min-w-0">
      <span
        aria-hidden="true"
        className={`progress-line-reveal absolute inset-x-0 top-0 h-[4px] rounded-full ${lineColorClassName}`}
        style={{ animationDelay: `${animationDelay}ms` }}
      />
      <ProgressStepBase
        type="Line text"
        size="L"
        state={state}
        title={title}
        subtext={subtext}
        className="!w-full !border-transparent"
      />
    </div>
  );
}

function ProjectRequestReceivedView({ compatibility, onBackToDashboard, onViewRequest, projectRequest }) {
  const score = Number.isFinite(Number(compatibility?.score))
    ? Math.max(0, Math.min(100, Number(compatibility.score)))
    : 0;
  const levelLabel = getCompatibilityLevelLabel(compatibility?.level);
  const observations = Array.isArray(compatibility?.observations)
    ? compatibility.observations.slice(0, 3)
    : [];
  const currentStatus = projectRequest?.status;
  const verificationCompleted = [
    "pending_review",
    "changes_requested",
    "approved",
    "rejected",
    "converted",
  ].includes(currentStatus);
  const reviewCompleted = [
    "changes_requested",
    "approved",
    "rejected",
    "converted",
  ].includes(currentStatus);
  const requestSteps = REQUEST_STATUS_STEPS.map((step, index) => {
    if (index === 0) return step;
    if (index === 1) {
      return {
        ...step,
        state: verificationCompleted ? "Completed" : "Active",
        subtext: verificationCompleted ? "Completado" : "En proceso",
        title: "Verificación administrativa",
      };
    }
    if (index === 2) {
      return {
        ...step,
        state: reviewCompleted ? "Completed" : verificationCompleted ? "Active" : "Incomplete",
        subtext: reviewCompleted ? "Completado" : verificationCompleted ? "En proceso" : "Pendiente",
        title: "Revisión técnica",
      };
    }
    if (index === 3) {
      return {
        ...step,
        state: reviewCompleted ? "Completed" : "Incomplete",
        subtext: reviewCompleted ? "Completado" : "Pendiente",
        title: currentStatus === "changes_requested"
          ? "Correcciones solicitadas"
          : currentStatus === "rejected"
            ? "Solicitud rechazada"
            : currentStatus === "converted"
              ? "Proyecto creado"
              : "Decisión final",
      };
    }
    return null;
  }).filter(Boolean);
  const decisionMessage = projectRequest?.correctionReason || projectRequest?.rejectionReason;
  return (
    <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
      <header className="flex w-full max-w-[850px] flex-col gap-[4px]">
        <h1 className="text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">
          Solicitud recibida
        </h1>
        <p className="text-body-3 text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">
          Hemos completado una evaluación preliminar de tu proyecto.
        </p>
      </header>

      <SectionDivider />

      <section className="grid w-full max-w-[850px] gap-[32px] min-[768px]:grid-cols-[minmax(0,1fr)_minmax(343px,445px)] min-[768px]:gap-[48px]">
        <h2 className="text-heading-7 text-[var(--color-text-200)]">
          Compatibilidad con nuestros servicios
        </h2>

        <ProgressBarLabel
          animated
          title={levelLabel}
          value={score}
          position="side"
          valueLabel={`${score}%`}
          sublabel="Este resultado mide la preparación y coherencia inicial de la solicitud. Nuestro equipo realizará la revisión definitiva."
          fillClassName="bg-[var(--color-success-200)]"
          className="w-full max-w-[445px]"
          aria-label={`Compatibilidad con nuestros servicios: ${score}%`}
        />
        {observations.length ? (
          <ul className="min-[768px]:col-start-2 flex list-disc flex-col gap-[8px] pl-[20px] text-body-3 text-[var(--color-text-200)]">
            {observations.map((observation) => <li key={observation}>{observation}</li>)}
          </ul>
        ) : null}
      </section>

      <SectionDivider />

      <section className="flex w-full max-w-[850px] flex-col gap-[16px]">
        <h2 className="text-heading-7 text-[var(--color-text-200)]">
          Estado actual
        </h2>

        <div
          className="grid w-full grid-cols-1 gap-x-[24px] gap-y-[24px] min-[480px]:grid-cols-2 min-[1024px]:grid-cols-5"
          aria-label="Progreso de la solicitud"
        >
          {requestSteps.map((step, index) => (
            <AnimatedRequestStep
              key={step.id}
              {...step}
              animationDelay={180 + index * 110}
            />
          ))}
        </div>
      </section>

      {decisionMessage ? (
        <p
          className="w-full max-w-[850px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] text-body-3 text-[var(--color-text-200)]"
          role="status"
        >
          {decisionMessage}
        </p>
      ) : null}

      <SectionDivider />

      <p className="w-full max-w-[850px] text-body-2 text-[var(--color-text-100)]">
        Nuestro equipo revisará la información y se comunicará contigo en un plazo de 24–48 horas hábiles.
      </p>

      <footer className="flex w-full max-w-[850px] flex-col-reverse gap-[8px] min-[480px]:flex-row min-[480px]:justify-end">
        <Button
          theme="Primary"
          type="Outline"
          size="M"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          className="!w-full min-[480px]:!w-auto"
          onClick={onViewRequest}
        >
          Ver solicitud
        </Button>
        <Button
          theme="Primary"
          type="Solid"
          size="M"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          className="!w-full min-[480px]:!w-auto"
          onClick={onBackToDashboard}
        >
          Volver al Dashboard
        </Button>
      </footer>
    </div>
  );
}

export default ProjectRequestReceivedView;
