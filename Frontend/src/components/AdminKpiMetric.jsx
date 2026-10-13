import IconContainer from "./ui/IconContainer/IconContainer.jsx";

/**
 * Métrica KPI de las vistas administrativas (usuarios y archivos): icono, etiqueta y valor.
 * Mide al menos 235 px, como en Figma, para alinear las métricas en columnas cuando el
 * contenedor las envuelve; crece si el valor es más largo (por ejemplo una fecha con hora)
 * en lugar de desbordar sobre la métrica siguiente, y nunca supera el ancho disponible.
 *
 * @param {Object} props Contenido de la métrica.
 * @param {import("react").ReactNode} props.icon Icono mostrado dentro del IconContainer.
 * @param {string} props.iconType Tema semántico del IconContainer.
 * @param {string} props.label Etiqueta de la métrica.
 * @param {import("react").ReactNode} props.value Valor ya formateado.
 * @returns {import("react").ReactElement} Métrica individual.
 */
function AdminKpiMetric({ icon, iconType, label, value }) {
  return (
    <article className="flex min-w-[235px] max-w-full shrink-0 items-center gap-[12px] pr-[16px]">
      <IconContainer size="L" type={iconType} icon={icon} />
      <div className="flex min-w-0 flex-col items-start justify-center gap-[2px]">
        <h2 className="text-heading-8 m-0 whitespace-nowrap text-[var(--color-text-100)]">{label}</h2>
        <strong className="text-heading-4 whitespace-nowrap text-[var(--color-text-200)]">{value}</strong>
      </div>
    </article>
  );
}

export default AdminKpiMetric;
