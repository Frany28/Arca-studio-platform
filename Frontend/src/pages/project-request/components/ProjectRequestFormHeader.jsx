/**
 * Encabezado del formulario de solicitud de proyecto, compartido por la creación del cliente
 * (ProjectRequestPage) y la edición administrativa (AdminProjectRequestEditForm): misma
 * estructura, tipografía, colores y comportamiento responsive (título 32/38 que pasa a 48/58 desde
 * 768 px y subtítulo 14/17 que pasa a 18/21). Solo cambian los textos y el dato lateral opcional,
 * que se oculta por debajo de 480 px.
 *
 * @param {Object} props - Textos del encabezado.
 * @param {string} props.title - Título (h1).
 * @param {string} props.subtitle - Subtítulo bajo el título.
 * @param {import("react").ReactNode} [props.aside] - Dato lateral (por ejemplo, el tiempo estimado).
 * @returns {import("react").ReactElement} Encabezado del formulario.
 */
function ProjectRequestFormHeader({ aside = null, subtitle, title }) {
  return (
    <header className="flex w-full max-w-[850px] flex-wrap items-end justify-between gap-x-[24px] gap-y-[16px]">
      <div className="min-w-0">
        <h1 className="text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">{title}</h1>
        <p className="mt-[4px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">{subtitle}</p>
      </div>
      {aside ? (
        <p className="hidden shrink-0 text-right text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)] min-[480px]:block">{aside}</p>
      ) : null}
    </header>
  );
}

export default ProjectRequestFormHeader;
