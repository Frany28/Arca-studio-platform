import Button from "../../../components/ui/Button/Button.jsx";

/**
 * Barra inferior fija de la consulta (Figma 3727:687292 y móvil 3727:687788): superficie
 * `primary-10` translúcida con desenfoque, radio 12 y padding 16. En escritorio separa la
 * acción de consulta de las acciones principales; en móvil apila los botones a ancho completo.
 * Solo muestra acciones de consulta: el resumen con la recomendación y, si la solicitud ya se
 * convirtió, el proyecto creado. Las decisiones administrativas se conectan en otra fase.
 *
 * @param {Object} props - Acciones disponibles.
 * @param {Function} props.onOpenSummary - Abre el drawer «Detalles de Solicitud».
 * @param {Function|null} [props.onOpenProject] - Abre el proyecto creado; null lo oculta.
 * @returns {import("react").ReactElement} Barra de acciones.
 */
function AdminProjectRequestActionBar({ onOpenProject = null, onOpenSummary }) {
  return (
    <div className="sticky bottom-0 z-[5] w-full max-w-[1200px] p-[16px] min-[768px]:p-[24px]">
      <div
        role="group"
        aria-label="Acciones de la solicitud"
        className="flex flex-wrap items-center justify-between gap-[16px] rounded-[var(--radius-3)] bg-[var(--color-primary-10)] p-[16px] backdrop-blur-[12px]"
      >
        <Button
          theme="Primary"
          type="Outline"
          size="M"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          aria-haspopup="dialog"
          className="max-[767px]:!w-full"
          onClick={onOpenSummary}
        >
          Ver resumen &amp; recomendación
        </Button>
        {onOpenProject ? (
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            className="max-[767px]:!w-full"
            onClick={onOpenProject}
          >
            Ver proyecto
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default AdminProjectRequestActionBar;
