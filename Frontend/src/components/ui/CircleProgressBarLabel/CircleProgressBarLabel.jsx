/* Renderiza un progreso circular accesible con porcentaje animado y texto opcional. */
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS,
  CIRCLE_PROGRESS_BAR_LABEL_SIZES,
  CIRCLE_PROGRESS_BAR_LABEL_THEME_COLORS,
} from "./circleProgressBarLabelConfig.js";

const CIRCLE_PROGRESS_BAR_LABEL_NODE_IDS = {
  S: {
    20: "2174:37037",
    50: "2174:37039",
    80: "2174:37052",
    100: "2174:37065",
  },
  M: {
    20: "2175:34097",
  },
  L: {
    20: "2175:34110",
  },
};

const CIRCLE_PROGRESS_BAR_SIZE_STYLES = {
  S: {
    circleSize: 64,
    strokeWidth: 6,
    valueTextClassName: "text-heading-8 tracking-[-0.5px]",
    titleClassName: "text-heading-8 tracking-[-0.5px]",
    descriptionClassName:
      "text-[12px] leading-[14px] tracking-[-0.5px] max-w-[220px]",
  },
  M: {
    circleSize: 96,
    strokeWidth: 10,
    valueTextClassName: "text-[21px] leading-[25.5px] font-medium tracking-[-0.75px]",
    titleClassName: "text-[16px] leading-[19px] font-bold tracking-[-0.5px]",
    descriptionClassName:
      "text-[14px] leading-[17px] tracking-[-0.5px] max-w-[220px]",
  },
  L: {
    circleSize: 192,
    strokeWidth: 14,
    valueTextClassName: "text-[42px] leading-[51px] font-medium tracking-[-1.5px]",
    titleClassName: "text-heading-4 tracking-[-0.5px]",
    descriptionClassName:
      "text-[16px] leading-[19px] tracking-[-0.5px] max-w-[220px]",
  },
};

// Limita un valor al rango indicado antes de usarlo en el progreso.
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Convierte value/max en un porcentaje seguro entre 0 y 100.
function getPercentage(value, max) {
  const safeMax = typeof max === "number" && max > 0 ? max : 100;
  const safeValue = typeof value === "number" ? value : 0;

  return clamp((safeValue / safeMax) * 100, 0, 100);
}

// Redondea el porcentaje para mostrarlo en texto y referencias visuales.
function getRoundedPercentage(percentage) {
  return Math.round(percentage);
}

// Obtiene la referencia visual asociada al tamaño y porcentaje conocido.
function getNodeId(size, roundedPercentage) {
  return CIRCLE_PROGRESS_BAR_LABEL_NODE_IDS[size]?.[roundedPercentage];
}

// Coordina tamaño, animación SVG y atributos accesibles del progreso.
function CircleProgressBarLabel({
  className,
  "aria-label": ariaLabel = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS["aria-label"],
  title = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.title,
  description = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.description,
  value = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.value,
  max = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.max,
  size = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.size,
  theme = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.theme,
  showText = CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.showText,
  ...props
}) {
  const resolvedSize = CIRCLE_PROGRESS_BAR_LABEL_SIZES.includes(size)
    ? size
    : CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.size;
  const sizeStyles = CIRCLE_PROGRESS_BAR_SIZE_STYLES[resolvedSize];
  const progressColor = CIRCLE_PROGRESS_BAR_LABEL_THEME_COLORS[theme]
    || CIRCLE_PROGRESS_BAR_LABEL_THEME_COLORS[CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS.theme];
  const percentage = getPercentage(value, max);
  const [animatedPercentage, setAnimatedPercentage] = useState(0);
  const roundedPercentage = getRoundedPercentage(animatedPercentage);
  const normalizedValue = clamp(value, 0, max);
  const circleRadius = (sizeStyles.circleSize - sizeStyles.strokeWidth) / 2;
  const circumference = 2 * Math.PI * circleRadius;
  const dashOffset = circumference - (animatedPercentage / 100) * circumference;
  const viewBox = `0 0 ${sizeStyles.circleSize} ${sizeStyles.circleSize}`;

  useEffect(() => {
    let animateFrameId = null;
    const resetFrameId = window.requestAnimationFrame(() => {
      setAnimatedPercentage(0);
      animateFrameId = window.requestAnimationFrame(() => {
        setAnimatedPercentage(percentage);
      });
    });

    return () => {
      window.cancelAnimationFrame(resetFrameId);
      if (animateFrameId != null) {
        window.cancelAnimationFrame(animateFrameId);
      }
    };
  }, [percentage]);

  return (
    <div
      className={clsx(
        "flex items-center justify-center gap-[16px]",
        resolvedSize === "L" && "w-full",
        className,
      )}
      data-node-id={getNodeId(resolvedSize, roundedPercentage)}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={normalizedValue}
      aria-valuetext={`${roundedPercentage}%`}
      {...props}
    >
      <div
        className="relative shrink-0"
        style={{
          width: `${sizeStyles.circleSize}px`,
          height: `${sizeStyles.circleSize}px`,
        }}
      >
        <svg
          viewBox={viewBox}
          className="size-full -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={sizeStyles.circleSize / 2}
            cy={sizeStyles.circleSize / 2}
            r={circleRadius}
            fill="none"
            stroke="var(--color-neutral-200)"
            strokeWidth={sizeStyles.strokeWidth}
            className="dark:stroke-[var(--color-neutral-300)]"
          />
          <circle
            cx={sizeStyles.circleSize / 2}
            cy={sizeStyles.circleSize / 2}
            r={circleRadius}
            fill="none"
            stroke={progressColor}
            strokeWidth={sizeStyles.strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap={animatedPercentage >= 99.5 ? "butt" : "round"}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={clsx(
              "font-medium text-[var(--color-text-300)]",
              sizeStyles.valueTextClassName,
            )}
          >
            {roundedPercentage}%
          </span>
        </div>
      </div>

      {showText ? (
        <div className="flex flex-col justify-center gap-[4px] self-stretch">
          <span
            className={clsx(
              "font-medium text-[var(--color-text-300)]",
              resolvedSize !== "S" && "font-bold",
              sizeStyles.titleClassName,
            )}
          >
            {title}
          </span>
          <span
            className={clsx(
              "font-normal text-[var(--color-text-200)] dark:text-[var(--color-text-200)]",
              sizeStyles.descriptionClassName,
            )}
          >
            {description}
          </span>
        </div>
      ) : null}

    </div>
  );
}

export default CircleProgressBarLabel;
