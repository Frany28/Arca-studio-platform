import Alert from "../../../components/ui/Alert/Alert.jsx";

/**
 * Aviso fijo del formulario de solicitudes cuando faltan datos o hay archivos con problemas.
 * Lo comparten la creación y la edición administrativa; se muestra tras intentar enviar o
 * guardar con errores y se oculta al corregirlos o al cerrarlo.
 *
 * @param {Object} props - Visibilidad y cierre.
 * @param {boolean} props.visible - Si el aviso está visible.
 * @param {() => void} props.onDismiss - Oculta el aviso.
 * @returns {import("react").ReactElement} Aviso posicionado en la esquina inferior.
 */
function ProjectRequestRequiredAlert({ onDismiss, visible }) {
  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-[90] flex w-full max-w-[722.615px] p-[16px] min-[480px]:p-[24px]">
      <Alert
        id="project-request-required-alert"
        visible={visible}
        theme="Danger"
        layout="Box"
        title="Por favor, proporcione la información necesaria."
        description="Revisa los campos señalados y los archivos seleccionados antes de continuar."
        showActions={false}
        showCloseButton
        onDismiss={onDismiss}
        aria-label="Campos obligatorios incompletos"
        className="pointer-events-auto"
      />
    </div>
  );
}

export default ProjectRequestRequiredAlert;
