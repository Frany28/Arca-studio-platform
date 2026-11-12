import Alert from "../ui/Alert/Alert.jsx";

/**
 * Confirmación administrativa «Aprobar solicitud» con estilo de alerta: reutiliza `Alert` (tema
 * Success, layout Box) dentro de un `alertdialog` modal, con icono, título, descripción, «Cancelar»
 * / «Aprobar» y X. Es una decisión del administrador (nunca una recomendación): al confirmar se crea
 * el proyecto. Un error del servidor sustituye la descripción y conserva el diálogo abierto.
 * Solo presenta y notifica; el guardado lo gestiona `ProjectRequestWorkflowModal`.
 *
 * @param {Object} props - Solicitud, error, estado del envío y callbacks.
 * @param {import("react").RefObject<HTMLElement>} props.dialogRef - Contenedor del diálogo (teclado y foco).
 * @param {string} [props.error] - Error del guardado.
 * @param {string} [props.projectName] - Nombre de la solicitud que se aprueba.
 * @param {() => void} props.onCancel - Cierra sin decidir.
 * @param {() => void} props.onConfirm - Aprueba la solicitud.
 * @param {boolean} props.submitting - Guardado en curso.
 * @returns {import("react").ReactElement} Diálogo.
 */
function ProjectRequestApprovalContent({ dialogRef, error = "", onCancel, onConfirm, projectName = "", submitting }) {
  return (
    <section
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="project-request-approval-title"
      aria-describedby="project-request-approval-description"
      className="w-[480px] max-w-full rounded-[var(--radius-3)] shadow-[var(--shadow-e2)]"
      onClick={(event) => event.stopPropagation()}
    >
      {/* El diálogo anuncia el contenido; la alerta interna no repite el aviso como live region. */}
      <Alert
        role="none"
        aria-live="off"
        aria-label={undefined}
        theme="Success"
        layout="Box"
        className="!max-w-full"
        title={<span id="project-request-approval-title">¿Deseas aprobar la solicitud?</span>}
        content={projectName || undefined}
        description={(
          <span
            id="project-request-approval-description"
            role={error ? "alert" : undefined}
            className={error ? "text-[var(--color-danger-100)]" : undefined}
          >
            {error || "Se creará el proyecto y el siguiente paso será coordinar la reunión inicial con el cliente."}
          </span>
        )}
        visible
        secondaryActionLabel="Cancelar"
        primaryActionLabel={submitting ? "Aprobando..." : "Aprobar"}
        primaryActionDisabled={submitting}
        onSecondaryAction={submitting ? undefined : onCancel}
        onPrimaryAction={onConfirm}
        onDismiss={submitting ? undefined : onCancel}
      />
    </section>
  );
}

export default ProjectRequestApprovalContent;
