import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";

const DEMO_REQUEST_DESCRIPTION =
  "Has recibido una nueva solicitud de proyecto, “Torre Empresarial Nexar” de Luis Gonzáles.";

function AdminRequestLoginAlert({ onAssign, onView, trigger }) {
  return (
    <AlertToast
      trigger={trigger}
      theme="Warning"
      title="Nueva solicitud recibida."
      description={DEMO_REQUEST_DESCRIPTION}
      autoHideMs={0}
      showActions
      secondaryActionLabel="Asignar responsable"
      primaryActionLabel="Ver solicitud"
      onSecondaryAction={onAssign}
      onPrimaryAction={onView}
      aria-label="Nueva solicitud de proyecto por revisar"
    />
  );
}

export default AdminRequestLoginAlert;
