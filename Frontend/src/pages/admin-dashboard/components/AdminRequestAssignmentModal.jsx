import { MessageNotif } from "iconsax-react";

import AssigneeMultiSelect from "../../../components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import IconContainer from "../../../components/ui/IconContainer.jsx";
import Modal from "../../../components/ui/Modal/Modal.jsx";

function AdminRequestAssignmentModal({
  assignees,
  assigneesLoading,
  onCancel,
  onConfirm,
  onSelectionChange,
  open,
  selectedAssignees,
  submitting,
}) {
  const closeModal = () => {
    if (!submitting) onCancel?.();
  };

  return (
    <Modal
      visible={open}
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      onClose={closeModal}
      aria-label="Asignar revisión de solicitud"
    >
      <section
        className="flex w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-request-assignment-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex w-full items-start gap-[16px] p-[16px]">
          <IconContainer
            size="M"
            type="Outline"
            icon={<MessageNotif size="20" variant="Linear" color="currentColor" />}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-[16px]">
            <div className="flex flex-col gap-[4px]">
              <h2
                id="admin-request-assignment-title"
                className="text-heading-6 text-[var(--color-text-300)]"
              >
                Asignar revisión de solicitud
              </h2>
              <p className="text-body-3 text-[var(--color-text-200)]">
                La persona a la que asignes se encargará de analizar la solicitud
                de proyecto y enviarte un resumen y recomendación de acciones.
              </p>
            </div>

            <AssigneeMultiSelect
              value={selectedAssignees}
              options={assignees}
              placeholder="Asignar responsable..."
              loading={assigneesLoading}
              disabled={submitting}
              className="w-full"
              aria-label="Responsable de la revisión"
              onChange={onSelectionChange}
            />
          </div>
        </div>

        <footer className="flex w-full items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
          <Button
            theme="Primary"
            type="Outline"
            size="S"
            showLeftIcon={false}
            showRightIcon={false}
            disabled={submitting}
            className="h-[40px] min-w-0 flex-1"
            onClick={closeModal}
          >
            Cancelar
          </Button>
          <Button
            theme="Primary"
            type="Solid"
            size="S"
            showLeftIcon={false}
            showRightIcon={false}
            disabled={submitting || selectedAssignees.length === 0}
            aria-busy={submitting}
            className="h-[40px] min-w-0 flex-1"
            onClick={onConfirm}
          >
            {submitting ? "Confirmando..." : "Confirmar"}
          </Button>
        </footer>
      </section>
    </Modal>
  );
}

export default AdminRequestAssignmentModal;
