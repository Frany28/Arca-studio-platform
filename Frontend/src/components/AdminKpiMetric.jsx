import IconContainer from "./ui/IconContainer/IconContainer.jsx";
import clsx from "clsx";

/**
 * Métrica KPI de las vistas administrativas: icono, etiqueta y valor.
 * Por defecto mide al menos 235 px para alinear las métricas en columnas cuando el
 * contenedor las envuelve; crece si el valor es más largo (por ejemplo una fecha con hora)
 * en lugar de desbordar sobre la métrica siguiente, y nunca supera el ancho disponible.
 *
 * @param {Object} props Contenido de la métrica.
 * @param {import("react").ReactNode} props.icon Icono mostrado dentro del IconContainer.
 * @param {string} props.iconType Tema semántico del IconContainer.
 * @param {string} props.label Etiqueta de la métrica.
 * @param {import("react").ReactNode} props.value Valor ya formateado.
 * @param {"default"|"projects"} [props.variant="default"] Proyectos permite ancho intrínseco
 * en tablet y conserva columnas de 235 px cuando caben en el contenedor.
 * @returns {import("react").ReactElement} Métrica individual.
 */
function AdminKpiMetric({ icon, iconType, label, value, variant = "default" }) {
  return (
    <article className={clsx("flex max-w-full shrink-0 items-center gap-[12px]", variant === "projects" ? "min-w-0 @min-[940px]:min-w-[235px]" : "min-w-[235px] pr-[16px]")}>
      <IconContainer size="L" type={iconType} icon={icon} />
      <div className="flex min-w-0 flex-col items-start justify-center gap-[2px]">
        <h2 className="text-heading-8 m-0 whitespace-nowrap text-[var(--color-text-100)]">{label}</h2>
        <strong className="text-heading-4 whitespace-nowrap text-[var(--color-text-200)]">{value}</strong>
      </div>
    </article>
  );
}

export default AdminKpiMetric;
