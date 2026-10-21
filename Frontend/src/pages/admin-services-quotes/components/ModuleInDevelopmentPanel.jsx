import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";

/**
 * Estado provisional de una pestaña del módulo cuya funcionalidad aún no está autorizada
 * (Tabulador de servicios, Cotizaciones). Conserva el contexto del módulo y no muestra datos
 * simulados ni acciones que todavía no existen.
 *
 * @param {Object} props - Textos de la pestaña.
 * @param {string} props.title - Título del estado.
 * @param {string} props.description - Qué se podrá hacer cuando esté disponible.
 * @returns {import("react").ReactElement} Estado vacío informativo.
 */
function ModuleInDevelopmentPanel({ title, description }) {
  return (
    <section aria-label={title}>
      <EmptyState
        title={title}
        description={description}
        size="S"
        showActions={false}
        className="min-h-[240px] w-full"
      />
    </section>
  );
}

export default ModuleInDevelopmentPanel;
