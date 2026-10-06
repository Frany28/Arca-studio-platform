import clsx from "clsx";
import {
  PROGRESS_BAR_LABEL_DEFAULT_PROPS,
  PROGRESS_BAR_LABEL_POSITIONS,
} from "./progressBarLabelConfig.js";

const PROGRESS_BAR_LABEL_NODE_IDS = {
  top: "2061:23181",
  side: "2061:23188",
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPercentage(value, max) {
  const safeMax = typeof max === "number" && max > 0 ? max : 100;
  const safeValue = typeof value === "number" ? value : 0;

  return clamp((safeValue / safeMax) * 100, 0, 100);
}

function formatPercentage(percentage) {
  return `${Math.round(percentage)}%`;
}

function ProgressBarLabel({
  className,
  title = PROGRESS_BAR_LABEL_DEFAULT_PROPS.title,
  sublabel = PROGRESS_BAR_LABEL_DEFAULT_PROPS.sublabel,
  value = PROGRESS_BAR_LABEL_DEFAULT_PROPS.value,
  max = PROGRESS_BAR_LABEL_DEFAULT_PROPS.max,
  position = PROGRESS_BAR_LABEL_DEFAULT_PROPS.position,
  showTitle = PROGRESS_BAR_LABEL_DEFAULT_PROPS.showTitle,
  showSublabel = PROGRESS_BAR_LABEL_DEFAULT_PROPS.showSublabel,
  animated = false,
  valueLabel,
  trackClassName,
  fillClassName,
  ...props
}) {
  const resolvedPosition = PROGRESS_BAR_LABEL_POSITIONS.includes(position)
    ? position
    : PROGRESS_BAR_LABEL_DEFAULT_PROPS.position;
  const percentage = getPercentage(value, max);
  const resolvedValueLabel =
    typeof valueLabel === "string" ? valueLabel : formatPercentage(percentage);
  // El color por defecto solo se aplica sin override: ambas clases arbitrarias tienen la
  // misma especificidad y el orden del CSS generado haría prevalecer siempre el default.
  const resolvedFillClassName = fillClassName || "bg-[var(--color-text-300)]";

  return (
    <div
      className={clsx(
        "flex w-[320px] max-w-full flex-col items-start gap-[4px]",
        className,
      )}
      data-node-id={PROGRESS_BAR_LABEL_NODE_IDS[resolvedPosition]}
      {...props}
    >
      {resolvedPosition === "top" && showTitle ? (
        <div className="flex w-full items-start justify-between gap-[12px]">
          <span className="text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
            {title}
          </span>
          <span className="shrink-0 text-heading-8 tracking-[-0.5px] text-[var(--color-text-100)] dark:text-[var(--color-text-200)]">
            {resolvedValueLabel}
          </span>
        </div>
      ) : null}

      {resolvedPosition === "top" ? (
        <div
          className={clsx(
            "relative h-[8px] w-full overflow-hidden rounded-full bg-[var(--color-neutral-200)] dark:bg-[var(--color-neutral-300)]",
            trackClassName,
          )}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={clamp(value, 0, max)}
          aria-valuetext={resolvedValueLabel}
        >
          <div
            className={clsx(
              "h-full rounded-full",
              animated && "progress-fill-reveal",
              resolvedFillClassName,
            )}
            style={animated
              ? { width: "100%", "--progress-scale": percentage / 100 }
              : { width: `${percentage}%` }}
          />
        </div>
      ) : (
        <div className="flex w-full items-center gap-[8px]">
          <div
            className={clsx(
              "relative h-[8px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-neutral-200)] dark:bg-[var(--color-neutral-300)]",
              trackClassName,
            )}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={clamp(value, 0, max)}
            aria-valuetext={resolvedValueLabel}
          >
            <div
              className={clsx(
                "h-full rounded-full",
                animated && "progress-fill-reveal",
                resolvedFillClassName,
              )}
              style={animated
                ? { width: "100%", "--progress-scale": percentage / 100 }
                : { width: `${percentage}%` }}
            />
          </div>
          <span className="shrink-0 text-heading-8 tracking-[-0.5px] text-[var(--color-text-100)] dark:text-[var(--color-text-200)]">
            {resolvedValueLabel}
          </span>
        </div>
      )}

      {resolvedPosition === "side" && showTitle ? (
        <span className="order-[-1] text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
          {title}
        </span>
      ) : null}

      {showSublabel ? (
        <span className="text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-100)] dark:text-[var(--color-text-200)]">
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}

export default ProgressBarLabel;
